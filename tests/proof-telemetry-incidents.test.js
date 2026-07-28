const Contracts = require('../shared/proof-telemetry-contracts.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');

function event(id, type, overrides = {}) {
  return {
    schemaVersion: 6,
    eventId: id,
    eventType: type,
    seq: Number(id.replace(/\D/g, '')) || 1,
    ingestSeq: Number(id.replace(/\D/g, '')) || 1,
    runGeneration: 1,
    runSessionId: 'run-1',
    modelId: 'GPT',
    dispatchId: 'dispatch-1',
    generationEpoch: 1,
    payload: { typed: { kind: 'unknown', state: 'unknown' } },
    ...overrides
  };
}

describe('proof telemetry incident index and evidence graph', () => {
  test('indexes and selects one deterministic incident while reporting other matches', () => {
    const events = [
      event('event-1', 'GENERATION_SIGNAL_CHANGED'),
      event('event-2', 'MODEL_TERMINAL_RECORDED'),
      event('event-3', 'GENERATION_SIGNAL_CHANGED', { dispatchId: 'dispatch-2', ingestSeq: 3, seq: 3 })
    ];
    const result = Incidents.selectIncident(events, { platform: 'GPT', task: 'true-completion' });
    expect(result.selected.scope.dispatchId).toBe('dispatch-1');
    expect(result.matchingIncidentCount).toBe(2);
    expect(result.otherMatchingIncidents).toHaveLength(1);
  });

  test('resolves typed evidence slots and marks missing evidence explicitly', () => {
    const incident = Incidents.indexIncidents([event('event-1', 'GENERATION_SIGNAL_CHANGED')])[0];
    const result = Incidents.resolveEvidenceSlots([event('event-1', 'GENERATION_SIGNAL_CHANGED')], incident, 'true-completion');
    expect(result.sufficiency).toBe('insufficient');
    expect(result.slots.find((slot) => slot.slotId === 'generation_transition').status).toBe('satisfied');
    expect(result.missingEvidence.some((slot) => slot.slotId === 'candidate_identity')).toBe(true);
  });

  test('builds recursive closure with includedFor and run SYSTEM context', () => {
    const events = [
      event('event-1', 'RUN_CONFIG_RECORDED', { modelId: 'SYSTEM', dispatchId: undefined }),
      event('event-2', 'GENERATION_SIGNAL_CHANGED'),
      event('event-3', 'CANDIDATE_IDENTITY_INFERRED'),
      event('event-4', 'OBSERVATION_FRAME_CAPTURED', { evidenceRefs: ['event-2'] }),
      event('event-5', 'DECISION_RECORDED', { evidenceRefs: ['event-4'] }),
      event('event-6', 'MODEL_TERMINAL_RECORDED', { evidenceRefs: ['event-5'] })
    ];
    const incident = Incidents.indexIncidents(events)[0];
    const result = Incidents.buildEvidenceClosure(events, incident, 'true-completion');
    expect(result.events.map((item) => item.eventId)).toEqual(['event-1', 'event-2', 'event-3', 'event-4', 'event-5', 'event-6']);
    expect(result.events.every((item) => item.includedFor.length > 0)).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('rejects an evidence edge into another dispatch or generation', () => {
    const events = [
      event('event-1', 'GENERATION_SIGNAL_CHANGED', { evidenceRefs: ['event-2'] }),
      event('event-2', 'CANDIDATE_IDENTITY_INFERRED', { dispatchId: 'dispatch-2', generationEpoch: 2 })
    ];
    const incident = Incidents.indexIncidents(events).find((item) => item.scope.dispatchId === 'dispatch-1');
    const result = Incidents.buildEvidenceClosure(events, incident, 'true-completion');
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ invariantId: 'SCOPE', eventId: 'event-2' })]));
    expect(result.events.some((item) => item.eventId === 'event-2')).toBe(false);
  });

  test('registry covers every selectable task', () => {
    expect(Object.keys(Contracts.REPORT_CONTRACTS).every((task) => Incidents.selectIncident([], { platform: 'GPT', task }).selected === null)).toBe(true);
  });
});
