const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const CONTENT = read('content-scripts/content-perplexity.js');
const ROUTER = read('background/message-router.js');
const DISPATCH = read('background/dispatch-coordinator.js');
const ORCHESTRATOR = read('background/job-orchestrator.js');

describe('Perplexity transient file-upload blocker handshake', () => {
  test('arms with run identity before attachment UI can navigate', () => {
    const attachmentBlock = CONTENT.slice(
      CONTENT.indexOf('if (Array.isArray(attachments) && attachments.length)'),
      CONTENT.indexOf("console.log('[content-perplexity] Input field found. Injecting prompt...')")
    );
    expect(attachmentBlock).toContain('await armPerplexityFileUploadBlocker(dispatchMeta)');
    expect(attachmentBlock.indexOf('await armPerplexityFileUploadBlocker(dispatchMeta)'))
      .toBeLessThan(attachmentBlock.indexOf('await attachmentHandler.attach(MODEL, attachments)'));
    expect(CONTENT).toContain('runSessionId: marker.runSessionId');
    expect(CONTENT).toContain('dispatchId: marker.dispatchId');
    expect(CONTENT).toContain('PERPLEXITY_BLOCKER_MARKER_TTL_MS = 120000');
  });

  test('does not close the payment page before STARTED acknowledgement', () => {
    const closeBlock = CONTENT.slice(
      CONTENT.indexOf('const closePerplexityFileUploadPaywall'),
      CONTENT.indexOf('const resumePerplexityAfterPaywall')
    );
    const ackAt = closeBlock.indexOf('const startedAck = await sendPerplexityRuntimeMessage');
    const rejectAt = closeBlock.indexOf('if (startedAck?.ok !== true) {');
    const clickAt = closeBlock.indexOf('close.click();');
    const backAt = closeBlock.indexOf('history.back();');
    expect(ackAt).toBeGreaterThan(-1);
    expect(rejectAt).toBeGreaterThan(ackAt);
    expect(clickAt).toBeGreaterThan(rejectAt);
    expect(backAt).toBeGreaterThan(rejectAt);
  });

  test('runtime ACK retry is executable and stops on success or identity rejection', async () => {
    const retrySource = CONTENT.slice(
      CONTENT.indexOf('const shouldRetryPerplexityBlockerMessage'),
      CONTENT.indexOf('const removePerplexityBlockerMarker')
    );
    const responses = [
      { ok: false, reason: 'message channel closed' },
      { ok: false, reason: 'transient_blocker_resume_in_progress' },
      { ok: true, status: 'already_cleared' }
    ];
    let calls = 0;
    const sandbox = {
      Promise,
      setTimeout: (fn) => { fn(); return 1; },
      clearTimeout: () => {},
      responses,
      calls
    };
    vm.createContext(sandbox);
    vm.runInContext(`
      const PERPLEXITY_BLOCKER_MESSAGE_RETRY_DELAYS_MS = [0, 0, 0];
      let callCount = 0;
      const sendPerplexityRuntimeMessage = async () => { callCount += 1; return responses.shift(); };
      ${retrySource}
      globalThis.runRetry = sendPerplexityRuntimeMessageWithRetry;
      globalThis.getCallCount = () => callCount;
    `, sandbox);
    await expect(sandbox.runRetry({ type: 'CLEAR' })).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(sandbox.getCallCount()).toBe(3);

    sandbox.responses.push({ ok: false, reason: 'sender_tab_mismatch' }, { ok: true });
    const before = sandbox.getCallCount();
    await expect(sandbox.runRetry({ type: 'CLEAR' })).resolves.toEqual(expect.objectContaining({
      ok: false,
      reason: 'sender_tab_mismatch'
    }));
    expect(sandbox.getCallCount() - before).toBe(1);
  });

  test('clears only after visible composer evidence and retains marker until ACK', () => {
    const resumeBlock = CONTENT.slice(
      CONTENT.indexOf('const resumePerplexityAfterPaywall'),
      CONTENT.indexOf('const baseAdapter')
    );
    const composerAt = resumeBlock.indexOf('await waitForVisiblePerplexityComposer()');
    const clearAt = resumeBlock.indexOf("'PROVIDER_TRANSIENT_BLOCKER_CLEARED'");
    const ackAt = resumeBlock.indexOf('if (ack?.ok === true)');
    const removeAt = resumeBlock.indexOf('removePerplexityBlockerMarker(marker.token)', ackAt);
    expect(composerAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(composerAt);
    expect(ackAt).toBeGreaterThan(clearAt);
    expect(removeAt).toBeGreaterThan(ackAt);
    expect(resumeBlock.slice(clearAt, ackAt)).not.toContain('removePerplexityBlockerMarker');
    expect(CONTENT).toContain("event?.persisted === true");
    expect(CONTENT).toContain("['armed', 'active', 'resume_pending'].includes(marker.state)");
    expect(CONTENT).toContain('schedulePerplexityHandoffRetry');
    expect(CONTENT).toContain('reconcilePerplexityFileUploadHandoff');
    expect(CONTENT).toContain("String(reason || '').startsWith('spa_navigation:')");
  });

  test('GET_ANSWER is accepted immediately instead of holding the command port', () => {
    const handler = CONTENT.slice(
      CONTENT.indexOf("if (message.type === 'GET_ANSWER'"),
      CONTENT.indexOf('\n  return false;\n};', CONTENT.indexOf("if (message.type === 'GET_ANSWER'"))
    );
    const ackAt = handler.indexOf('accepted: true');
    const providerWorkAt = handler.indexOf('injectAndGetResponse(');
    expect(ackAt).toBeGreaterThan(-1);
    expect(providerWorkAt).toBeGreaterThan(ackAt);
    expect(handler).not.toContain("sendResponse?.({ status: 'success' })");
  });

  test('transport errors owned by the blocker stop before generic recovery/finalization', () => {
    const errorBranch = DISPATCH.slice(
      DISPATCH.indexOf('if (chrome.runtime.lastError) {', DISPATCH.indexOf('function sendMessageSafely')),
      DISPATCH.indexOf('} else {', DISPATCH.indexOf('if (chrome.runtime.lastError) {', DISPATCH.indexOf('function sendMessageSafely')))
    );
    const deferredAt = errorBranch.indexOf('SEND_DEFERRED_TRANSIENT_BLOCKER');
    const recoverAt = errorBranch.indexOf('const canRecover');
    const terminalAt = errorBranch.lastIndexOf('handleLLMResponse(');
    expect(deferredAt).toBeGreaterThan(-1);
    expect(recoverAt).toBeGreaterThan(deferredAt);
    expect(terminalAt).toBeGreaterThan(recoverAt);
    expect(DISPATCH).toContain('STALE_SEND_CALLBACK_QUARANTINED');
  });

  test('resume resets SUBMITTING through ERROR and reports success only after command acceptance', () => {
    const clearCase = ROUTER.slice(
      ROUTER.indexOf("case 'PROVIDER_TRANSIENT_BLOCKER_CLEARED'"),
      ROUTER.indexOf("case 'PROMPT_SUBMITTED'")
    );
    const errorAt = clearCase.indexOf('machine.error({');
    const resetAt = clearCase.indexOf('machine.reset();');
    const dispatchAt = clearCase.indexOf('const result = await self.dispatchPromptToTab');
    const acceptanceAt = clearCase.indexOf("result?.accepted !== true");
    const countAt = clearCase.indexOf('acceptedEntry.perplexityPaywallResumeCount = resumeCount + 1');
    const successTelemetryAt = clearCase.indexOf("emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME',", countAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(errorAt);
    expect(dispatchAt).toBeGreaterThan(resetAt);
    expect(acceptanceAt).toBeGreaterThan(dispatchAt);
    expect(countAt).toBeGreaterThan(acceptanceAt);
    expect(successTelemetryAt).toBeGreaterThan(countAt);
    expect(clearCase).toContain("status: 'already_cleared'");
    expect(clearCase).toContain('resumeCount >= 1');
    expect(clearCase).toContain('requireCommandAcceptance: true');
    expect(clearCase).toContain('skipFocusRestore: true');
    expect(clearCase).toContain("current.phase = 'PROBING'");
    expect(clearCase.indexOf("current.phase = 'PROBING'")).toBeLessThan(clearCase.indexOf('await probePerplexityResumeDocument'));
    expect(clearCase).toContain('self.TransportPolicy.resolvePromptForModel');
  });

  test('MV3 retry supervisor and stale lifecycle remain suspended while blocker owns the dispatch', () => {
    expect(DISPATCH).toContain('function isTransientBlockerDispatchSuspended');
    const supervisor = DISPATCH.slice(
      DISPATCH.indexOf('function hasPendingPromptDispatches'),
      DISPATCH.indexOf('async function dispatchPromptToTab')
    );
    expect(supervisor).toContain('isTransientBlockerDispatchSuspended(llmName, entry');
    expect(DISPATCH).toContain("reason !== 'perplexity_paywall_resume'");
    expect(ROUTER).toContain('TRANSIENT_BLOCKER_RESPONSE_QUARANTINED');
    expect(ROUTER).toContain('pipeline_state_deferred_for_transient_blocker');
    expect(ROUTER).toContain('PERPLEXITY_TRANSIENT_BLOCKER_ALARM_PREFIX');
  });

  test('MV3 compaction retains blocker identity and accepted-resume count', () => {
    jest.resetModules();
    const PipelineFSM = require('../shared/pipeline-fsm.js');
    const compacted = PipelineFSM.compactJobStateForStorage({
      prompt: 'test',
      session: { startTime: 123 },
      llms: {
        Perplexity: {
          llmName: 'Perplexity',
          transientBlocker: {
            kind: 'file_upload_paywall', token: 'token-123', phase: 'ACTIVE',
            runSessionId: 123, dispatchId: 'Perplexity:123:1', tabId: 7, startedAt: 100
          },
          transientBlockerDispatchId: 'Perplexity:123:1',
          perplexityPaywallResumeCount: 1
        }
      }
    });
    expect(compacted.llms.Perplexity.transientBlocker).toEqual(expect.objectContaining({
      token: 'token-123',
      dispatchId: 'Perplexity:123:1'
    }));
    expect(compacted.llms.Perplexity.transientBlockerDispatchId).toBe('Perplexity:123:1');
    expect(compacted.llms.Perplexity.perplexityPaywallResumeCount).toBe(1);
  });

  test('stale pre-terminal recovery rechecks ownership after await', () => {
    const recovery = ORCHESTRATOR.slice(
      ORCHESTRATOR.indexOf('function maybeDeferTerminalFailureForMaterialization'),
      ORCHESTRATOR.indexOf('function detectActiveGenerationInPage')
    );
    const awaitAt = recovery.indexOf('const result = await runPreTerminalMaterializeRecovery');
    const postAwaitGuardAt = recovery.indexOf('afterRecovery.preTerminalMaterializeRecovery?.key !== key', awaitAt);
    const finalAt = recovery.indexOf('FINAL_ERROR_AFTER_RECOVERY', postAwaitGuardAt);
    expect(postAwaitGuardAt).toBeGreaterThan(awaitAt);
    expect(finalAt).toBeGreaterThan(postAwaitGuardAt);
  });
});
