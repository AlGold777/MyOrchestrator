const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Policy = require('../shared/proof-telemetry-policy.js');

const make = (rows) => ProofTelemetry.buildLedger(rows.map(([label, ts, meta = {}]) => ({
  label,
  ts,
  platform: 'GPT',
  meta: { runSessionId: 42, dispatchId: 'GPT:42:1', ...meta }
})), { runSessionId: 42 });

describe('proof telemetry required scenario matrix', () => {
  test.each([
    ['normal completion', [
      ['PROMPT_SUBMITTED_ACCEPTED', 1000],
      ['ANSWER_START_DETECTED', 1100],
      ['ANSWER_VERIFICATION_RECORDED', 1200, { verified: true }],
      ['ANSWER_COMPLETE_DETECTED', 1300]
    ], (axes) => axes.completionEvidenceTier >= 3 && axes.verification === 'verified'],
    ['temporary pause', [
      ['ANSWER_GENERATING', 1000, { textLength: 50 }],
      ['ANSWER_TEXT_STABLE', 1100, { textLength: 50 }]
    ], (axes) => axes.observedGeneration === 'quiescent' && axes.completionEvidenceTier < 3],
    ['same-length hash change', [
      ['ANSWER_GENERATING', 1000, { textLength: 50, textHash: 'a' }],
      ['ANSWER_GENERATING', 1100, { textLength: 50, textHash: 'b' }]
    ], (axes) => axes.textEvolution === 'changing'],
    ['stale baseline', [
      ['STALE_BASELINE_ANSWER_IGNORED', 1000]
    ], (axes) => axes.answerIdentity === 'stale'],
    ['prompt echo', [
      ['GROK_PROMPT_ECHO_REJECTED', 1000]
    ], (axes) => axes.answerIdentity === 'rejected'],
    ['multiple candidates', [
      ['MULTIPLE_CANDIDATES_AMBIGUOUS', 1000, { candidateCount: 2 }]
    ], (axes) => axes.answerIdentity === 'ambiguous'],
    ['background throttling', [
      ['LIFECYCLE_SNAPSHOT_ACCEPTED', 1000, { timerThrottlingSuspected: true, maximumSignalSkewMs: 2400 }]
    ], (axes) => axes.observationReliability === 'degraded'],
    ['selector failure', [
      ['SELECTOR_RESOLVE_FAIL', 1000]
    ], (axes) => axes.observationReliability === 'degraded'],
    ['request not sent', [
      ['DISPATCH_SEND', 1000],
      ['PROMPT_SUBMITTED_REJECTED', 1100]
    ], (axes) => axes.submission === 'failed'],
    ['generation not started', [
      ['PROMPT_SUBMITTED_ACCEPTED', 1000]
    ], (axes) => axes.submission === 'confirmed' && axes.generationStart === 'not_started'],
    ['forced timeout', [
      ['ANSWER_GENERATING', 1000],
      ['AUTOMATION_DEADLINE_REACHED', 2000],
      ['MODEL_FINAL', 2100]
    ], (axes) => axes.terminalMode === 'forced' && axes.completionDetection !== 'inferred_complete'],
    ['SPA navigation', [
      ['SPA_NAVIGATION', 1000, { navigationEpoch: 2, documentInstanceId: 'doc-2' }]
    ], (axes) => axes.observationReliability === 'reliable'],
    ['active run export', [
      ['ANSWER_GENERATING', 1000, { textLength: 25 }]
    ], (axes) => axes.finalization === 'not_evaluated' && axes.observedGeneration === 'active']
  ])('%s', (_name, rows, assertion) => {
    const ledger = make(rows);
    const axes = Policy.deriveAxes(ledger, ledger[ledger.length - 1]);
    expect(assertion(axes)).toBe(true);
  });
});
