'use strict';

const ProofTelemetry = require('../../shared/proof-oriented-telemetry.js');

const row = (label, ts, meta = {}) => ({ label, ts, meta });

const SCENARIOS = Object.freeze([
  { id: 'full-success', rows: [
    row('DISPATCH_BASELINE_CAPTURED', 1000), row('DISPATCH_SEND', 1010),
    row('PROMPT_SUBMITTED_ACCEPTED', 1020), row('ANSWER_START_DETECTED', 1030),
    row('TURN_RESOLUTION_ACCEPTED', 1040, { answerIdentity: 'current_dispatch' }),
    row('ANSWER_GENERATING', 1050, { textLength: 120, textHash: 'hash:full' }),
    row('ANSWER_VERIFICATION_RECORDED', 1060, { verified: true }),
    row('ANSWER_COMPLETE_DETECTED', 1070), row('FINALIZATION_DECISION', 1080, { accepted: true }),
    row('MODEL_FINAL', 1090, { finalStatus: 'SUCCESS', answerLen: 120 })
  ] },
  { id: 'cutted', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 2000), row('ANSWER_GENERATING', 2010, { textLength: 160 }),
    row('ANSWER_LENGTH_DECREASED', 2020, { textLength: 70 }),
    row('ANSWER_PARTIAL_ON_TIMEOUT', 2030), row('MODEL_FINAL', 2040, { finalStatus: 'SUCCESS', answerLen: 70 })
  ] },
  { id: 'false-success', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 3000), row('ANSWER_GENERATING', 3010, { textLength: 80, textHash: 'hash:a' }),
    row('MODEL_FINAL', 3020, { finalStatus: 'SUCCESS', answerLen: 80 }),
    row('POST_TERMINAL_ANSWER_OBSERVED', 3030, { textLength: 120, textHash: 'hash:b' }),
    row('POST_TERMINAL_AUDIT_COMPLETED', 3040, { conclusion: 'contradicted', growthChars: 40, growthPct: 50, hashChanged: true })
  ] },
  { id: 'old-answer', rows: [
    row('DISPATCH_BASELINE_CAPTURED', 4000), row('PROMPT_SUBMITTED_ACCEPTED', 4010),
    row('TURN_RESOLUTION_ACCEPTED', 4020, { answerIdentity: 'previous_dispatch' }),
    row('ANSWER_EXTRACTION_COMPLETED', 4030, { answerIdentity: 'previous_dispatch', length: 100 }),
    row('MODEL_FINAL', 4040, { finalStatus: 'SUCCESS', answerEvidenceDispatchId: 'previous-dispatch' })
  ] },
  { id: 'no-delivery', rows: [
    row('ANSWER_SOURCE_MATERIALIZED', 5000, { attemptId: 'a1', payloadEvidenceId: 'p1', sourceProofLevel: 'direct_preterminal', normalizedHash: 'hash:a', normalizedLength: 100 }),
    row('ANSWER_DELIVERY_ACKNOWLEDGED', 5010, { attemptId: 'a1', payloadEvidenceId: 'p1', outcome: 'accepted' }),
    row('ANSWER_COMMIT_EVALUATED', 5020, { attemptId: 'a1', payloadEvidenceId: 'p1', outcome: 'accepted' }),
    row('ANSWER_CARD_RENDER_EVALUATED', 5030, { attemptId: 'a1', payloadEvidenceId: 'p1', outcome: 'empty', contentClass: 'empty', usableResult: false, expectedCardId: 'card-gpt', observedCardId: 'card-gpt' })
  ] },
  { id: 'prompt-not-inserted', rows: [
    row('PROMPT_INSERTION_FAILED', 6000, { insertionState: 'failed' }),
    row('DISPATCH_SEND', 6010), row('PROMPT_SUBMITTED_REJECTED', 6020),
    row('OBSERVATION_INTERVAL_CLOSED', 22000, { observationCoverage: 'complete', continuous: true })
  ] },
  { id: 'prompt-not-sent', rows: [
    row('PROMPT_INSERTION_CONFIRMED', 7000, { insertionState: 'inserted' }),
    row('DISPATCH_SEND', 7010), row('PROMPT_SUBMITTED_REJECTED', 7020),
    row('OBSERVATION_INTERVAL_CLOSED', 23000, { observationCoverage: 'complete', continuous: true })
  ] },
  { id: 'late-end', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 8000), row('ANSWER_GENERATING', 8010, { textLength: 100 }),
    row('ANSWER_TEXT_STABLE', 8020, { textLength: 100 }), row('ANSWER_COMPLETE_DETECTED', 8030),
    row('FINALIZATION_DECISION', 8040, { accepted: true }), row('MODEL_FINAL', 12000, { finalStatus: 'SUCCESS' })
  ] },
  { id: 'multiple-incidents', incidents: [
    { dispatchId: 'GPT:fixture:multiple:1', rows: [row('PROMPT_SUBMITTED_ACCEPTED', 9000), row('MODEL_FINAL', 9010, { finalStatus: 'ERROR' })] },
    { dispatchId: 'GPT:fixture:multiple:2', rows: [row('PROMPT_SUBMITTED_ACCEPTED', 9020), row('ANSWER_GENERATING', 9030), row('MODEL_FINAL', 9040, { finalStatus: 'SUCCESS' })] }
  ] },
  { id: 'active-run-export', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 10000), row('ANSWER_GENERATING', 10010, { textLength: 40 })
  ], exportState: { exportedDuringActiveRun: true, persistenceQueue: 'drained' } },
  { id: 'busy-persistence-queue', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 11000), row('ANSWER_GENERATING', 11010, { textLength: 30 })
  ], exportState: { exportedDuringActiveRun: true, persistenceQueue: 'busy', pendingMutations: 3 } },
  { id: 'service-worker-restart', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 12000), row('ANSWER_GENERATING', 12010, { textLength: 55 }),
    row('RUN_CONFIG_RECORDED', 12020, { recoverySource: 'indexeddb', runGeneration: 2 })
  ], exportState: { serviceWorkerRestarted: true, recoveredFromPersistence: true } },
  { id: 'post-terminal-growth-without-terminal', rows: [
    row('PROMPT_SUBMITTED_ACCEPTED', 13000), row('ANSWER_GENERATING', 13010, { textLength: 60, textHash: 'hash:a' }),
    row('POST_TERMINAL_ANSWER_OBSERVED', 13020, { textLength: 90, textHash: 'hash:b' }),
    row('MISSING_EVIDENCE_RECORDED', 13030, { missing: 'MODEL_TERMINAL_RECORDED' })
  ] }
]);

function sourceRows(scenario) {
  const incidents = scenario.incidents || [{ dispatchId: `GPT:fixture:${scenario.id}:1`, rows: scenario.rows || [] }];
  return incidents.flatMap((incident, incidentIndex) => (incident.rows || []).map((item) => ({
    type: 'TELEMETRY',
    level: 'info',
    platform: 'GPT',
    label: item.label,
    ts: item.ts,
    meta: {
      runSessionId: 'fixture-run',
      runGeneration: scenario.id === 'service-worker-restart' ? 2 : 1,
      dispatchId: incident.dispatchId,
      generationEpoch: incidentIndex + 1,
      ...item.meta
    }
  })));
}

function ledgerFor(scenario) {
  return ProofTelemetry.buildLedger(sourceRows(scenario), {
    runSessionId: 'fixture-run',
    runGeneration: scenario.id === 'service-worker-restart' ? 2 : 1,
    exportedAt: 20000
  });
}

module.exports = Object.freeze({ SCENARIOS, sourceRows, ledgerFor });
