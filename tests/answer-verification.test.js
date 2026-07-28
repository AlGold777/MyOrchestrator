const Verification = require('../shared/answer-verification');
const fixtures = require('./fixtures/answer-structure-cases.json');

describe('answer completeness verification', () => {
  test.each(fixtures)('$name', ({ first, second, verified }) => {
    const result = Verification.verifySnapshotPair(first, second);
    expect(result.verified).toBe(verified);
    if (verified) {
      expect(result).toEqual(expect.objectContaining({
        runSessionId: second.runSessionId,
        dispatchId: second.dispatchId,
        generationEpoch: second.generationEpoch,
        turnAnchor: second.turnAnchor
      }));
    }
  });

  test('timeline and revisions are bounded and contain no raw answer', () => {
    const entry = {};
    for (let i = 0; i < 140; i += 1) {
      Verification.appendTimeline(entry, { stage: `stage-${i}`, details: { text: 'secret', length: i } });
    }
    for (let i = 0; i < 40; i += 1) {
      Verification.appendRevision(entry, { text: `answer ${i}`, channel: 'dom' });
    }
    expect(entry.stageTimeline).toHaveLength(120);
    expect(entry.answerRevisions).toHaveLength(30);
    expect(JSON.stringify(entry.stageTimeline)).not.toContain('secret');
    expect(entry.answerRevisions[0]).not.toHaveProperty('text');
  });

  test('decision-critical generation diagnostics survive snapshot verification', () => {
    const identity = { runSessionId: 'r', dispatchId: 'd', generationEpoch: 1, turnAnchor: 0 };
    const snapshot = {
      ...identity,
      selectedHash: 'answer',
      selectedLength: 420,
      candidateSetHash: 'set',
      messageRootHash: 'root',
      messageRootLength: 455,
      resolution: 'exact',
      structuralComplete: true,
      structuralIssues: [],
      generationActive: false,
      generationSignalKind: 'inactive_controls_absent',
      generationSignalSelector: 'button[aria-label*="Stop" i]',
      observedAt: 12345
    };
    const result = Verification.verifySnapshotPair(snapshot, snapshot);
    expect(result).toEqual(expect.objectContaining({
      verified: true,
      messageRootLength: 455,
      generationSignalKind: 'inactive_controls_absent',
      generationSignalSelector: 'button[aria-label*="Stop" i]',
      observedAt: 12345
    }));
  });

  test('same text in a replaced selected node resets structural stability', () => {
    const identity = { runSessionId: 'r', dispatchId: 'd', generationEpoch: 1, turnAnchor: 0 };
    const base = {
      ...identity, selectedHash: 'same', selectedLength: 420, candidateSetHash: 'set',
      messageRootHash: 'root', resolution: 'exact', structuralComplete: true, generationActive: false
    };
    const result = Verification.verifySnapshotPair(
      { ...base, selectedNodeKey: 'answer-node-1' },
      { ...base, selectedNodeKey: 'answer-node-2' }
    );
    expect(result.verified).toBe(false);
    expect(result.reasons).toContain('selected_node_replaced');
  });

  test('automatic upgrade requires same identity, verified stable append', () => {
    const accepted = Verification.canAutoUpgrade(
      { length: 5, runSessionId: 'r', dispatchId: 'd', generationEpoch: 2, turnAnchor: 1 },
      { length: 11, runSessionId: 'r', dispatchId: 'd', generationEpoch: 2, turnAnchor: 1,
        verified: true, resolution: 'exact', structuralComplete: true, generationActive: false },
      { previousText: 'hello', nextText: 'hello world' }
    );
    expect(accepted.ok).toBe(true);
    expect(Verification.canAutoUpgrade(
      { length: 5, dispatchId: 'old' },
      { length: 11, dispatchId: 'new', verified: true },
      { previousText: 'hello', nextText: 'hello world' }
    ).ok).toBe(false);
  });

  test('automatic identity fails closed while manual comparison stays soft', () => {
    expect(Verification.sameIdentity({ dispatchId: 'd' }, { dispatchId: 'd' })).toBe(false);
    expect(Verification.sameIdentity({ dispatchId: 'd' }, { dispatchId: 'd' }, { strict: false })).toBe(true);
    expect(Verification.canAutoUpgrade(
      { length: 5, dispatchId: 'd' },
      { length: 11, dispatchId: 'd', verified: true },
      { previousText: 'hello', nextText: 'hello world' }
    ).reasons).toEqual(expect.arrayContaining([expect.stringContaining('identity_missing:')]));
  });

  test('automatic upgrade never falls back to length-only comparison', () => {
    const identity = { runSessionId: 'r', dispatchId: 'd', generationEpoch: 1, turnAnchor: 0 };
    const result = Verification.canAutoUpgrade(
      { ...identity, length: 10 },
      { ...identity, length: 100, verified: true, generationActive: false }
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('upgrade_texts_required');
  });

  test.each([
    ['fallback resolution', { resolution: 'fallback', structuralComplete: true, generationActive: false }, 'turn_resolution_fallback'],
    ['unknown resolution', { structuralComplete: true, generationActive: false }, 'turn_resolution_unknown'],
    ['unproven structure', { resolution: 'exact', generationActive: false }, 'structural_completeness_unproven'],
    ['active generation', { resolution: 'exact', structuralComplete: true, generationActive: true }, 'generation_still_active'],
    ['unknown generation', { resolution: 'exact', structuralComplete: true }, 'generation_inactive_unproven']
  ])('automatic upgrade rejects %s', (_name, proof, reason) => {
    const identity = { runSessionId: 'r', dispatchId: 'd', generationEpoch: 1, turnAnchor: 0 };
    const result = Verification.canAutoUpgrade(
      { ...identity, length: 5 },
      { ...identity, length: 11, verified: true, ...proof },
      { previousText: 'hello', nextText: 'hello world' }
    );
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain(reason);
  });
});
