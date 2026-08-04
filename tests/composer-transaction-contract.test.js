const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('composer transaction contract', () => {
  test('shared paste transaction rejects and avoids duplicated prompt bodies', async () => {
    delete window.ContentUtils;
    window.eval(read('content-scripts/content-utils.js'));
    const prompt = 'Explain the transaction boundary and return a structured answer.';
    expect(window.ContentUtils.countPromptOccurrences(`${prompt}\n${prompt}`, prompt)).toBe(2);
    expect(window.ContentUtils.promptMatchesComposer(`${prompt}\n${prompt}`, prompt)).toBe(false);

    document.body.innerHTML = '<textarea></textarea>';
    const composer = document.querySelector('textarea');
    const originalExecCommand = document.execCommand;
    let insertCount = 0;
    document.execCommand = jest.fn((command, _ui, value) => {
      if (command === 'delete') composer.value = '';
      if (command === 'insertText') {
        insertCount += 1;
        composer.value += String(value || '');
      }
      return true;
    });
    await window.ContentUtils.pasteTextFirst(composer, prompt);
    expect(composer.value).toBe(prompt);
    expect(insertCount).toBe(1);
    document.execCommand = originalExecCommand;
  });

  test('shared prompt evidence tolerates rich-editor zero-width nodes but requires both prompt ends', () => {
    const utils = read('content-scripts/content-utils.js');
    expect(utils).toContain("replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '')");
    expect(utils).toContain('actual.includes(head) && actual.includes(tail)');
    expect(utils).toContain('promptMatchesComposer: pasteMatchesPrompt');
  });

  test('Round 2 reports active provider ownership as deferred and does not probe the busy tab', () => {
    const orchestrator = read('background/job-orchestrator.js');
    const activeBranch = orchestrator.slice(
      orchestrator.indexOf('if (!confirmedByContent && providerPipelineActive)'),
      orchestrator.indexOf('if (!confirmedByContent && ROUND2_REPAIR_MODELS.has', orchestrator.indexOf('if (!confirmedByContent && providerPipelineActive)'))
    );
    expect(activeBranch).toContain("endMeta.outcome = 'deferred'");
    expect(activeBranch).not.toContain('triggerResponseCollectionPing');
    expect(activeBranch).not.toContain('scheduleAdaptiveCollectionProbe');
    expect(read('results.js')).toContain('`${timeLabel} deferred`');
    expect(read('results-devtools.js')).toContain('`${timeLabel} (deferred)`');
  });
  test('shared preparation gate verifies the current prompt instead of any text', () => {
    const utils = read('content-scripts/content-utils.js');
    const gate = utils.slice(utils.indexOf('const ensurePromptPrepared'), utils.indexOf('// Report the on-page answer'));
    expect(gate).toContain('pasteMatchesPrompt(current, payload)');
    expect(gate).toContain("reason: 'prompt_not_present'");
    expect(utils).toContain('ensurePromptPrepared,');
  });

  test('DeepSeek publishes PROMPT_SUBMITTED only after preparation and confirmed send', () => {
    const deepseek = read('content-scripts/content-deepseek.js');
    const injection = deepseek.slice(deepseek.indexOf("console.log('[DeepSeek] Input found, injecting...')"), deepseek.indexOf("console.log('[DeepSeek] Waiting for response...')"));
    expect(injection).toContain('ContentUtils.ensurePromptPrepared');
    expect(injection).toContain("type: 'prompt_injection_failed'");
    expect(injection).toContain('const sendConfirmed = await sendComposer(composer)');
    expect(injection).toContain("type: 'send_failed'");
    expect(injection.indexOf('if (!sendConfirmed)')).toBeLessThan(injection.indexOf("type: 'PROMPT_SUBMITTED'"));
    expect(deepseek).toContain('return confirmed;');
  });

  test('DeepSeek attachment dispatch may fall through until evidence confirms delivery', () => {
    const handler = read('content-scripts/attachment-handler.js');
    const config = handler.slice(handler.indexOf('DeepSeek: {'), handler.indexOf("'Le Chat': {"));
    expect(config).toContain("strategies: ['drop', 'input']");
    expect(config).not.toContain('singleDispatch: true');
  });

  test.each([
    ['Perplexity', 'content-scripts/content-perplexity.js'],
    ['Le Chat', 'content-scripts/content-lechat.js']
  ])('%s uses exact prompt preparation before PROMPT_SUBMITTED', (name, file) => {
    const source = read(file);
    const gateAt = source.indexOf('ContentUtils.ensurePromptPrepared');
    const submittedAt = source.indexOf("type: 'PROMPT_SUBMITTED'", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(source).toContain(`${name} confirmed attachment handler unavailable`);
    expect(submittedAt).toBeGreaterThan(gateAt);
  });

  test('Perplexity does not publish submit after an unconfirmed send', () => {
    const source = read('content-scripts/content-perplexity.js');
    const trustedSendAt = source.indexOf("type: 'PROVIDER_TRUSTED_SEND_REQUEST'");
    const trustedEnterAt = source.indexOf("type: 'PERPLEXITY_TRUSTED_ENTER_REQUEST'", trustedSendAt);
    const pageButtonAt = source.indexOf('const sendButton = resolveSendButton()', trustedSendAt);
    const failedAt = source.indexOf("type: 'send_failed'", trustedSendAt);
    const submittedAt = source.indexOf("type: 'PROMPT_SUBMITTED'", failedAt);
    expect(trustedSendAt).toBeGreaterThan(-1);
    expect(trustedEnterAt).toBeGreaterThan(trustedSendAt);
    expect(pageButtonAt).toBe(-1);
    expect(failedAt).toBeGreaterThan(-1);
    expect(submittedAt).toBeGreaterThan(failedAt);
    expect(source).toContain('findOwnedPerplexityPromptComposer(prompt)');
    expect(source).toContain('actual === expected');
    expect(source).toContain('countPerplexityUserTurns()');
    expect(source).toContain('collectPerplexityGenerationEvidence()');
    expect(source).not.toContain('if (!liveComposer) return true;');
    expect(source).toContain('trustedBrowserDispatch');
    expect(source).toContain('PERPLEXITY_DUPLICATE_DISPATCH_SUPPRESSED');
    expect(source).toContain('perplexityDispatchGate.begin');
    expect(source).toContain('perplexityDispatchGate.finish');
    expect(source).not.toContain("const typing = document.querySelector('[aria-busy=\"true\"]");
  });

  // 2.81.199: in-page insertion stays the primary path, but it is no longer the
  // only one. Field evidence 2.81.196 and 2.81.198 both ended
  // `prompt_injection_failed` after three prepare() attempts, so the donor's
  // native input transaction is restored as the fallback behind it.
  test('Perplexity falls back to the native input transaction only after prepare fails', () => {
    const source = read('content-scripts/content-perplexity.js');
    const prepareAt = source.indexOf('PerplexityComposerTransaction.prepare');
    const trustedAt = source.indexOf("type: 'PERPLEXITY_TRUSTED_INPUT_REQUEST'");
    const throwAt = source.indexOf("throw { type: 'prompt_injection_failed'");
    expect(prepareAt).toBeGreaterThan(-1);
    expect(trustedAt).toBeGreaterThan(prepareAt);
    // The native retry must come before giving up, otherwise it is unreachable.
    expect(trustedAt).toBeLessThan(throwAt);
    const router = read('background/message-router.js');
    const enabled = router.slice(
      router.indexOf('const ENABLED_DEBUGGER_RPC_TYPES'),
      router.indexOf(']);', router.indexOf('const ENABLED_DEBUGGER_RPC_TYPES'))
    );
    expect(enabled).toContain('PERPLEXITY_TRUSTED_INPUT_REQUEST');
  });

  test('Perplexity acquires a composer before considering a strictly-owned promotion overlay', () => {
    const source = read('content-scripts/content-perplexity.js');
    const searchAt = source.indexOf('waitForPerplexityComposer(inputSelectors, 8000)');
    const dismissAt = source.indexOf('await dismissPerplexityPromotion()', searchAt);
    expect(searchAt).toBeGreaterThan(-1);
    expect(dismissAt).toBeGreaterThan(searchAt);
    expect(source.slice(searchAt, dismissAt)).toContain('if (!inputField)');
    expect(source).toContain('PerplexityComposerTransaction.prepare');
    expect(source).toContain('PERPLEXITY_DRAFT_ACCEPTED');
    expect(source).toContain('PERPLEXITY_DRAFT_REJECTED');
  });

  test('trusted Perplexity actions reject a composer value altered by an attachment chip', () => {
    const router = read('background/message-router.js');
    const loadBuilder = (name, nextMarker) => {
      const start = router.indexOf(`const ${name} =`);
      const end = router.indexOf(nextMarker, start);
      const declaration = router.slice(start, end);
      return new Function(`${declaration}; return ${name};`)(); // eslint-disable-line no-new-func
    };
    const buildFocus = loadBuilder('buildProviderComposerFocusExpression', '\n\nasync function dispatchProviderTrustedEnter');
    const buildSend = loadBuilder('buildProviderSendControlExpression', '\n\nasync function dispatchProviderTrustedSend');
    const prompt = 'Compare the attached architecture report and identify every transaction boundary that lacks explicit confirmation.';
    const normalized = prompt.toLowerCase();
    const width = Math.min(32, Math.max(12, Math.floor(normalized.length / 3)));

    document.body.innerHTML = '<form><textarea></textarea><button type="submit" aria-label="Send message">Send</button></form>';
    const composer = document.querySelector('textarea');
    composer.value = `${normalized.slice(0, width)} architecture-report.pdf ${normalized.slice(-width)}`;
    composer.getBoundingClientRect = () => ({ width: 500, height: 80, top: 0, left: 0, right: 500, bottom: 80 });
    document.querySelector('button').getBoundingClientRect = () => ({
      width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40
    });

    expect(window.eval(buildFocus(prompt))).toBe(false);
    expect(document.activeElement).not.toBe(composer);
    expect(window.eval(buildSend(prompt))).toBe(null);
  });
});
