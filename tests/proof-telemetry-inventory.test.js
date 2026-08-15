const Contracts = require('../shared/proof-telemetry-contracts.js');
const Inventory = require('../shared/proof-telemetry-inventory.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

describe('proof telemetry inventory', () => {
  test('registers every canonical event type and every report dependency', () => {
    const result = Inventory.validateInventory(ProofTelemetry.CANONICAL_EVENT_TYPES);
    expect(result).toEqual({ valid: true, errors: [] });
    expect(Object.keys(Inventory.EVENT_REGISTRY)).toHaveLength(67);

    for (const eventType of [
      'ATTEMPT_CONTEXT_CAPTURED', 'WITNESS_OBSERVED', 'GENERATION_OBSERVED',
      'OWNERSHIP_CONFIRMED', 'PRODUCER_TERMINAL', 'CONTENT_TERMINAL',
      'TERMINAL_DECISION', 'EXTRACTION_SNAPSHOT_CAPTURED'
    ]) {
      expect(ProofTelemetry.classifyRuntimeEvent({ label: eventType })).toEqual(expect.objectContaining({
        route: 'canonical', eventType
      }));
    }
  });

  test('fails closed when code introduces an event without registry metadata', () => {
    const result = Inventory.validateInventory([
      ...ProofTelemetry.CANONICAL_EVENT_TYPES,
      'NEW_UNREGISTERED_EVENT'
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('unregistered event type: NEW_UNREGISTERED_EVENT');
  });

  test('records ownership, identity, storage, retention and consumers for every event', () => {
    Object.entries(Inventory.EVENT_REGISTRY).forEach(([eventType, entry]) => {
      expect(entry.eventType).toBe(eventType);
      expect(entry.producers.length).toBeGreaterThan(0);
      expect(entry.requiredEnvelopeFields).toEqual(expect.arrayContaining(['eventId', 'eventType', 'runSessionId', 'payload']));
      expect(entry.identity.requiredFields).toContain('runSessionId');
      expect(entry.recipients).toContain('proof-ledger');
      expect(entry.retention.canonical).toMatch(/lossless|bounded-with-explicit-omission/);
      expect(entry.consumers).toContain('telemetry-validator');
    });
  });

  test('capability matrix covers every required surface with explicit support', () => {
    expect(Inventory.CAPABILITY_MATRIX).toHaveLength(10);
    const allowed = new Set(Object.values(Inventory.SUPPORT));
    Inventory.CAPABILITY_MATRIX.forEach((capability) => {
      ['legacyExport', 'schema6', 'json', 'markdown', 'timeline', 'digest'].forEach((surface) => {
        expect(allowed.has(capability.support[surface])).toBe(true);
      });
      expect(capability.evidence.length).toBeGreaterThan(0);
    });
  });

  test('report consumers are derived from executable contracts', () => {
    Object.entries(Contracts.REPORT_CONTRACTS).forEach(([reportType, contract]) => {
      (contract.slots || []).flatMap((slot) => slot[2] || []).forEach((eventType) => {
        expect(Inventory.EVENT_REGISTRY[eventType].consumers).toContain(`report:${reportType}`);
      });
    });
  });
});
