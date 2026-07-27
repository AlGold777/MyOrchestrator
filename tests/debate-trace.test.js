const Schema = require('../disput/debate-trace-schema');
global.DebateTraceSchema = Schema;
const TraceStore = require('../disput/debate-trace-store');
const Projections = require('../disput/debate-trace-projections');
const ProblemContextFilter = require('../shared/problem-context-filter');

const plan = {
  version: 1,
  planId: 'plan-1',
  presetId: 'UNIVERSAL_RED_TEAM',
  topology: 'universal',
  participants: ['Qwen', 'DeepSeek', 'Le Chat'],
  synthesizer: 'Claude',
  stages: [
    { stageId: 'r1:wave', kind: 'opening_batch', round: 1, participants: ['Qwen', 'DeepSeek', 'Le Chat'], inputs: [], outputs: ['r1:a'], completionPolicy: 'all_required_answers', failurePolicy: 'fail_run' },
    { stageId: 'final:synthesis', kind: 'final_synthesis', round: 2, participants: ['Claude'], inputs: ['r1:a'], outputs: ['final:verdict'], completionPolicy: 'all_required_answers', failurePolicy: 'fail_run' }
  ]
};

function completedTrace(extraEvents = []) {
  const store = TraceStore.createStore();
  store.beginRun({ debateRunId: 'run-1', plan, topology: 'universal', presetId: plan.presetId, sessionId: '1' });
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

  test('redacts generic and camelCase response content recursively', () => {
    const event = Schema.createEvent({
      eventType: 'ANSWER_COLLECTED', source: 'background',
      correlation: { debateRunId: 'run-1', stageId: 'r1:wave' },
      payload: {
        text: 'full response',
        answerText: 'camel response',
        responseHtml: '<p>response</p>',
        compiledPrompt: 'full compiled prompt',
        evidence: { answerEvidence: { text: 'nested answer' } },
        delta: { artifacts: [{ id: 'a1', type: 'claim', text: 'artifact content', description: 'claim body' }] },
        attachments: [{ name: 'private.pdf', dataUrl: 'data:private' }],
        stateMap: { claims: [{ title: 'private claim' }] },
        answerLength: 13,
        answerHash: 'hash-safe'
      }
    }, { receivedSeq: 1 });

    expect(event.payload).toEqual(expect.objectContaining({
      text: '[REDACTED]',
      answerText: '[REDACTED]',
      responseHtml: '[REDACTED]',
      compiledPrompt: '[REDACTED]',
      answerLength: 13,
      answerHash: 'hash-safe'
    }));
    expect(event.payload.evidence.answerEvidence).toBe('[REDACTED]');
    expect(event.payload.delta.artifacts[0]).toEqual(expect.objectContaining({
      id: 'a1',
      type: 'claim',
      text: '[REDACTED]',
      description: '[REDACTED]'
    }));
    expect(event.payload.attachments).toBe('[REDACTED]');
    expect(event.payload.stateMap).toBe('[REDACTED]');
    expect(event.redactedFieldsCount).toBeGreaterThanOrEqual(9);
  });

  test('bounds free-form diagnostic details', () => {
    const event = Schema.createEvent({
      eventType: 'LEGACY_DIAGNOSTIC_EVENT', source: 'background',
      correlation: { debateRunId: 'run-1' },
      payload: { details: 'x'.repeat(1000) }
    }, { receivedSeq: 1 });
    expect(event.payload.details.length).toBe(240);
    expect(event.payload.details.endsWith('…')).toBe(true);
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

  test('rejects an eventId replay with different semantic content without consuming a sequence', () => {
    const store = TraceStore.createStore();
    store.beginRun({ debateRunId: 'run-1', plan });
    const first = store.append({ eventId: 'same-id', eventType: 'RUN_STARTED', source: 'application', correlation: { debateRunId: 'run-1' }, payload: { attempt: 1 } });
    const conflict = store.append({ eventId: 'same-id', eventType: 'RUN_STARTED', source: 'application', correlation: { debateRunId: 'run-1' }, payload: { attempt: 2 } });
    expect(conflict).toBeNull();
    expect(store.getRun('run-1').events).toHaveLength(3); // RUN_CREATED, PLAN_COMPILED, first
    expect(store.getRun('run-1').events.at(-1).receivedSeq).toBe(first.receivedSeq);
    expect(store.getConflicts('run-1')).toEqual([expect.objectContaining({ eventId: 'same-id' })]);
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

  test('re-sanitizes legacy persisted trace events during restore', async () => {
    const legacyEvent = {
      schemaVersion: 4,
      eventId: 'legacy-answer',
      eventType: 'ANSWER_COLLECTED',
      source: 'background',
      severity: 'info',
      sourceTimestamp: 1000,
      receivedAt: 1001,
      receivedSeq: 1,
      reasonCode: '',
      correlation: { debateRunId: 'run-legacy', correlationQuality: 'exact' },
      causality: {},
      payload: { model: 'Qwen', text: 'legacy full answer', answerText: 'legacy camel answer', answerLength: 18 },
      provenance: 'legacy_adapter',
      redactedFieldsCount: 0,
      semanticHash: 'old-hash',
      validationErrors: []
    };
    const saved = {
      llmCodexDebateTrace: {
        schemaVersion: 4,
        receivedSeq: 1,
        activeRunId: 'run-legacy',
        runs: [{ debateRunId: 'run-legacy', createdAt: 1, updatedAt: 1, plan, events: [legacyEvent] }]
      }
    };
    const storageKey = 'llmCodexDebateTrace';
    const writes = [];
    const storage = {
      get: (key, cb) => cb({ [key]: saved[key] }),
      set: (value, cb) => { writes.push(value); cb?.(); }
    };
    const store = TraceStore.createStore({ storage, storageKey });
    expect(await store.restore()).toBe(true);
    const restored = store.getRun('run-legacy').events[0];
    expect(restored.payload.text).toBe('[REDACTED]');
    expect(restored.payload.answerText).toBe('[REDACTED]');
    expect(restored.payload.answerLength).toBe(18);
    expect(writes.length).toBeGreaterThan(0);
    expect(JSON.stringify(writes)).not.toContain('legacy full answer');
    expect(JSON.stringify(writes)).not.toContain('legacy camel answer');
  });
});

describe('Debate trace projections', () => {
  test('produces success only for a complete clean plan', () => {
    const report = Projections.buildReport(completedTrace().getRun('run-1'), { extensionVersion: 'test' });
    expect(report.health.classification).toBe('success');
    expect(report.stageExecutions).toHaveLength(2);
    expect(report.integrity.missingRequiredStageEvents).toEqual([]);
    expect(report.metadata.presetId).toBe('UNIVERSAL_RED_TEAM');
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

  test('report does not duplicate full events inside derived sections', () => {
    const store = TraceStore.createStore();
    store.beginRun({ debateRunId: 'run-1', plan });
    store.append({
      eventType: 'ANSWER_COLLECTED', source: 'background',
      correlation: { debateRunId: 'run-1', stageId: 'r1:wave', dispatchId: 'dispatch-1' },
      payload: { model: 'Qwen', text: 'private answer'.repeat(1000), answerLength: 14000 }
    });
    const report = Projections.buildReport(store.getRun('run-1'));
    expect(report.events.at(-1).payload.text).toBe('[REDACTED]');
    expect(report.dispatchAttempts[0].events).toBeUndefined();
    expect(report.dispatchAttempts[0].evidenceEventIds).toEqual([report.events.at(-1).eventId]);
    expect(JSON.stringify(report)).not.toContain('private answer');
  });

  test('Only problems filters every event-derived report section', () => {
    const store = completedTrace([
      {
        eventType: 'ANSWER_COLLECTED', sourceTimestamp: 1200,
        correlation: { debateRunId: 'run-1', stageId: 'r1:wave', dispatchId: 'dispatch-ok' },
        payload: { model: 'Qwen', text: 'private answer', answerLength: 14 }
      },
      {
        eventType: 'SUBMIT_TIMEOUT', severity: 'high', sourceTimestamp: 1210,
        correlation: { debateRunId: 'run-1', stageId: 'r1:wave', dispatchId: 'dispatch-fail' },
        payload: { model: 'DeepSeek' }
      },
      {
        eventType: 'STAGE_ARTIFACT_PRODUCED', sourceTimestamp: 1220,
        correlation: { debateRunId: 'run-1', stageId: 'r1:wave' },
        payload: { artifactId: 'artifact-1', artifact: { id: 'artifact-1', text: 'private artifact' } }
      }
    ]);
    const report = Projections.buildReport(store.getRun('run-1'));
    const filtered = Projections.filterProblems(report, { problemContextFilter: ProblemContextFilter });

    expect(filtered.artifacts).toEqual([]);
    expect(filtered.dispatchAttempts.some((attempt) => attempt.dispatchId === 'dispatch-fail')).toBe(true);
    expect(JSON.stringify(filtered)).not.toContain('private answer');
    expect(JSON.stringify(filtered)).not.toContain('private artifact');
  });

  test('classifies a recorded parallel-stage recovery pattern as degraded and exposes its evidence', () => {
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
