// shared/provider-stream-semantics.js
// What a provider's own stream means: which requests carry a turn, which bytes
// say the turn is over, and whether one stream is known to equal one turn.
//
// The semantics of a network event are a per-provider contract, not something
// an observer may infer for itself. This table is that contract, and it is
// deliberately conservative: `oneToOne` stays false until a provider has been
// measured, so stream closure enters the ladder as P1 suspicion rather than
// proof. Flipping a flag here is a calibration result, not a code cleanup.

(function initProviderStreamSemantics(root) {
  'use strict';

  const SCHEMA_VERSION = 1;

  // Bytes that mean "this turn produced its last token". Matched against the
  // decoded tail of the stream, so a marker split across two chunks is still
  // seen.
  const GENERIC_TERMINAL_PATTERNS = Object.freeze([
    { kind: 'stream_done_token', pattern: /(^|\n)data:\s*\[DONE\]/i },
    { kind: 'provider_message_stop', pattern: /"type"\s*:\s*"message_stop"/i },
    { kind: 'provider_status_completed', pattern: /"status"\s*:\s*"(completed|complete|finished|success)"/i },
    { kind: 'stream_done_token', pattern: /(^|\n)event:\s*(done|complete|message_stop)/i },
    { kind: 'stream_done_token', pattern: /"(done|is_?done|isFinal|is_final|finished)"\s*:\s*true/i }
  ]);

  const FINISH_REASON_PATTERN = /"(?:finish_reason|finishReason|stop_reason|stopReason)"\s*:\s*"([a-z_\-]+)"/i;

  // finish_reason values, mapped onto the terminal reasons of the result
  // contract. `length` is terminal and incomplete at the same time — that is
  // exactly why the two are separate axes.
  const FINISH_REASON_MAP = Object.freeze({
    stop: 'STOP',
    end_turn: 'STOP',
    stop_sequence: 'STOP',
    complete: 'STOP',
    completed: 'STOP',
    length: 'LENGTH_LIMIT',
    max_tokens: 'LENGTH_LIMIT',
    content_filter: 'CONTENT_FILTER',
    safety: 'CONTENT_FILTER',
    tool_use: 'TOOL_CALL',
    tool_calls: 'TOOL_CALL',
    function_call: 'TOOL_CALL',
    error: 'ERROR',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
    aborted: 'CANCELLED'
  });

  const STREAM_CONTENT_TYPES = Object.freeze([
    'text/event-stream',
    'application/x-ndjson',
    'application/stream+json',
    'application/jsonl',
    'text/plain'
  ]);

  const PROVIDERS = Object.freeze({
    chatgpt: {
      generation: [/\/backend-api\/(f\/)?conversation/i, /\/backend-alt\/conversation/i],
      oneToOne: false
    },
    claude: {
      generation: [/\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/i, /\/completion(\?|$)/i],
      oneToOne: false
    },
    gemini: {
      generation: [/StreamGenerate/i, /assistant\.lamda\.BardFrontendService/i],
      oneToOne: false
    },
    grok: {
      generation: [/\/rest\/app-chat\/conversations\/[^/]+\/responses/i, /\/rest\/app-chat\/conversations\/new/i],
      oneToOne: false
    },
    qwen: {
      generation: [/\/api\/v[0-9]+\/chat\/completions/i, /\/api\/chat\/completions/i],
      oneToOne: false
    },
    deepseek: {
      generation: [/\/api\/v[0-9]+\/chat\/completion/i],
      oneToOne: false
    },
    lechat: {
      generation: [/\/api\/chat(\/|\?|$)/i, /\/api\/conversations?\/[^/]+\/messages/i],
      oneToOne: false
    },
    perplexity: {
      generation: [/\/rest\/sse\/perplexity_ask/i, /perplexity_ask/i],
      oneToOne: false
    },
    zai: {
      generation: [/\/api\/chat\/completions/i, /\/api\/v[0-9]+\/chat\/completions/i],
      oneToOne: false
    },
    kimi: {
      generation: [/\/api\/chat\/[^/]+\/completion(\/stream)?/i, /\/completion\/stream/i],
      oneToOne: false
    }
  });

  function normalizePlatform(platform) {
    return String(platform || '').trim().toLowerCase();
  }

  function getProfile(platform) {
    return PROVIDERS[normalizePlatform(platform)] || null;
  }

  // Whether this request is the one that carries the turn. Unknown platforms
  // fall back to "no opinion" — the observer then reports capability loss
  // instead of guessing that some request was the generation.
  function isGenerationRequest(platform, url) {
    const profile = getProfile(platform);
    const target = String(url || '');
    if (!profile) return { match: false, reason: 'unknown_platform' };
    const matched = profile.generation.some((pattern) => pattern.test(target));
    return { match: matched, reason: matched ? 'generation_endpoint' : 'not_generation_endpoint' };
  }

  function isStreamContentType(contentType) {
    const value = String(contentType || '').toLowerCase();
    return STREAM_CONTENT_TYPES.some((type) => value.includes(type));
  }

  function isOneToOne(platform) {
    return getProfile(platform)?.oneToOne === true;
  }

  // Reads a decoded slice of the stream and reports the strongest terminal fact
  // in it. Returns null when the slice says nothing terminal — silence here is
  // never turned into a terminal claim.
  function detectTerminal(text) {
    const chunk = String(text || '');
    if (!chunk) return null;
    const finishMatch = chunk.match(FINISH_REASON_PATTERN);
    if (finishMatch) {
      const raw = String(finishMatch[1] || '').toLowerCase();
      const terminalReason = FINISH_REASON_MAP[raw] || 'UNKNOWN';
      if (raw && raw !== 'null') {
        return { kind: 'provider_finish_reason', finishReason: raw, terminalReason };
      }
    }
    for (const entry of GENERIC_TERMINAL_PATTERNS) {
      if (entry.pattern.test(chunk)) {
        return { kind: entry.kind, finishReason: null, terminalReason: 'STOP' };
      }
    }
    return null;
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    PROVIDERS,
    GENERIC_TERMINAL_PATTERNS,
    FINISH_REASON_MAP,
    STREAM_CONTENT_TYPES,
    normalizePlatform,
    getProfile,
    isGenerationRequest,
    isStreamContentType,
    isOneToOne,
    detectTerminal
  });

  root.ProviderStreamSemantics = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
