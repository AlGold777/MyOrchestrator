// Canonical, versioned Debate case. Raw responses stay in the run log; this
// module owns validated semantic artifacts, their links and immutable history.
(function initDebateCaseSchema(root) {
  'use strict';
  const VERSION = 2;
  const ARTIFACT_TYPES = Object.freeze([
    'claim', 'assumption', 'objection', 'evidence', 'revision', 'axis_verdict',
    'dissent', 'human_decision', 'limitation', 'evidence_gap', 'contradiction',
    'open_question', 'decision_criterion', 'synthesis_working', 'synthesis_conclusion', 'audit', 'source', 'finding'
  ]);
  const ARTIFACT_STATUSES = Object.freeze([
    'proposed', 'open', 'raised', 'asserted', 'contested', 'disputed', 'clarifying',
    'partially_closed', 'reopened', 'supported', 'verified', 'refuted', 'conceded',
    'answered', 'withdrawn', 'unresolved', 'unverified', 'active', 'resolved', 'recorded', 'accepted', 'accepted_as_limitation',
    'limitation', 'closed', 'superseded', 'merged', 'stale', 'rejected', 'unknown'
  ]);
  const TECHNICAL_STATUSES = Object.freeze(['idle', 'running', 'paused', 'technical_pause', 'completed', 'error', 'cancelled', 'degraded']);
  const EPISTEMIC_OUTCOMES = Object.freeze(['pending', 'resolved', 'partial', 'inconclusive', 'insufficient_evidence', 'blocked', 'stagnation', 'budget_limited', 'manual_stop', 'failed', 'cancelled']);
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const hash = (value) => {
    const source = stable(value); let result = 2166136261;
    for (let i = 0; i < source.length; i += 1) { result ^= source.charCodeAt(i); result = Math.imul(result, 16777619); }
    return `fnv1a-${(result >>> 0).toString(16).padStart(8, '0')}`;
  };
  const now = (input) => Number(input) || Date.now();

  function createCase(input = {}) {
    const createdAt = now(input.createdAt);
    return {
      schemaVersion: VERSION,
      caseId: String(input.caseId || input.runId || `case-${createdAt}`),
      runId: String(input.runId || ''), sessionId: String(input.sessionId || ''),
      title: String(input.title || input.problemSpec?.goal || 'Текущее дело'),
      problemSpec: clone(input.problemSpec || {}),
      taskContract: clone(input.taskContract || null),
      profile: clone(input.profile || { id: '', version: '' }),
      participants: clone(input.participants || []),
      technicalStatus: TECHNICAL_STATUSES.includes(input.technicalStatus) ? input.technicalStatus : 'idle',
      epistemicOutcome: EPISTEMIC_OUTCOMES.includes(input.epistemicOutcome) ? input.epistemicOutcome : 'pending',
      artifacts: {}, changes: [], sourceEvents: [], snapshots: [], acceptedCorrelations: {}, acceptedActions: {}, humanDecisions: [],
      contractVersions: clone(input.contractVersions || {}),
      createdAt, updatedAt: createdAt, degradedReasons: clone(input.degradedReasons || [])
    };
  }

  function normalizeArtifact(input = {}, previous = null, changedAt = Date.now()) {
    const artifact = {
      ...(previous || {}), ...clone(input),
      id: String(input.id || previous?.id || ''),
      type: String(input.type || previous?.type || ''),
      status: String(input.status || previous?.status || 'open'),
      title: String(input.title || input.formulation || input.text || previous?.title || ''),
      targetId: String(input.targetId || input.claimId || previous?.targetId || ''),
      provenance: clone(input.provenance || previous?.provenance || null),
      extractionConfidence: Number(input.extractionConfidence ?? previous?.extractionConfidence ?? 1),
      revision: Number(previous?.revision || 0) + (previous ? 1 : 0),
      supersededBy: String(input.supersededBy || previous?.supersededBy || ''),
      mergedInto: String(input.mergedInto || previous?.mergedInto || ''),
      createdAt: Number(previous?.createdAt || input.createdAt || changedAt),
      updatedAt: changedAt,
      history: Array.isArray(previous?.history) ? previous.history.slice() : []
    };
    return artifact;
  }

  function validateArtifact(artifact, artifacts = {}) {
    const errors = [];
    if (!artifact.id) errors.push('artifact_id_missing');
    if (!ARTIFACT_TYPES.includes(artifact.type)) errors.push(`artifact_type_invalid:${artifact.type}`);
    if (!artifact.provenance) errors.push('artifact_provenance_missing');
    if (!ARTIFACT_STATUSES.includes(artifact.status)) errors.push(`artifact_status_invalid:${artifact.status}`);
    if (!Number.isFinite(Number(artifact.extractionConfidence)) || Number(artifact.extractionConfidence) < 0 || Number(artifact.extractionConfidence) > 1) errors.push('artifact_confidence_invalid');
    if (artifact.targetId && !artifacts[artifact.targetId] && artifact.targetId !== artifact.id) errors.push(`artifact_target_missing:${artifact.targetId}`);
    if (['objection', 'evidence', 'revision'].includes(artifact.type) && !artifact.targetId) errors.push(`${artifact.type}_target_missing`);
    if (artifact.targetId === artifact.id) errors.push('artifact_self_reference');
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  function snapshotOf(state, reason, at) {
    const projection = {
      artifacts: state.artifacts, technicalStatus: state.technicalStatus,
      epistemicOutcome: state.epistemicOutcome, profile: state.profile, participants: state.participants,
      taskContract: state.taskContract, sourceEventCount: state.sourceEvents.length
    };
    return { snapshotId: `snapshot-${state.snapshots.length + 1}`, sequence: state.changes.length, reason, at, hash: hash(projection), projection: clone(projection) };
  }

  function applyChange(current, change = {}) {
    const state = clone(current || createCase());
    state.sourceEvents = Array.isArray(state.sourceEvents) ? state.sourceEvents : [];
    state.acceptedActions = state.acceptedActions && typeof state.acceptedActions === 'object' ? state.acceptedActions : {};
    state.humanDecisions = Array.isArray(state.humanDecisions) ? state.humanDecisions : [];
    state.changes = Array.isArray(state.changes) ? state.changes : [];
    state.snapshots = Array.isArray(state.snapshots) ? state.snapshots : [];
    state.acceptedCorrelations = state.acceptedCorrelations && typeof state.acceptedCorrelations === 'object' ? state.acceptedCorrelations : {};
    if (change.expectedSequence != null && Number(change.expectedSequence) !== state.changes.length) {
      return { ok: false, stale: true, errors: Object.freeze([`case_sequence_stale:${change.expectedSequence}:${state.changes.length}`]), state: current };
    }
    const at = now(change.at);
    const correlationId = String(change.correlationId || '');
    if (correlationId && state.acceptedCorrelations[correlationId]) return { ok: true, duplicate: true, state: current };
    const kind = String(change.kind || 'UPSERT_ARTIFACT');
    let details = {};
    if (kind === 'APPEND_SOURCE_EVENT') {
      const sourceEvent = clone(change.event || {});
      const eventId = String(sourceEvent.eventId || sourceEvent.turnId || sourceEvent.id || '');
      if (!eventId) return { ok: false, errors: ['source_event_id_missing'], state: current };
      if (state.sourceEvents.some((entry) => String(entry.eventId || entry.turnId || entry.id) === eventId)) return { ok: true, duplicate: true, state: current };
      const sequence = state.sourceEvents.length + 1;
      state.sourceEvents.push({ ...sourceEvent, eventId, sequence, at: Number(sourceEvent.at || at), actor: String(sourceEvent.actor || change.actor || '') });
      details = { eventId, sourceSequence: sequence, eventType: String(sourceEvent.type || sourceEvent.eventType || 'SOURCE_EVENT') };
    } else if (kind === 'UPSERT_ARTIFACT') {
      const previous = state.artifacts[String(change.artifact?.id || '')] || null;
      const artifact = normalizeArtifact(change.artifact, previous, at);
      const verdict = validateArtifact(artifact, state.artifacts);
      if (!verdict.ok) return { ok: false, errors: verdict.errors, state: current };
      if (previous) artifact.history.push({ at, status: previous.status, title: previous.title, changedBy: String(change.actor || '') });
      state.artifacts[artifact.id] = artifact;
      details = { artifactId: artifact.id, artifactType: artifact.type, before: previous, after: clone(artifact) };
    } else if (kind === 'DELETE_ARTIFACT') {
      const artifactId = String(change.artifactId || change.artifact?.id || '').trim();
      if (!artifactId) return { ok: false, errors: ['artifact_id_missing'], state: current };
      const previous = state.artifacts[artifactId];
      if (!previous) return { ok: false, errors: [`artifact_not_found:${artifactId}`], state: current };
      const dependents = Object.values(state.artifacts).filter((artifact) => artifact.id !== artifactId && artifact.targetId === artifactId);
      if (dependents.length) return { ok: false, errors: [`artifact_has_dependents:${artifactId}`], state: current };
      delete state.artifacts[artifactId];
      details = { artifactId, artifactType: previous.type, before: clone(previous) };
    } else if (kind === 'SET_STATUS') {
      if (change.technicalStatus && !TECHNICAL_STATUSES.includes(change.technicalStatus)) return { ok: false, errors: ['technical_status_invalid'], state: current };
      if (change.epistemicOutcome && !EPISTEMIC_OUTCOMES.includes(change.epistemicOutcome)) return { ok: false, errors: ['epistemic_outcome_invalid'], state: current };
      const before = { technicalStatus: state.technicalStatus, epistemicOutcome: state.epistemicOutcome };
      if (change.technicalStatus) state.technicalStatus = change.technicalStatus;
      if (change.epistemicOutcome) state.epistemicOutcome = change.epistemicOutcome;
      details = { before, after: { technicalStatus: state.technicalStatus, epistemicOutcome: state.epistemicOutcome } };
    } else if (kind === 'RECORD_HUMAN_DECISION') {
      const decision = clone(change.decision || {});
      const decisionId = String(decision.decisionId || correlationId || `decision-${state.humanDecisions.length + 1}`);
      if (!String(decision.text || decision.value || '').trim()) return { ok: false, errors: ['human_decision_value_missing'], state: current };
      state.humanDecisions.push({ ...decision, decisionId, at, actor: String(change.actor || 'human') });
      details = { decisionId, targetId: String(decision.targetId || '') };
    } else {
      return { ok: false, errors: [`case_change_unknown:${kind}`], state: current };
    }
    const sequence = state.changes.length + 1;
    state.changes.push({ changeId: `change-${sequence}`, sequence, kind, at, actor: String(change.actor || ''), correlationId, details });
    if (correlationId) state.acceptedCorrelations[correlationId] = sequence;
    state.updatedAt = at;
    state.snapshots.push(snapshotOf(state, kind, at));
    return { ok: true, duplicate: false, state };
  }

  function validateCase(state = {}) {
    const errors = [];
    if (Number(state.schemaVersion) !== VERSION) errors.push('case_schema_version_invalid');
    if (!String(state.caseId || '')) errors.push('case_id_missing');
    Object.values(state.artifacts || {}).forEach((artifact) => errors.push(...validateArtifact(artifact, state.artifacts).errors));
    const sequences = (state.changes || []).map((entry) => Number(entry.sequence));
    if (sequences.some((value, index) => value !== index + 1)) errors.push('case_change_sequence_invalid');
    const sourceSequences = (state.sourceEvents || []).map((entry) => Number(entry.sequence));
    if (sourceSequences.some((value, index) => value !== index + 1)) errors.push('case_source_event_sequence_invalid');
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  function migrate(input = {}) {
    if (Number(input.schemaVersion) === VERSION) return clone(input);
    const migrated = createCase({
      ...input, taskContract: input.taskContract || null, createdAt: input.createdAt,
      degradedReasons: [...(input.degradedReasons || []), `migrated_case_v${Number(input.schemaVersion || 0)}_to_v${VERSION}`]
    });
    migrated.artifacts = clone(input.artifacts || {});
    Object.values(migrated.artifacts).forEach((artifact) => {
      artifact.status = ARTIFACT_STATUSES.includes(artifact.status) ? artifact.status : 'unknown';
      artifact.extractionConfidence = Number.isFinite(Number(artifact.extractionConfidence)) ? Number(artifact.extractionConfidence) : 1;
      artifact.revision = Number(artifact.revision || 0);
      artifact.history = Array.isArray(artifact.history) ? artifact.history : [];
    });
    migrated.changes = clone(input.changes || []);
    migrated.sourceEvents = clone(input.sourceEvents || input.eventLog || []).map((event, index) => ({ ...event, eventId: String(event.eventId || event.turnId || event.id || `legacy-event-${index + 1}`), sequence: index + 1 }));
    migrated.snapshots = clone(input.snapshots || []);
    migrated.acceptedCorrelations = clone(input.acceptedCorrelations || {});
    migrated.acceptedActions = clone(input.acceptedActions || {});
    migrated.humanDecisions = clone(input.humanDecisions || []);
    migrated.updatedAt = Number(input.updatedAt || migrated.createdAt);
    return migrated;
  }

  const api = Object.freeze({ VERSION, ARTIFACT_TYPES, ARTIFACT_STATUSES, TECHNICAL_STATUSES, EPISTEMIC_OUTCOMES, createCase, normalizeArtifact, validateArtifact, applyChange, validateCase, migrate, hash });
  root.DebateCaseSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
