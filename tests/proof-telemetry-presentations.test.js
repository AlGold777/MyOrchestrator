const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Presentations = require('../shared/proof-telemetry-presentations.js');

const evt = (platform, label, ts, meta = {}) => ({
  platform,
  label,
  ts,
  meta: { llmName: platform, runSessionId: 42, dispatchId: `${platform}:42:1`, generationEpoch: 1, ...meta }
});

describe('proof-ledger Timeline and Markdown shadow projections', () => {
  test('projects canonical rows with stable identity and renders proof-based Markdown', () => {
    const legacy = [
      evt('GPT', 'PROMPT_SUBMITTED_ACCEPTED', 1000),
      evt('GPT', 'ANSWER_GENERATING', 1100, { textLength: 20 }),
      evt('GPT', 'MODEL_FINAL', 1200, { finalStatus: 'SUCCESS' })
    ];
    const proof = ProofTelemetry.buildLedger(legacy, { runSessionId: 42, exportedAt: 1300 });
    const rows = Presentations.timelineRows(proof);
    expect(rows).toHaveLength(proof.length);
    expect(rows.every((row) => row.eventId && row.seq && row.dispatchId === 'GPT:42:1')).toBe(true);
    const markdown = Presentations.renderMarkdown(proof, {
      snapshotBoundary: { runSessionId: 42, ledgerCompleteThroughSeq: proof[proof.length - 1].seq }
    });
    expect(markdown).toContain('## Canonical proof telemetry');
    expect(markdown).toContain('EventId');
    proof.forEach((event) => expect(markdown).toContain(event.eventId));
  });

  test('records parity and explicit legacy-only/proof-only facts without changing either stream', () => {
    const legacy = [evt('GPT', 'ANSWER_GENERATING', 1000)];
    const proof = ProofTelemetry.buildLedger(legacy, { runSessionId: 42, exportedAt: 1100 });
    const legacyBefore = JSON.stringify(legacy);
    const proofBefore = JSON.stringify(proof);
    const bundle = Presentations.buildShadowBundle(legacy, proof, { generatedAt: 1200 });
    expect(bundle.comparison.status).toBe('matched');
    expect(bundle.comparison.legacyOnlyEventTypes).toEqual([]);
    expect(bundle.timeline).toHaveLength(proof.length);
    expect(JSON.stringify(legacy)).toBe(legacyBefore);
    expect(JSON.stringify(proof)).toBe(proofBefore);
  });

  test('detects terminal and identity divergence instead of hiding it', () => {
    const legacy = [evt('GPT', 'MODEL_FINAL', 1000)];
    const proof = ProofTelemetry.buildLedger([evt('Claude', 'ANSWER_GENERATING', 1000)], { runSessionId: 42 });
    const comparison = Presentations.compareLegacyToProof(legacy, proof);
    expect(comparison.status).toBe('mismatch');
    expect(comparison.mismatchCodes).toEqual(expect.arrayContaining([
      'model_set_mismatch',
      'dispatch_identity_mismatch',
      'terminal_count_mismatch'
    ]));
  });
});
