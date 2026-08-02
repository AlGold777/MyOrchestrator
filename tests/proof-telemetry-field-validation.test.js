const {
  versionBefore,
  explainSourceError,
  summarizeFindings,
  analyzeDigestText
} = require('../scripts/validate-proof-telemetry-field.js');

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
});
