// Guards the follow-up "false green" bug: on a second request into an existing
// conversation tab the previous answer is already on the page, and recovery /
// answer-start paths would finalize it as a fresh success. The adapter reports a
// pre-send baseline signature; the orchestrator rejects any candidate equal to it.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ORCH_SRC = read('background', 'job-orchestrator.js');
const ROUTER_SRC = read('background', 'message-router.js');
const UTILS_SRC = read('content-scripts', 'content-utils.js');
const CHATGPT_SRC = read('content-scripts', 'content-chatgpt.js');
const CLAUDE_SRC = read('content-scripts', 'content-claude.js');
const GEMINI_SRC = read('content-scripts', 'content-gemini.js');
const GROK_SRC = read('content-scripts', 'content-grok.js');
const LECHAT_SRC = read('content-scripts', 'content-lechat.js');
const QWEN_SRC = read('content-scripts', 'content-qwen.js');
const DEEPSEEK_SRC = read('content-scripts', 'content-deepseek.js');
const PERPLEXITY_SRC = read('content-scripts', 'content-perplexity.js');
const ZAI_SRC = read('content-scripts', 'content-zai.js');
const KIMI_SRC = read('content-scripts', 'content-kimi.js');

describe('dispatch baseline stale guard (follow-up false-green)', () => {
  test('orchestrator defines the baseline helpers + per-entry fields', () => {
    expect(ORCH_SRC).toContain('function normalizeAnswerSignatureBg');
    expect(ORCH_SRC).toContain('function isStaleBaselineCandidate');
    // Profiled ladder (2.80.142): the guard window follows the wait profile.
    expect(ORCH_SRC).toContain('getBaselineGuardWindowMs()');
    expect(ORCH_SRC).toContain('BASELINE_GUARD_WINDOW_SHORT_MS');
    expect(ORCH_SRC).toContain('preDispatchAnswerSignature: null');
    expect(ORCH_SRC).toContain('preDispatchAnswerHash: null');
    expect(ORCH_SRC).toContain('preDispatchAnswerCapturedAt: 0');
  });

  test('snapshot recovery is gated on submit-confirmation (content-independent primary guard)', () => {
    // The robust guard: if the prompt was never confirmed submitted and no new answer
    // started/completed, the on-page answer is the previous one — block recovery.
    expect(ORCH_SRC).toContain('const submitConfirmed = Boolean(');
    expect(ORCH_SRC).toContain('RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED');
    expect(ORCH_SRC).toContain('!submitConfirmed && !newAnswerEvidence');
    expect(ORCH_SRC).toContain('entry.answerCompleteDetectedAt || entry.lifecycleReadyAt');
    const TELEMETRY_SRC = read('background', 'telemetry-logs.js');
    expect(TELEMETRY_SRC).toContain('RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED');
  });

  describe('submit-confirmation gate semantics (mirror of the source logic)', () => {
    const gateBlocks = (entry, dispatchId = null, allowUnconfirmed = false) => {
      const submitConfirmed = Boolean(
        entry.promptSubmittedAt
        || entry.submitSource === 'content'
        || entry.submitSource === 'inferred_answer_evidence'
        || (entry.confirmedDispatchId && (!dispatchId || entry.confirmedDispatchId === dispatchId))
      );
      const newAnswerEvidence = Boolean(entry.answerCompleteDetectedAt || entry.lifecycleReadyAt);
      return !allowUnconfirmed && !submitConfirmed && !newAnswerEvidence;
    };
    test('blocks when nothing was submitted (Gemini: submit pending, old answer on page)', () => {
      expect(gateBlocks({})).toBe(true);
    });
    test('allows once the prompt was confirmed submitted', () => {
      expect(gateBlocks({ promptSubmittedAt: Date.now() })).toBe(false);
      expect(gateBlocks({ submitSource: 'content' })).toBe(false);
    });
    test('allows when a new answer actually completed / lifecycle ready', () => {
      expect(gateBlocks({ answerCompleteDetectedAt: Date.now() })).toBe(false);
      expect(gateBlocks({ lifecycleReadyAt: Date.now() })).toBe(false);
    });
    test('confirmedDispatchId only counts for the matching dispatch', () => {
      expect(gateBlocks({ confirmedDispatchId: 'M:1:0' }, 'M:1:0')).toBe(false);
      expect(gateBlocks({ confirmedDispatchId: 'M:1:9' }, 'M:1:0')).toBe(true);
    });
    test('explicit allowUnconfirmedRecovery override bypasses the gate', () => {
      expect(gateBlocks({}, null, true)).toBe(false);
    });
  });

  test('snapshot recovery rejects a baseline-equal snapshot instead of accepting it', () => {
    expect(ORCH_SRC).toContain('isStaleBaselineCandidate(entry, snapshot.text, dispatchId)');
    expect(ORCH_SRC).toContain('RECOVERY_STALE_BASELINE_REJECTED');
    // The reject path must give the snapshot budget back so a later (real) answer can land.
    expect(ORCH_SRC).toMatch(/stale_baseline_answer[\s\S]*refundRecoveryBudget|refundRecoveryBudget[\s\S]*stale_baseline_answer/);
  });

  test('handleLLMResponse ignores a baseline-equal answer (DeepSeek/Perplexity path)', () => {
    expect(ORCH_SRC).toContain('isStaleBaselineCandidate(entry, earlyAnswerText, guardDispatchId)');
    expect(ORCH_SRC).toContain('STALE_BASELINE_ANSWER_IGNORED');
  });

  test('router stores the reported baseline + the rejection events are pinned', () => {
    expect(ROUTER_SRC).toContain("case 'DISPATCH_BASELINE_CAPTURED'");
    expect(ROUTER_SRC).toContain('entry.preDispatchAnswerSignature = sig');
    expect(ROUTER_SRC).toContain('entry.preDispatchAnswerHash = self.AnswerEvidence?.hashText');
    expect(ROUTER_SRC).toContain('DISPATCH_BASELINE_REJECTED');
    expect(ROUTER_SRC).toContain('senderTabId && expectedTabId && senderTabId !== expectedTabId');
    expect(ROUTER_SRC).toContain("sendResponse({ status: 'dispatch_baseline_rejected', reason: 'meta_mismatch' });");
    expect(ROUTER_SRC).toContain('generationEpoch: normalizedMeta.generationEpoch');
    expect(ROUTER_SRC).toContain('attemptId: normalizedMeta.attemptId');
    expect(ROUTER_SRC).toContain("baselineState: sig ? 'present' : 'empty'");
    const TELEMETRY_SRC = read('background', 'telemetry-logs.js');
    expect(TELEMETRY_SRC).toContain('normalized.generationEpoch = Number(activeDispatchMeta.generationEpoch)');
    expect(TELEMETRY_SRC).toContain('normalized.attemptId = activeDispatchMeta.attemptId');
    expect(TELEMETRY_SRC).toContain('STALE_BASELINE_ANSWER_IGNORED');
    expect(TELEMETRY_SRC).toContain('RECOVERY_STALE_BASELINE_REJECTED');
  });

  test('snapshot cache write rejects a baseline-equal answer', () => {
    expect(ORCH_SRC).toContain('SNAPSHOT_STALE_BASELINE_SKIPPED');
    expect(ORCH_SRC).toContain("return { status: 'snapshot_ignored', reason: 'stale_baseline_answer' };");
  });

  test('ContentUtils exposes baseline helpers and all adapters report pre-send baseline', () => {
    expect(UTILS_SRC).toContain('const reportDispatchBaseline');
    expect(UTILS_SRC).toContain('startResponseLifecycleTracking');
    expect(UTILS_SRC).toContain('captureTurnAnchor');
    expect(UTILS_SRC).toContain("baselineText: String(baselineText || '')");
    expect(UTILS_SRC).toContain('turnAnchor: anchorAnswerCount');
    expect(UTILS_SRC).toContain('const isBaselineEquivalent');
    expect(UTILS_SRC).toContain("type: 'DISPATCH_BASELINE_CAPTURED'");
    expect(UTILS_SRC).toMatch(/\breportDispatchBaseline,/); // exported
    expect(UTILS_SRC).toMatch(/\bisBaselineEquivalent,/); // exported
    expect(CHATGPT_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, preDispatchBaseline');
    expect(CLAUDE_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, claudeDispatchBaseline');
    expect(GEMINI_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, preDispatchBaseline.text');
    expect(GROK_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, baselineSnapshot.text');
    expect(LECHAT_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, preDispatchBaseline');
    expect(QWEN_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, baselineAssistantText');
    expect(DEEPSEEK_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, preDispatchBaseline');
    expect(PERPLEXITY_SRC).toContain('reportDispatchBaseline?.(MODEL, dispatchMeta, preDispatchBaseline');
    expect(ZAI_SRC).toContain('reportDispatchBaseline?.(MODEL, meta, baseline');
    expect(KIMI_SRC).toContain('reportDispatchBaseline?.(MODEL, meta, baseline');
  });

  test('all adapters attempt pre-send baseline registration without blocking Send on telemetry failure', () => {
    [CHATGPT_SRC, CLAUDE_SRC, GEMINI_SRC, GROK_SRC, LECHAT_SRC, QWEN_SRC,
      DEEPSEEK_SRC, PERPLEXITY_SRC, ZAI_SRC, KIMI_SRC].forEach((source) => {
      expect(source).toMatch(/await window\.ContentUtils\?\.reportDispatchBaseline\?\./);
    });
    expect(UTILS_SRC).toContain("acceptedStatus: 'dispatch_baseline_ack'");
    expect(UTILS_SRC).toContain('timeoutMs: 5000');
    expect(UTILS_SRC).toContain('attempts: 2');
    expect(UTILS_SRC).not.toContain('setTimeout(() => finish(false), 1500)');
    expect(UTILS_SRC).toContain('const lifecycleStart = await Promise.resolve(start.call(lifecycle');
    expect(UTILS_SRC).toContain('if (lifecycleStart?.ok !== true) return false');
    [CHATGPT_SRC, CLAUDE_SRC, GEMINI_SRC, GROK_SRC, LECHAT_SRC, QWEN_SRC,
      DEEPSEEK_SRC, PERPLEXITY_SRC, ZAI_SRC, KIMI_SRC].forEach((source) => {
      expect(source).toContain("if (completionAttemptReady !== true)");
      expect(source).toContain("'completion_preflight_degraded'");
      expect(source).not.toContain("throw { type: 'completion_runtime_unavailable'");
    });
  });

  test('all provider transactions complete preflight before attachment or prompt side effects', () => {
    [CHATGPT_SRC, CLAUDE_SRC, GEMINI_SRC, GROK_SRC, LECHAT_SRC, QWEN_SRC,
      DEEPSEEK_SRC, PERPLEXITY_SRC, ZAI_SRC, KIMI_SRC].forEach((source) => {
      const preflightAt = source.indexOf('reportDispatchBaseline');
      const attachmentAt = source.indexOf('attachmentHandler?.attach');
      const insertionAt = source.indexOf('reportPromptInsertion');
      expect(preflightAt).toBeGreaterThan(-1);
      expect(attachmentAt).toBeGreaterThan(preflightAt);
      expect(insertionAt).toBeGreaterThan(preflightAt);
    });
  });

  test('pipeline calls receive the pre-send baseline text', () => {
    expect(CHATGPT_SRC).toContain('baselineText: baselineText ||');
    expect(GEMINI_SRC).toContain('baselineText: baselineText ||');
    expect(GROK_SRC).toContain('baselineText: baselineText ||');
    expect(LECHAT_SRC).toContain('baselineText: baselineText ||');
    expect(QWEN_SRC).toContain('baselineText: baselineText ||');
    expect(DEEPSEEK_SRC).toContain('baselineText: baselineText ||');
    expect(PERPLEXITY_SRC).toContain('baselineText: baselineText ||');
    expect(CLAUDE_SRC).toContain('baselineText: claudeDispatchBaseline ||');
    expect(ZAI_SRC).toContain('baselineText: baseline');
  });

  test('DOM fallback paths reject baseline-equivalent candidates', () => {
    expect(CHATGPT_SRC).toContain('isBaselineEquivalent?.(cleanedFallback, preDispatchBaseline)');
    expect(PERPLEXITY_SRC).toContain('isBaselineEquivalent?.(cleanedFallback, preDispatchBaseline)');
    expect(DEEPSEEK_SRC).toContain('isBaselineEquivalent?.(cleanedResponse, preDispatchBaseline)');
    expect(LECHAT_SRC).toContain('isBaselineEquivalent?.(cleaned, preDispatchBaseline)');
  });

  test('content + background normalize signatures identically', () => {
    // content-utils normalizeForPaste and orchestrator normalizeAnswerSignatureBg must agree.
    expect(UTILS_SRC).toMatch(/normalizeForPaste[\s\S]{0,120}replace\(\/\\s\+\/g, ' '\)[\s\S]{0,40}\.trim\(\)[\s\S]{0,40}\.toLowerCase\(\)/);
    expect(ORCH_SRC).toMatch(/normalizeAnswerSignatureBg[\s\S]{0,160}replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.toLowerCase\(\)/);
  });

  describe('isStaleBaselineCandidate semantics (mirror of the source logic)', () => {
    const WINDOW = 120000;
    const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isStale = (entry, text, dispatchId = null) => {
      if (!entry || !entry.preDispatchAnswerSignature) return false;
      const capturedAt = Number(entry.preDispatchAnswerCapturedAt || 0);
      if (capturedAt && (Date.now() - capturedAt) > WINDOW) return false;
      const baseDispatch = entry.preDispatchAnswerDispatchId || null;
      if (baseDispatch && dispatchId && baseDispatch !== dispatchId) return false;
      const sig = normalize(text);
      if (!sig) return false;
      return sig === entry.preDispatchAnswerSignature;
    };
    const entry = (over = {}) => Object.assign({
      preDispatchAnswerSignature: normalize('Previous   ANSWER\ntext'),
      preDispatchAnswerDispatchId: 'M:1:0',
      preDispatchAnswerCapturedAt: Date.now()
    }, over);

    test('the prior answer (cosmetic diff) is rejected', () => {
      expect(isStale(entry(), 'previous answer text', 'M:1:0')).toBe(true);
    });
    test('a genuinely new answer passes', () => {
      expect(isStale(entry(), 'a brand new answer', 'M:1:0')).toBe(false);
    });
    test('no baseline (fresh chat) never blocks', () => {
      expect(isStale(entry({ preDispatchAnswerSignature: null }), 'anything', 'M:1:0')).toBe(false);
    });
    test('expired baseline window no longer blocks', () => {
      expect(isStale(entry({ preDispatchAnswerCapturedAt: Date.now() - WINDOW - 1 }), 'previous answer text', 'M:1:0')).toBe(false);
    });
    test('baseline from a different dispatch is not applied', () => {
      expect(isStale(entry({ preDispatchAnswerDispatchId: 'M:1:9' }), 'previous answer text', 'M:1:0')).toBe(false);
    });
    test('empty candidate is never stale', () => {
      expect(isStale(entry(), '', 'M:1:0')).toBe(false);
    });
  });
});
