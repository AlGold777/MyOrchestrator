(function initCompletionProtocol(root, factory) {
  if (root?.CompletionProtocol) {
    if (typeof module === 'object' && module.exports) module.exports = root.CompletionProtocol;
    return;
  }
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CompletionProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildCompletionProtocol() {
  'use strict';

  const TERMINAL_STATUSES = Object.freeze([
    'SUCCESS_TERMINAL', 'CONTINUE_REQUIRED', 'PROVIDER_ERROR', 'INTERRUPTED',
    'STALLED', 'AMBIGUOUS', 'CONTEXT_LOST'
  ]);
  const PRODUCER_STATES = Object.freeze(['UNKNOWN', 'ACTIVE', 'CANDIDATE', 'TERMINAL', 'VETOED']);
  const OWNERSHIP_STATES = Object.freeze(['CONFIRMED', 'UNKNOWN', 'CONFLICT']);
  const VETO_TYPES = Object.freeze([
    'ACTIVE_GENERATION', 'ACTIVE_STOP', 'PROVIDER_ERROR', 'CONTINUE_REQUIRED',
    'OWNERSHIP_CONFLICT', 'CONTEXT_INVALID'
  ]);
  const WITNESS_TYPES = Object.freeze([
    'GENERATION_ACTIVE', 'GENERATION_INACTIVE', 'FRESH_RESPONSE_OBSERVED',
    'STOP_VISIBLE', 'STOP_ABSENT', 'COPY_VISIBLE', 'REGENERATE_VISIBLE',
    'COMPLETION_MARKER_VISIBLE', 'CONTINUE_VISIBLE', 'CONTENT_PROGRESS',
    'RESPONSE_STRUCTURE_CHANGED', 'COSMETIC_MUTATION', 'PROVIDER_ERROR_VISIBLE',
    'NODE_REPLACED', 'CONTEXT_INVALIDATED', 'USER_INTERRUPTED'
  ]);

  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
    Object.keys(value).forEach((key) => freeze(value[key]));
    return Object.freeze(value);
  };

  function hashString(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  class EvidenceLedger {
    constructor() {
      this.records = [];
      this.nextSeq = 1;
    }

    append(event) {
      if (!event || !WITNESS_TYPES.includes(event.type)) throw new TypeError(`Unknown witness type: ${event?.type}`);
      const record = freeze({
        seq: this.nextSeq++,
        type: event.type,
        observedAt: Number(event.observedAt || Date.now()),
        source: String(event.source || 'unknown'),
        payload: event.payload == null ? null : event.payload
      });
      this.records.push(record);
      return record;
    }

    getLatest(type) {
      for (let index = this.records.length - 1; index >= 0; index -= 1) {
        if (this.records[index].type === type) return this.records[index];
      }
      return null;
    }

    has(type) { return this.records.some((record) => record.type === type); }
    snapshot() { return freeze(this.records.slice()); }
    refs(types = null) {
      const allowed = types ? new Set(types) : null;
      return this.records.filter((record) => !allowed || allowed.has(record.type)).map((record) => record.seq);
    }
  }

  class ProducerGate {
    constructor({ confirmationWindowMs = 1200 } = {}) {
      this.confirmationWindowMs = Math.max(0, Number(confirmationWindowMs || 0));
      this.state = 'UNKNOWN';
      this.candidateSince = null;
      this.evidenceRefs = [];
    }

    observe(type, observedAt = Date.now(), evidenceRef = null) {
      const at = Number(observedAt || Date.now());
      if (evidenceRef != null) this.evidenceRefs.push(evidenceRef);
      if (['GENERATION_ACTIVE', 'STOP_VISIBLE', 'CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.state = 'ACTIVE';
        this.candidateSince = null;
      } else if (['STOP_ABSENT', 'COPY_VISIBLE', 'REGENERATE_VISIBLE', 'COMPLETION_MARKER_VISIBLE', 'GENERATION_INACTIVE'].includes(type)) {
        if (this.state !== 'TERMINAL' && this.state !== 'VETOED') {
          if (this.state !== 'CANDIDATE') this.candidateSince = at;
          this.state = 'CANDIDATE';
        }
      }
      return this.evaluate(at);
    }

    veto() { this.state = 'VETOED'; return this.state; }
    evaluate(now = Date.now()) {
      if (this.state === 'CANDIDATE' && Number(now) - Number(this.candidateSince) >= this.confirmationWindowMs) {
        this.state = 'TERMINAL';
      }
      return this.state;
    }
  }

  class MutationClassifier {
    classify(mutations, context = {}) {
      const list = Array.from(mutations || []);
      return list.map((mutation) => {
        const target = mutation?.target || null;
        const responseRoot = context.responseRoot || null;
        const controlsRoot = context.controlsRoot || null;
        const inResponse = !!(target && responseRoot && (target === responseRoot || responseRoot.contains?.(target)));
        const inControls = !!(target && controlsRoot && (target === controlsRoot || controlsRoot.contains?.(target)));
        const cosmetic = !!context.isCosmetic?.(target, mutation)
          || (mutation?.type === 'attributes' && ['class', 'style', 'aria-live', 'aria-busy'].includes(mutation.attributeName));
        const normalizedBefore = context.normalizedBefore ?? null;
        const normalizedAfter = context.normalizedAfter ?? null;
        const structuralBefore = context.structuralBefore ?? null;
        const structuralAfter = context.structuralAfter ?? null;
        if (inControls) return { kind: 'PRODUCER_CONTROL', substantive: false, targetNode: target };
        if (!inResponse) return { kind: 'UNRELATED', substantive: false, targetNode: target };
        if (normalizedBefore !== null && normalizedAfter !== null && normalizedBefore !== normalizedAfter) {
          return { kind: 'CONTENT_PROGRESS', substantive: true, targetNode: target };
        }
        if (structuralBefore !== null && structuralAfter !== null && structuralBefore !== structuralAfter) {
          return { kind: 'RESPONSE_STRUCTURE', substantive: true, targetNode: target };
        }
        if (cosmetic) return { kind: 'COSMETIC', substantive: false, targetNode: target };
        return { kind: 'COSMETIC', substantive: false, targetNode: target };
      });
    }
  }

  class TimeoutPolicy {
    constructor({ promptSubmittedAt = Date.now(), progressTimeoutMs = 60000, producerStuckTimeoutMs = 90000, hardAttemptTimeoutMs = 450000 } = {}) {
      this.promptSubmittedAt = Number(promptSubmittedAt);
      this.progressTimeoutMs = Number(progressTimeoutMs);
      this.producerStuckTimeoutMs = Number(producerStuckTimeoutMs);
      this.hardAttemptTimeoutMs = Number(hardAttemptTimeoutMs);
      this.lastProgressAt = this.promptSubmittedAt;
      this.producerActiveSince = null;
    }
    progress(at = Date.now()) { this.lastProgressAt = Number(at); }
    producerActive(active, at = Date.now()) {
      if (active && this.producerActiveSince == null) this.producerActiveSince = Number(at);
      if (!active) this.producerActiveSince = null;
    }
    evaluate(now = Date.now()) {
      const at = Number(now);
      if (at - this.promptSubmittedAt >= this.hardAttemptTimeoutMs) return 'HARD';
      if (this.producerActiveSince != null && at - this.lastProgressAt >= this.producerStuckTimeoutMs) return 'PRODUCER_STUCK';
      if (at - this.lastProgressAt >= this.progressTimeoutMs) return 'PROGRESS';
      return null;
    }
  }

  class CompletionCapabilityHealth {
    constructor(initial = {}) {
      this.states = {
        generationSignal: initial.generationSignal || 'UNAVAILABLE',
        producerControls: initial.producerControls || 'UNAVAILABLE',
        answerResolution: initial.answerResolution || 'UNAVAILABLE',
        continueDetection: initial.continueDetection || 'UNAVAILABLE'
      };
    }
    report(capability, state) {
      if (!Object.prototype.hasOwnProperty.call(this.states, capability)) throw new TypeError(`Unknown capability: ${capability}`);
      if (!['HEALTHY', 'DEGRADED', 'UNAVAILABLE'].includes(state)) throw new TypeError(`Unknown capability state: ${state}`);
      this.states[capability] = state;
      return state;
    }
    snapshot() { return freeze({ ...this.states }); }
  }

  const CompletionPolicy = Object.freeze({
    canSucceed(facts) {
      return facts?.generationObserved === true
        && facts?.producerState === 'TERMINAL'
        && facts?.contentTerminal === true
        && facts?.ownership === 'CONFIRMED'
        && Array.isArray(facts?.activeVetoes)
        && facts.activeVetoes.length === 0;
    },
    evaluate(facts, meta = {}) {
      let status = null;
      let reason = null;
      if (facts?.contextLost) [status, reason] = ['CONTEXT_LOST', 'context_invalidated'];
      else if (facts?.interrupted) [status, reason] = ['INTERRUPTED', 'attempt_interrupted'];
      else if (facts?.providerError) [status, reason] = ['PROVIDER_ERROR', 'provider_error_visible'];
      else if (facts?.continueRequired) [status, reason] = ['CONTINUE_REQUIRED', 'continue_required'];
      else if (facts?.ownership === 'CONFLICT') [status, reason] = ['AMBIGUOUS', 'ownership_conflict'];
      else if (facts?.timeoutState) [status, reason] = ['STALLED', `timeout_${String(facts.timeoutState).toLowerCase()}`];
      else if (this.canSucceed(facts)) [status, reason] = ['SUCCESS_TERMINAL', 'all_terminal_facts_proven'];
      if (!status) return null;
      return freeze({
        status,
        attemptId: String(meta.attemptId || 'unknown-attempt'),
        decidedAt: Number(meta.decidedAt || Date.now()),
        reason,
        evidenceRefs: Array.from(new Set(meta.evidenceRefs || [])),
        ownership: meta.ownershipResult || undefined
      });
    }
  });

  class MaterializationHydrationGate {
    constructor(strategies = []) { this.strategies = Array.from(strategies || []); }
    async materialize(input) {
      const strategy = this.strategies.find((item) => item?.canHandle?.(input?.provider));
      if (strategy) return strategy.materialize(input);
      const before = await input.capture();
      await input.forceBottom?.();
      await input.expandDeferred?.();
      await input.waitForSettle?.();
      const after = await input.capture();
      const beforeHash = before?.contentHash || hashString(before?.text || '');
      const afterHash = after?.contentHash || hashString(after?.text || '');
      const beforeStructuralHash = before?.structuralHash || null;
      const afterStructuralHash = after?.structuralHash || null;
      return freeze({
        changed: beforeHash !== afterHash || (beforeStructuralHash != null && beforeStructuralHash !== afterStructuralHash),
        beforeHash, afterHash, beforeStructuralHash, afterStructuralHash,
        reason: 'generic_materialization_comparison', before, after
      });
    }
  }

  const ExtractionSnapshotFactory = Object.freeze({
    capture(terminalResult, verifiedSnapshot) {
      if (terminalResult?.status !== 'SUCCESS_TERMINAL') throw new Error('Extraction requires SUCCESS_TERMINAL');
      if (!verifiedSnapshot || typeof verifiedSnapshot.text !== 'string') throw new Error('Verified snapshot is required');
      const text = verifiedSnapshot.text;
      const html = String(verifiedSnapshot.html || '');
      return freeze({
        responseIdentity: freeze({ ...(verifiedSnapshot.responseIdentity || {}) }),
        text,
        html,
        contentHash: verifiedSnapshot.contentHash || hashString(text),
        structuralHash: verifiedSnapshot.structuralHash || hashString(html || text),
        capturedAt: Number(verifiedSnapshot.capturedAt || verifiedSnapshot.observedAt || terminalResult.decidedAt)
      });
    }
  });

  const RecoveryReconciler = Object.freeze({
    reconcile(persisted, current) {
      if (!persisted || !current || current.contextValid === false) return 'CONTEXT_LOST';
      const keys = ['runSessionId', 'dispatchId', 'generationEpoch'];
      if (keys.some((key) => persisted[key] != null && current[key] != null && String(persisted[key]) !== String(current[key]))) return 'AMBIGUOUS';
      if (persisted.responseIdentity && current.responseIdentity
        && JSON.stringify(persisted.responseIdentity) !== JSON.stringify(current.responseIdentity)) return 'AMBIGUOUS';
      return 'RESUME';
    }
  });

  const FinalizationAdapter = Object.freeze({
    toFinalStatus(terminalResult) {
      return ({
        SUCCESS_TERMINAL: 'COMPLETE',
        CONTINUE_REQUIRED: 'USER_ACTION_REQUIRED',
        PROVIDER_ERROR: 'EXTERNAL_LLM_FAILURE',
        INTERRUPTED: 'ERROR',
        STALLED: 'STREAM_TIMEOUT',
        AMBIGUOUS: 'UNCERTAIN',
        CONTEXT_LOST: 'UNCERTAIN'
      })[terminalResult?.status] || 'UNCERTAIN';
    },
    toCandidate(terminalResult, extractionSnapshot = null) {
      return freeze({
        status: this.toFinalStatus(terminalResult),
        finalStatus: this.toFinalStatus(terminalResult),
        dispatchId: extractionSnapshot?.responseIdentity?.dispatchId || null,
        trimmedAnswer: terminalResult?.status === 'SUCCESS_TERMINAL' ? String(extractionSnapshot?.text || '').trim() : '',
        completionTerminalResult: terminalResult || null
      });
    }
  });

  const CompletionRollout = Object.freeze({
    MODES: Object.freeze(['legacy', 'shadow', 'enforced']),
    normalize(mode) { return this.MODES.includes(mode) ? mode : 'enforced'; },
    compare({ legacySuccess = false, legacyCompletionReason = null, terminalResult = null, responseLength = 0, contentHash = null } = {}) {
      const v2TerminalStatus = terminalResult?.status || null;
      const v2Success = v2TerminalStatus === 'SUCCESS_TERMINAL';
      return freeze({
        legacySuccess: legacySuccess === true,
        v2TerminalStatus,
        legacyCompletionReason,
        v2Evidence: terminalResult?.evidenceRefs || [],
        responseLength: Number(responseLength || 0),
        contentHash,
        decisionDelta: legacySuccess === v2Success ? 'same' : (legacySuccess ? `legacy_success_v2_${v2TerminalStatus || 'non_terminal'}` : `legacy_non_success_v2_${v2TerminalStatus}`)
      });
    }
  });

  class CompletionSession {
    constructor(context, options = {}) {
      this.context = freeze({ ...(context || {}) });
      this.attemptId = String(options.attemptId || context?.dispatchId || `${context?.provider || 'attempt'}:${context?.promptSubmittedAt || Date.now()}`);
      this.rolloutMode = CompletionRollout.normalize(options.rolloutMode);
      this.ledger = new EvidenceLedger();
      this.producer = new ProducerGate({ confirmationWindowMs: options.confirmationWindowMs });
      this.timeouts = new TimeoutPolicy({ promptSubmittedAt: context?.promptSubmittedAt, ...options.timeouts });
      this.facts = {
        generationObserved: false, producerState: 'UNKNOWN', contentTerminal: false,
        ownership: 'UNKNOWN', activeVetoes: [], timeoutState: null,
        providerError: false, continueRequired: false, interrupted: false, contextLost: false
      };
      this.ownershipResult = null;
      this.capabilityHealth = new CompletionCapabilityHealth(options.capabilityHealth);
      this.verifiedSnapshot = null;
      this.terminalResult = null;
      this.extractionSnapshot = null;
    }

    observe(event) {
      if (this.terminalResult) return null;
      const record = this.ledger.append(event);
      const type = record.type;
      if (['FRESH_RESPONSE_OBSERVED', 'GENERATION_ACTIVE', 'CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.facts.generationObserved = true;
      }
      if (['CONTENT_PROGRESS', 'RESPONSE_STRUCTURE_CHANGED'].includes(type)) {
        this.timeouts.progress(record.observedAt);
        this.facts.contentTerminal = false;
        this.verifiedSnapshot = null;
      }
      this.timeouts.producerActive(['GENERATION_ACTIVE', 'STOP_VISIBLE'].includes(type), record.observedAt);
      this.facts.producerState = this.producer.observe(type, record.observedAt, record.seq);
      if (type === 'PROVIDER_ERROR_VISIBLE') this.facts.providerError = true;
      if (type === 'CONTINUE_VISIBLE') this.facts.continueRequired = true;
      if (type === 'USER_INTERRUPTED') this.facts.interrupted = true;
      if (type === 'CONTEXT_INVALIDATED') this.facts.contextLost = true;
      if (type === 'NODE_REPLACED') this.confirmOwnership({ status: 'CONFLICT', reasons: ['node_replaced'], verifiedAt: record.observedAt });
      this.refreshVetoes();
      return record;
    }

    confirmOwnership(result) {
      const status = OWNERSHIP_STATES.includes(result?.status) ? result.status : 'UNKNOWN';
      this.ownershipResult = freeze({ status, responseIdentity: result?.responseIdentity, reasons: Array.from(result?.reasons || []), verifiedAt: Number(result?.verifiedAt || Date.now()) });
      this.facts.ownership = status;
      this.refreshVetoes();
      return this.ownershipResult;
    }

    setContentVerification(verification, materialization, snapshot) {
      const terminal = verification?.stable === true
        && verification?.structurallyComplete === true
        && verification?.lengthRegressionRecovered === true
        && materialization?.changed === false;
      this.facts.contentTerminal = terminal;
      this.verifiedSnapshot = terminal ? freeze({ ...(snapshot || verification?.snapshot || {}) }) : null;
      return terminal;
    }

    refreshVetoes() {
      const vetoes = [];
      if (this.facts.producerState === 'ACTIVE') vetoes.push('ACTIVE_GENERATION');
      if (this.ledger.getLatest('STOP_VISIBLE')?.seq > (this.ledger.getLatest('STOP_ABSENT')?.seq || 0)) vetoes.push('ACTIVE_STOP');
      if (this.facts.providerError) vetoes.push('PROVIDER_ERROR');
      if (this.facts.continueRequired) vetoes.push('CONTINUE_REQUIRED');
      if (this.facts.ownership === 'CONFLICT') vetoes.push('OWNERSHIP_CONFLICT');
      if (this.facts.contextLost) vetoes.push('CONTEXT_INVALID');
      this.facts.activeVetoes = vetoes;
      return vetoes;
    }

    evaluate(now = Date.now()) {
      if (this.terminalResult) return this.terminalResult;
      this.facts.producerState = this.producer.evaluate(now);
      this.facts.timeoutState = this.facts.timeoutState || this.timeouts.evaluate(now);
      this.refreshVetoes();
      const result = CompletionPolicy.evaluate(this.facts, {
        attemptId: this.attemptId, decidedAt: now, evidenceRefs: this.ledger.refs(), ownershipResult: this.ownershipResult
      });
      if (result) {
        this.terminalResult = result;
        if (result.status === 'SUCCESS_TERMINAL') {
          this.extractionSnapshot = ExtractionSnapshotFactory.capture(result, this.verifiedSnapshot);
        }
      }
      return result;
    }

    snapshot() {
      return freeze({ context: this.context, rolloutMode: this.rolloutMode, facts: { ...this.facts, activeVetoes: this.facts.activeVetoes.slice() }, capabilityHealth: this.capabilityHealth.snapshot(), evidence: this.ledger.snapshot(), terminalResult: this.terminalResult, extractionSnapshot: this.extractionSnapshot });
    }
  }

  return Object.freeze({
    TERMINAL_STATUSES, PRODUCER_STATES, OWNERSHIP_STATES, VETO_TYPES, WITNESS_TYPES,
    EvidenceLedger, ProducerGate, MutationClassifier, TimeoutPolicy, CompletionCapabilityHealth, CompletionPolicy,
    MaterializationHydrationGate, ExtractionSnapshotFactory, RecoveryReconciler, FinalizationAdapter, CompletionRollout,
    CompletionSession, hashString
  });
});
