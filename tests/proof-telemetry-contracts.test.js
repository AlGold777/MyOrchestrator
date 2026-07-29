const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const Contracts = require('../shared/proof-telemetry-contracts.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');

describe('proof telemetry executable contracts', () => {
  test('scope equality includes run generation and identity vocabulary is normalized', () => {
    const base = { runSessionId: 'run', runGeneration: 1, modelId: 'GPT', dispatchId: 'd1', generationEpoch: 1 };
    expect(Contracts.sameIncidentScope(base, { ...base, runGeneration: 9 })).toBe(false);
    expect(Contracts.sameIncidentScope(base, { ...base })).toBe(true);
    expect(Contracts.normalizeIdentityState('stale')).toBe('previous');
    expect(Contracts.normalizeIdentityState('previous_dispatch')).toBe('previous');
    expect(Contracts.normalizeIdentityState('current_dispatch')).toBe('current');
  });

  test('every protected fact-level slot rejects a malformed fact', () => {
    Object.entries(Contracts.SLOT_MATCH_RULES).forEach(([key, rule]) => {
      const [reportType, slotId] = key.split('.');
      const slot = Contracts.normalizedSlots(reportType).find((item) => item.slotId === slotId);
      const malformed = {
        schemaVersion: 6,
        eventId: `event-malformed-${reportType}-${slotId}`,
        eventType: slot.eventTypes[0],
        seq: 2,
        ingestSeq: 2,
        runGeneration: 1,
        runSessionId: 'run',
        modelId: 'GPT',
        dispatchId: 'd1',
        generationEpoch: 1,
        payload: { typed: { kind: 'malformed', state: 'malformed' } }
      };
      expect(Incidents.eventMatchesSlot(malformed, slot, [malformed])).toBe(false);
      expect(rule.fact || rule.temporal).toBeTruthy();
    });
  });

  test('defines evidence-slot contracts for every current and shadow diagnostic question', () => {
    expect(Object.keys(Contracts.REPORT_CONTRACTS)).toEqual([
      'cutted',
      'false-success',
      'old-answer',
      'empty',
      'no-delivery',
      'prompt-not-inserted',
      'prompt-not-sent',
      'late-end'
    ]);
    Object.keys(Contracts.REPORT_CONTRACTS).forEach((reportType) => {
      const slots = Contracts.normalizedSlots(reportType);
      expect(slots.length).toBeGreaterThan(0);
      expect(new Set(slots.map((slot) => slot.slotId)).size).toBe(slots.length);
      expect(slots.some((slot) => slot.criticality === 'critical')).toBe(true);
      const applicability = Contracts.normalizedApplicability(reportType);
      expect(applicability.all.length).toBeGreaterThan(0);
      expect(applicability.all.every((predicate) => predicate.path.startsWith('$.derivedViews.'))).toBe(true);
    });
  });

  test('treats a missing dispatch identity as incompatible rather than wildcard', () => {
    const target = { runSessionId: 'run', modelId: 'GPT', dispatchId: 'd1', generationEpoch: 1 };
    expect(Contracts.sameIncidentScope(target, { ...target })).toBe(true);
    expect(Contracts.sameIncidentScope(target, { ...target, dispatchId: undefined })).toBe(false);
    expect(Contracts.sameIncidentScope(target, { ...target, dispatchId: 'd2' })).toBe(false);
    expect(Contracts.sameIncidentScope(target, { ...target, generationEpoch: 2 })).toBe(false);
  });

  test('derives every report event type from evidence slots without a second catalog', () => {
    ProofTelemetry.REPORT_TYPES.forEach((reportType) => {
      const fromSlots = Array.from(new Set(Contracts.normalizedSlots(reportType)
        .flatMap((slot) => slot.eventTypes)));
      expect(ProofTelemetry.REPORT_EVENT_TYPES[reportType]).toEqual(fromSlots);
    });
  });

  test('keeps the generated dependency registry identical to the executable snapshot', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(
      __dirname,
      '..',
      'docs',
      'proof_oriented_telemetry_spec_v1',
      'registry',
      'report-dependency-registry.json'
    ), 'utf8'));
    expect(registry).toEqual(ProofTelemetry.dependencyRegistrySnapshot());
  });

  test('schema 6 validates typed clock evidence', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(
      __dirname,
      '..',
      'docs',
      'proof_oriented_telemetry_spec_v1',
      'schemas',
      'telemetry-event-v6.schema.json'
    ), 'utf8'));
    const event = {
      schemaVersion: 6,
      eventId: 'event-0000000000000001',
      eventType: 'GENERATION_SIGNAL_CHANGED',
      layer: 'fact',
      seq: 1,
      ingestSeq: 1,
      runGeneration: 1,
      wallTs: 1000,
      runSessionId: 'run-1',
      modelId: 'GPT',
      dispatchId: 'd1',
      generationEpoch: 1,
      producer: { component: 'test', version: '1' },
      clock: {
        contractVersion: '1.0',
        producerEpochId: 'producer-epoch-1',
        producerSequence: 1,
        observedAtLocalMonoMs: 10,
        sentAtLocalMonoMs: 11,
        originKind: 'document',
        ingestEpochId: 'worker-epoch-1',
        ingestMonoMs: 12
      },
      payload: { typed: { kind: 'generation', state: 'active' } }
    };
    expect(new Ajv2020({ strict: false }).validate(schema, event)).toBe(true);
  });
});
