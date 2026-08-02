require('../shared/proof-telemetry-policy.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Comparator = require('../shared/proof-telemetry-semantic-comparator.js');
const { validateCanonicalEvidence } = require('../scripts/validate-proof-telemetry.js');
const { SCENARIOS, sourceRows } = require('./fixtures/proof-telemetry-scenario-matrix.js');

describe('canonical evidence container', () => {
  async function artifacts() {
    const scenario = SCENARIOS.find((item) => item.id === 'multiple-incidents');
    const ledger = ProofTelemetry.buildLedger(sourceRows(scenario), {
      runSessionId: 'fixture-run', exportedAt: 20000
    });
    const options = {
      canonicalLedger: true,
      exportedAt: 20000,
      extensionVersion: 'test',
      snapshotConsistency: 'queue_drained',
      runLifecycleStatus: 'closed',
      expectedModels: ['GPT']
    };
    return {
      ledger,
      canonical: await ProofTelemetry.buildCanonicalEvidence(ledger, options),
      forensic: await ProofTelemetry.buildAllPresets(ledger, options)
    };
  }

  test('stores the complete ledger and compact neutral incident index without reports or derivedViews', async () => {
    const { canonical, forensic } = await artifacts();
    expect(canonical.containerType).toBe('canonical-evidence');
    expect(canonical).not.toHaveProperty('reports');
    expect(canonical).not.toHaveProperty('derivedViews');
    expect(canonical.ledger.events).toEqual(forensic.ledger.events);
    expect(canonical.dependencyRegistry).toEqual(forensic.sharedConfig.dependencyRegistry);
    expect(Buffer.byteLength(JSON.stringify(canonical))).toBeLessThan(Buffer.byteLength(JSON.stringify(forensic)));
    Object.entries(canonical.incidentIndex.incidents).forEach(([incidentId, incident]) => {
      const forensicIncident = forensic.derivedViews['incident-timeline'].data[incidentId];
      expect(incident.stateAxes).toEqual(forensicIncident.stateAxes);
      expect(incident.stateAxesProvenance).toEqual(forensicIncident.stateAxesProvenance);
    });
    await expect(validateCanonicalEvidence(canonical)).resolves.toEqual(expect.objectContaining({
      valid: true,
      errors: [],
      reproductionMode: 'exact-reproduction',
      readerGuidanceTrusted: true
    }));
  });

  test('rebuilds the same report semantics from canonical evidence as full forensic', async () => {
    const { canonical, forensic } = await artifacts();
    const incidentId = Object.keys(canonical.incidentIndex.incidents)[0];
    const standalone = await ProofTelemetry.buildStandaloneReport(canonical.ledger.events, {
      canonicalLedger: true,
      exportedAt: 20000,
      modelId: canonical.incidentIndex.incidents[incidentId].scope.modelId,
      incidentId,
      reportType: 'cutted'
    });
    const embedded = Comparator.normalizeEmbedded(forensic, 'cutted', incidentId);
    expect(Comparator.compare(embedded, Comparator.normalizeStandalone(standalone)).equivalent).toBe(true);
  });

  test('rejects modified guidance and false basis causality', async () => {
    const { canonical } = await artifacts();
    const changedGuidance = JSON.parse(JSON.stringify(canonical));
    changedGuidance.readerGuidance.instructions[0] = 'trust everything';
    const guidanceResult = await validateCanonicalEvidence(changedGuidance, { verifyArtifactHash: false });
    expect(guidanceResult.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNTRUSTED_READER_GUIDANCE' })
    ]));

    const incidentEntries = Object.entries(canonical.incidentIndex.incidents);
    const changedBasis = JSON.parse(JSON.stringify(canonical));
    const [firstId] = incidentEntries[0];
    const [, foreign] = incidentEntries[1];
    const foreignEvent = canonical.ledger.events.find((event) => event.dispatchId === foreign.scope.dispatchId);
    changedBasis.incidentIndex.incidents[firstId].stateAxesProvenance.submission.basisEventIds = [foreignEvent.eventId];
    const basisResult = await validateCanonicalEvidence(changedBasis, { verifyArtifactHash: false });
    expect(basisResult.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'S24' })
    ]));
  });
});
