// shared/completion-evidence-ladder.js
// Ranked completion evidence with veto, replacing weighted voting.
//
// The rule this encodes: signals of different classes do not add up. Five DOM
// heuristics agreeing is still a DOM claim about a rendered projection, and it
// never becomes a protocol-level proof of terminality. Conversely a single
// contradicting fact — the stream is still open, the stop control is still
// visible — forbids the commit no matter how much weak agreement stands
// against it.
//
//   P0  provider semantic terminal   ([DONE], message_stop, finish_reason)
//   P1  transport termination        (the generation stream closed)
//   P2  application state            (the page's own idle/streaming flag)
//   P3  DOM / UI projection          (stop gone, regenerate shown, text stable)
//   P4  temporal heuristic           (silence, score, timeout)
//
// Only P0 proves terminality on its own. P1 proves it only where the provider
// contract is known to be one stream per turn; otherwise it is suspicion.

(function initCompletionEvidenceLadder(root) {
  'use strict';

  const RunResultContract = root.RunResultContract || (() => {
    try { return typeof require === 'function' ? require('./run-result-contract.js') : null; } catch (_) { return null; }
  })();
  const ObserverHealth = root.ObserverHealth || (() => {
    try { return typeof require === 'function' ? require('./observer-health.js') : null; } catch (_) { return null; }
  })();

  const GUARANTEE = RunResultContract?.GUARANTEE || Object.freeze({
    STRICT: 'STRICT', DEGRADED: 'DEGRADED', HEURISTIC: 'HEURISTIC', BLIND: 'BLIND'
  });
  const AXIS_STATES = RunResultContract?.AXIS_STATES || Object.freeze({
    PROVEN: 'proven', SUSPECTED: 'suspected', UNPROVEN: 'unproven', CONTRADICTED: 'contradicted'
  });

  const CLASSES = Object.freeze({
    P0: 'P0',
    P1: 'P1',
    P2: 'P2',
    P3: 'P3',
    P4: 'P4'
  });

  const CLASS_RANK = Object.freeze({ P0: 4, P1: 3, P2: 2, P3: 1, P4: 0 });

  // Guarantee a class can support at its best. DOM and temporal signals stay
  // heuristic by construction — that is the whole point of the separation.
  const CLASS_CEILING = Object.freeze({
    P0: GUARANTEE.STRICT,
    P1: GUARANTEE.STRICT,
    P2: GUARANTEE.DEGRADED,
    P3: GUARANTEE.HEURISTIC,
    P4: GUARANTEE.HEURISTIC
  });

  const SIGNAL_CLASSES = Object.freeze({
    // P0 — the provider says the turn is over, in its own protocol.
    provider_finish_reason: CLASSES.P0,
    provider_message_stop: CLASSES.P0,
    provider_status_completed: CLASSES.P0,
    stream_done_token: CLASSES.P0,
    api_response_complete: CLASSES.P0,
    // P1 — the stream that carried the turn ended.
    stream_closed: CLASSES.P1,
    transport_eof: CLASSES.P1,
    // P2 — the page's own state store says it is idle.
    app_state_idle: CLASSES.P2,
    // P3 — the rendered projection.
    stop_button_gone: CLASSES.P3,
    regenerate_visible: CLASSES.P3,
    completion_indicator: CLASSES.P3,
    copy_button_stable: CLASSES.P3,
    content_mutation_stable: CLASSES.P3,
    aria_busy_cleared: CLASSES.P3,
    // P4 — time, and sums of the above.
    score_threshold: CLASSES.P4,
    criteria_met: CLASSES.P4,
    silence_window: CLASSES.P4,
    soft_timeout: CLASSES.P4,
    hard_timeout: CLASSES.P4
  });

  // Facts that forbid a commit while they hold, whatever else agrees.
  const CONTRADICTION_KINDS = Object.freeze({
    stream_open: 'stream is still delivering frames for this turn',
    generation_active: 'the page still reports an active generation',
    stop_button_visible: 'the stop control is still offered',
    text_shrunk: 'the answer got shorter, so the observed text is not the final one',
    identity_mismatch: 'the terminal fact belongs to a different run',
    observer_blind: 'nobody was watching while this was decided'
  });

  function classOf(kind) {
    return SIGNAL_CLASSES[String(kind || '').trim()] || null;
  }

  function rankOf(evidenceClass) {
    return CLASS_RANK[evidenceClass] ?? -1;
  }

  function strongerClass(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return rankOf(a) >= rankOf(b) ? a : b;
  }

  function minGuarantee(a, b) {
    if (RunResultContract?.minGuarantee) return RunResultContract.minGuarantee(a, b);
    const rank = { STRICT: 3, DEGRADED: 2, HEURISTIC: 1, BLIND: 0 };
    return (rank[a] ?? 0) <= (rank[b] ?? 0) ? a : b;
  }

  function normalizeSignal(signal = {}) {
    const kind = String(signal.kind || '').trim();
    return {
      kind,
      evidenceClass: classOf(kind),
      // Uncorrelated evidence is not weak evidence — it is evidence about some
      // other run, and it is dropped rather than discounted.
      correlated: signal.correlated !== false,
      correlationMethod: signal.correlationMethod || null,
      at: Number(signal.at) || null,
      meta: signal.meta || null
    };
  }

  // A one-to-one transport contract means: exactly one stream carries exactly
  // one turn, so its end is the turn's end. Over a persistent multiplexed
  // socket that is false, and stream closure only raises suspicion.
  function terminalityFromClass(evidenceClass, options = {}) {
    // A terminal fact proves the terminality of *this* run only if it is known
    // to belong to it. Causal ordering says the stream started after the run
    // did — which a service request on the same endpoint also satisfies, and
    // which says nothing at all about a stream that ended before the observer
    // subscribed. Without a provider-issued identity the fact is real but its
    // attribution is not, so it stays suspicion.
    const attributed = options.correlationMethod === 'provider_id';
    if (evidenceClass === CLASSES.P0) {
      return attributed ? AXIS_STATES.PROVEN : AXIS_STATES.SUSPECTED;
    }
    if (evidenceClass === CLASSES.P1) {
      return attributed && options.transportOneToOne === true
        ? AXIS_STATES.PROVEN
        : AXIS_STATES.SUSPECTED;
    }
    if (evidenceClass === CLASSES.P2 || evidenceClass === CLASSES.P3 || evidenceClass === CLASSES.P4) {
      return AXIS_STATES.SUSPECTED;
    }
    return AXIS_STATES.UNPROVEN;
  }

  function evaluate(input = {}) {
    const rawSignals = Array.isArray(input.signals) ? input.signals : [];
    const signals = rawSignals.map(normalizeSignal);
    const accepted = [];
    const rejected = [];
    signals.forEach((signal) => {
      if (!signal.evidenceClass) {
        rejected.push(Object.assign({}, signal, { rejectReason: 'unknown_signal_kind' }));
        return;
      }
      if (!signal.correlated) {
        rejected.push(Object.assign({}, signal, { rejectReason: 'uncorrelated_signal' }));
        return;
      }
      accepted.push(signal);
    });

    const contradictions = (Array.isArray(input.contradictions) ? input.contradictions : [])
      .map((item) => (typeof item === 'string' ? { kind: item } : (item || {})))
      .filter((item) => item.kind && item.active !== false)
      .map((item) => ({
        kind: String(item.kind),
        detail: item.detail || CONTRADICTION_KINDS[String(item.kind)] || null
      }));

    const witnessSet = input.witnessSet || null;
    const observerAxis = witnessSet && ObserverHealth?.observerAxisState
      ? ObserverHealth.observerAxisState(witnessSet)
      : (input.observerAxis || AXIS_STATES.UNPROVEN);
    if (observerAxis === AXIS_STATES.CONTRADICTED
      && !contradictions.some((item) => item.kind === 'observer_blind')) {
      contradictions.push({ kind: 'observer_blind', detail: CONTRADICTION_KINDS.observer_blind });
    }

    let strongest = null;
    accepted.forEach((signal) => {
      strongest = strongerClass(strongest, signal.evidenceClass);
    });

    const observerCeiling = witnessSet?.ceiling || input.observerCeiling || GUARANTEE.BLIND;
    const classCeiling = strongest ? CLASS_CEILING[strongest] : GUARANTEE.BLIND;
    // Correlation established only by causal ordering is honest evidence, but
    // it is not a provider-issued identity, so it cannot carry a strict claim.
    const weakCorrelation = accepted.some((signal) => (
      rankOf(signal.evidenceClass) >= rankOf(CLASSES.P1)
      && signal.correlationMethod
      && signal.correlationMethod !== 'provider_id'
    ));
    let guarantee = minGuarantee(observerCeiling, classCeiling);
    const reasons = [];
    if (weakCorrelation && guarantee === GUARANTEE.STRICT) {
      guarantee = GUARANTEE.DEGRADED;
      reasons.push('correlation_without_provider_id');
    }

    // The correlation that matters is the one carried by the signal that set
    // the strongest class, not the best correlation present anywhere.
    const strongestSignal = accepted.reduce((best, signal) => (
      !best || rankOf(signal.evidenceClass) > rankOf(best.evidenceClass) ? signal : best
    ), null);
    const veto = contradictions.length > 0;
    let terminality = strongest
      ? terminalityFromClass(strongest, {
        transportOneToOne: input.transportOneToOne === true,
        correlationMethod: strongestSignal?.correlationMethod || null
      })
      : AXIS_STATES.UNPROVEN;
    if (strongest && rankOf(strongest) >= rankOf(CLASSES.P1) && terminality !== AXIS_STATES.PROVEN
      && strongestSignal?.correlationMethod !== 'provider_id') {
      reasons.push('terminal_fact_not_attributed_to_this_run');
    }
    if (veto) {
      terminality = AXIS_STATES.CONTRADICTED;
      guarantee = minGuarantee(guarantee, GUARANTEE.HEURISTIC);
      reasons.push(`veto:${contradictions.map((item) => item.kind).join(',')}`);
    }
    if (!strongest) reasons.push('no_terminal_evidence');
    if (strongest === CLASSES.P1 && input.transportOneToOne !== true) {
      reasons.push('transport_contract_not_proven_one_to_one');
    }
    if (strongest && rankOf(strongest) <= rankOf(CLASSES.P3) && accepted.length > 1) {
      // Named explicitly so nobody re-derives weighted voting later: several
      // weak witnesses that agree stay weak.
      reasons.push('weak_agreement_does_not_promote_class');
    }

    const canCommit = !veto && terminality === AXIS_STATES.PROVEN && guarantee !== GUARANTEE.BLIND;

    return {
      schemaVersion: 1,
      terminality,
      strongestClass: strongest,
      guarantee,
      canCommit,
      veto: {
        active: veto,
        kinds: contradictions.map((item) => item.kind),
        details: contradictions
      },
      acceptedSignals: accepted,
      rejectedSignals: rejected,
      observerAxis,
      observerCeiling,
      classCeiling,
      reasons,
      evaluatedAt: Number(input.now) || Date.now()
    };
  }

  const api = Object.freeze({
    CLASSES,
    CLASS_RANK,
    CLASS_CEILING,
    SIGNAL_CLASSES,
    CONTRADICTION_KINDS,
    classOf,
    rankOf,
    strongerClass,
    terminalityFromClass,
    evaluate
  });

  root.CompletionEvidenceLadder = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
