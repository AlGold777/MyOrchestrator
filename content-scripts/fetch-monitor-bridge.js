// Main-world fetch hook. Reports two different things:
//   * request failures, as before, for rate-limit handling;
//   * the lifecycle of the streaming response that carries a turn, so that the
//     end of generation can be observed on the provider's own protocol instead
//     of being inferred from the rendered page.
//
// The page's Response object is never replaced: the body is read through
// response.clone(), so nothing about the page's own consumption changes. If
// cloning or reading fails the hook degrades to silence, and the observer that
// depends on it reports itself blind rather than reporting completion.
(() => {
  const readInit = () => {
    try {
      const raw = document.currentScript?.dataset?.hfmInit;
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Retained for the isolated-world callers that still set it directly.
    return window.__HFM_INIT__ || null;
  };

  const init = readInit();
  if (!init || !init.channel || !init.model) return;
  try { delete window.__HFM_INIT__; } catch (_) {}
  const { channel, model } = init;

  const compilePatterns = (list) => (Array.isArray(list) ? list : [])
    .map((entry) => {
      try {
        return {
          kind: entry.kind || 'stream_done_token',
          re: new RegExp(entry.source, entry.flags || 'i'),
          terminalReason: entry.terminalReason || null,
          capture: !!entry.capture
        };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);

  const generationPatterns = compilePatterns(init.generationPatterns);
  const terminalPatterns = compilePatterns(init.terminalPatterns);
  const finishReasonPattern = (() => {
    if (!init.finishReasonPattern) return null;
    try { return new RegExp(init.finishReasonPattern.source, init.finishReasonPattern.flags || 'i'); } catch (_) { return null; }
  })();
  const streamContentTypes = Array.isArray(init.streamContentTypes) ? init.streamContentTypes : [];
  const finishReasonMap = init.finishReasonMap || {};
  // Enough to hold a marker split across two frames without holding the answer.
  const TAIL_LIMIT = 4096;

  try {
    const globalState = window.__humanoidFetchMonitor = window.__humanoidFetchMonitor || {
      hooked: false,
      models: [],
      record(modelName) {
        if (!this.models.includes(modelName)) this.models.push(modelName);
      }
    };
    globalState.record(model);
    if (globalState.hooked || typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;
    globalState.hooked = true;

    let streamSeq = 0;

    const post = (payload) => {
      try {
        window.postMessage(Object.assign({
          source: channel,
          models: globalState.models.slice()
        }, payload), '*');
      } catch (_) {}
    };

    const isGenerationRequest = (url) => generationPatterns.some((entry) => entry.re.test(url));

    const isStreamResponse = (response) => {
      let contentType = '';
      try { contentType = response.headers?.get?.('content-type') || ''; } catch (_) { contentType = ''; }
      const lowered = String(contentType).toLowerCase();
      if (streamContentTypes.some((type) => lowered.includes(type))) return true;
      // A chunked response with no declared length is a stream in practice.
      let length = null;
      try { length = response.headers?.get?.('content-length'); } catch (_) { length = null; }
      return !length && !lowered.includes('text/html');
    };

    const detectTerminal = (text) => {
      if (finishReasonPattern) {
        const match = text.match(finishReasonPattern);
        if (match) {
          const raw = String(match[1] || '').toLowerCase();
          if (raw && raw !== 'null') {
            return {
              kind: 'provider_finish_reason',
              finishReason: raw,
              terminalReason: finishReasonMap[raw] || 'UNKNOWN'
            };
          }
        }
      }
      for (const entry of terminalPatterns) {
        if (entry.re.test(text)) {
          return { kind: entry.kind, finishReason: null, terminalReason: entry.terminalReason || 'STOP' };
        }
      }
      return null;
    };

    // Reads the cloned body to the end, reporting only counts and terminal
    // markers. The answer text itself never leaves this function.
    const observeStream = async (clone, context) => {
      const decoder = new TextDecoder('utf-8');
      const reader = clone.body.getReader();
      let bytes = 0;
      let chunkCount = 0;
      let tail = '';
      let terminal = null;
      let firstChunkAt = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          bytes += value.byteLength || value.length || 0;
          chunkCount += 1;
          if (!firstChunkAt) {
            firstChunkAt = Date.now();
            post(Object.assign({ kind: 'stream', phase: 'first_chunk', at: firstChunkAt }, context));
          }
          const decoded = decoder.decode(value, { stream: true });
          const window_ = (tail + decoded);
          const found = detectTerminal(window_);
          if (found && !terminal) {
            terminal = Object.assign({ at: Date.now() }, found);
            post(Object.assign({
              kind: 'stream',
              phase: 'terminal_marker',
              at: terminal.at,
              markerKind: terminal.kind,
              finishReason: terminal.finishReason,
              terminalReason: terminal.terminalReason,
              bytes,
              chunkCount
            }, context));
          }
          tail = window_.length > TAIL_LIMIT ? window_.slice(-TAIL_LIMIT) : window_;
        }
        post(Object.assign({
          kind: 'stream',
          phase: 'end',
          at: Date.now(),
          bytes,
          chunkCount,
          markerKind: terminal?.kind || null,
          finishReason: terminal?.finishReason || null,
          terminalReason: terminal?.terminalReason || null,
          terminalMarkerSeen: !!terminal
        }, context));
      } catch (error) {
        // A read that failed means the observer lost the stream — reported as
        // an error phase, never as an end.
        post(Object.assign({
          kind: 'stream',
          phase: 'error',
          at: Date.now(),
          bytes,
          chunkCount,
          error: error?.message || String(error)
        }, context));
      }
    };

    window.fetch = async (...args) => {
      const requestInfo = args[0];
      const requestInit = args[1] || {};
      const method = requestInit.method || requestInfo?.method || 'GET';
      const url = typeof requestInfo === 'string' ? requestInfo : requestInfo?.url || '';
      const startedAt = Date.now();
      const generation = isGenerationRequest(url);
      if (generation) {
        streamSeq += 1;
        post({ kind: 'stream', phase: 'request', at: startedAt, streamId: `s${streamSeq}`, url, method });
      }
      const streamId = generation ? `s${streamSeq}` : null;
      try {
        const response = await originalFetch(...args);
        const status = Number(response?.status) || 0;
        if (status >= 400) {
          let retryAfter = '';
          try {
            retryAfter = response.headers?.get?.('Retry-After') || '';
          } catch (_) {}
          post({
            status,
            method,
            url,
            retryAfter,
            ok: response?.ok ?? true,
            startedAt,
            endedAt: Date.now()
          });
          if (generation) {
            post({ kind: 'stream', phase: 'error', at: Date.now(), streamId, url, method, status });
          }
          return response;
        }
        if (generation && response?.body && isStreamResponse(response)) {
          try {
            const clone = response.clone();
            post({ kind: 'stream', phase: 'start', at: Date.now(), streamId, url, method, status });
            observeStream(clone, { streamId, url, method, status });
          } catch (error) {
            post({
              kind: 'stream',
              phase: 'unobservable',
              at: Date.now(),
              streamId,
              url,
              method,
              error: error?.message || String(error)
            });
          }
        } else if (generation) {
          post({ kind: 'stream', phase: 'unobservable', at: Date.now(), streamId, url, method, reason: 'not_a_readable_stream' });
        }
        return response;
      } catch (error) {
        post({
          status: 0,
          method,
          url,
          retryAfter: '',
          error: error?.message || String(error),
          startedAt,
          endedAt: Date.now()
        });
        if (generation) {
          post({ kind: 'stream', phase: 'error', at: Date.now(), streamId, url, method, error: error?.message || String(error) });
        }
        throw error;
      }
    };
  } catch (_) {
    /* swallow */
  }
})();
