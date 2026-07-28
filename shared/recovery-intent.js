// shared/recovery-intent.js
// Recovery action safety contract. Keeps observe-only recovery separate from prompt resend.

(function initRecoveryIntent(root) {
  'use strict';

  const INTENTS = Object.freeze({
    OBSERVE_ONLY: 'observe_only',
    FOCUS_ONLY: 'focus_only',
    NUDGE_GENERATION: 'nudge_generation',
    COMPOSER_REPAIR: 'composer_repair',
    RESEND_PROMPT: 'resend_prompt'
  });

  const MUTATING_INTENTS = new Set([
    INTENTS.COMPOSER_REPAIR,
    INTENTS.RESEND_PROMPT
  ]);

  function normalizeIntent(intent) {
    const value = String(intent || '').trim().toLowerCase();
    if (Object.values(INTENTS).includes(value)) return value;
    if (value.includes('resend') || value.includes('repair_dispatch')) return INTENTS.RESEND_PROMPT;
    if (value.includes('composer_repair')) return INTENTS.COMPOSER_REPAIR;
    if (value.includes('focus') || value.includes('visit')) return INTENTS.FOCUS_ONLY;
    if (value.includes('nudge') || value.includes('scroll')) return INTENTS.NUDGE_GENERATION;
    return INTENTS.OBSERVE_ONLY;
  }

  function normalizeAnswer(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isBaselineEquivalent(entry = {}, text = '', dispatchId = null) {
    const baseline = normalizeAnswer(entry.preDispatchAnswerSignature || '');
    const candidate = normalizeAnswer(text);
    if (!baseline || !candidate) return false;
    const baselineDispatchId = entry.preDispatchAnswerDispatchId || null;
    if (baselineDispatchId && dispatchId && String(baselineDispatchId) !== String(dispatchId)) return false;
    return baseline === candidate;
  }

  function hasConfirmedSubmission(entry = {}, dispatchId = null) {
    const confirmedDispatchId = entry.confirmedDispatchId || null;
    const dispatchMatches = !dispatchId || !confirmedDispatchId || String(confirmedDispatchId) === String(dispatchId);
    const inferredOnly = entry.submitSource === 'inferred_answer_evidence';
    return Boolean(dispatchMatches && (
      (entry.promptSubmittedAt && !inferredOnly)
      || entry.submitSource === 'content'
      || (confirmedDispatchId && !inferredOnly)
    ));
  }

  function hasMatchingLifecycleEvidence(entry = {}, dispatchId = null) {
    if (!entry.lifecycleReadyAt && !entry.answerCompleteDetectedAt) return false;
    const lifecycleDispatchId = entry.lifecycleReadyMeta?.dispatchId
      || entry.answerCompleteMeta?.dispatchId
      || null;
    return !dispatchId
      ? true
      : Boolean(lifecycleDispatchId && String(lifecycleDispatchId) === String(dispatchId));
  }

  function hasMatchingVerifiedEvidence(entry = {}, dispatchId = null) {
    const verification = entry.answerVerification || {};
    if (verification.verified !== true
      || verification.resolution !== 'exact'
      || verification.structuralComplete !== true
      || verification.generationActive !== false) return false;
    const verificationDispatchId = verification.dispatchId || null;
    return !dispatchId
      ? true
      : Boolean(verificationDispatchId && String(verificationDispatchId) === String(dispatchId));
  }

  function evaluateFreshEvidence(entry = {}, options = {}) {
    const minChars = Number(options.minChars || 120);
    const dispatchId = options.dispatchId || entry.lastDispatchMeta?.dispatchId || entry.confirmedDispatchId || null;
    const candidates = [entry.answer, entry.pendingFinalAnswer]
      .map((value) => String(value || '').trim())
      .filter((value) => value.length >= minChars);
    const lifecycleFresh = hasMatchingLifecycleEvidence(entry, dispatchId);
    const verifiedFresh = hasMatchingVerifiedEvidence(entry, dispatchId);
    const submissionConfirmed = hasConfirmedSubmission(entry, dispatchId);
    const explicitFresh = entry.answerFreshness?.fresh === true
      && (!dispatchId || !entry.answerFreshness.dispatchId || String(entry.answerFreshness.dispatchId) === String(dispatchId));
    const freshText = candidates.find((text) => !isBaselineEquivalent(entry, text, dispatchId)) || null;
    const fresh = Boolean(
      verifiedFresh
      || explicitFresh
      || (freshText && submissionConfirmed)
    );
    return {
      fresh,
      dispatchId,
      lifecycleFresh,
      verifiedFresh,
      explicitFresh,
      submissionConfirmed,
      hasCandidateText: candidates.length > 0,
      baselineEquivalent: candidates.length > 0 && candidates.every((text) => isBaselineEquivalent(entry, text, dispatchId)),
      reason: fresh
        ? (verifiedFresh ? 'matching_verified_answer' : (explicitFresh ? 'explicit_fresh_turn' : 'confirmed_submit_nonbaseline_text'))
        : (candidates.some((text) => isBaselineEquivalent(entry, text, dispatchId))
          ? 'baseline_only'
          : (lifecycleFresh ? 'lifecycle_without_verified_answer' : 'freshness_unproven'))
    };
  }

  function hasTerminalEligibleEvidence(entry = {}, options = {}) {
    return evaluateFreshEvidence(entry, options).fresh;
  }

  function authorize(entry = {}, request = {}) {
    const intent = normalizeIntent(request.intent || request.reason || request.action);
    const evidenceHit = hasTerminalEligibleEvidence(entry, request);
    const mutatesPage = MUTATING_INTENTS.has(intent);
    const explicitOverride = request.explicitUserOverride === true && request.allowAfterEvidence === true;
    if (mutatesPage && evidenceHit && !explicitOverride) {
      return {
        ok: false,
        intent,
        reason: 'no_resend_after_answer_evidence',
        mutatesPage,
        evidenceHit
      };
    }
    return {
      ok: true,
      intent,
      reason: evidenceHit ? 'allowed_with_answer_evidence' : 'allowed_no_answer_evidence',
      mutatesPage,
      evidenceHit
    };
  }

  const api = Object.freeze({
    INTENTS,
    normalizeIntent,
    hasTerminalEligibleEvidence,
    evaluateFreshEvidence,
    isBaselineEquivalent,
    hasConfirmedSubmission,
    hasMatchingLifecycleEvidence,
    hasMatchingVerifiedEvidence,
    authorize
  });

  root.RecoveryIntent = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
