// shared/answer-length-policy.js
// Single source of truth for answer-length thresholds used by terminal decisions.
//
// Before this module the thresholds were scattered and contradictory:
// job-orchestrator used 80 (DOM_SNAPSHOT_RECOVERY_MIN_CHARS), dispatch-coordinator
// fell back to 120, and shared/answer-evidence carried its own 80/1200/1200 copies.
// Every terminal SUCCESS/PARTIAL decision must reference this policy via
// `policyRef` so exports can explain which threshold justified the outcome.

(function initAnswerLengthPolicy(root) {
  'use strict';

  const POLICY_VERSION = 2;
  const POLICY_REF = `answer-length-policy@${POLICY_VERSION}`;

  const DEFAULTS = Object.freeze({
    // Absolute floor: text shorter than this is never terminal-eligible answer evidence.
    minTerminalChars: 80,
    // Stable-text finalization may force terminal only at or above this length.
    stableForceMinChars: 1200,
    // Snapshot evidence without an explicit terminal signal needs this length.
    snapshotTerminalMinChars: 2400,
    // SUCCESS below this length is flagged (not blocked) as a suspect short answer
    // so real-log analysis can distinguish genuine short answers from truncated captures.
    shortSuccessSuspectMaxChars: 800,
    // Early-terminal guard may force success without re-observation at this length.
    earlyGuardForceSuccessChars: 1800,
    // Text shorter than this is not even PARTIAL-eligible in finalization.
    minPartialChars: 120,
    // Explicit user latest-recovery accepts much shorter candidates.
    manualLatestMinChars: 20
  });

  // Per-model exceptions. None are required as of v1; the key shape is kept so a
  // model with legitimately short answers can relax shortSuccessSuspectMaxChars
  // without touching call sites.
  const MODEL_OVERRIDES = Object.freeze({});

  function getPolicy(llmName) {
    const override = llmName && MODEL_OVERRIDES[llmName] ? MODEL_OVERRIDES[llmName] : null;
    return override ? Object.freeze({ ...DEFAULTS, ...override }) : DEFAULTS;
  }

  function describePolicy(llmName) {
    return {
      policyRef: POLICY_REF,
      llmName: llmName || null,
      hasModelOverride: Boolean(llmName && MODEL_OVERRIDES[llmName]),
      ...getPolicy(llmName)
    };
  }

  function evaluateTerminalAnswerLength(llmName, length, { finalStatus } = {}) {
    const policy = getPolicy(llmName);
    const numericLength = Math.max(0, Number(length) || 0);
    const normalizedStatus = String(finalStatus || '').toUpperCase();
    return {
      policyRef: POLICY_REF,
      llmName: llmName || null,
      length: numericLength,
      finalStatus: normalizedStatus || null,
      minTerminalChars: policy.minTerminalChars,
      shortSuccessSuspectMaxChars: policy.shortSuccessSuspectMaxChars,
      meetsTerminalMin: numericLength >= policy.minTerminalChars,
      suspectShortSuccess: normalizedStatus === 'SUCCESS'
        && numericLength > 0
        && numericLength < policy.shortSuccessSuspectMaxChars
    };
  }

  const api = Object.freeze({
    POLICY_VERSION,
    POLICY_REF,
    DEFAULTS,
    MODEL_OVERRIDES,
    getPolicy,
    describePolicy,
    evaluateTerminalAnswerLength
  });

  root.AnswerLengthPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
