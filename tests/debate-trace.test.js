const Schema = require('../disput/debate-trace-schema');
global.DebateTraceSchema = Schema;
const TraceStore = require('../disput/debate-trace-store');
const Projections = require('../disput/debate-trace-projections');

const plan = {
  version: 1,
  planId: 'plan-1',
  presetId: 'TRIAD_RED_TEAM',
  topology: 'triad',
  participants: ['Qwen', 'DeepSeek', 'Le Chat'],
  synthesizer: 'Claude',
  stages: [
    { stageId: 'r1:wave', kind: 'opening_batch', round: 1, participants: ['Qwen', 'DeepSeek', 'Le Chat'], inputs: [], outputs: ['r1:a'], completionPolicy: 'all_required_answers', failurePolicy: 'fail_run' },
    { stageId: 'final:synthesis', kind: 'final_synthesis', round: 2, participants: ['Claude'], inputs: ['r1:a'], outputs: ['final:verdict'], completionPolicy: 'all_required_answers', failurePolicy: 'fail_run' }
  ]
};

function completedTrace(extraEvents = []) {
  const store = TraceStore.createStore();
  store.beginRun({ debateRunId: 'run-1', plan, topology: 'triad', presetId: plan.presetId, sessionId: '1' });
  store.append({ eventType: 'RUN_STARTED', source: 'application', correlation: { debateRunId: 'run-1', planId: plan.planId }, sourceTimestamp: 1000, payload: {} });
  plan.stages.forEach((stage, index) => {
    store.append({ eventType: 'STAGE_STARTED', source: 'runner', correlation: { debateRunId: 'run-1', planId: plan.planId, stageId: stage.stageId }, sourceTimestamp: 1100 + index * 100, payload: { participants: stage.participants, kind: stage.kind } });
    store.append({ eventType: 'STAGE_COMPLETED', source: 'runner', correlation: { debateRunId: 'run-1', planId: plan.planId, stageId: stage.stageId }, sourceTimestamp: 1150 + index * 100, payload: { participants: stage.participants } });
  });
  extraEvents.forEach((event) => store.append({ source: 'background', correlation: { debateRunId: 'run-1', planId: plan.planId }, payload: {}, ...event }));
  store.append({ eventType: 'RUN_COMPLETED', source: 'run_store', correlation: { debateRunId: 'run-1', planId: plan.planId }, sourceTimestamp: 1400, payload: {} });
  return store;
}

describe('Debate trace schema', () => {
  test('uses typed payload and enforces ingress redaction', () => {
    const event = Schema.createEvent({
      eventType: 'ANSWER_COLLECTED', source: 'background',
      correlation: { debateRunId: 'run-1', stageId: 'r1:wave' },
      payload: { answer: 'private full answer', answerLength: 19, prompt: 'private prompt', promptFingerprint: 'abc', details: 'Bearer abcdefghijklmnop' }
    }, { receivedSeq: 1 });
    expect(event.payload.answer).toBe('[REDACTED]');
    expect(event.payload.prompt).toBe('[REDACTED]');
    expect(event.payload.answerLength).toBe(19);
    expect(event.payload.promptFingerprint).toBe('abc');
    expect(event.payload.details).toContain('[REDACTED]');
    expect(event.redactedFieldsCount).toBe(2);
    expect(event.validationErrors).toEqual([]);
  });
});

describe('Debate trace store', () => {
  test('orders events by collector sequence and ignores duplicate event ids', () => {
    const store = TraceStore.createStore();
    store.beginRun({ debateRunId: 'run-1', plan });
    const first = store.append({ eventId: 'fixed', eventType: 'RUN_STARTED', source: 'application', correlation: { debateRunId: 'run-1' }, payload: {} });
    const duplicate = store.append({ eventId: 'fixed', eventType: 'RUN_STARTED', source: 'application', correlation: { debateRunId: 'run-1' }, payload: {} });
    expect(first.receivedSeq).toBeGreaterThan(0);
    expect(duplicate).toBeNull();
    expect(store.getDuplicateIds('run-1')).toEqual(['fixed']);
    expect(store.getRun('run-1').events.map((event) => event.receivedSeq)).toEqual([...store.getRun('run-1').events.map((event) => event.receivedSeq)].sort((a, b) => a - b));
  });

  test('persists and restores a bounded machine trace', async () => {
    let saved = {};
    const storage = {
      get: (key, cb) => cb({ [key]: saved[key] }),
      set: (value, cb) => { saved = { ...saved, ...value }; cb?.(); }
    };
    const store = TraceStore.createStore({ storage, flushDelayMs: 5 });
    store.beginRun({ debateRunId: 'run-1', plan });
    await store.flush();
    const restored = TraceStore.createStore({ storage });
    expect(await restored.restore()).toBe(true);
    expect(restored.getRun('run-1').plan.planId).toBe('plan-1');
  });
});

