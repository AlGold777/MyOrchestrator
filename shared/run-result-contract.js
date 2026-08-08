// shared/run-result-contract.js
// Typed result of a single model run: what was observed, how strongly it was
// proven, and what the caller is allowed to do with the text.
//
// Replaces the implicit `{ success: true, confidence: 0.85 }` shape, in which an
// unproven result is indistinguishable from a proven one once it reaches the
// caller. Here the uncertainty is part of the type: below COMMITTED the plain
// `.text` accessor throws, and the caller has to ask for the text through
// `readUncertainText(acknowledgement)`, which records that it accepted an
// unproven answer.
//
// Orthogonality is deliberate: identity, terminality, integrity, semantic
// completeness and observer health are five independent axes. A run can be
// terminal (`finish_reason=length`) and semantically incomplete at the same
// time, so they must not collapse into one boolean.

(function initRunResultContract(root) {
  'use strict';

  const CONTRACT_VERSION = 1;

  const RESULT_TYPES = Object.freeze({
    COMMITTED: 'COMMITTED',
    COMMITTED_TRUNCATED: 'COMMITTED_TRUNCATED',
    SUSPECTED_COMPLETE: 'SUSPECTED_COMPLETE',
    UNKNOWN: 'UNKNOWN',
    OBSERVER_LOST: 'OBSERVER_LOST',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
  });

  // Highest guarantee the witness set can support. A lost strong observer does
  // not remove one vote — it lowers this ceiling.
  const GUARANTEE = Object.freeze({
    STRICT: 'STRICT',
    DEGRADED: 'DEGRADED',
    HEURISTIC: 'HEURISTIC',
    BLIND: 'BLIND'
  });

  const GUARANTEE_RANK = Object.freeze({
    STRICT: 3,
    DEGRADED: 2,
    HEURISTIC: 1,
    BLIND: 0
  });

  // Why the run stopped producing bytes. Independent of whether the answer is
  // semantically whole: `LENGTH_LIMIT` is terminal and incomplete at once.
  const TERMINAL_REASONS = Object.freeze({
    STOP: 'STOP',
    LENGTH_LIMIT: 'LENGTH_LIMIT',
    CONTENT_FILTER: 'CONTENT_FILTER',
    TOOL_CALL: 'TOOL_CALL',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED',
    UNKNOWN: 'UNKNOWN'
  });

  const AXES = Object.freeze(['identity', 'terminality', 'integrity', 'semantic', 'observer']);

  const AXIS_STATES = Object.freeze({
    PROVEN: 'proven',
    SUSPECTED: 'suspected',
    UNPROVEN: 'unproven',
    CONTRADICTED: 'contradicted'
  });

  // Types whose text may be read without an explicit acknowledgement.
  const TEXT_READABLE_TYPES = Object.freeze([
    RESULT_TYPES.COMMITTED,
    RESULT_TYPES.COMMITTED_TRUNCATED
  ]);

  const STATUS_BY_TYPE = Object.freeze({
    COMMITTED: 'SUCCESS',
    COMMITTED_TRUNCATED: 'PARTIAL',
    SUSPECTED_COMPLETE: 'PARTIAL',
    UNKNOWN: 'UNCERTAIN',
    OBSERVER_LOST: 'UNCERTAIN',
    FAILED: 'ERROR',
    CANCELLED: 'ERROR'
  });

  function hashText(value = '') {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeType(value) {
    const key = String(value || '').trim().toUpperCase();
    return RESULT_TYPES[key] || RESULT_TYPES.UNKNOWN;
  }

  function normalizeGuarantee(value) {
    const key = String(value || '').trim().toUpperCase();
    return GUARANTEE[key] || GUARANTEE.BLIND;
  }

  function normalizeTerminalReason(value) {
    const key = String(value || '').trim().toUpperCase();
    return TERMINAL_REASONS[key] || TERMINAL_REASONS.UNKNOWN;
  }

  function normalizeAxisState(value) {
    const key = String(value || '').trim().toLowerCase();
    return Object.values(AXIS_STATES).includes(key) ? key : AXIS_STATES.UNPROVEN;
  }

  function normalizeAxes(input = {}) {
    const axes = {};
    AXES.forEach((axis) => {
      axes[axis] = normalizeAxisState(input[axis]);
    });
    return Object.freeze(axes);
  }

  function compareGuarantee(a, b) {
    return (GUARANTEE_RANK[normalizeGuarantee(a)] || 0) - (GUARANTEE_RANK[normalizeGuarantee(b)] || 0);
  }

  function minGuarantee(a, b) {
    return compareGuarantee(a, b) <= 0 ? normalizeGuarantee(a) : normalizeGuarantee(b);
  }

  function isTextReadable(type) {
    return TEXT_READABLE_TYPES.includes(normalizeType(type));
  }

  function toStatus(type) {
    return STATUS_BY_TYPE[normalizeType(type)] || 'UNCERTAIN';
  }

  // A commit claim that the axes do not support is downgraded here rather than
  // at the call site, so a caller cannot construct a COMMITTED result out of
  // DOM stability alone.
  //
  // `contradicted` on identity, terminality, integrity or observer health
  // blocks a readable commit. `unproven` on integrity and semantic does not,
  // and that is a deliberate line: there is no independent reconciliation
  // source in the tree yet, so every run would be unproven on those two axes
  // and nothing would ever commit. Terminality and identity are different —
  // they have real sources today, so `unproven` there does downgrade.
  function reconcileType(type, axes, guarantee) {
    const requested = normalizeType(type);
    const reasons = [];
    let resolved = requested;

    if (axes.observer === AXIS_STATES.CONTRADICTED) {
      if (resolved !== RESULT_TYPES.FAILED && resolved !== RESULT_TYPES.CANCELLED) {
        resolved = RESULT_TYPES.OBSERVER_LOST;
        reasons.push('observer_contradicted');
      }
    }
    if (isTextReadable(resolved)) {
      // A payload its own integrity axis calls damaged must not be readable,
      // however strongly terminality was proven. Terminality is a claim about
      // the stream having ended; integrity is a claim about what arrived, and
      // the second one failing is not cured by the first one holding.
      if (axes.integrity === AXIS_STATES.CONTRADICTED) {
        resolved = RESULT_TYPES.UNKNOWN;
        reasons.push('integrity_contradicted');
      } else if (axes.identity !== AXIS_STATES.PROVEN) {
        resolved = RESULT_TYPES.UNKNOWN;
        reasons.push('identity_not_proven');
      } else if (axes.terminality === AXIS_STATES.CONTRADICTED) {
        resolved = RESULT_TYPES.UNKNOWN;
        reasons.push('terminality_contradicted');
      } else if (axes.terminality !== AXIS_STATES.PROVEN) {
        resolved = RESULT_TYPES.SUSPECTED_COMPLETE;
        reasons.push('terminality_not_proven');
      } else if (normalizeGuarantee(guarantee) === GUARANTEE.BLIND) {
        resolved = RESULT_TYPES.UNKNOWN;
        reasons.push('blind_guarantee');
      } else if (normalizeGuarantee(guarantee) === GUARANTEE.HEURISTIC) {
        resolved = RESULT_TYPES.SUSPECTED_COMPLETE;
        reasons.push('heuristic_guarantee');
      }
    }
    if (resolved === RESULT_TYPES.COMMITTED && axes.semantic === AXIS_STATES.CONTRADICTED) {
      resolved = RESULT_TYPES.COMMITTED_TRUNCATED;
      reasons.push('semantic_incomplete');
    }
    return { type: resolved, downgradeReasons: reasons };
  }

  function buildRunResult(input = {}) {
    const text = typeof input.text === 'string' ? input.text : String(input.text || '');
    const axes = normalizeAxes(input.axes);
    const requestedGuarantee = normalizeGuarantee(input.guarantee);
    const terminalReason = normalizeTerminalReason(input.terminalReason);
    const declaredType = normalizeType(
      input.type === undefined && terminalReason === TERMINAL_REASONS.LENGTH_LIMIT
        ? RESULT_TYPES.COMMITTED_TRUNCATED
        : input.type
    );
    const { type, downgradeReasons } = reconcileType(declaredType, axes, requestedGuarantee);
    // A downgraded type must not keep advertising a guarantee it no longer has.
    const guarantee = downgradeReasons.length && isTextReadable(declaredType) && !isTextReadable(type)
      ? minGuarantee(requestedGuarantee, GUARANTEE.HEURISTIC)
      : requestedGuarantee;
    const reasons = Object.freeze([
      ...(Array.isArray(input.reasons) ? input.reasons.map(String) : []),
      ...downgradeReasons
    ]);
    const readable = isTextReadable(type);
    const acknowledgements = [];

    const serialize = () => ({
      contractVersion: CONTRACT_VERSION,
      type,
      declaredType,
      guarantee,
      terminalReason,
      axes: Object.assign({}, axes),
      reasons: reasons.slice(),
      length: text.length,
      hash: text.length ? hashText(text) : null,
      textReadable: readable,
      acknowledgements: acknowledgements.slice(),
      llmName: input.llmName || null,
      dispatchId: input.dispatchId || null,
      runSessionId: input.runSessionId || null,
      strongestEvidenceClass: input.strongestEvidenceClass || null,
      createdAt: Number(input.createdAt) || Date.now()
    });

    const result = {
      contractVersion: CONTRACT_VERSION,
      type,
      declaredType,
      guarantee,
      terminalReason,
      axes,
      reasons,
      length: text.length,
      hash: text.length ? hashText(text) : null,
      textReadable: readable,
      llmName: input.llmName || null,
      dispatchId: input.dispatchId || null,
      runSessionId: input.runSessionId || null,
      strongestEvidenceClass: input.strongestEvidenceClass || null,
      evidence: input.evidence || null,
      createdAt: Number(input.createdAt) || Date.now(),
      status: toStatus(type),
      // Reading unproven text is allowed, but only on the record: the caller
      // names itself and the fact is carried in telemetry.
      readUncertainText(acknowledgement) {
        const ack = String(acknowledgement || '').trim();
        if (!ack) {
          throw new Error('run_result_acknowledgement_required');
        }
        acknowledgements.push({ acknowledgement: ack.slice(0, 120), at: Date.now() });
        return text;
      },
      acknowledgedReads() {
        return acknowledgements.slice();
      },
      serialize,
      toJSON: serialize
    };

    // Non-enumerable so that spreading or logging the result never trips the
    // guard; only a deliberate `.text` read does.
    Object.defineProperty(result, 'text', {
      enumerable: false,
      configurable: false,
      get() {
        if (!readable) {
          const error = new Error(`run_result_text_unproven:${type}`);
          error.resultType = type;
          error.guarantee = guarantee;
          throw error;
        }
        return text;
      }
    });

    return Object.freeze(result);
  }

  const api = Object.freeze({
    CONTRACT_VERSION,
    RESULT_TYPES,
    GUARANTEE,
    GUARANTEE_RANK,
    TERMINAL_REASONS,
    AXES,
    AXIS_STATES,
    TEXT_READABLE_TYPES,
    buildRunResult,
    hashText,
    normalizeType,
    normalizeGuarantee,
    normalizeTerminalReason,
    normalizeAxes,
    compareGuarantee,
    minGuarantee,
    isTextReadable,
    toStatus
  });

  root.RunResultContract = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
