// Finalization improvements:
// (1) deferred-recheck backoff — stuck streams stop re-pinging every 8s for minutes;
// (2) log-replay property test — a Le Chat-style deferred->forced->PARTIAL sequence
//     ends in a single PARTIAL terminal with the post-terminal duplicate ignored.
const fs = require('fs');
const path = require('path');
const LogReplayHarness = require('../shared/log-replay-harness');

const ORCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

describe('deferred-recheck backoff (mirror of nextDeferRecheckDelay)', () => {
  const BASE = 8000;
  const MAX = 32000;
  const FACTOR = 1.6;
  const make = () => ({});
  const next = (entry, len) => {
    const prev = Number(entry.deferRecheckLastLen);
    if (len > 0 && len === prev) entry.deferRecheckUnchanged = (Number(entry.deferRecheckUnchanged) || 0) + 1;
    else entry.deferRecheckUnchanged = 0;
    entry.deferRecheckLastLen = len;
    return Math.min(MAX, Math.round(BASE * Math.pow(FACTOR, entry.deferRecheckUnchanged)));
  };

  test('unchanged length backs off geometrically, capped; growth resets', () => {
    const e = make();
    expect(next(e, 1000)).toBe(8000);   // first sample
    expect(next(e, 1000)).toBe(12800);  // unchanged x1
    expect(next(e, 1000)).toBe(20480);  // unchanged x2
    expect(next(e, 1000)).toBe(32000);  // unchanged x3 -> capped (32768 -> 32000)
    expect(next(e, 1500)).toBe(8000);   // text grew -> reset
  });

  test('source wires the backoff into the deferred recheck timer', () => {
    expect(ORCH_SRC).toContain('function nextDeferRecheckDelay');
    expect(ORCH_SRC).toContain('const recheckDelay = nextDeferRecheckDelay(');
    expect(ORCH_SRC).toContain('}, recheckDelay));');
  });
});

describe('finalization replay property (Le Chat deferred -> PARTIAL)', () => {
  test('a deferred-then-forced PARTIAL run ends in one PARTIAL terminal, duplicate ignored', () => {
    const replay = LogReplayHarness.replay([
      { ts: 1, llmName: 'Le Chat', label: 'Finalization deferred (generation active)', status: 'GENERATING' },
      { ts: 2, llmName: 'Le Chat', label: 'Finalization deferred (generation active)', status: 'GENERATING' },
      { ts: 3, llmName: 'Le Chat', label: 'Finalization forced (stable answer evidence)', status: 'GENERATING' },
      { ts: 4, llmName: 'Le Chat', label: 'MODEL_FINAL', status: 'PARTIAL', meta: { decision: 'accept_success', reason: 'streaming_incomplete' } },
      { ts: 5, llmName: 'Le Chat', label: 'MODEL_FINAL ignored (deduplicated)', status: 'PARTIAL', meta: { decision: 'ignore_duplicate_final', telemetryTaxonomy: { eventClass: 'finalization_duplicate_ignored' } } }
    ]);
    expect(replay.models['Le Chat']).toEqual(expect.objectContaining({
      finalStatus: 'PARTIAL',
      terminalEvents: 1,
      duplicateFinalIgnored: 1
    }));
  });
});
