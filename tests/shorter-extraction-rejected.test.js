// Field evidence 2026-08-01, isolated single-model Grok run. Chronology from the
// full report:
//
//   66.7s  ANSWER_SOURCE_MATERIALIZED  len=2546  deferred_finalization  current_dispatch
//   68.8s  OBSERVATION_FRAME_CAPTURED  len=88    inline_executeScript
//   68.9s  ANSWER_SOURCE_MATERIALIZED  len=88    manual_ping            current_dispatch
//   68.9s  ANSWER_COMMIT_EVALUATED     len=88
//   69.0s  MODEL_TERMINAL_RECORDED     len=88    forced_success_with_text
//
// The real answer was extracted, then discarded two seconds later in favour of
// a 29x shorter one. The user saw the answer appear and be replaced by their own
// prompt. Both extractions claim identity current_dispatch, so identity cannot
// separate them — only relative size can.
const fs = require('fs');
const path = require('path');

const ORCH = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const guard = ORCH.slice(
  ORCH.indexOf('const incomingFinalAnswer = String(normalizedAnswer'),
  ORCH.indexOf('entry.earlyTerminalGuard = {', ORCH.indexOf('const incomingFinalAnswer = String(normalizedAnswer'))
);

describe('a later extraction cannot shrink the answer already held', () => {
  test('the guard compares against what is held for the same dispatch', () => {
    expect(guard).toContain('const heldFinalAnswer = String(entry.pendingFinalAnswer');
    expect(guard).toContain('sameDispatchAsHeld');
  });

  test('it rejects only a drastic shrink, not ordinary variation', () => {
    // 88 vs 2546 is the case; a small trim must still be allowed through.
    expect(guard).toContain('incomingFinalAnswer.length * 2 < heldFinalAnswer.length');
  });

  test('growth is never blocked', () => {
    // The condition is one-sided: a longer incoming answer cannot satisfy it.
    expect(guard).not.toMatch(/incomingFinalAnswer\.length\s*>\s*heldFinalAnswer\.length/);
  });

  test('a held answer below the recovery floor does not block anything', () => {
    expect(guard).toContain('heldFinalAnswer.length >= DOM_SNAPSHOT_RECOVERY_MIN_CHARS');
  });

  test('the rejection is recorded rather than silent', () => {
    expect(guard).toContain('SHORTER_EXTRACTION_REJECTED');
    expect(guard).toContain('heldAnswerLength');
    expect(guard).toContain('incomingAnswerLength');
  });

  test('the dispatch of the held answer is remembered, so the comparison is scoped', () => {
    expect(ORCH).toContain('entry.pendingFinalAnswerDispatchId = dispatchId || heldDispatchId || null;');
  });
});
