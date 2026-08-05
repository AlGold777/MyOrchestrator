const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HANDLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'attachment-handler.js'),
  'utf8'
);
const BRIDGE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-bridge.js'),
  'utf8'
);
const BOOTSTRAP_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-bootstrap.js'),
  'utf8'
);
const UTILS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-utils.js'),
  'utf8'
);
const PERPLEXITY_TRANSACTION_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'perplexity-composer-transaction.js'),
  'utf8'
);
const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);
const DISPATCH_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);
const GEMINI_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-gemini.js'),
  'utf8'
);
const PROVIDER_SOURCES = {
  ChatGPT: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-chatgpt.js'), 'utf8'),
  Claude: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-claude.js'), 'utf8'),
  Gemini: GEMINI_SRC,
  Grok: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-grok.js'), 'utf8'),
  Perplexity: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-perplexity.js'), 'utf8'),
  Qwen: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-qwen.js'), 'utf8'),
  DeepSeek: fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-deepseek.js'), 'utf8'),
  'Le Chat': fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-lechat.js'), 'utf8')
};
const RESULTS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'results.js'),
  'utf8'
);

describe('attachment bridge authentication', () => {
  test('shared attachment events carry the token and trusted source required by the main-world bridge', () => {
    const attachViaBridge = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('const attachViaBridge'),
      HANDLER_SRC.indexOf('const notifyManualAttachmentRequired')
    );

    expect(BRIDGE_SRC).toContain("detail.bridgeSource === 'content-script'");
    expect(BRIDGE_SRC).toContain('detail.bridgeToken === bridgeToken');
    expect(attachViaBridge).toContain('global.ContentUtils?.getMainBridgeToken?.()');
    expect(attachViaBridge).toContain('bridgeToken,');
    expect(attachViaBridge).toContain("bridgeSource: 'content-script'");
  });

  test('does not report a bridge dispatch when no token is available', () => {
    const attachViaBridge = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('const attachViaBridge'),
      HANDLER_SRC.indexOf('const notifyManualAttachmentRequired')
    );

    expect(attachViaBridge).toMatch(/if \(!bridgeToken\) \{[\s\S]*?return false;/);
  });

  test('preserves the token across bootstrap and ContentUtils load order', () => {
    expect(BOOTSTRAP_SRC).toContain('root.__LLMMainBridgeToken = bridgeToken');
    expect(UTILS_SRC).toContain("typeof window.__LLMMainBridgeToken === 'string'");
    expect(UTILS_SRC).toContain('window.__LLMMainBridgeToken = mainBridgeToken');
  });

  test('Gemini uses CDP file-input attachment without the system clipboard', () => {
    const geminiConfig = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('Gemini: {'),
      HANDLER_SRC.indexOf('Perplexity: {')
    );
    // CDP first, but never CDP-only: see the note in attachment-handler.js (2.81.116).
    expect(geminiConfig).toMatch(/strategies: \['cdp-file-input',/);
    expect(geminiConfig).toContain("'input'");
    expect(geminiConfig).toContain('timeoutMs: 12000');
    expect(geminiConfig).toContain("confirmationMode: 'batch'");
    expect(geminiConfig).toContain('inputFileCountIsEvidence: true');
    expect(geminiConfig).toContain('dispatchIsEvidence: true');
    expect(geminiConfig).toContain('dispatchEvidenceSettleMs: 2500');
    expect(geminiConfig).toContain('inputEvidenceSettleMs: 15000');
    expect(HANDLER_SRC).toContain("type: 'GEMINI_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain("case 'GEMINI_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain("'DOM.setFileInputFiles'");
    expect(ROUTER_SRC).toContain("method !== 'Page.fileChooserOpened'");
    expect(ROUTER_SRC).toContain('params?.backendNodeId');
    expect(ROUTER_SRC).toContain("'Input.dispatchMouseEvent'");
    expect(ROUTER_SRC).toContain("type: 'mousePressed'");
    expect(ROUTER_SRC).toContain("type: 'mouseReleased'");
    expect(ROUTER_SRC).toContain('setFilesParams.backendNodeId = backendNodeId');
    expect(ROUTER_SRC).toContain('gemini_file_chooser_not_opened');
    expect(ROUTER_SRC).toContain('materializeGeminiAttachments');
    expect(ROUTER_SRC).toContain('GEMINI_CDP_FILES_ASSIGNED');
    expect(ROUTER_SRC).toContain('scheduleMaterializedDownloadCleanup(id, 120000)');
    expect(ROUTER_SRC).toContain('/^https:\\/\\/gemini\\.google\\.com\\//i');
    expect(geminiConfig).not.toContain("'clipboard'");
  });

  test('Qwen CDP attachment RPC is sender-gated and targets filesUpload', () => {
    expect(HANDLER_SRC).toContain("type: 'QWEN_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain("case 'QWEN_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain('/^https:\\/\\/chat\\.qwen\\.ai\\//i');
    expect(ROUTER_SRC).toContain('QWEN_FIND_FILE_INPUT_EXPRESSION');
    expect(ROUTER_SRC).toContain('input#filesUpload[type="file"]');
    expect(ROUTER_SRC).toContain("'DOM.setFileInputFiles'");
    expect(ROUTER_SRC).toContain('qwen_file_input_not_found');
  });

  test('Perplexity and Z.ai use sender-gated trusted native file assignment', () => {
    expect(HANDLER_SRC).toContain("type: 'PROVIDER_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain("case 'PROVIDER_CDP_ATTACH_REQUEST'");
    expect(ROUTER_SRC).toContain("model === 'Perplexity'");
    expect(ROUTER_SRC).toContain("model === 'Z.ai'");
    expect(ROUTER_SRC).toContain('PROVIDER_FILE_INPUT_EXPRESSION');
    expect(ROUTER_SRC).toContain("this.dispatchEvent(new Event('change'");
    expect(ROUTER_SRC).toContain('PROVIDER_UPLOAD_TRIGGER_CLICKED');
    expect(ROUTER_SRC).toContain('perplexity_file_input_not_found');
    expect(ROUTER_SRC).toContain('attempt: attempt + 1');
    expect(ROUTER_SRC).toContain("source: backendNodeId ? 'file_chooser' : 'dom_input'");
    const providerAttach = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf('async function dispatchProviderCdpAttachments'),
      ROUTER_SRC.indexOf('async function dispatchTrustedGrokInput')
    );
    const initialInputProbe = providerAttach.indexOf('objectId = await findProviderFileInputObject(target)');
    const firstTrustedClick = providerAttach.indexOf('trustedClickDebuggerObject(target, triggerObjectId)');
    const postClickInputProbe = providerAttach.indexOf(
      'objectId = await findProviderFileInputObject(target)',
      firstTrustedClick
    );
    expect(initialInputProbe).toBeGreaterThan(-1);
    expect(initialInputProbe).toBeLessThan(firstTrustedClick);
    expect(postClickInputProbe).toBeGreaterThan(firstTrustedClick);
    expect(providerAttach).toContain('attempt < 2');
    expect(providerAttach).toContain('perplexity_file_upload_paywall_navigation');
  });

  test('Perplexity assigns a lazy native input after one menu-opening click', async () => {
    // The attachment path raises the window through the shared focus guard, so
    // the real helper is compiled in rather than stubbed.
    const debuggerManagerRuntime = `const debuggerSessionQueuesByTab = new Map();\n${ROUTER_SRC.slice(
      ROUTER_SRC.indexOf('function withManagedDebuggerSession'),
      ROUTER_SRC.indexOf('const DEBUGGER_RPC_TYPES')
    )}`;
    const providerRuntime = debuggerManagerRuntime + ROUTER_SRC.slice(
      ROUTER_SRC.indexOf('const bringToFrontUnlessUserIsElsewhere'),
      ROUTER_SRC.indexOf('const callChromeDownloads')
    ) + ROUTER_SRC.slice(
      ROUTER_SRC.indexOf('const PROVIDER_FILE_INPUT_EXPRESSION'),
      ROUTER_SRC.indexOf('async function dispatchTrustedGrokInput')
    );
    const calls = [];
    let inputProbeCount = 0;
    let trustedClicks = 0;
    const sandbox = {
      Map,
      Promise,
      chrome: {
        runtime: { lastError: null },
        windows: { getLastFocused: (_opts, cb) => cb({ id: 1, focused: true }) }
      },
      materializeGeminiAttachments: async () => [{ id: 1, filename: '/tmp/lazy-input.txt' }],
      providerAttachmentFlightsByTab: new Map(),
      callChromeDebugger: async (method, target, command, params) => {
        calls.push({ method, command, params });
        if (method === 'sendCommand' && command === 'Runtime.evaluate'
          && String(params?.expression || '').includes('input[type="file"]')) {
          inputProbeCount += 1;
          return inputProbeCount === 1
            ? { result: {} }
            : { result: { objectId: 'lazy-file-input' } };
        }
        return {};
      },
      observeGeminiFileChooser: () => ({ getBackendNodeId: () => null, dispose: () => {} }),
      findGeminiUploadTriggerObject: async () => 'add-files-trigger',
      trustedClickDebuggerObject: async () => {
        trustedClicks += 1;
        return { clicked: true, descriptor: { label: 'Add files or tools' } };
      },
      readDebuggerPageUrl: async () => 'https://www.perplexity.ai/',
      emitTelemetry: () => {},
      routerSleep: async () => {},
      scheduleMaterializedDownloadCleanup: () => {}
    };
    vm.createContext(sandbox);
    vm.runInContext(`${providerRuntime}\n;globalThis.runProviderAttach = dispatchProviderCdpAttachments;`, sandbox);

    await expect(sandbox.runProviderAttach(77, 'Perplexity', [{ name: 'lazy-input.txt' }]))
      .resolves.toEqual(expect.objectContaining({ ok: true, uploadedCount: 1 }));
    expect(trustedClicks).toBe(1);
    expect(inputProbeCount).toBe(2);
    const assignment = calls.find((call) => call.command === 'DOM.setFileInputFiles');
    expect(assignment?.params).toEqual(expect.objectContaining({
      objectId: 'lazy-file-input',
      files: ['/tmp/lazy-input.txt']
    }));
  });

  test('internal attachment materialization suppresses Chrome download UI and restores it', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('downloads.ui');
    expect(ROUTER_SRC).toContain('acquireInternalDownloadUiSuppression');
    expect(ROUTER_SRC).toContain('setInternalDownloadUiEnabled(false)');
    expect(ROUTER_SRC).toContain('releaseInternalDownloadUiSuppression');
    expect(ROUTER_SRC).toContain('setInternalDownloadUiEnabled(true)');
    expect(ROUTER_SRC).toContain('download_ui_suppression_unavailable');
  });

  test('Perplexity dismisses only explicit promotional dialogs', () => {
    const source = PROVIDER_SOURCES.Perplexity;
    expect(source).toContain('dismissPerplexityPromotion');
    expect(source).toContain('PERPLEXITY_PROMOTION_DISMISSED');
    expect(source).toContain('PerplexityComposerTransaction?.findOwnedPromotionClose');
    expect(PERPLEXITY_TRANSACTION_SRC).toContain('container === doc.body || container === doc.documentElement');
    expect(PERPLEXITY_TRANSACTION_SRC).toContain('text.length > 1800');
    expect(PERPLEXITY_TRANSACTION_SRC).toContain('rect.width * rect.height > viewportArea * 0.6');
    expect(PERPLEXITY_TRANSACTION_SRC).toContain("container.querySelector?.(DEFAULT_SELECTORS.join(','))");
    const attachmentBlock = source.slice(
      source.indexOf('if (Array.isArray(attachments) && attachments.length)'),
      source.indexOf("console.log('[content-perplexity] Input field found. Injecting prompt...')")
    );
    expect(attachmentBlock).toContain('const promotionGuardTimer = setInterval');
    expect(attachmentBlock.indexOf('const promotionGuardTimer = setInterval'))
      .toBeLessThan(attachmentBlock.indexOf('await attachmentHandler.attach(MODEL, attachments)'));
    expect(attachmentBlock).toContain('clearInterval(promotionGuardTimer)');
    expect(attachmentBlock).toContain('await dismissPromotionDuringAttachment()');
    expect(attachmentBlock).toContain('runAttachmentAttempt');
    expect(attachmentBlock).toContain('if (!result?.success && promotionDismissed');
    expect(attachmentBlock).toContain('Perplexity retry handoff was not acknowledged');
  });

  test('Perplexity clicks the live utility-class close button inside a promotion ancestor', async () => {
    delete window.PerplexityComposerTransaction;
    window.eval(PERPLEXITY_TRANSACTION_SRC);
    document.body.innerHTML = `
      <div id="promotion">Upgrade to Perplexity Pro
        <button class="reset interactable select-none [-webkit-user-drag:none] outline-none font-semibold">
          <svg></svg>
        </button>
      </div>`;
    const promotion = document.getElementById('promotion');
    const close = promotion.querySelector('button');
    promotion.getBoundingClientRect = () => ({ left: 100, top: 100, width: 500, height: 320 });
    close.getBoundingClientRect = () => ({ left: 550, top: 115, width: 32, height: 32 });
    let clicked = 0;
    close.addEventListener('click', () => { clicked += 1; });
    const dismissSource = PROVIDER_SOURCES.Perplexity.slice(
      PROVIDER_SOURCES.Perplexity.indexOf('async function dismissPerplexityPromotion()'),
      PROVIDER_SOURCES.Perplexity.indexOf('const runAntiSleepPulse')
    );
    const factory = new Function(
      'window', 'document', 'getComputedStyle', 'chrome', 'sleep', 'MODEL',
      `${dismissSource}; return dismissPerplexityPromotion;`
    );
    const dismiss = factory(
      window,
      document,
      getComputedStyle,
      { runtime: { sendMessage: jest.fn() } },
      async () => {},
      'Perplexity'
    );

    await expect(dismiss()).resolves.toBe(true);
    expect(clicked).toBe(1);
  });

  test('Perplexity cannot confirm a file from vanished transient upload markup', () => {
    const perplexityConfig = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('Perplexity: {'),
      HANDLER_SRC.indexOf('Qwen: {')
    );
    const confirmation = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('const waitForUploadConfirmation'),
      HANDLER_SRC.indexOf('const findFirst')
    );
    expect(perplexityConfig).toContain('persistentEvidenceRequired: true');
    expect(confirmation).toContain('config.persistentEvidenceRequired !== true && evidenceAt > 0');
    expect(confirmation).toContain("config.persistentEvidenceRequired === true && !evidenceNow");
  });

  test('Perplexity uses a correlated, acknowledged payment-page handoff before resuming', () => {
    const source = PROVIDER_SOURCES.Perplexity;
    expect(source).toContain("url.pathname.startsWith('/pro/payment')");
    expect(source).toContain("url.searchParams.get('origin') === 'fileUpload'");
    expect(source).toContain('closePerplexityFileUploadPaywall');
    expect(source).toContain("'PROVIDER_TRANSIENT_BLOCKER_STARTED'");
    expect(source).toContain("'PROVIDER_TRANSIENT_BLOCKER_CANCELLED'");
    expect(source).toContain("'PROVIDER_TRANSIENT_BLOCKER_CLEARED'");
    expect(source).toContain('PERPLEXITY_BLOCKER_MARKER_VERSION = 2');
    expect(source).toContain('runSessionId: marker.runSessionId');
    expect(source).toContain('dispatchId: marker.dispatchId');
    expect(source).toContain('waitForVisiblePerplexityComposer');
    expect(source).toContain("message?.type === 'PROVIDER_TRANSIENT_BLOCKER_RESUME_PROBE'");
    expect(source.indexOf('if (startedAck?.ok !== true) return false;'))
      .toBeLessThan(source.indexOf('close.click();'));
    const resumeBlock = source.slice(
      source.indexOf('const resumePerplexityAfterPaywall'),
      source.indexOf('const baseAdapter')
    );
    expect(resumeBlock.indexOf('if (ack?.ok === true) {'))
      .toBeLessThan(resumeBlock.indexOf('removePerplexityBlockerMarker(marker.token);', resumeBlock.indexOf('if (ack?.ok === true) {')));
    const orchestrator = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    expect(orchestrator).toContain("errorType === 'attachment_unavailable'");
    expect(ROUTER_SRC).toContain("case 'PROVIDER_TRANSIENT_BLOCKER_STARTED'");
    expect(ROUTER_SRC).toContain("case 'PROVIDER_TRANSIENT_BLOCKER_CANCELLED'");
    expect(ROUTER_SRC).toContain("case 'PROVIDER_TRANSIENT_BLOCKER_CLEARED'");
    expect(ROUTER_SRC).toContain('probePerplexityResumeDocument');
    expect(ROUTER_SRC).toContain('PROVIDER_TRANSIENT_BLOCKER_RESUME');
    expect(ROUTER_SRC).toContain("'perplexity_paywall_resume'");
    expect(ROUTER_SRC).toContain('resumeCount >= 1');
    expect(ROUTER_SRC).toContain('requireCommandAcceptance: true');
    const clearCase = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("case 'PROVIDER_TRANSIENT_BLOCKER_CLEARED'"),
      ROUTER_SRC.indexOf("case 'PROMPT_SUBMITTED'")
    );
    expect(clearCase.indexOf('machine.error({')).toBeLessThan(clearCase.indexOf('machine.reset();'));
    expect(clearCase.indexOf('const result = await self.dispatchPromptToTab')).toBeLessThan(clearCase.indexOf('PROVIDER_TRANSIENT_BLOCKER_RESUME', clearCase.indexOf('PROVIDER_TRANSIENT_BLOCKER_RESUME_ATTEMPT') + 1));
    expect(source.indexOf('chrome.runtime.onMessage.addListener(onRuntimeMessage)'))
      .toBeLessThan(source.lastIndexOf('void reconcilePerplexityFileUploadHandoff();'));
    expect(DISPATCH_SRC).toContain('SEND_DEFERRED_TRANSIENT_BLOCKER');
    expect(DISPATCH_SRC).toContain('STALE_SEND_CALLBACK_QUARANTINED');
    expect(DISPATCH_SRC).toContain('requireCommandAcceptance');
  });

  test('Perplexity GET_ANSWER acknowledges command ownership before asynchronous provider work', () => {
    const source = PROVIDER_SOURCES.Perplexity;
    const handlerAt = source.indexOf("if (message.type === 'GET_ANSWER'");
    const acceptedAt = source.indexOf("status: 'accepted'", handlerAt);
    const injectAt = source.indexOf('injectAndGetResponse(', acceptedAt);
    expect(acceptedAt).toBeGreaterThan(handlerAt);
    expect(injectAt).toBeGreaterThan(acceptedAt);
    expect(source.slice(handlerAt, injectAt)).not.toContain("sendResponse?.({ status: 'success' })");
  });

  test('active provider transactions cannot be overwritten by Round 2 repair', () => {
    const orchestrator = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    expect(PROVIDER_SOURCES['Le Chat']).toContain('reportProviderPipelineState');
    expect(PROVIDER_SOURCES.Perplexity).toContain('reportProviderPipelineState');
    expect(ROUTER_SRC).toContain("case 'PROVIDER_DISPATCH_PIPELINE_STATE'");
    expect(orchestrator).toContain("reason: 'provider_pipeline_active'");
    expect(orchestrator.indexOf('const providerPipelineActive')).toBeLessThan(orchestrator.indexOf("canRepairDispatchInRound2(llmName)"));
  });

  test('Le Chat and Perplexity use the only enabled sender-gated debugger routes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('debugger');
    expect(PROVIDER_SOURCES['Le Chat']).toContain("type: 'PROVIDER_TRUSTED_SEND_REQUEST'");
    expect(PROVIDER_SOURCES.Perplexity).toContain("type: 'PERPLEXITY_TRUSTED_ENTER_REQUEST'");
    expect(PROVIDER_SOURCES.Perplexity).toContain("type: 'PROVIDER_TRUSTED_SEND_REQUEST'");
    expect(ROUTER_SRC).toContain("model === 'Le Chat' && /^https:\\/\\/chat\\.mistral\\.ai\\//i.test(senderUrl)");
    expect(ROUTER_SRC).toContain("model === 'Perplexity' && /^https:\\/\\/(?:www\\.)?perplexity\\.ai\\//i.test(senderUrl)");
    expect(ROUTER_SRC).toContain("case 'PERPLEXITY_TRUSTED_ENTER_REQUEST'");
    expect(ROUTER_SRC).toContain("'PROVIDER_TRUSTED_SEND_FAILED'");
    expect(ROUTER_SRC).toContain("'PROVIDER_TRUSTED_ENTER_FAILED'");
    expect(ROUTER_SRC).toContain("debuggerApiAvailable: typeof chrome.debugger?.attach === 'function'");
    expect(ROUTER_SRC).toContain("const ENABLED_DEBUGGER_RPC_TYPES = new Set([\n    'PROVIDER_TRUSTED_SEND_REQUEST',\n    'PERPLEXITY_TRUSTED_ENTER_REQUEST'");
    expect(ROUTER_SRC).toContain("reason: 'debugger_route_disabled'");
  });

  // 2.81.286 amends the 2.81.195 contract. The point of that correction was to
  // stop burning seconds in a long tail of synthetic click/form/keyboard
  // attempts after a failed trusted transaction — not to make the debugger the
  // only way to submit. Ctrl+Enter now runs first: it is a single ~3s attempt,
  // it needs no debugger attach, and Le Chat accepts it for a pasted prompt.
  // The slow fallbacks it replaced must stay gone.
  test('Le Chat submits with at most Ctrl+Enter then the trusted donor transaction', () => {
    const source = PROVIDER_SOURCES['Le Chat'];
    const ctrlEnterAt = source.indexOf("runStrategy('ctrl_enter'");
    const trustedAt = source.indexOf("type: 'PROVIDER_TRUSTED_SEND_REQUEST'");
    const nextFunctionAt = source.indexOf('\n  function getProseNodes', trustedAt);
    const transaction = source.slice(trustedAt, nextFunctionAt);
    expect(ctrlEnterAt).toBeGreaterThan(-1);
    expect(trustedAt).toBeGreaterThan(ctrlEnterAt);
    // A failed chain still ends in an explicit failure, never a silent success.
    expect(transaction).toContain('Failed to confirm prompt submission.');
    expect(transaction).not.toContain('form.requestSubmit()');
    expect(transaction).not.toContain('dispatchEnter();');
    expect(transaction).not.toContain('waitForSendEnabled(');
    expect(transaction).not.toContain('prompt\n');
  });

  test('Le Chat confirms a new submission signal rather than a pre-existing busy element', () => {
    const source = PROVIDER_SOURCES['Le Chat'];
    expect(source).toContain('const baselineGenerationEvidence = new Set(collectGenerationEvidence())');
    expect(source).toContain('hasFreshGenerationEvidence()');
    expect(source).toContain('countUserTurns() > baselineUserTurns');
    expect(source).not.toContain("if (typing || stopButton || ariaBusy) return true;");
    expect(source).not.toContain('if (beforeTextLength > 0 && !composerText.length) return true;');
    expect(source).not.toContain('composerText.length <= Math.max(1, Math.floor(beforeTextLength * 0.1))');
    expect(source).toContain('trustedBrowserDispatch');
    expect(source).toContain('ProviderSubmitConfirmation');
  });

  test('Gemini waits for the background CDP result and fails before UI confirmation when dispatch fails', () => {
    const cdpRequest = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('const attachGeminiViaCdpFileInput'),
      HANDLER_SRC.indexOf('// Content-script drag&drop fallback')
    );
    const tryVia = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('const tryVia = async'),
      HANDLER_SRC.indexOf('const runStrategy = async')
    );

    expect(cdpRequest).toContain('new Promise((resolve) =>');
    expect(cdpRequest).toContain('resolve(response ||');
    expect(tryVia).toContain('dispatchResult = await dispatchFn()');
    expect(tryVia).toMatch(/if \(!ok\) \{[\s\S]*?ATTACHMENT_DISPATCH_FAILED[\s\S]*?return false;/);
  });

  test('results page cannot steal the Gemini RPC response from background', () => {
    expect(RESULTS_SRC).toContain('const RESULTS_RUNTIME_MESSAGE_TYPES = new Set([');
    expect(RESULTS_SRC).toContain('if (!RESULTS_RUNTIME_MESSAGE_TYPES.has(message?.type)) return false;');
    const ownedTypes = RESULTS_SRC.slice(
      RESULTS_SRC.indexOf('const RESULTS_RUNTIME_MESSAGE_TYPES'),
      RESULTS_SRC.indexOf('// Only acknowledge messages owned by the results page')
    );
    expect(ownedTypes).not.toContain('GEMINI_CDP_ATTACH_REQUEST');
  });

  test('ChatGPT never pastes an attachment as composer text', () => {
    const gptConfig = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('GPT: {'),
      HANDLER_SRC.indexOf('Grok: {')
    );
    expect(gptConfig).toContain("strategies: ['drop', 'input']");
    expect(gptConfig).not.toContain("'paste'");
  });

  test('captures the attachment baseline before paste and blocks an unconfirmed send', () => {
    const baselineAt = HANDLER_SRC.indexOf('const baselineState = captureUploadBaseline(config)');
    const dispatchAt = HANDLER_SRC.indexOf('dispatchResult = await dispatchFn()', baselineAt);
    expect(baselineAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(baselineAt);
    expect(GEMINI_SRC).toContain("type: 'attachment_failed'");
    expect(GEMINI_SRC).toContain('Gemini attachment upload not confirmed');
  });

  test('results startup never retries an attachment request without files', () => {
    expect(RESULTS_SRC).not.toContain('retrying without them');
    expect(RESULTS_SRC).toContain('Request was not retried without files.');
  });

  test('provider adapters fail closed when requested attachments are not confirmed', () => {
    const expectedMessages = {
      ChatGPT: 'ChatGPT attachment upload was not confirmed',
      Claude: 'Claude attachment upload not confirmed',
      Gemini: 'Gemini attachment upload not confirmed',
      Grok: 'Grok attachment upload not confirmed',
      Perplexity: 'Perplexity attachment upload not confirmed',
      Qwen: 'Qwen attachment upload not confirmed',
      DeepSeek: 'DeepSeek attachment upload not confirmed',
      'Le Chat': 'Le Chat attachment upload not confirmed'
    };
    for (const [name, source] of Object.entries(PROVIDER_SOURCES)) {
      expect(source).toContain("type: 'attachment_failed'");
      expect(source).toContain(expectedMessages[name]);
    }
  });

  test('DeepSeek and Le Chat use the shared confirmation-gated attachment handler first', () => {
    const deepSeekConfig = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf('DeepSeek: {'),
      HANDLER_SRC.indexOf("'Le Chat': {")
    );
    const leChatConfig = HANDLER_SRC.slice(
      HANDLER_SRC.indexOf("'Le Chat': {"),
      HANDLER_SRC.indexOf('const sleep =')
    );
    expect(deepSeekConfig).toContain("strategies: ['drop', 'input']");
    expect(deepSeekConfig).toContain('confirmSelectors');
    expect(leChatConfig).toContain("strategies: ['drop', 'input']");
    expect(leChatConfig).toContain('confirmSelectors');
    expect(PROVIDER_SOURCES.DeepSeek).toContain('attachmentHandler.attach(MODEL, options.attachments)');
    expect(PROVIDER_SOURCES['Le Chat']).toContain('attachmentHandler.attach(MODEL, attachments)');
  });

  test('records confirmation evidence and timeout details', () => {
    expect(HANDLER_SRC).toContain('ATTACHMENT_STRATEGY_START');
    expect(HANDLER_SRC).toContain('ATTACHMENT_CONFIRMED');
    expect(HANDLER_SRC).toContain('ATTACHMENT_CONFIRM_TIMEOUT');
    expect(HANDLER_SRC).toContain('inputFileCount');
    expect(HANDLER_SRC).toContain("config.confirmationMode === 'batch' ? 1 : expectedCount");
  });
});
