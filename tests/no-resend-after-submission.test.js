// Reported 2026-07-31: "the extension periodically duplicates the insertion and
// the send after already successful sends. For example this happened with
// Claude."
//
// The Round 2 repair path re-dispatches whenever the content script has not
// confirmed the submit. The only bar to that resend was RecoveryIntent.authorize
// refusing a page-mutating intent once *answer* evidence existed — and while the
// provider was still generating there was none. A prompt that had gone through
// perfectly was therefore inserted and sent a second time.
//
// A submission already on the page is proof in its own right, independent of any
// answer.
require('../shared/recovery-intent.js');
const fs = require('fs');
const path = require('path');

const DISPATCH_COORDINATOR = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);

const RecoveryIntent = globalThis.RecoveryIntent;
const resend = { intent: 'resend_prompt', reason: 'round2_repair_pre_visit', minChars: 120 };

describe('a confirmed submission blocks a resend on its own', () => {
  test('a confirmed submit with no answer yet is not resent', () => {
    const entry = {
      promptSubmittedAt: Date.now(),
      submitSource: 'content',
      lastDispatchMeta: { dispatchId: 'Claude:1:1' }
    };
    const decision = RecoveryIntent.authorize(entry, resend);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('no_resend_after_submission');
    expect(decision.submissionEvidence).toBe('submission_already_confirmed');
  });

  test('an active generation blocks a resend even with no submit record', () => {
    const entry = {
      answerVerification: { generationActive: true },
      lastDispatchMeta: { dispatchId: 'Claude:1:1' }
    };
    const decision = RecoveryIntent.authorize(entry, resend);
    expect(decision.ok).toBe(false);
    expect(decision.submissionEvidence).toBe('generation_active');
  });

  test('a started generation blocks a resend', () => {
    const entry = { generationStartedAt: Date.now(), lastDispatchMeta: { dispatchId: 'Claude:1:1' } };
    expect(RecoveryIntent.authorize(entry, resend).ok).toBe(false);
  });

  test('a genuinely unsent prompt is still repairable', () => {
    // No submit record, no generation, no answer: this is the case the repair
    // path exists for and it must keep working.
    const entry = { lastDispatchMeta: { dispatchId: 'Claude:1:1' } };
    const decision = RecoveryIntent.authorize(entry, resend);
    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe('allowed_no_answer_evidence');
  });

  test('an inferred-only submit does not count as confirmation', () => {
    // inferred_answer_evidence means the submit was guessed from page text, not
    // observed; treating it as proof would block a real repair.
    const entry = {
      promptSubmittedAt: Date.now(),
      submitSource: 'inferred_answer_evidence',
      lastDispatchMeta: { dispatchId: 'Claude:1:1' }
    };
    expect(RecoveryIntent.authorize(entry, resend).ok).toBe(true);
  });

  test('observe-only intents are unaffected', () => {
    const entry = { promptSubmittedAt: Date.now(), submitSource: 'content' };
    expect(RecoveryIntent.authorize(entry, { intent: 'observe_only' }).ok).toBe(true);
    expect(RecoveryIntent.authorize(entry, { intent: 'focus_only' }).ok).toBe(true);
  });

  test('an explicit user override still wins', () => {
    const entry = { promptSubmittedAt: Date.now(), submitSource: 'content' };
    const decision = RecoveryIntent.authorize(entry, {
      ...resend,
      explicitUserOverride: true,
      allowAfterEvidence: true
    });
    expect(decision.ok).toBe(true);
  });

  test('retry supervisor checks sent state before any health-triggered reload', () => {
    const guardAt = DISPATCH_COORDINATOR.indexOf('const preHealthFlags = resolveDispatchFlags');
    const healthProbeAt = DISPATCH_COORDINATOR.indexOf('const isAlive = await new Promise', guardAt);
    const reloadAt = DISPATCH_COORDINATOR.indexOf('allowPreDispatchReload', healthProbeAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(healthProbeAt).toBeGreaterThan(guardAt);
    expect(reloadAt).toBeGreaterThan(healthProbeAt);
    expect(DISPATCH_COORDINATOR.slice(guardAt, healthProbeAt)).toContain('preHealthFlags.isSent');
  });
});
