// Shared attachment handler with per-platform selectors and manual fallback.
(function (global) {
  if (global.AttachmentHandler) return;

  const DEFAULT_MAX_FILES = 5;
  const DEFAULT_TIMEOUT_MS = (typeof TimingConfig?.getTiming === 'function')
    ? TimingConfig.getTiming('attachmentTimeoutMs', 10000)
    : 10000;
  const DEFAULT_POLL_MS = (typeof TimingConfig?.getTiming === 'function')
    ? TimingConfig.getTiming('attachmentPollMs', 200)
    : 200;

  const MODEL_CONFIG = {
    GPT: {
      // ChatGPT delivery, in order of what actually lands an upload:
      //   1. drop  — a synthetic DragEvent carrying a real DataTransfer (built in
      //      the page context via the main-world bridge). This is the same vector
      //      that fixed Qwen, and unlike paste it isn't gated on `isTrusted`, so
      //      ChatGPT's drop handler reads dataTransfer.files and actually uploads.
      //   2. paste — synthetic ClipboardEvent. Manual Ctrl+V works for the user,
      //      but the programmatic paste appears to be ignored (ChatGPT likely gates
      //      clipboardData on a trusted event), so it only sometimes lands. Kept as
      //      a fallback rather than the primary path.
      //   3. input — programmatically setting input.files makes the chip appear but
      //      the upload never completes; last resort only.
      // Confirmation gates each step, so a stuck input chip can't falsely "confirm"
      // and skip the working drop/paste paths — and so the cascade STOPS at the first
      // vector that actually lands the file (no duplicate "file already added").
      //
      // We deliberately do NOT set confirmOptional here. confirmOptional treated a
      // successful *dispatch* as success, but attachViaBridge returns true merely for
      // firing the event (it can't know the file landed) — so the cascade stopped
      // after drop(bridge) even when that vector didn't deliver, and nothing fell
      // back → the file silently never attached (worse than a duplicate, since GPT
      // then answers without the file). Reliable attach > cosmetic duplicate.
      //
      // The remaining duplicate happens only when confirm false-negatives (the chip
      // doesn't match confirmSelectors below). confirmSelectors is broadened with
      // generic upload indicators to catch the real attachment and stop early; if it
      // still misses, the safe failure mode is "works, with a duplicate warning",
      // never "no file". A true fix needs the live ChatGPT attached-file selector.
      preferPaste: false,
      // Never paste a File into ChatGPT: text-like files are interpreted as
      // composer text, which can replace the actual prompt with file contents.
      strategies: ['drop', 'input'],
      finishDragLifecycle: true,
      dropSelectors: [
        '#prompt-textarea',
        'form div[contenteditable="true"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'main form'
      ],
      pasteSelectors: [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'textarea',
        '[role="textbox"]'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      // Broadened with generic upload indicators (blob/data image preview, remove
      // control) so confirm can detect a real upload and break the cascade before it
      // re-attaches. waitForUploadConfirmation compares against a pre-attach baseline,
      // so pre-existing matches never false-confirm. These are best-effort guesses
      // until the live attached-file selector is captured.
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Удалить" i]',
        '[class*="attachment" i]'
      ]
    },
    Grok: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        'button[aria-label*="Upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"]'
      ],
      // Run 1782940321214: the file chip was visibly present in the Grok
      // composer while both input:bridge and input:content confirm timed out —
      // Grok's tailwind/tiptap chips carry no data-testid, so the two narrow
      // selectors false-negatived. Broadened with the same generic upload
      // evidence set as GPT; waitForUploadConfirmation compares against a
      // pre-attach baseline, so pre-existing matches never false-confirm.
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        'button[aria-label*="Удалить" i]',
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="chip" i]'
      ]
    },
    Claude: {
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]',
        '[data-testid="composer-upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-upload-id]',
        '[data-testid*="upload"] [data-upload-id]',
        '[data-testid*="file"]',
        '[data-testid*="attachment"]'
      ],
      confirmGoneSelectors: [
        '[data-testid*="upload"] [role="progressbar"]',
        '[data-testid*="upload"] [aria-busy="true"]',
        '[data-upload-id][aria-busy="true"]'
      ]
    },
    Gemini: {
      // Arbitrary files cannot be represented faithfully with the Web Clipboard
      // API (Finder/Explorer uses native file-reference clipboard formats). Ask
      // the background worker to materialize the bytes and use CDP's trusted
      // DOM.setFileInputFiles path instead.
      // 2.81.195: the debugger permission exists only for the scoped Le Chat and
      // Perplexity submit routes. Attachment CDP RPCs remain policy-disabled, so
      // every strategy list must retain native input/drop fallbacks.
      strategies: ['cdp-file-input', 'input', 'drop'],
      timeoutMs: 12000,
      scaleTimeoutByFileCount: false,
      confirmationMode: 'batch',
      inputFileCountIsEvidence: true,
      // DOM.setFileInputFiles returning successfully is trusted delivery
      // evidence. Gemini may immediately clear the native input and render its
      // file chip in an Angular overlay that the isolated content world cannot
      // inspect, so requiring a second DOM selector produced a false timeout
      // even while the file was visibly attached.
      dispatchIsEvidence: true,
      dispatchEvidenceSettleMs: 2500,
      settleMs: 2500,
      inputEvidenceSettleMs: 15000,
      dropSelectors: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[role="textbox"]'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-test-id*="file"]',
        '[data-testid*="file"]',
        '.file-preview',
        '.file-chip',
        'img[src^="blob:"]',
        'img[src^="data:image"]',
        'button[aria-label*="Remove" i]',
        '[class*="attachment" i]',
        '[class*="upload" i]',
        'mat-chip'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="attachment" i][aria-busy="true"]',
        '[role="progressbar"]',
        'mat-progress-bar'
      ]
    },
    Perplexity: {
      // 2.81.116: fallback added, see the Gemini note above.
      strategies: ['provider-cdp-file-input', 'input'],
      settleMs: 1200,
      // Perplexity's paid-plan modal can briefly render generic upload classes.
      // Those transient nodes are not attachment evidence: a file chip,
      // filename or populated input must still exist when confirmation settles.
      persistentEvidenceRequired: true,
      // A successful bridge dispatch can replace the composer and render a file
      // chip whose classes no longer match our selectors. Never dispatch the same
      // file a second time while confirmation is catching up.
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Add file"]',
        'button[data-testid*="attach"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="file-chip"]',
        '[class*="attachment"]',
        '[class*="upload"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    },
    Qwen: {
      // Current Qwen UI exposes one stable native contract:
      // <input id="filesUpload" multiple type="file">. Assign files to that
      // exact input through trusted CDP instead of synthetic drop/paste/menu UI.
      // 2.81.116: fallback added, see the Gemini note above. The same stable
      // native contract named in the comment is used directly by the `input`
      // strategy, which needs no debugger permission.
      strategies: ['qwen-cdp-file-input', 'input'],
      inputSelectors: [
        'input#filesUpload[type="file"]',
        'input[id="filesUpload"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      timeoutMs: 45000,
      scaleTimeoutByFileCount: false,
      inputFileCountIsEvidence: true,
      settleMs: 3000,
      inputEvidenceSettleMs: 10000,
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[class*="attachment"]',
        '[class*="file"]',
        '[class*="file-card"]'
      ],
      confirmGoneSelectors: [
        '[class*="upload"][aria-busy="true"]',
        '[class*="upload"] [role="progressbar"]'
      ]
    },
    DeepSeek: {
      strategies: ['drop', 'input'],
      dropSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        '[class*="chat-input"]',
        '[class*="composer"]',
        '[class*="input-area"]',
        'main',
        'form'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Upload"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        '[class*="attachment" i]',
        '[class*="file" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="Remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    'Le Chat': {
      strategies: ['drop', 'input'],
      dropSelectors: [
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        '[class*="chat-input"]',
        '[class*="composer"]',
        '[class*="input-area"]',
        'main',
        'form'
      ],
      attachSelectors: [
        'button[aria-label*="Attach"]',
        'button[aria-label*="Upload file"]',
        'button[aria-label*="Upload"]',
        'button[data-testid*="attach"]',
        'button[data-testid*="upload"]'
      ],
      inputSelectors: [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="pdf"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment"]',
        '[data-testid*="file"]',
        '[class*="attachment" i]',
        '[class*="file" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="Remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    'Z.ai': {
      // Z.ai accepts files through the composer paste path (the same native
      // interaction the user verified with copy + Ctrl+V). Do not fall back to
      // unrelated upload controls: prompt dispatch stays blocked until a new
      // attachment chip, filename or preview is observable.
      // 2.81.116: fallback added, see the Gemini note above. Paste is listed first
      // among the fallbacks because it is the native interaction this config was
      // originally written around.
      strategies: ['provider-cdp-file-input', 'paste', 'input'],
      dispatchIsEvidence: true,
      dispatchEvidenceSettleMs: 1200,
      pasteSelectors: [
        '#chat-input',
        'textarea.input-scroll',
        'textarea[placeholder*="help you today" i]',
        'form textarea:not([type="search"])',
        '[contenteditable="true"][role="textbox"]'
      ],
      confirmSelectors: [
        '[data-testid*="attachment" i]',
        '[data-testid*="file" i]',
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    },
    Kimi: {
      // Kimi's composer is a Lexical contenteditable, so paste is the native
      // attachment path; the "+" control next to the composer opens the file
      // input used by the `input` fallback.
      strategies: ['paste', 'input'],
      dispatchIsEvidence: true,
      dispatchEvidenceSettleMs: 1200,
      pasteSelectors: [
        '.chat-input-editor[contenteditable="true"]',
        '.chat-input-editor',
        '.chat-editor [contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]'
      ],
      inputSelectors: [
        'input[type="file"][multiple]',
        'input[type="file"]'
      ],
      confirmSelectors: [
        '[class*="attachment" i]',
        '[class*="file-chip" i]',
        '[class*="upload" i]',
        'img[src^="blob:"]',
        'button[aria-label*="remove" i]'
      ],
      confirmGoneSelectors: [
        '[class*="upload" i][aria-busy="true"]',
        '[class*="upload" i] [role="progressbar"]',
        '[role="progressbar"]'
      ]
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const parseDataUrlToBytes = (dataUrl = '') => {
    try {
      const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
      const base64Part = match ? match[2] : dataUrl;
      const binary = atob(base64Part || '');
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to parse data URL', err);
      return null;
    }
  };

  const hydrateAttachments = (raw = []) => {
    return (raw || [])
      .map((item) => {
        if (!item || !item.name || !item.base64) return null;
        try {
          const bytes = parseDataUrlToBytes(item.base64);
          if (!bytes) return null;
          return new File([bytes], item.name, { type: item.type || 'application/octet-stream' });
        } catch (err) {
          console.warn('[AttachmentHandler] Failed to hydrate attachment', item?.name, err);
          return null;
        }
      })
      .filter(Boolean);
  };

  const resolveConfig = (model, overrides = {}) => {
    const base = MODEL_CONFIG[model] || {};
    return {
      attachSelectors: overrides.attachSelectors || base.attachSelectors || [],
      inputSelectors: overrides.inputSelectors || base.inputSelectors || [],
      dropSelectors: overrides.dropSelectors || base.dropSelectors || [],
      pasteSelectors: overrides.pasteSelectors || base.pasteSelectors || [],
      confirmSelectors: overrides.confirmSelectors || base.confirmSelectors || [],
      confirmGoneSelectors: overrides.confirmGoneSelectors || base.confirmGoneSelectors || [],
      preferPaste: overrides.preferPaste != null ? overrides.preferPaste : (base.preferPaste || false),
      confirmOptional: overrides.confirmOptional != null ? overrides.confirmOptional : (base.confirmOptional || false),
      singleDispatch: overrides.singleDispatch != null ? overrides.singleDispatch : (base.singleDispatch || false),
      confirmationMode: overrides.confirmationMode || base.confirmationMode || 'per-file',
      inputFileCountIsEvidence: overrides.inputFileCountIsEvidence != null
        ? overrides.inputFileCountIsEvidence
        : (base.inputFileCountIsEvidence || false),
      dispatchIsEvidence: overrides.dispatchIsEvidence != null
        ? overrides.dispatchIsEvidence
        : (base.dispatchIsEvidence || false),
      dispatchEvidenceSettleMs: Number.isFinite(overrides.dispatchEvidenceSettleMs)
        ? overrides.dispatchEvidenceSettleMs
        : (base.dispatchEvidenceSettleMs || 0),
      scaleTimeoutByFileCount: overrides.scaleTimeoutByFileCount != null
        ? overrides.scaleTimeoutByFileCount
        : (base.scaleTimeoutByFileCount !== false),
      settleMs: Number.isFinite(overrides.settleMs)
        ? overrides.settleMs
        : (Number.isFinite(base.settleMs) ? base.settleMs : 0),
      inputEvidenceSettleMs: Number.isFinite(overrides.inputEvidenceSettleMs)
        ? overrides.inputEvidenceSettleMs
        : (Number.isFinite(base.inputEvidenceSettleMs) ? base.inputEvidenceSettleMs : 0),
      strategies: overrides.strategies || base.strategies || null,
      finishDragLifecycle: overrides.finishDragLifecycle != null
        ? overrides.finishDragLifecycle
        : (base.finishDragLifecycle || false),
      sequentialFiles: overrides.sequentialFiles != null
        ? overrides.sequentialFiles
        : (base.sequentialFiles || false),
      timeoutMs: Number.isFinite(overrides.timeoutMs)
        ? overrides.timeoutMs
        : (Number.isFinite(base.timeoutMs) ? base.timeoutMs : DEFAULT_TIMEOUT_MS),
      pollMs: Number.isFinite(overrides.pollMs) ? overrides.pollMs : DEFAULT_POLL_MS,
      maxFiles: Number.isFinite(overrides.maxFiles) ? overrides.maxFiles : DEFAULT_MAX_FILES
    };
  };

  const waitForSelectorMatch = async (selectors = [], timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS) => {
    if (!selectors.length) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        if (document.querySelector(selector)) return true;
      }
      await sleep(pollMs);
    }
    return false;
  };

  const collectOpenRoots = () => {
    const roots = [document];
    const seen = new Set();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('*').forEach((el) => {
          if (el.shadowRoot && !seen.has(el.shadowRoot)) roots.push(el.shadowRoot);
        });
      } catch (_) {}
    }
    return roots;
  };

  const countSelectorMatches = (selectors = []) => {
    if (!selectors.length) return 0;
    const matches = new Set();
    collectOpenRoots().forEach((root) => {
      selectors.forEach((selector) => {
        if (!selector) return;
        try { root.querySelectorAll(selector).forEach((el) => matches.add(el)); } catch (_) {}
      });
    });
    return matches.size;
  };

  const normalizeFilename = (value = '') => String(value || '').normalize('NFC').trim().toLowerCase();

  // Provider markup changes frequently, but the file name is the stable piece of
  // evidence users actually see in an attachment chip. Search light-weight visible
  // text/attributes across open shadow roots and compare against the pre-dispatch
  // baseline so an old chip cannot confirm a new request.
  const countFilenameEvidence = (files = []) => {
    const names = files.map((file) => normalizeFilename(file?.name)).filter(Boolean);
    if (!names.length) return 0;
    const haystacks = [];
    collectOpenRoots().forEach((root) => {
      try { haystacks.push(normalizeFilename(root.body?.innerText || root.innerText || root.textContent || '')); } catch (_) {}
      try {
        root.querySelectorAll?.('[aria-label],[title],[data-testid],[data-test-id]').forEach((el) => {
          haystacks.push(normalizeFilename([
            el.getAttribute?.('aria-label'),
            el.getAttribute?.('title'),
            el.getAttribute?.('data-testid'),
            el.getAttribute?.('data-test-id')
          ].filter(Boolean).join(' ')));
        });
      } catch (_) {}
    });
    return names.reduce((count, name) => count + (haystacks.some((text) => text.includes(name)) ? 1 : 0), 0);
  };

  const countAttachedInputFiles = () => {
    const roots = [document];
    const seen = new Set();
    let maxCount = 0;
    while (roots.length) {
      const root = roots.shift();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      try {
        root.querySelectorAll?.('input[type="file"]').forEach((input) => {
          maxCount = Math.max(maxCount, Number(input?.files?.length || 0));
        });
        root.querySelectorAll?.('*').forEach((el) => {
          if (el.shadowRoot) roots.push(el.shadowRoot);
        });
      } catch (_) {}
    }
    return maxCount;
  };

  const emitAttachmentTelemetry = (model, label, details = '', level = 'info', meta = {}) => {
    try {
      chrome.runtime.sendMessage({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: model,
        event: {
          type: 'TELEMETRY',
          label,
          details,
          level,
          meta: { ...meta, event: label }
        }
      });
    } catch (_) {}
  };

  const captureUploadBaseline = (config, files = []) => ({
    confirmCount: countSelectorMatches(config.confirmSelectors || []),
    progressCount: countSelectorMatches(config.confirmGoneSelectors || []),
    inputFileCount: countAttachedInputFiles(),
    filenameEvidenceCount: countFilenameEvidence(files)
  });

  const waitForUploadConfirmation = async (config, expectedCount = 1, baselineState = null, files = []) => {
    const confirmSelectors = config.confirmSelectors || [];
    const confirmGoneSelectors = config.confirmGoneSelectors || [];
    if (!confirmSelectors.length && !confirmGoneSelectors.length) {
      return { confirmed: true, reason: 'NO_CONFIRMATION_SELECTORS', elapsedMs: 0 };
    }
    const totalTimeoutMs = config.scaleTimeoutByFileCount === false
      ? (config.timeoutMs || DEFAULT_TIMEOUT_MS)
      : (config.timeoutMs || DEFAULT_TIMEOUT_MS) * Math.max(1, expectedCount);
    const pollMs = config.pollMs || DEFAULT_POLL_MS;
    const deadline = Date.now() + totalTimeoutMs;
    const baseline = Number.isFinite(baselineState?.confirmCount)
      ? baselineState.confirmCount
      : countSelectorMatches(confirmSelectors);
    let lastCount = baseline;
    let lastInputFileCount = Number(baselineState?.inputFileCount || 0);
    let sawProgress = false;
    let evidenceAt = 0;
    let selectorEvidenceSeen = false;
    const baselineFilenameEvidence = Number(baselineState?.filenameEvidenceCount || 0);
    const requiredDelta = config.confirmationMode === 'batch' ? 1 : expectedCount;

    while (Date.now() < deadline) {
      const currentCount = countSelectorMatches(confirmSelectors);
      const inputFileCount = countAttachedInputFiles();
      const filenameEvidenceCount = countFilenameEvidence(files);
      const selectorEvidence = currentCount >= baseline + requiredDelta;
      const inputEvidence = config.inputFileCountIsEvidence === true
        && inputFileCount >= expectedCount;
      const filenameEvidence = filenameEvidenceCount >= baselineFilenameEvidence + expectedCount;
      const evidenceNow = selectorEvidence || inputEvidence || filenameEvidence;
      if (selectorEvidence) selectorEvidenceSeen = true;
      if (evidenceNow && !evidenceAt) evidenceAt = Date.now();
      const hasEvidence = evidenceNow
        || (config.persistentEvidenceRequired !== true && evidenceAt > 0);
      if (config.persistentEvidenceRequired === true && !evidenceNow) evidenceAt = 0;
      const requiredSettleMs = selectorEvidenceSeen
        ? (config.settleMs || 0)
        : (config.inputEvidenceSettleMs || config.settleMs || 0);
      if (confirmGoneSelectors.length) {
        const progressCount = countSelectorMatches(confirmGoneSelectors);
        if (progressCount > 0) sawProgress = true;
        const settled = progressCount === 0
          && hasEvidence
          && Date.now() - evidenceAt >= requiredSettleMs;
        if (settled || (sawProgress && progressCount === 0 && hasEvidence)) {
          return {
            confirmed: true,
            baselineCount: baseline,
            currentCount,
            inputFileCount,
            filenameEvidenceCount,
            sawProgress,
            elapsedMs: totalTimeoutMs - Math.max(0, deadline - Date.now())
          };
        }
      } else if (hasEvidence && Date.now() - evidenceAt >= requiredSettleMs) {
        return {
          confirmed: true,
          baselineCount: baseline,
          currentCount,
          inputFileCount,
          filenameEvidenceCount,
          sawProgress,
          elapsedMs: totalTimeoutMs - Math.max(0, deadline - Date.now())
        };
      }
      lastCount = currentCount;
      lastInputFileCount = inputFileCount;
      await sleep(pollMs);
    }
    return {
      confirmed: false,
      baselineCount: baseline,
      currentCount: lastCount,
      inputFileCount: lastInputFileCount,
      filenameEvidenceCount: countFilenameEvidence(files),
      sawProgress,
      elapsedMs: totalTimeoutMs
    };
  };

  const findFirst = async (selectors = [], timeoutMs = 2000, pollMs = 150) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        if (!selector) continue;
        const el = document.querySelector(selector);
        if (el) return el;
      }
      await sleep(pollMs);
    }
    return null;
  };

  const attachViaInput = async (files, config) => {
    const attachButton = await findFirst(config.attachSelectors, 1200, 120);
    if (attachButton) {
      try {
        attachButton.click();
        await sleep(300);
      } catch (_) {}
    }
    const input = await findFirst(config.inputSelectors, 3000, 120) || document.querySelector('input[type="file"]');
    if (!input) return false;
    const dt = new DataTransfer();
    files.forEach((file) => {
      try { dt.items.add(file); } catch (_) {}
    });
    try {
      input.files = dt.files;
    } catch (err) {
      console.warn('[AttachmentHandler] Failed to set input files', err);
    }
    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
    try { input.focus?.({ preventScroll: true }); } catch (_) { try { input.focus?.(); } catch (_) {} }
    return true;
  };

  const attachViaPaste = async (files, config = {}) => {
    const selectors = (config.pasteSelectors || []).concat([
      '[contenteditable="true"]', 'textarea', '[role="textbox"]'
    ]);
    const target = await findFirst(selectors, 3000, 120);
    if (!target) return false;
    const dt = new DataTransfer();
    files.forEach((file) => { try { dt.items.add(file); } catch (_) {} });
    dt.effectAllowed = 'copy';
    const factory = () => {
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      if (!ev.clipboardData) {
        try { Object.defineProperty(ev, 'clipboardData', { value: dt }); } catch (_) {}
      } else if (dt.items?.length) {
        dt.items.forEach((item) => { try { ev.clipboardData.items.add(item.getAsFile()); } catch (_) {} });
      }
      return ev;
    };
    try {
      try { target.focus?.({ preventScroll: true }); } catch (_) { try { target.focus?.(); } catch (_) {} }
      target.dispatchEvent(factory());
      await sleep(120);
      target.dispatchEvent(factory());
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] paste attach failed', err);
      return false;
    }
  };

  const attachGeminiViaCdpFileInput = (attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'GEMINI_CDP_ATTACH_REQUEST',
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  const attachQwenViaCdpFileInput = (attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'QWEN_CDP_ATTACH_REQUEST',
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  const attachProviderViaCdpFileInput = (model, attachments) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({
        type: 'PROVIDER_CDP_ATTACH_REQUEST',
        llmName: model,
        attachments
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message || 'runtime_error' });
          return;
        }
        resolve(response || { ok: false, reason: 'empty_response' });
      });
    } catch (_) {
      resolve({ ok: false, reason: 'request_failed' });
    }
  });

  // Content-script drag&drop fallback (the main-world bridge drop is preferred —
  // it builds the DataTransfer in the page context — but this covers the case
  // where the bridge is unavailable). Used for Qwen, which only accepts drop.
  const attachViaDrop = async (files, config) => {
    const selectors = (config.dropSelectors && config.dropSelectors.length)
      ? config.dropSelectors
      : ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
    let target = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { target = el; break; }
    }
    if (!target) return false;
    const dt = new DataTransfer();
    files.forEach((file) => { try { dt.items.add(file); } catch (_) {} });
    dt.effectAllowed = 'copy';
    const rect = target.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const coords = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try {
      try { target.focus?.({ preventScroll: true }); } catch (_) { try { target.focus?.(); } catch (_) {} }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords));
        target.dispatchEvent(ev);
        await sleep(40);
      }
      if (config.finishDragLifecycle === true) {
        await sleep(40);
        for (const type of ['dragleave', 'dragend']) {
          target.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, coords)));
        }
      }
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] drop attach failed', err);
      return false;
    }
  };

  const attachViaBridge = async (attachments, config, mode = 'auto') => {
    if (!attachments || !attachments.length) return false;
    const ensureBridge = global.ContentUtils?.ensureMainWorldBridge;
    if (typeof ensureBridge === 'function') {
      const loaded = await ensureBridge();
      if (!loaded) return false;
    }
    const bridgeToken = global.ContentUtils?.getMainBridgeToken?.();
    if (!bridgeToken) {
      console.warn('[AttachmentHandler] Main-world bridge token unavailable');
      return false;
    }
    try {
      window.dispatchEvent(new CustomEvent('EXT_ATTACH', {
        detail: {
          bridgeToken,
          bridgeSource: 'content-script',
          attachments,
          mode,
          attachSelectors: config.attachSelectors,
          inputSelectors: config.inputSelectors,
          dropSelectors: config.dropSelectors,
          pasteSelectors: config.pasteSelectors,
          finishDragLifecycle: config.finishDragLifecycle === true
        }
      }));
      await sleep(200);
      return true;
    } catch (err) {
      console.warn('[AttachmentHandler] Bridge attach failed', err);
      return false;
    }
  };

  const notifyManualAttachmentRequired = (modelName, attachments = [], reason = '') => {
    if (!attachments || !attachments.length) return;
    const label = modelName || 'LLM';
    const message = `${label}: failed to attach ${attachments.length} file(s) automatically. Please attach manually.`;
    try {
      chrome?.runtime?.sendMessage?.({ type: 'ATTACHMENT_MANUAL_REQUIRED', llmName: label, message });
    } catch (_) {}
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: label,
        event: { type: 'ATTACH', label: 'Manual attachment required', details: message, level: 'warning', meta: { reason } }
      });
    } catch (_) {}
  };

  const attach = async (model, attachments = [], overrides = {}) => {
    if (!attachments || !attachments.length) {
      return { success: true, uploadedCount: 0, failedFiles: [], reason: 'NO_ATTACHMENTS' };
    }
    const config = resolveConfig(model, overrides);
    const files = hydrateAttachments(attachments).slice(0, config.maxFiles);
    if (!files.length) {
      return { success: false, uploadedCount: 0, failedFiles: attachments, reason: 'NO_FILES' };
    }
    if (config.sequentialFiles === true && files.length > 1) {
      const limitedAttachments = attachments.slice(0, files.length);
      let uploadedCount = 0;
      for (let index = 0; index < limitedAttachments.length; index += 1) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_SEQUENCE_ITEM_START', `${index + 1}/${limitedAttachments.length}`, 'info', {
          itemIndex: index,
          itemCount: limitedAttachments.length,
          filename: limitedAttachments[index]?.name || null
        });
        const itemResult = await attach(model, [limitedAttachments[index]], {
          ...overrides,
          sequentialFiles: false,
          maxFiles: 1
        });
        if (!itemResult?.success) {
          return {
            success: false,
            uploadedCount,
            failedFiles: limitedAttachments.slice(index),
            reason: itemResult?.reason || 'SEQUENTIAL_ITEM_FAILED'
          };
        }
        uploadedCount += 1;
        emitAttachmentTelemetry(model, 'ATTACHMENT_SEQUENCE_ITEM_CONFIRMED', `${index + 1}/${limitedAttachments.length}`, 'success', {
          itemIndex: index,
          itemCount: limitedAttachments.length,
          filename: limitedAttachments[index]?.name || null
        });
      }
      return { success: true, uploadedCount, failedFiles: [], reason: 'SEQUENTIAL_CONFIRMED' };
    }
    let attached = false;
    let attempted = false;
    const expectedCount = files.length;

    // Per-model ordered strategy list. Each strategy first tries the main-world
    // bridge (authentic DataTransfer/events in page context), then a content-script
    // fallback, confirming upload after each. Default preserves the historical
    // behaviour (input, plus paste for preferPaste models).
    const strategies = (Array.isArray(config.strategies) && config.strategies.length)
      ? config.strategies
      : (config.preferPaste ? ['paste', 'input'] : ['input']);

    const confirmOptional = config.confirmOptional === true;

    // Run one delivery vector. A successful dispatch is confirmed first (clean
    // success when confirmSelectors match). When confirmOptional, a dispatch that
    // didn't confirm still counts as delivered — this stops the cascade from
    // re-attaching the same file via every remaining vector (the duplicate-insert
    // / "file already added" bug on ChatGPT). Returns 'delivered' to break the
    // loop, or false to fall through to the next vector.
    const tryVia = async (strategy, dispatchFn) => {
      const baselineState = captureUploadBaseline(config);
      baselineState.filenameEvidenceCount = countFilenameEvidence(files);
      const startedAt = Date.now();
      emitAttachmentTelemetry(model, 'ATTACHMENT_STRATEGY_START', strategy, 'info', {
        strategy,
        expectedCount,
        baselineState
      });
      // A strategy that throws must not abort the remaining strategies: a missing
      // API (for example chrome.debugger after the permission was removed) surfaces
      // as a thrown TypeError, and letting it propagate would kill the whole
      // attachment chain and with it the prompt dispatch.
      let dispatchResult;
      try {
        dispatchResult = await dispatchFn();
      } catch (error) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCH_FAILED', strategy, 'warning', {
          strategy,
          expectedCount,
          reason: `dispatch_threw:${error?.message || 'unknown'}`,
          dispatchElapsedMs: Date.now() - startedAt
        });
        return false;
      }
      const ok = dispatchResult === true || dispatchResult?.ok === true;
      if (!ok) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCH_FAILED', strategy, 'warning', {
          strategy,
          expectedCount,
          reason: dispatchResult?.reason || 'dispatch_failed',
          dispatchElapsedMs: Date.now() - startedAt
        });
        return false;
      }
      attempted = true;
      emitAttachmentTelemetry(model, 'ATTACHMENT_DISPATCHED', strategy, 'info', {
        strategy,
        expectedCount,
        dispatchMethod: dispatchResult?.method || strategy,
        dispatchElapsedMs: Date.now() - startedAt
      });
      if (config.dispatchIsEvidence === true) {
        const settleMs = Math.max(0, Number(config.dispatchEvidenceSettleMs || 0));
        if (settleMs) await sleep(settleMs);
        emitAttachmentTelemetry(model, 'ATTACHMENT_CONFIRMED', strategy, 'success', {
          strategy,
          expectedCount,
          reason: 'TRUSTED_DISPATCH',
          dispatchMethod: dispatchResult?.method || strategy,
          elapsedMs: Date.now() - startedAt
        });
        return true;
      }
      const confirmation = await waitForUploadConfirmation(config, expectedCount, baselineState, files);
      if (confirmation?.confirmed) {
        emitAttachmentTelemetry(model, 'ATTACHMENT_CONFIRMED', strategy, 'success', {
          strategy,
          expectedCount,
          ...confirmation
        });
        return true;
      }
      emitAttachmentTelemetry(model, 'ATTACHMENT_CONFIRM_TIMEOUT', strategy, 'warning', {
        strategy,
        expectedCount,
        ...confirmation
      });
      return confirmOptional;
    };

    const runStrategy = async (name) => {
      // Bridge first (authentic events in page context). Crucially, if the bridge
      // dispatch already delivered we must NOT also run the content-script fallback
      // for the same vector — that would attach the file twice. The content path
      // runs only when the bridge dispatch itself didn't deliver.
      if (name === 'cdp-file-input') {
        return tryVia(name, () => attachGeminiViaCdpFileInput(attachments));
      }
      if (name === 'qwen-cdp-file-input') {
        return tryVia(name, () => attachQwenViaCdpFileInput(attachments));
      }
      if (name === 'provider-cdp-file-input') {
        return tryVia(name, () => attachProviderViaCdpFileInput(model, attachments));
      }
      if (name === 'drop') {
        if (await tryVia('drop:bridge', () => attachViaBridge(attachments, config, 'drop'))) return true;
        if (attempted && config.singleDispatch) return false;
        if (await tryVia('drop:content', () => attachViaDrop(files, config))) return true;
        return false;
      }
      if (name === 'paste') {
        if (await tryVia('paste:bridge', () => attachViaBridge(attachments, config, 'paste'))) return true;
        if (attempted && config.singleDispatch) return false;
        if (await tryVia('paste:content', () => attachViaPaste(files, config))) return true;
        return false;
      }
      // input
      if (await tryVia('input:bridge', () => attachViaBridge(attachments, config, 'input'))) return true;
      if (attempted && config.singleDispatch) return false;
      if (await tryVia('input:content', () => attachViaInput(files, config))) return true;
      return false;
    };

    for (const strat of strategies) {
      attached = await runStrategy(strat);
      if (attached || (attempted && config.singleDispatch)) break;
    }
    if (!attached) {
      return {
        success: false,
        uploadedCount: 0,
        failedFiles: attachments,
        reason: attempted ? 'TIMEOUT' : 'MANUAL_REQUIRED'
      };
    }
    try {
      chrome?.runtime?.sendMessage?.({
        type: 'SMART_ATTACHMENT_CONFIRMED',
        llmName: model || null,
        uploadedCount: files.length,
        reason: 'OK',
        ts: Date.now()
      });
    } catch (_) {}
    return { success: true, uploadedCount: files.length, failedFiles: [], reason: 'OK' };
  };

  global.AttachmentHandler = {
    attach,
    notifyManualAttachmentRequired,
    hydrateAttachments
  };
})(typeof window !== 'undefined' ? window : self);
