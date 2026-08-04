const {
  versionBefore,
  explainSourceError,
  summarizeFindings,
  analyzeDigestText,
  inspectJsonArtifact
} = require('../scripts/validate-proof-telemetry-field.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

describe('proof telemetry field validation', () => {
  test('classifies historical contract drift without hiding unknown errors', () => {
    const source = {
      manifest: { sourceSnapshot: {} },
      exportAudit: {},
      reports: { cutted: {} },
      derivedViews: { 'incident-timeline': { data: { incident: { stateAxes: {} } } } }
    };
    const result = summarizeFindings([
      { code: 'JSON_SCHEMA', message: "manifest/sourceSnapshot: must have required property 'snapshotCompleteness'" },
      { code: 'S22', message: 'invalid provenance contract for state axis submission' },
      { code: 'UNEXPECTED', message: 'new unexplained failure' }
    ], '2.81.220', source);
    // A near-match is not allowlisted: migration messages must be exact.
    expect(result.findings.JSON_SCHEMA.explanation).toBeNull();
    expect(result.findings.S22.explanation).toMatch(/2\.81\.228/);
    expect(result.findings.UNEXPECTED.explanation).toBeNull();
    expect(result.unexplained).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'JSON_SCHEMA' }),
      expect.objectContaining({ code: 'UNEXPECTED' })
    ]));
    expect(explainSourceError({ code: 'S22', message: 'additional basis corruption' }, '2.81.220', source)).toBeNull();
    expect(versionBefore('2.81.227', '2.81.228')).toBe(true);
  });

  test('rejects an expected migration signature when its count is not exact', () => {
    const source = {
      reports: { cutted: {} },
      derivedViews: { 'incident-timeline': { data: { incident: { stateAxes: {} } } } }
    };
    const duplicated = Array(2).fill({
      code: 'S22',
      message: 'invalid provenance contract for state axis submission'
    });
    const result = summarizeFindings(duplicated, '2.81.220', source);
    expect(result.findings.S22).toEqual(expect.objectContaining({ explanation: null, unexplainedCount: 2 }));
  });

  test('recognizes only the exact historical zero-basis provenance structure', () => {
    const oldProvenance = (ruleId) => ({
      layer: 'inference',
      ruleId,
      derivationVersion: 'state-axes-provenance@1.0.0',
      basisEventIds: []
    });
    const source = {
      sharedConfig: { generatorVersion: 'proof-export@2.6.0' },
      reports: { cutted: {}, 'false-success': {} },
      derivedViews: { 'incident-timeline': { data: {
        first: { stateAxesProvenance: { answerIdentity: oldProvenance('no-candidate-evidence') } },
        second: { stateAxesProvenance: { answerIdentity: oldProvenance('no-candidate-evidence') } }
      } } }
    };
    const finding = { code: 'S22', message: 'non-audit provenance requires basis evidence for state axis answerIdentity' };
    expect(summarizeFindings(Array(4).fill(finding), '2.81.227', source).unexplained).toEqual([]);
    expect(summarizeFindings(Array(3).fill(finding), '2.81.227', source).unexplained)
      .toEqual([expect.objectContaining({ count: 3 })]);
    source.derivedViews['incident-timeline'].data.first.stateAxesProvenance.answerIdentity.ruleId = 'different-rule';
    expect(summarizeFindings(Array(4).fill(finding), '2.81.227', source).unexplained)
      .toEqual([expect.objectContaining({ count: 4 })]);
  });

  test('marks digest as triage-only and extracts only safe envelope metadata', () => {
    const result = analyzeDigestText([
      '# READ THIS FIRST',
      'It does NOT carry these event types, present in this run:',
      'RULE: do not infer the absence of anything from this document alone.',
      'version 2.81.227 | 2026-08-02T12:01:47.625Z | 558 events',
      'run sessions: run-42'
    ].join('\n'), '/tmp/sample-digest.txt');
    expect(result).toEqual(expect.objectContaining({
      file: 'sample-digest.txt',
      extensionVersion: '2.81.227',
      eventCount: 558,
      role: 'triage-only',
      supportsIntegrityValidation: false,
      supportsOfflineReplay: false,
      missingSignalRulePresent: true
    }));
  });

  test('reads canonical evidence registry, incidents and report identity from their canonical locations', async () => {
    const ledger = ProofTelemetry.buildLedger([
      {
        platform: 'GPT',
        label: 'RUN_CONFIG_RECORDED',
        ts: 1000,
        meta: { llmName: 'GPT', runSessionId: 42, expectedModels: ['GPT'] }
      },
      {
        platform: 'GPT',
        label: 'PROMPT_SUBMITTED_ACCEPTED',
        ts: 1100,
        meta: { llmName: 'GPT', runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 }
      }
    ], { runSessionId: 42, exportedAt: 1200 });
    const canonical = await ProofTelemetry.buildCanonicalEvidence(ledger, {
      canonicalLedger: true,
      exportedAt: 1200,
      extensionVersion: '2.81.252'
    });

    const result = await inspectJsonArtifact(canonical, { currentExtensionVersion: '2.81.252' });

    expect(result.source.registryVersion).toBe(canonical.dependencyRegistry.registryVersion);
    expect(result.source.incidentCount).toBe(canonical.incidentIndex.incidentCount);
    expect(result.source.incidentCount).toBeGreaterThan(0);
    expect(result.reinterpretation.mode).toBe('exact-current-generator');
    expect(result.gatePassed).toBe(true);
  });
});
