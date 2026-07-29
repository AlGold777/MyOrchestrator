const Normalization = require('../shared/answer-proof-normalization.js');
const AnswerEvidence = require('../shared/answer-evidence.js');
const AnswerVerification = require('../shared/answer-verification.js');

describe('answer proof normalization', () => {
  test('normalizes equivalent text identically in every consumer', () => {
    const variants = ['A\u00a0answer\r\n\r\n\r\nB', 'A answer\n\nB\u200b'];
    const evidence = variants.map((text) => Normalization.evidence(text, {
      dispatchId: 'GPT:42:1', attemptId: 'attempt-1'
    }));
    expect(evidence[0]).toEqual(evidence[1]);
    expect(AnswerEvidence.hashText(variants[0])).toBe(AnswerVerification.hashText(variants[1]));
    expect(evidence[0]).toEqual(expect.objectContaining({
      normalizationVersion: Normalization.VERSION,
      payloadEvidenceId: expect.stringContaining('attempt-1')
    }));
  });

  test('does not create payload identity without an attempt', () => {
    expect(Normalization.evidence('answer', { dispatchId: 'GPT:42:1' }).payloadEvidenceId).toBeNull();
  });

  test('distinguishes repeated identical payloads by attempt identity', () => {
    const first = Normalization.evidence('same answer', { dispatchId: 'GPT:42:1', attemptId: 'attempt-1' });
    const second = Normalization.evidence('same answer', { dispatchId: 'GPT:42:1', attemptId: 'attempt-2' });
    expect(first.normalizedHash).toBe(second.normalizedHash);
    expect(first.payloadEvidenceId).not.toBe(second.payloadEvidenceId);
  });

  test('treats different normalization versions as incomparable', () => {
    const current = Normalization.evidence('answer', { dispatchId: 'GPT:42:1', attemptId: 'attempt-1' });
    expect(Normalization.compare(current, { ...current, normalizationVersion: 'other@1' })).toEqual({
      status: 'incomparable',
      reason: 'normalization_version_mismatch'
    });
    expect(Normalization.compare(current, { ...current, normalizedHash: 'fnv1a:00000000' }).status).toBe('mismatched');
  });

  test('answer revisions inherit attempt-scoped payload evidence', () => {
    const entry = { lastDispatchMeta: { dispatchId: 'GPT:42:1' } };
    const revision = AnswerVerification.appendRevision(entry, { text: 'answer', attemptId: 'attempt-7' });
    expect(revision).toEqual(expect.objectContaining({
      attemptId: 'attempt-7',
      normalizationVersion: Normalization.VERSION,
      payloadEvidenceId: expect.stringContaining('attempt-7')
    }));
  });
});