describe('Debate trace projections', () => {
  test('produces success only for a complete clean plan', () => {
    const report = Projections.buildReport(completedTrace().getRun('run-1'), { extensionVersion: 'test' });
    expect(report.health.classification).toBe('success');
    expect(report.stageExecutions).toHaveLength(2);
    expect(report.integrity.missingRequiredStageEvents).toEqual([]);
    expect(report.metadata.presetId).toBe('TRIAD_RED_TEAM');
  });

  test('deterministically classifies manual recovery and state divergence as degraded success', () => {
    const store = completedTrace([
      { eventType: 'MANUAL_RECOVERY_REQUESTED', severity: 'high', sourceTimestamp: 1250, payload: { model: 'Qwen', details: 'latest answer scan' } },
      { eventType: 'STATE_DIVERGENCE', severity: 'high', sourceTimestamp: 1260, payload: { model: 'DeepSeek', details: 'SUCCESS != EXTRACT_FAILED' } }
    ]);
    const report = Projections.buildReport(store.getRun('run-1'));
    expect(report.health.classification).toBe('degraded_success');
    expect(report.health.manualRecoveryCount).toBe(1);
    expect(report.health.stateDivergenceCount).toBe(1);
    expect(report.diagnoses.map((item) => item.code)).toEqual(expect.arrayContaining(['MANUAL_RECOVERY_REQUIRED', 'STATE_DIVERGENCE']));
  });

  test('Markdown is derived from the same machine report', () => {
    const report = Projections.buildReport(completedTrace().getRun('run-1'));
    const markdown = Projections.toMarkdown(report);
    expect(markdown).toContain('Health: **success**');
    expect(markdown).toContain('r1:wave');
    expect(markdown).toContain('Qwen');
  });

  test('classifies the recorded Triad recovery pattern as degraded and exposes its evidence', () => {
    const store = completedTrace([
      { eventType: 'BARRIER_OPENED', sourceTimestamp: 1200, correlation: { debateRunId: 'run-1', stageId: 'r1:wave' }, payload: { participants: ['Qwen', 'DeepSeek', 'Le Chat'] } },
      { eventType: 'BARRIER_PARTICIPANT_READY', sourceTimestamp: 1250, correlation: { debateRunId: 'run-1', stageId: 'r1:wave' }, payload: { model: 'DeepSeek' } },
      { eventType: 'BARRIER_PARTICIPANT_READY', sourceTimestamp: 1260, correlation: { debateRunId: 'run-1', stageId: 'r1:wave' }, payload: { model: 'Le Chat' } },
      { eventType: 'BARRIER_PARTICIPANT_READY', sourceTimestamp: 1390, correlation: { debateRunId: 'run-1', stageId: 'r1:wave' }, payload: { model: 'Qwen' } },
      { eventType: 'BARRIER_RELEASED', sourceTimestamp: 1395, correlation: { debateRunId: 'run-1', stageId: 'r1:wave' }, payload: {} },
      { eventType: 'MANUAL_RECOVERY_REQUESTED', severity: 'high', sourceTimestamp: 1300, payload: { model: 'Qwen', details: 'status indicator double click' } },
      { eventType: 'TERMINAL_FAILURE_UPGRADED', severity: 'high', sourceTimestamp: 1310, payload: { model: 'DeepSeek', answerLength: 7306 } },
      { eventType: 'STATE_DIVERGENCE', severity: 'high', sourceTimestamp: 1320, payload: { model: 'DeepSeek', details: 'SUCCESS != EXTRACT_FAILED' } },
      { eventType: 'STABLE_TEXT_FALLBACK_USED', severity: 'warning', sourceTimestamp: 1330, payload: { model: 'Le Chat', elapsedMs: 21057, busy: true } },
      { eventType: 'STALE_EVENT_REJECTED', severity: 'warning', sourceTimestamp: 1340, payload: { model: 'DeepSeek', dispatchId: 'old' } },
      { eventType: 'UI_PROJECTION_FAILED', severity: 'warning', sourceTimestamp: 1350, payload: { model: 'Qwen', panelId: 'panel-qwen' } }
    ]);
    const report = Projections.buildReport(store.getRun('run-1'));
    expect(report.health.classification).toBe('degraded_success');
    expect(report.diagnoses.map((item) => item.code)).toEqual(expect.arrayContaining([
      'MANUAL_RECOVERY_REQUIRED', 'PREMATURE_TERMINAL_FAILURE', 'STATE_DIVERGENCE',
      'FORCED_STABLE_TEXT_COMPLETION', 'STALE_EVENT_REJECTED', 'UI_PROJECTION_FAILED'
    ]));
    expect(report.barriers[0]).toMatchObject({ stageId: 'r1:wave', criticalParticipant: 'Qwen', outcome: 'released' });
    expect(report.integrity.schemaValidationErrors).toEqual([]);
  });
});
