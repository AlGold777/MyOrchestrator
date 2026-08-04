require('../shared/proof-telemetry-policy.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Comparator = require('../shared/proof-telemetry-semantic-comparator.js');
const { SCENARIOS, sourceRows } = require('./fixtures/proof-telemetry-scenario-matrix.js');

describe('embedded/standalone semantic comparator', () => {
  async function frozenContainer() {
    const scenario = SCENARIOS.find((item) => item.id === 'multiple-incidents');
    const gptRows = sourceRows(scenario);
    const claudeRows = gptRows.map((event) => ({
      ...event,
      platform: 'Claude',
      ts: event.ts + 100,
      meta: {
        ...event.meta,
        llmName: 'Claude',
        dispatchId: String(event.meta.dispatchId).replace(/^GPT:/, 'Claude:')
      }
    }));
    const ledger = ProofTelemetry.buildLedger([...gptRows, ...claudeRows], {
      runSessionId: 'fixture-run', exportedAt: 20000
    });
    return ProofTelemetry.buildAllPresets(ledger, {
      canonicalLedger: true,
      exportedAt: 20000,
      extensionVersion: 'test',
      snapshotConsistency: 'queue_drained',
      runLifecycleStatus: 'closed',
      expectedModels: ['GPT', 'Claude']
    });
  }

  test('compares every report type for every incident in a frozen ledger', async () => {
    const result = await Comparator.compareContainer(await frozenContainer(), { exportedAt: 20000 });
    const incidents = Object.values((await frozenContainer()).derivedViews['incident-timeline'].data);
    expect(new Set(incidents.map((incident) => incident.modelId))).toEqual(new Set(['GPT', 'Claude']));
    expect(result.comparisonCount).toBe(ProofTelemetry.REPORT_TYPES.length * incidents.length);
    expect(result.equivalent).toBe(true);
    expect(result.results.every((item) => item.differences.length === 0)).toBe(true);
    expect(result.results.every((item) => item.core?.registry?.version)).toBe(true);
  });

  test.each([
    ['verdict', (value) => { value.diagnosticVerdict = 'mutated'; }, '$.diagnosticVerdict'],
    ['slot status', (value) => { value.slots[0].status = 'mutated'; }, '$.slots[0].status'],
    ['evidence event', (value) => { value.slots[0].eventIds.push('mutated-event'); }, '$.slots[0].eventIds'],
    ['causal relation', (value) => { value.diagnosisArbitration.causedBy = 'mutated-cause'; }, '$.diagnosisArbitration.causedBy'],
    ['limitation', (value) => { value.limitations.push({ code: 'mutated', impact: null, affectedReportTypes: [] }); }, '$.limitations']
  ])('negative control detects a changed %s', async (_name, mutate, expectedPath) => {
    const container = await frozenContainer();
    const incidentId = Object.keys(container.derivedViews['incident-timeline'].data)[0];
    const embedded = Comparator.normalizeEmbedded(container, 'cutted', incidentId);
    const changed = JSON.parse(JSON.stringify(embedded));
    mutate(changed);
    const result = Comparator.compare(embedded, changed);
    expect(result.equivalent).toBe(false);
    expect(result.differences.some((item) => item.path.startsWith(expectedPath))).toBe(true);
  });

  test('resolves embedded seq references back to canonical event IDs', async () => {
    const container = await frozenContainer();
    const incidentId = Object.keys(container.derivedViews['incident-timeline'].data)[0];
    const normalized = Comparator.normalizeEmbedded(container, 'prompt-not-sent', incidentId);
    const ledgerIds = new Set(container.ledger.events.map((event) => event.eventId));
    normalized.slots.flatMap((slot) => slot.eventIds).forEach((eventId) => expect(ledgerIds.has(eventId)).toBe(true));
  });
});
