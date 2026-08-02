const {
  versionBefore,
  explainSourceError,
  summarizeFindings,
  analyzeDigestText
} = require('../scripts/validate-proof-telemetry-field.js');

describe('proof telemetry field validation', () => {
  test('classifies historical contract drift without hiding unknown errors', () => {
    const findings = summarizeFindings([
      { code: 'JSON_SCHEMA', message: "manifest/sourceSnapshot: must have required property 'snapshotCompleteness'" },
      { code: 'S22', message: 'invalid provenance contract for state axis submission' },
      { code: 'UNEXPECTED', message: 'new unexplained failure' }
    ], '2.81.220');
    expect(findings.JSON_SCHEMA.explanation).toMatch(/2\.81\.226/);
    expect(findings.S22.explanation).toMatch(/2\.81\.228/);
    expect(findings.UNEXPECTED.explanation).toBeNull();
    expect(explainSourceError({ code: 'S22' }, '2.81.228')).toBeNull();
    expect(versionBefore('2.81.227', '2.81.228')).toBe(true);
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
