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
  test('expands a selected task to deterministic incident reports across all platforms', () => {
    const events = [
      event('event-1', 'TEXT_STATE_CHANGED'),
      event('event-2', 'TEXT_STATE_CHANGED', { modelId: 'Claude', dispatchId: 'dispatch-claude-1' }),
      event('event-3', 'MODEL_TERMINAL_RECORDED', { dispatchId: 'dispatch-gpt-2' })
    ];
    const allTargets = Incidents.selectIncidentReports(events, { task: 'cutted' });
    expect(allTargets.map((target) => target.modelId)).toEqual(['GPT', 'GPT', 'Claude']);
    expect(allTargets.map((target) => target.incidentId)).toEqual(expect.arrayContaining([
      expect.stringContaining('dispatch-1'),
      expect.stringContaining('dispatch-gpt-2'),
      expect.stringContaining('dispatch-claude-1')
    ]));
    const claudeTargets = Incidents.selectIncidentReports(events, { platform: 'Claude', task: 'cutted' });
    expect(claudeTargets).toHaveLength(1);
    expect(claudeTargets[0]).toEqual(expect.objectContaining({ modelId: 'Claude', rank: 0 }));
  });

  test('indexes and selects one deterministic incident while reporting other matches', () => {
    const events = [
      event('event-1', 'GENERATION_SIGNAL_CHANGED'),
      event('event-2', 'MODEL_TERMINAL_RECORDED'),
      event('event-3', 'GENERATION_SIGNAL_CHANGED', { dispatchId: 'dispatch-2', ingestSeq: 3, seq: 3 })
    ];
    const result = Incidents.selectIncident(events, { platform: 'GPT', task: 'false-success' });
    expect(result.selected.scope.dispatchId).toBe('dispatch-1');
    expect(result.matchingIncidentCount).toBe(2);
    expect(result.otherMatchingIncidents).toHaveLength(1);
  });

  test('rejects an unknown explicit incident instead of silently falling back', () => {
    const selection = Incidents.selectIncident([event('event-1', 'GENERATION_SIGNAL_CHANGED')], {
      platform: 'GPT',
      task: 'false-success',
      incidentId: 'incident:not-present'
    });
    expect(selection).toEqual({
      selected: null,
      selectionReason: 'explicit_incident_not_found',
      otherMatchingIncidents: [],
      matchingIncidentCount: 0
    });
  });

  test('resolves typed evidence slots and marks missing evidence explicitly', () => {
    const incident = Incidents.indexIncidents([event('event-1', 'GENERATION_SIGNAL_CHANGED')])[0];
    const result = Incidents.resolveEvidenceSlots([event('event-1', 'GENERATION_SIGNAL_CHANGED')], incident, 'false-success');
    expect(result.sufficiency).toBe('insufficient');
    expect(result.slots.find((slot) => slot.slotId === 'generation_state').status).toBe('satisfied');
    expect(result.missingEvidence.some((slot) => slot.slotId === 'terminal_decision')).toBe(true);
  });

  test('does not satisfy a success slot with a FAILURE terminal fact', () => {
    const failure = event('event-1', 'MODEL_TERMINAL_RECORDED', {
      payload: { typed: { kind: 'terminal_action', state: 'FAILURE' } }
    });
    const incident = Incidents.indexIncidents([failure])[0];
    const result = Incidents.resolveEvidenceSlots([failure], incident, 'cutted');
    expect(result.slots.find((slot) => slot.slotId === 'success_terminal')).toEqual(expect.objectContaining({
      status: 'unavailable',
      matchedEventCount: 0,
      rejectedEventCount: 1
    }));
  });

  test('requires post-terminal audit order and causal evidence references', () => {
    const auditBefore = event('event-1', 'POST_TERMINAL_AUDIT_COMPLETED');
    const terminal = event('event-2', 'MODEL_TERMINAL_RECORDED', {
      payload: { typed: { kind: 'terminal_action', state: 'SUCCESS' } }
    });
    const incident = Incidents.indexIncidents([auditBefore, terminal])[0];
    expect(Incidents.validateTemporalInvariants([auditBefore, terminal], incident)).toEqual(expect.arrayContaining([
      expect.objectContaining({ invariantId: 'TEMPORAL_AUDIT_ORDER', eventId: 'event-1' })
    ]));
    const slots = Incidents.resolveEvidenceSlots([auditBefore, terminal], incident, 'false-success');
    expect(slots.slots.find((slot) => slot.slotId === 'post_terminal_audit').status).toBe('unavailable');
  });

  test('builds recursive closure without unrelated run-wide SYSTEM context', () => {
    const events = [
      event('event-1', 'RUN_CONFIG_RECORDED', { modelId: 'SYSTEM', dispatchId: undefined }),
      event('event-2', 'GENERATION_SIGNAL_CHANGED'),
      event('event-3', 'CANDIDATE_IDENTITY_INFERRED'),
      event('event-4', 'OBSERVATION_FRAME_CAPTURED', { evidenceRefs: ['event-2'] }),
      event('event-5', 'DECISION_RECORDED', { evidenceRefs: ['event-4'] }),
      event('event-6', 'MODEL_TERMINAL_RECORDED', {
        evidenceRefs: ['event-5'],
        payload: { typed: { kind: 'terminal_action', state: 'SUCCESS' } }
      })
    ];
    const incident = Incidents.indexIncidents(events)[0];
    const result = Incidents.buildEvidenceClosure(events, incident, 'false-success');
    expect(result.events.map((item) => item.eventId)).toEqual(['event-2', 'event-4', 'event-5', 'event-6']);
    expect(result.events.every((item) => item.includedFor.length > 0)).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('rejects an evidence edge into another dispatch or generation', () => {
    const events = [
      event('event-1', 'GENERATION_SIGNAL_CHANGED', { evidenceRefs: ['event-2'] }),
      event('event-2', 'CANDIDATE_IDENTITY_INFERRED', { dispatchId: 'dispatch-2', generationEpoch: 2 })
    ];
    const incident = Incidents.indexIncidents(events).find((item) => item.scope.dispatchId === 'dispatch-1');
    const result = Incidents.buildEvidenceClosure(events, incident, 'false-success');
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ invariantId: 'SCOPE', eventId: 'event-2' })]));
    expect(result.events.some((item) => item.eventId === 'event-2')).toBe(false);
  });

  test('rejects SYSTEM evidence from another run or run generation', () => {
    const events = [
      event('event-1', 'GENERATION_SIGNAL_CHANGED', { evidenceRefs: ['event-2', 'event-3'] }),
      event('event-2', 'RUN_CONFIG_RECORDED', { modelId: 'SYSTEM', dispatchId: undefined, runSessionId: 'other-run' }),
      event('event-3', 'RUN_CONFIG_RECORDED', { modelId: 'SYSTEM', dispatchId: undefined, runGeneration: 9 })
    ];
    const incident = Incidents.indexIncidents(events)[0];
    const result = Incidents.buildEvidenceClosure(events, incident, 'false-success');
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ invariantId: 'SCOPE', eventId: 'event-2' }),
      expect.objectContaining({ invariantId: 'SCOPE', eventId: 'event-3' })
    ]));
    expect(result.events.map((item) => item.eventId)).not.toEqual(expect.arrayContaining(['event-2', 'event-3']));
  });

  test('registry covers every selectable task', () => {
    expect(Object.keys(Contracts.REPORT_CONTRACTS).every((task) => Incidents.selectIncident([], { platform: 'GPT', task }).selected === null)).toBe(true);
  });

  test('selects an incident even when the chosen task has zero expected event types', () => {
    const events = [event('event-1', 'GENERATION_SIGNAL_CHANGED')];
    const selection = Incidents.selectIncident(events, { platform: 'GPT', task: 'prompt-not-sent' });
    expect(selection.selected).not.toBeNull();
    expect(selection.selectionReason).toContain('including_zero_match');
    const closure = Incidents.buildEvidenceClosure(events, selection.selected, 'prompt-not-sent');
    expect(closure.sufficiency).toBe('insufficient');
    expect(closure.events).toEqual([
      expect.objectContaining({
        eventId: 'event-1',
        includedFor: ['counterevidence:prompt-not-sent', 'scope:incident-anchor']
      })
    ]);
  });

  test('promotes a conditional slot to required only when requiredIf matches', () => {
    const events = [event('event-1', 'MODEL_TERMINAL_RECORDED')];
    const incident = Incidents.indexIncidents(events)[0];
    const forced = Incidents.resolveEvidenceSlots(events, incident, 'cutted', {
      stateAxes: { terminalMode: 'forced' }
    });
    expect(forced.slots.find((slot) => slot.slotId === 'finalization_policy')).toEqual(expect.objectContaining({
      criticality: 'conditional',
      effectiveCriticality: 'required',
      requiredIfMatched: true,
      status: 'unavailable'
    }));
    expect(forced.sufficiency).toBe('insufficient');
    const automatic = Incidents.resolveEvidenceSlots(events, incident, 'cutted', {
      stateAxes: { terminalMode: 'automatic' }
    });
    expect(automatic.slots.find((slot) => slot.slotId === 'finalization_policy')).toEqual(expect.objectContaining({
      effectiveCriticality: 'conditional',
      requiredIfMatched: false,
      status: 'not_observed'
    }));
  });

  test('compacts repeated slot events by proof role while retaining boundaries and extrema', () => {
    const repeated = Array.from({ length: 50 }, (_, index) => event(`event-${index + 1}`, 'TEXT_STATE_CHANGED', {
      payload: { typed: { kind: 'text', state: 'changing' }, metadata: { textLength: index === 25 ? 999 : index } }
    }));
    const incident = Incidents.indexIncidents(repeated)[0];
    const resolved = Incidents.resolveEvidenceSlots(repeated, incident, 'cutted');
    const slot = resolved.slots.find((item) => item.slotId === 'text_evolution');
    expect(slot.matchedEventCount).toBe(50);
    expect(slot.selectedEventCount).toBeLessThan(slot.matchedEventCount);
    expect(slot.eventIds).toEqual(expect.arrayContaining(['event-1', 'event-26', 'event-50']));
  });
});
