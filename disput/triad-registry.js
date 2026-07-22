// disput/triad-registry.js
// Pure artifact/trigger registry for the Triad (3-model wave) debate.
//
// Three-layer ownership model (docs/disput-docs/D8_duel-protocol.md, artefact spec):
//   1. Event log      — raw wave turns, append-only, the source of truth.
//   2. Artifact store — the working map of debate state (issues/claims/terms).
//   3. Checkpoint (C) — proposes deltas + triggers; it never writes directly.
//
// The orchestrator (this module) validates every proposed delta against the
// event log (a trigger/artifact must carry a verbatim anchor quote that really
// exists in the referenced turn) and only then applies it. Anything that fails
// validation is dropped and recorded as a ProtocolViolation, so a single bad
// checkpoint classification can never become irreversible "truth".
//
// Pure and unit-testable; mirrors disput/triad-runtime.js conventions
// (IIFE, in-place mutation of a plain state object, frozen dual-context API).

(function initTriadRegistry(root) {
  'use strict';

  const VERSION = 1;

  const ARTIFACT_TYPES = Object.freeze({
    OPEN_ISSUE: 'open_issue',
    CLAIM: 'claim',
    TERM_MISMATCH: 'term_mismatch',
    OBJECTION: 'objection',
    REVISION: 'revision',
    ASSUMPTION: 'assumption',
    EVIDENCE: 'evidence',
    DISSENT: 'dissent',
    LIMITATION: 'limitation',
    EVIDENCE_GAP: 'evidence_gap',
    CONTRADICTION: 'contradiction',
    OPEN_QUESTION: 'open_question',
    DECISION_CRITERION: 'decision_criterion'
  });

  const ISSUE_STATUSES = Object.freeze(['open', 'clarifying', 'partially_closed', 'closed', 'reopened']);
  const CLAIM_STATUSES = Object.freeze(['asserted', 'supported', 'contested', 'refuted', 'conceded']);
  const TERM_STATUSES = Object.freeze(['disputed', 'aligned']);
  const OBJECTION_STATUSES = Object.freeze(['raised', 'answered', 'conceded', 'withdrawn', 'unresolved']);
  const REVISION_STATUSES = Object.freeze(['recorded']);
  const GENERIC_STATUSES = Object.freeze(['proposed', 'open', 'closed', 'asserted', 'supported', 'contested', 'verified', 'unverified', 'disputed', 'refuted', 'active', 'resolved', 'accepted', 'accepted_as_limitation', 'stale', 'reopened']);
  const ACTION_STATUSES = Object.freeze(['pending', 'answered', 'evaded', 'insufficient', 'expired']);

  // Active (still worth surfacing) statuses per type.
  const ACTIVE_ISSUE_STATUSES = Object.freeze(['open', 'clarifying', 'partially_closed', 'reopened']);
  const ACTIVE_CLAIM_STATUSES = Object.freeze(['asserted', 'contested']);
  const ACTIVE_TERM_STATUSES = Object.freeze(['disputed']);

  // Fixed conflict priority (index = priority, lower wins) used when several
  // triggers target the same model in one wave. Severity dominates; catalog
  // order breaks ties. Catalog matches artefact spec §5.
  const TRIGGER_CATALOG = Object.freeze([
    'UNSUPPORTED_CLAIM',
    'STRAWMAN',
    'CIRCULAR_ARGUMENT',
    'FALSE_CONSENSUS',
    'TERM_MISMATCH',
    'ONE_SIDE_IGNORED',
    'PREMATURE_VERDICT',
    'TOPIC_DRIFT',
    'REPEATED_POINT',
    'RECURRING_WEAKNESS'
  ]);
  const TRIGGER_SET = Object.freeze(new Set(TRIGGER_CATALOG));

  const SEVERITY_RANK = Object.freeze({
    action_required: 3, high: 3, critical: 3,
    warning: 2, medium: 2,
    info: 1, low: 1
  });

  const LOGICAL_PATTERN_TRIGGERS = Object.freeze(new Set([
    'STRAWMAN',
    'CIRCULAR_ARGUMENT',
    'FALSE_CONSENSUS',
    'TOPIC_DRIFT'
  ]));

  const INSTRUCTION_KIND_BY_TRIGGER = Object.freeze({
    UNSUPPORTED_CLAIM: 'provide_evidence',
    STRAWMAN: 'clarify',
    CIRCULAR_ARGUMENT: 'defend',
    FALSE_CONSENSUS: 'concede_check',
    TERM_MISMATCH: 'clarify',
    ONE_SIDE_IGNORED: 'attack',
    PREMATURE_VERDICT: 'concede_check',
    TOPIC_DRIFT: 'clarify',
    REPEATED_POINT: 'summarize',
    RECURRING_WEAKNESS: 'defend'
  });

  // Human-readable instruction templates. The primary trigger of a model is
  // rendered from these into that model's next wave prompt (one line, targeted).
  const TRIGGER_TEMPLATES = Object.freeze({
    UNSUPPORTED_CLAIM: 'Приведи источник или строгое обоснование для утверждения: "{quote}". Если обосновать нечем — явно отметь его как недоказанное.',
    STRAWMAN: 'Твоя реплика исказила позицию оппонента ("{quote}"). Восстанови его исходный тезис и ответь именно на него.',
    CIRCULAR_ARGUMENT: 'Аргумент "{quote}" опирается сам на себя. Дай независимое обоснование, не повторяя вывод в посылке.',
    FALSE_CONSENSUS: 'Согласие по пункту "{quote}" не подтверждено обеими сторонами. Проверь, действительно ли вопрос закрыт, или он остаётся открытым.',
    TERM_MISMATCH: 'Термин в "{quote}" стороны используют по-разному. Зафиксируй своё определение явно, прежде чем спорить дальше.',
    ONE_SIDE_IGNORED: 'Ты проигнорировал аргумент оппонента: "{quote}". Ответь на него прямо.',
    PREMATURE_VERDICT: 'Ты вынес вердикт ("{quote}"), хотя спор не завершён. Вернись к анализу, а не к итогу.',
    TOPIC_DRIFT: 'Обсуждение ушло от темы в "{quote}". Верни фокус к исходному вопросу.',
    REPEATED_POINT: 'Ты повторил уже прозвучавший тезис ("{quote}") без нового содержания. Разверни его или перейди дальше.',
    RECURRING_WEAKNESS: 'Это повторяющаяся слабость твоей линии: "{quote}". Устрани её, а не обходи.'
  });

  // Default cooldown (in checkpoint waves): the same (triggerId, target) is not
  // re-issued while an active PendingAction covers it.
  const DEFAULT_COOLDOWN_WAVES = 1;
  // A pending action left unresolved for this many waves is auto-expired.
  const ACTION_EXPIRY_WAVES = 2;
  // Cap on simultaneously active open issues (artefact spec §4.2 archival).
  const MAX_ACTIVE_OPEN_ISSUES = 20;
  // How many active artifacts we surface into a single wave prompt.
  const PROMPT_ARTIFACT_LIMIT = 8;
  // Anchor quote quality gate.
  const MIN_ANCHOR_QUOTE_CHARS = 8;

  const normText = (value) => String(value == null ? '' : value).trim();
  const normLoose = (value) => normText(value).replace(/\s+/g, ' ').toLowerCase();

  function createDerivedLayer(input) {
    const derived = input && typeof input === 'object' ? input : {};
    return {
      focusHistory: Array.isArray(derived.focusHistory) ? derived.focusHistory : [],
      instructionBurdenLog: Array.isArray(derived.instructionBurdenLog) ? derived.instructionBurdenLog : [],
      actionTargetHistory: Array.isArray(derived.actionTargetHistory) ? derived.actionTargetHistory : [],
      routeHistory: Array.isArray(derived.routeHistory) ? derived.routeHistory : [],
      logicalPatternLog: Array.isArray(derived.logicalPatternLog) ? derived.logicalPatternLog : [],
      recurringWeaknessLog: Array.isArray(derived.recurringWeaknessLog) ? derived.recurringWeaknessLog : [],
      contextRequestHistory: Array.isArray(derived.contextRequestHistory) ? derived.contextRequestHistory : []
    };
  }

  function ensureDerived(reg) {
    if (!reg) return null;
    reg.derived = createDerivedLayer(reg.derived);
    return reg.derived;
  }

  function createRegistry(overrides) {
    const reg = {
      version: VERSION,
      mode: 'triad',
      wave: 0,
      seq: 0,
      checkpointSeq: 0,
      eventLog: [],
      artifacts: {},        // id -> { id, type, status, ... , anchor, wave, lastWave }
      pendingActions: [],   // { actionId, triggerId, target, artifactId, severity, status, anchor, issuedWave, cooldownUntilWave, basis }
      violations: [],       // { id, code, detail, wave, at }
      archive: [],          // evicted artifacts (available for export, not fed to prompts)
      derived: createDerivedLayer()
    };
    if (overrides && typeof overrides === 'object') Object.assign(reg, overrides);
    reg.mode = normText(reg.mode || overrides?.mode || 'triad') || 'triad';
    ensureDerived(reg);
    return reg;
  }

  const nextId = (reg, prefix) => {
    reg.seq = (Number(reg.seq) || 0) + 1;
    return `${prefix}-${reg.seq}`;
  };

  // --- Event log (source of truth) -------------------------------------------

  function appendEvent(reg, { turnId, waveKey = '', model = '', text = '' } = {}) {
    if (!reg || !turnId) return reg;
    const id = String(turnId);
    const entry = {
      turnId: id,
      waveKey: String(waveKey),
      model: String(model),
      text: String(text == null ? '' : text),
      at: Date.now()
    };
    const existing = reg.eventLog.findIndex((e) => e.turnId === id);
    if (existing >= 0) reg.eventLog[existing] = entry; // idempotent per turnId
    else reg.eventLog.push(entry);
    return reg;
  }

  function getEvent(reg, turnId) {
    if (!reg || !turnId) return null;
    return reg.eventLog.find((e) => e.turnId === String(turnId)) || null;
  }

  // A quote is valid only if it appears verbatim (whitespace/case-insensitive)
  // inside the referenced turn. This is the single guard against hallucinated
  // evidence: no anchor, no application.
  function anchorIsValid(reg, anchor) {
    if (!anchor || typeof anchor !== 'object') return false;
    const event = getEvent(reg, anchor.turnId);
    if (!event) return false;
    const quote = normLoose(anchor.quote);
    if (quote.length < MIN_ANCHOR_QUOTE_CHARS) return false;
    return normLoose(event.text).includes(quote);
  }

  function recordViolation(reg, code, detail) {
    const violation = {
      id: nextId(reg, 'viol'),
      code: String(code || 'invalid'),
      detail: String(detail || ''),
      wave: reg.wave,
      at: Date.now()
    };
    reg.violations.push(violation);
    return violation;
  }

  function severityBucket(severity) {
    const rank = severityRank(severity);
    if (rank >= 3) return 'high';
    if (rank === 2) return 'medium';
    return 'low';
  }

  function checkpointId(reg) {
    reg.checkpointSeq = Number(reg.checkpointSeq || 0) + 1;
    return `chk-${reg.checkpointSeq}`;
  }

  // --- Artifact deltas -------------------------------------------------------

  const STATUSES_FOR_TYPE = {
    [ARTIFACT_TYPES.OPEN_ISSUE]: ISSUE_STATUSES,
    [ARTIFACT_TYPES.CLAIM]: CLAIM_STATUSES,
    [ARTIFACT_TYPES.TERM_MISMATCH]: TERM_STATUSES
    ,[ARTIFACT_TYPES.OBJECTION]: OBJECTION_STATUSES
    ,[ARTIFACT_TYPES.REVISION]: REVISION_STATUSES
    ,[ARTIFACT_TYPES.ASSUMPTION]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.EVIDENCE]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.DISSENT]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.LIMITATION]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.EVIDENCE_GAP]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.CONTRADICTION]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.OPEN_QUESTION]: GENERIC_STATUSES
    ,[ARTIFACT_TYPES.DECISION_CRITERION]: GENERIC_STATUSES
  };

  function normalizeType(raw) {
    const t = normText(raw).toLowerCase();
    if (t === 'open_issue' || t === 'openissue' || t === 'issue') return ARTIFACT_TYPES.OPEN_ISSUE;
    if (t === 'claim' || t === 'claimledger') return ARTIFACT_TYPES.CLAIM;
    if (t === 'term_mismatch' || t === 'terminology' || t === 'term' || t === 'terminologyledger') return ARTIFACT_TYPES.TERM_MISMATCH;
    if (t === 'objection') return ARTIFACT_TYPES.OBJECTION;
    if (t === 'revision') return ARTIFACT_TYPES.REVISION;
    if (t === 'assumption') return ARTIFACT_TYPES.ASSUMPTION;
    if (t === 'evidence') return ARTIFACT_TYPES.EVIDENCE;
    if (t === 'dissent') return ARTIFACT_TYPES.DISSENT;
    if (t === 'limitation') return ARTIFACT_TYPES.LIMITATION;
    if (t === 'evidence_gap' || t === 'evidencegap') return ARTIFACT_TYPES.EVIDENCE_GAP;
    if (t === 'contradiction') return ARTIFACT_TYPES.CONTRADICTION;
    if (t === 'open_question' || t === 'question') return ARTIFACT_TYPES.OPEN_QUESTION;
    if (t === 'decision_criterion' || t === 'criterion') return ARTIFACT_TYPES.DECISION_CRITERION;
    return '';
  }

  function defaultStatusForType(type) {
    if (type === ARTIFACT_TYPES.OPEN_ISSUE) return 'open';
    if (type === ARTIFACT_TYPES.CLAIM) return 'asserted';
    if (type === ARTIFACT_TYPES.TERM_MISMATCH) return 'disputed';
    if (type === ARTIFACT_TYPES.OBJECTION) return 'raised';
    if (type === ARTIFACT_TYPES.REVISION) return 'recorded';
    if (type === ARTIFACT_TYPES.EVIDENCE) return 'unverified';
    if (type === ARTIFACT_TYPES.DISSENT) return 'active';
    if (type === ARTIFACT_TYPES.LIMITATION) return 'accepted_as_limitation';
    if ([ARTIFACT_TYPES.EVIDENCE_GAP, ARTIFACT_TYPES.CONTRADICTION, ARTIFACT_TYPES.OPEN_QUESTION].includes(type)) return 'open';
    if ([ARTIFACT_TYPES.ASSUMPTION, ARTIFACT_TYPES.DECISION_CRITERION].includes(type)) return 'proposed';
    return '';
  }

  // Returns { ok, id?, reason? }. Rejected deltas are logged as violations.
  function applyDelta(reg, delta) {
    if (!reg || !delta || typeof delta !== 'object') {
      return { ok: false, reason: 'empty_delta' };
    }
    const op = normText(delta.op || delta.operation).toLowerCase() || 'create';
    const type = normalizeType(delta.type || delta.artifactType);
    const anchor = delta.anchor && typeof delta.anchor === 'object'
      ? { turnId: normText(delta.anchor.turnId), quote: normText(delta.anchor.quote) }
      : null;

    if (op === 'update') {
      const id = normText(delta.id || delta.targetId);
      const artifact = id ? reg.artifacts[id] : null;
      if (!artifact) {
        recordViolation(reg, 'unknown_artifact', `update references missing artifact ${id || '(none)'}`);
        return { ok: false, reason: 'unknown_artifact' };
      }
      const nextStatus = normText(delta.status).toLowerCase();
      const allowed = STATUSES_FOR_TYPE[artifact.type] || [];
      if (nextStatus && !allowed.includes(nextStatus)) {
        recordViolation(reg, 'illegal_status', `${artifact.type} cannot become "${nextStatus}"`);
        return { ok: false, reason: 'illegal_status' };
      }
      // Closing/refuting requires fresh anchored evidence.
      const closingIssue = artifact.type === ARTIFACT_TYPES.OPEN_ISSUE && ['closed', 'partially_closed'].includes(nextStatus);
      const settlingClaim = artifact.type === ARTIFACT_TYPES.CLAIM && ['supported', 'refuted', 'conceded'].includes(nextStatus);
      const settlingGeneric = ![ARTIFACT_TYPES.OPEN_ISSUE, ARTIFACT_TYPES.CLAIM].includes(artifact.type)
        && ['closed', 'resolved', 'supported', 'verified', 'refuted', 'accepted'].includes(nextStatus);
      if ((closingIssue || settlingClaim || settlingGeneric) && !anchorIsValid(reg, anchor)) {
        recordViolation(reg, 'unanchored_resolution', `status "${nextStatus}" on ${id} lacks a verifiable anchor`);
        return { ok: false, reason: 'unanchored_resolution' };
      }
      if (artifact.type === ARTIFACT_TYPES.CLAIM && normText(delta.formulation) && normText(delta.formulation) !== normText(artifact.formulation)) {
        recordViolation(reg, 'claim_text_immutable', `claim ${id} text changes require a revision`);
        return { ok: false, reason: 'claim_text_immutable' };
      }
      const fromStatus = artifact.status;
      if (nextStatus) artifact.status = nextStatus;
      if (anchor && anchorIsValid(reg, anchor)) artifact.anchor = anchor;
      if (normText(delta.formulation)) artifact.formulation = normText(delta.formulation);
      artifact.lastWave = reg.wave;
      artifact.history = Array.isArray(artifact.history) ? artifact.history : [];
      if (fromStatus !== artifact.status) artifact.history.push({ at: Date.now(), wave: reg.wave, fromStatus, toStatus: artifact.status, sourceCheckpointId: reg.checkpointSeq, anchor });
      reconcileActions(reg);
      return { ok: true, id };
    }

    // create
    if (!type) {
      recordViolation(reg, 'unknown_type', `create with unknown type "${delta.type || delta.artifactType || ''}"`);
      return { ok: false, reason: 'unknown_type' };
    }
    if (type === ARTIFACT_TYPES.OBJECTION && !reg.artifacts[normText(delta.targetId)]) {
      recordViolation(reg, 'objection_without_target', `objection target ${normText(delta.targetId) || '(none)'} is missing`);
      return { ok: false, reason: 'objection_without_target' };
    }
    if ([ARTIFACT_TYPES.EVIDENCE, ARTIFACT_TYPES.ASSUMPTION, ARTIFACT_TYPES.EVIDENCE_GAP].includes(type) && normText(delta.targetId) && !reg.artifacts[normText(delta.targetId)]) {
      recordViolation(reg, 'linked_artifact_without_target', `${type} target ${normText(delta.targetId)} is missing`);
      return { ok: false, reason: 'linked_artifact_without_target' };
    }
    if (type === ARTIFACT_TYPES.REVISION && (!reg.artifacts[normText(delta.claimId)] || !delta.basis || !['objection','evidence','correction','spec_change','reassessment'].includes(normText(delta.basis.kind)))) {
      recordViolation(reg, 'revision_without_basis', 'revision requires claimId and valid basis');
      return { ok: false, reason: 'revision_without_basis' };
    }
    if (!anchorIsValid(reg, anchor)) {
      recordViolation(reg, 'anchor_not_found', `create ${type} rejected: quote not verbatim in turn ${anchor?.turnId || '(none)'}`);
      return { ok: false, reason: 'anchor_not_found' };
    }
    const status = normText(delta.status).toLowerCase() || defaultStatusForType(type);
    const allowed = STATUSES_FOR_TYPE[type] || [];
    if (!allowed.includes(status)) {
      recordViolation(reg, 'illegal_status', `${type} cannot be created as "${status}"`);
      return { ok: false, reason: 'illegal_status' };
    }
    const id = nextId(reg, type === ARTIFACT_TYPES.OPEN_ISSUE ? 'issue' : type === ARTIFACT_TYPES.CLAIM ? 'claim' : type.replace(/_/g, '-'));
    reg.artifacts[id] = {
      id,
      type,
      status,
      formulation: normText(delta.formulation || delta.text || delta.term),
      target: normText(delta.target),
      anchor,
      wave: reg.wave,
      lastWave: reg.wave
      ,history: []
      ,targetId: normText(delta.targetId)
      ,claimId: normText(delta.claimId)
      ,basis: delta.basis || null
      ,sourceCheckpointId: reg.lastCheckpointId || ''
    };
    if (type === ARTIFACT_TYPES.OPEN_ISSUE) enforceIssueLimit(reg);
    return { ok: true, id };
  }

  // --- Triggers -> PendingActions -------------------------------------------

  function severityRank(severity) {
    return SEVERITY_RANK[normText(severity).toLowerCase()] || 1;
  }

  function findActiveAction(reg, triggerId, target) {
    return reg.pendingActions.find((a) =>
      a.triggerId === triggerId
      && a.target === target
      && a.status === 'pending'
      && a.cooldownUntilWave > reg.wave);
  }

  // Returns { ok, actionId?, reason? }.
  function ingestTrigger(reg, trigger) {
    if (!reg || !trigger || typeof trigger !== 'object') return { ok: false, reason: 'empty' };
    const triggerId = normText(trigger.triggerId || trigger.id).toUpperCase();
    if (!TRIGGER_SET.has(triggerId)) {
      recordViolation(reg, 'unknown_trigger', `trigger "${triggerId}" not in catalog`);
      return { ok: false, reason: 'unknown_trigger' };
    }
    const anchor = {
      turnId: normText(trigger.evidenceTurnId || trigger.anchor?.turnId),
      quote: normText(trigger.evidenceQuote || trigger.shortSpan || trigger.anchor?.quote)
    };
    if (!anchorIsValid(reg, anchor)) {
      recordViolation(reg, 'anchor_not_found', `trigger ${triggerId} rejected: quote not verbatim in turn ${anchor.turnId || '(none)'}`);
      return { ok: false, reason: 'anchor_not_found' };
    }
    const target = normText(trigger.target);
    const artifactId = normText(trigger.targetArtifactId || trigger.artifactId);
    recordDerivedForTrigger(reg, {
      triggerId,
      target,
      artifactId,
      severity: normText(trigger.severity).toLowerCase() || 'warning',
      anchor
    });
    // Cooldown: do not duplicate a live action for the same (triggerId, target).
    if (findActiveAction(reg, triggerId, target)) {
      return { ok: false, reason: 'cooldown' };
    }
    const action = {
      actionId: nextId(reg, 'act'),
      triggerId,
      target,
      artifactId,
      severity: normText(trigger.severity).toLowerCase() || 'warning',
      basis: normText(trigger.basis),
      anchor,
      status: 'pending',
      issuedWave: reg.wave,
      cooldownUntilWave: reg.wave + DEFAULT_COOLDOWN_WAVES
    };
    reg.pendingActions.push(action);
    return { ok: true, actionId: action.actionId };
  }

  function recordDerivedForTrigger(reg, { triggerId, target, artifactId, severity, anchor }) {
    const derived = ensureDerived(reg);
    if (!derived) return;
    const actionTargetId = nextId(reg, 'target');
    derived.actionTargetHistory.push({
      id: actionTargetId,
      wave: reg.wave,
      triggerType: triggerId,
      targetModel: target,
      targetArtifactId: artifactId || null,
      severity: severityBucket(severity),
      cooldownUntilWave: reg.wave + DEFAULT_COOLDOWN_WAVES
    });
    derived.instructionBurdenLog.push({
      id: nextId(reg, 'burden'),
      wave: reg.wave,
      targetModel: target,
      instructionKind: INSTRUCTION_KIND_BY_TRIGGER[triggerId] || 'defend',
      sourceTriggerId: triggerId,
      sourceArtifactId: artifactId || null
    });
    if (LOGICAL_PATTERN_TRIGGERS.has(triggerId)) {
      derived.logicalPatternLog.push({
        id: nextId(reg, 'logic'),
        wave: reg.wave,
        type: triggerId,
        targetModel: target,
        artifactId: artifactId || null,
        anchor,
        status: 'active'
      });
      reconcileRecurringWeakness(reg, target, triggerId);
    }
  }

  function reconcileRecurringWeakness(reg, targetModel, triggerType) {
    const derived = ensureDerived(reg);
    const recent = derived.logicalPatternLog.filter((entry) =>
      entry.targetModel === targetModel
      && entry.type === triggerType
      && reg.wave - Number(entry.wave || 0) <= 3
    );
    if (recent.length < 3) return null;
    const existing = derived.recurringWeaknessLog.find((entry) =>
      entry.targetModel === targetModel
      && entry.weaknessType === triggerType
      && entry.status === 'active'
    );
    if (existing) {
      existing.triggerIds = recent.map((entry) => entry.id);
      existing.firstSeenWave = Math.min(...recent.map((entry) => entry.wave));
      existing.lastSeenWave = Math.max(...recent.map((entry) => entry.wave));
      existing.count = recent.length;
      return existing;
    }
    const entry = {
      id: nextId(reg, 'weak'),
      targetModel,
      weaknessType: triggerType,
      triggerIds: recent.map((item) => item.id),
      firstSeenWave: Math.min(...recent.map((item) => item.wave)),
      lastSeenWave: Math.max(...recent.map((item) => item.wave)),
      count: recent.length,
      status: 'active'
    };
    derived.recurringWeaknessLog.push(entry);
    return entry;
  }

  // When a claim becomes supported, any pending REQUEST_SUPPORT-style action on
  // that claim's target is considered answered (closes the cooldown loop).
  function reconcileActions(reg) {
    const supportedTargets = new Set(
      Object.values(reg.artifacts)
        .filter((a) => a.type === ARTIFACT_TYPES.CLAIM && a.status === 'supported')
        .map((a) => a.id)
    );
    reg.pendingActions.forEach((action) => {
      if (action.status === 'pending' && action.triggerId === 'UNSUPPORTED_CLAIM' && supportedTargets.has(action.artifactId)) {
        action.status = 'answered';
      }
    });
  }

  // --- Wave lifecycle --------------------------------------------------------

  // Ingest one checkpoint output ({ artifacts, triggers }) for the current wave.
  function ingestCheckpoint(reg, parsed, { wave } = {}) {
    if (!reg) return { applied: 0, rejected: 0, actions: 0, focus: 0, contextRequests: 0 };
    if (typeof wave === 'number') reg.wave = wave;
    ensureDerived(reg);
    const sourceCheckpointId = checkpointId(reg);
    reg.lastCheckpointId = sourceCheckpointId;
    const artifacts = Array.isArray(parsed?.artifacts) ? parsed.artifacts : [];
    const triggers = Array.isArray(parsed?.triggers) ? parsed.triggers : [];
    const contextRequests = Array.isArray(parsed?.contextRequests) ? parsed.contextRequests : [];
    let applied = 0;
    let rejected = 0;
    let actions = 0;
    let focus = 0;
    let acceptedContextRequests = 0;
    artifacts.forEach((delta) => {
      const res = applyDelta(reg, delta);
      if (res.ok) applied += 1; else rejected += 1;
    });
    triggers.forEach((trigger) => {
      const res = ingestTrigger(reg, trigger);
      if (res.ok) actions += 1; else if (res.reason !== 'cooldown') rejected += 1;
    });
    if (recordRecommendedFocus(reg, parsed?.recommendedFocus, sourceCheckpointId)) focus += 1;
    contextRequests.forEach((request) => {
      const res = recordContextRequest(reg, request, sourceCheckpointId);
      if (res.ok) acceptedContextRequests += 1; else rejected += 1;
    });
    reconcileActions(reg);
    return { applied, rejected, actions, focus, contextRequests: acceptedContextRequests };
  }

  function recordRecommendedFocus(reg, recommendedFocus, sourceCheckpointId = '') {
    if (!recommendedFocus || typeof recommendedFocus !== 'object') return null;
    const text = normText(recommendedFocus.text);
    if (!text) return null;
    const derived = ensureDerived(reg);
    const targetArtifactIds = Array.isArray(recommendedFocus.targetArtifactIds)
      ? recommendedFocus.targetArtifactIds.map(normText).filter(Boolean)
      : [];
    const targetModels = Array.isArray(recommendedFocus.targetModels)
      ? recommendedFocus.targetModels.map(normText).filter(Boolean)
      : [];
    const entry = {
      id: nextId(reg, 'focus'),
      wave: reg.wave,
      sourceCheckpointId: normText(sourceCheckpointId),
      text,
      targetArtifactIds,
      targetModels,
      reason: normText(recommendedFocus.reason),
      adoptedInNextWave: null,
      adoptedEvidence: null
    };
    derived.focusHistory.push(entry);
    return entry;
  }

  function recordContextRequest(reg, request, sourceCheckpointId = '') {
    if (!reg || !request || typeof request !== 'object') return { ok: false, reason: 'empty_request' };
    const artifactId = normText(request.artifactId);
    const artifact = artifactId ? reg.artifacts[artifactId] : null;
    if (!artifact) {
      recordViolation(reg, 'unknown_context_artifact', `contextRequest references missing artifact ${artifactId || '(none)'}`);
      return { ok: false, reason: 'unknown_artifact' };
    }
    const event = getEvent(reg, artifact.anchor?.turnId);
    if (!event) {
      recordViolation(reg, 'context_anchor_missing', `contextRequest ${artifactId} has no event for anchor turn ${artifact.anchor?.turnId || '(none)'}`);
      return { ok: false, reason: 'missing_event' };
    }
    const entry = {
      id: nextId(reg, 'ctx'),
      wave: reg.wave,
      sourceCheckpointId: normText(sourceCheckpointId),
      artifactId,
      reason: normText(request.reason),
      turnId: event.turnId,
      status: 'pending'
    };
    ensureDerived(reg).contextRequestHistory.push(entry);
    return { ok: true, id: entry.id };
  }

  // Advance to the next checkpoint wave: expire stale pending actions.
  function advanceWave(reg) {
    if (!reg) return reg;
    reg.wave = (Number(reg.wave) || 0) + 1;
    reg.pendingActions.forEach((action) => {
      if (action.status === 'pending' && reg.wave - action.issuedWave >= ACTION_EXPIRY_WAVES) {
        action.status = 'expired';
      }
    });
    return reg;
  }

  function isActiveArtifact(artifact) {
    if (!artifact) return false;
    if (artifact.type === ARTIFACT_TYPES.OPEN_ISSUE) return ACTIVE_ISSUE_STATUSES.includes(artifact.status);
    if (artifact.type === ARTIFACT_TYPES.CLAIM) return ACTIVE_CLAIM_STATUSES.includes(artifact.status);
    if (artifact.type === ARTIFACT_TYPES.TERM_MISMATCH) return ACTIVE_TERM_STATUSES.includes(artifact.status);
    if (artifact.type === ARTIFACT_TYPES.OBJECTION) return ['raised', 'unresolved'].includes(artifact.status);
    if ([ARTIFACT_TYPES.EVIDENCE_GAP, ARTIFACT_TYPES.CONTRADICTION, ARTIFACT_TYPES.OPEN_QUESTION].includes(artifact.type)) return ['open', 'reopened', 'contested', 'disputed'].includes(artifact.status);
    if (artifact.type === ARTIFACT_TYPES.DISSENT) return ['active', 'open', 'contested'].includes(artifact.status);
    if (artifact.type === ARTIFACT_TYPES.EVIDENCE) return ['unverified', 'disputed', 'stale'].includes(artifact.status);
    if ([ARTIFACT_TYPES.ASSUMPTION, ARTIFACT_TYPES.DECISION_CRITERION].includes(artifact.type)) return ['proposed', 'contested'].includes(artifact.status);
    return false;
  }

  function activeArtifacts(reg) {
    return Object.values(reg.artifacts).filter(isActiveArtifact);
  }

  function enforceIssueLimit(reg) {
    const openIssues = Object.values(reg.artifacts)
      .filter((a) => a.type === ARTIFACT_TYPES.OPEN_ISSUE && ACTIVE_ISSUE_STATUSES.includes(a.status));
    if (openIssues.length <= MAX_ACTIVE_OPEN_ISSUES) return;
    openIssues
      .sort((a, b) => (a.lastWave || 0) - (b.lastWave || 0))
      .slice(0, openIssues.length - MAX_ACTIVE_OPEN_ISSUES)
      .forEach((issue) => {
        issue.status = 'closed';
        reg.archive.push(issue);
      });
  }

  // --- Prompt serialization (hybrid context, artefact spec §4.2) -------------

  function shortQuote(anchor, limit = 160) {
    const q = normText(anchor?.quote);
    if (!q) return '';
    return q.length > limit ? `${q.slice(0, limit - 1)}…` : q;
  }

  function selectPrimaryAction(reg, model) {
    const target = normText(model);
    const candidates = reg.pendingActions.filter((a) =>
      a.status === 'pending'
      && a.target === target
      && a.cooldownUntilWave > reg.wave);
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const rank = severityRank(b.severity) - severityRank(a.severity);
      if (rank !== 0) return rank;
      return TRIGGER_CATALOG.indexOf(a.triggerId) - TRIGGER_CATALOG.indexOf(b.triggerId);
    });
    return candidates[0];
  }

  function renderPrimaryTrigger(action) {
    if (!action) return '';
    const template = TRIGGER_TEMPLATES[action.triggerId] || '{quote}';
    return template.replace('{quote}', shortQuote(action.anchor));
  }

  // Builds the "already recorded by the system" block for one model's next wave.
  // Active artifacts -> id + status + anchor quote; the model's primary trigger
  // is returned separately so the caller can foreground it.
  function serializeForPromptModel(reg, model) {
    if (!reg) return { context: '', primaryTrigger: '' };
    const items = activeArtifacts(reg)
      .sort((a, b) => (b.lastWave || 0) - (a.lastWave || 0))
      .slice(0, PROMPT_ARTIFACT_LIMIT)
      .map((a) => {
        const label = a.type === ARTIFACT_TYPES.OPEN_ISSUE ? 'Спор'
          : a.type === ARTIFACT_TYPES.CLAIM ? 'Тезис'
          : a.type === ARTIFACT_TYPES.TERM_MISMATCH ? 'Термин' : a.type === ARTIFACT_TYPES.OBJECTION ? 'Возражение' : 'Изменение позиции';
        const quote = shortQuote(a.anchor, 120);
        const body = normText(a.formulation) || quote;
        return `- [${a.id}] ${label}/${a.status}: ${body}${quote && body !== quote ? ` («${quote}»)` : ''}`;
      });
    const context = items.length ? items.join('\n') : '';
    const primaryTrigger = renderPrimaryTrigger(selectPrimaryAction(reg, model));
    const operationalSignals = summarizeDerivedForPrompt(reg, model);
    return { context, primaryTrigger, operationalSignals };
  }

  // Compact registry summary handed to the checkpoint model as prior state.
  function summarizeForCheckpoint(reg) {
    if (!reg) return '';
    const lines = activeArtifacts(reg).map((a) =>
      `- [${a.id}] ${a.type}/${a.status}: ${normText(a.formulation) || shortQuote(a.anchor, 100)}`);
    const objections = activeArtifacts(reg).filter((a) => a.type === ARTIFACT_TYPES.OBJECTION).map((a) => `- [${a.id}] возражение к ${a.targetId}: ${normText(a.formulation)}`);
    if (objections.length) lines.push('Активные возражения:', ...objections);
    return lines.join('\n');
  }

  function computeRoundDelta(reg, { sinceCheckpointId = '', participantCount = 1 } = {}) {
    const empty = { newClaims: [], newObjections: [], revisions: [], resolvedIssues: [], reopenedIssues: [], duplicateSignals: [], counts: {} };
    if (!reg) return empty;
    const baseline = Number(String(sinceCheckpointId).replace(/^chk-/, '')) || 0;
    const allArtifacts = Object.values(reg.artifacts);
    const artifacts = allArtifacts.filter((artifact) => !sinceCheckpointId || (Number(String(artifact.sourceCheckpointId).replace(/^chk-/, '')) > baseline));
    const changedTo = (statuses) => allArtifacts.filter((artifact) => (artifact.history || []).some((entry) =>
      Number(entry.sourceCheckpointId || 0) > baseline && statuses.includes(entry.toStatus)));
    const result = {
      newClaims: artifacts.filter((a) => a.type === ARTIFACT_TYPES.CLAIM),
      newObjections: artifacts.filter((a) => a.type === ARTIFACT_TYPES.OBJECTION),
      revisions: artifacts.filter((a) => a.type === ARTIFACT_TYPES.REVISION),
      resolvedIssues: changedTo(['closed', 'partially_closed']),
      reopenedIssues: changedTo(['reopened']),
      duplicateSignals: (reg.pendingActions || []).filter((a) => a.triggerId === 'REPEATED_POINT' && a.wave === reg.wave)
    };
    result.counts = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.length]));
    result.participantCount = Math.max(1, Number(participantCount || 1));
    result.stagnation = {
      repeatedPointCount: result.duplicateSignals.length,
      newContentRatio: (result.newClaims.length + result.newObjections.length + result.revisions.length) / Math.max(1, Number(participantCount || 1))
    };
    return result;
  }

  function summarizeDerivedForPrompt(reg, model = '', limit = 4) {
    if (!reg) return '';
    const derived = ensureDerived(reg);
    const target = normText(model);
    const lines = [];
    const focus = derived.focusHistory
      .filter((entry) => !entry.targetModels.length || entry.targetModels.includes(target))
      .slice(-1)[0];
    if (focus) lines.push(`- Фокус: ${focus.text}`);
    const weakness = derived.recurringWeaknessLog
      .filter((entry) => entry.targetModel === target && entry.status === 'active')
      .slice(-1)[0];
    if (weakness) lines.push(`- Повторяющаяся слабость: ${weakness.weaknessType} (${weakness.count} раза)`);
    const burden = derived.instructionBurdenLog
      .filter((entry) => entry.targetModel === target)
      .slice(-limit);
    if (burden.length >= 3) {
      const kinds = burden.map((entry) => entry.instructionKind).join(', ');
      lines.push(`- Недавняя нагрузка указаниями: ${kinds}`);
    }
    return lines.join('\n');
  }

  function summarizeDerivedForCheckpoint(reg, limit = 6) {
    if (!reg) return '';
    const derived = ensureDerived(reg);
    const lines = [];
    derived.focusHistory.slice(-limit).forEach((entry) => {
      lines.push(`- focus/${entry.wave}: ${entry.text}`);
    });
    derived.recurringWeaknessLog.slice(-limit).forEach((entry) => {
      lines.push(`- weakness/${entry.targetModel}: ${entry.weaknessType} x${entry.count}`);
    });
    derived.instructionBurdenLog.slice(-limit).forEach((entry) => {
      lines.push(`- burden/${entry.targetModel}: ${entry.instructionKind}`);
    });
    return lines.join('\n');
  }

  function getFullContextForArtifact(reg, artifactId) {
    if (!reg) return null;
    const id = normText(artifactId);
    const artifact = id ? reg.artifacts[id] : null;
    if (!artifact) return null;
    const event = getEvent(reg, artifact.anchor?.turnId);
    if (!event) return null;
    return {
      artifactId: id,
      turnId: event.turnId,
      model: event.model,
      waveKey: event.waveKey,
      text: event.text
    };
  }

  function consumePendingContextForCheckpoint(reg, limit = 3) {
    const derived = ensureDerived(reg);
    const pending = derived.contextRequestHistory
      .filter((entry) => entry.status === 'pending')
      .slice(0, limit);
    const contexts = pending
      .map((entry) => getFullContextForArtifact(reg, entry.artifactId))
      .filter(Boolean);
    pending.forEach((entry) => { entry.status = 'provided'; });
    return contexts;
  }

  function recordRoute(reg, route = {}) {
    if (!reg) return null;
    const entry = Object.assign({
      id: nextId(reg, 'route'),
      mode: normText(route.mode || reg.mode || 'triad'),
      wave: reg.wave,
      primaryTriggerId: null
    }, route);
    ensureDerived(reg).routeHistory.push(entry);
    return entry;
  }

  function exportRegistry(reg) {
    if (!reg) return null;
    return {
      version: VERSION,
      mode: reg.mode || 'triad',
      wave: reg.wave,
      artifacts: Object.values(reg.artifacts),
      pendingActions: reg.pendingActions.slice(),
      violations: reg.violations.slice(),
      archive: reg.archive.slice(),
      derived: createDerivedLayer(reg.derived),
      eventLog: reg.eventLog.map((e) => ({ turnId: e.turnId, model: e.model, waveKey: e.waveKey }))
    };
  }

  const api = Object.freeze({
    VERSION,
    ARTIFACT_TYPES,
    ISSUE_STATUSES,
    CLAIM_STATUSES,
    TERM_STATUSES,
    OBJECTION_STATUSES,
    REVISION_STATUSES,
    ACTION_STATUSES,
    TRIGGER_CATALOG,
    TRIGGER_TEMPLATES,
    SEVERITY_RANK,
    LOGICAL_PATTERN_TRIGGERS,
    INSTRUCTION_KIND_BY_TRIGGER,
    MAX_ACTIVE_OPEN_ISSUES,
    createRegistry,
    ensureDerived,
    appendEvent,
    getEvent,
    anchorIsValid,
    applyDelta,
    ingestTrigger,
    ingestCheckpoint,
    recordRecommendedFocus,
    recordContextRequest,
    getFullContextForArtifact,
    consumePendingContextForCheckpoint,
    summarizeDerivedForPrompt,
    summarizeDerivedForCheckpoint,
    recordRoute,
    reconcileActions,
    advanceWave,
    activeArtifacts,
    selectPrimaryAction,
    renderPrimaryTrigger,
    serializeForPromptModel,
    summarizeForCheckpoint,
    computeRoundDelta,
    exportRegistry
  });

  root.TriadRegistry = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
