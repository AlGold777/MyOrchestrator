const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const Contracts = require('../shared/proof-telemetry-contracts.js');

describe('proof telemetry executable contracts', () => {
  test('defines evidence-slot contracts for the six user diagnostic questions', () => {
    expect(Object.keys(Contracts.REPORT_CONTRACTS)).toEqual([
      'cutted',
      'false-success',
      'old-answer',
      'empty',
      'prompt-not-sent',
      'late-end'
    ]);
    Object.keys(Contracts.REPORT_CONTRACTS).forEach((reportType) => {
      const slots = Contracts.normalizedSlots(reportType);
      expect(slots.length).toBeGreaterThan(0);
      expect(new Set(slots.map((slot) => slot.slotId)).size).toBe(slots.length);
      expect(slots.some((slot) => slot.criticality === 'critical')).toBe(true);
    });
  });

  test('treats a missing dispatch identity as incompatible rather than wildcard', () => {
    const target = { runSessionId: 'run', modelId: 'GPT', dispatchId: 'd1', generationEpoch: 1 };
    expect(Contracts.sameIncidentScope(target, { ...target })).toBe(true);
    expect(Contracts.sameIncidentScope(target, { ...target, dispatchId: undefined })).toBe(false);
    expect(Contracts.sameIncidentScope(target, { ...target, dispatchId: 'd2' })).toBe(false);
    expect(Contracts.sameIncidentScope(target, { ...target, generationEpoch: 2 })).toBe(false);
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
