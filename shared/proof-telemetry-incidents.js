// Incident indexing and evidence-closure construction for schema 6 telemetry.
(function initProofTelemetryIncidents(root) {
  'use strict';

  const contracts = () => root.ProofTelemetryContracts || (typeof require === 'function' ? require('./proof-telemetry-contracts.js') : null);

  function value(value) {
    return value === undefined || value === null || value === '' ? null : value;
  }

  function scopeOf(event) {
    const numeric = (candidate) => value(candidate) !== null && Number.isFinite(Number(candidate)) ? Number(candidate) : null;
    return {
      runSessionId: value(event?.runSessionId) === null ? null : String(event.runSessionId),
      runGeneration: numeric(event?.runGeneration),
      modelId: value(event?.modelId) === null ? null : String(event.modelId),
      dispatchId: value(event?.dispatchId) === null ? null : String(event.dispatchId),
      generationEpoch: numeric(event?.generationEpoch)
    };
  }

  function scopeKey(scope) {
    return [scope.runSessionId ?? 'none', scope.runGeneration ?? 'none', scope.modelId ?? 'none', scope.dispatchId ?? 'none', scope.generationEpoch ?? 'none'].join('|');
  }

  function exactScope(left, right) {
    return contracts()?.sameIncidentScope?.(left, right) === true;
  }

  function sameRunScope(left, right) {
    const a = scopeOf(left);
    const b = scopeOf(right);
    return a.runSessionId !== null && a.runSessionId === b.runSessionId
      && a.runGeneration !== null && a.runGeneration === b.runGeneration;
  }

  function indexIncidents(events) {
    const indexes = new Map();
    (events || []).forEach((event) => {
      if (!event || event.modelId === 'SYSTEM' || !event.dispatchId) return;
      const scope = scopeOf(event);
      const key = scopeKey(scope);
      if (!indexes.has(key)) indexes.set(key, {
        incidentId: `incident:${key}`,
        scope,
        eventIds: [],
        candidateIds: new Set(),
        navigationLineage: new Set(),
        firstIngestSeq: Number(event.ingestSeq || event.seq || 0),
        lastIngestSeq: Number(event.ingestSeq || event.seq || 0),
        terminal: false,
        contradiction: false
      });
      const incident = indexes.get(key);
      incident.eventIds.push(event.eventId);
      if (event.candidateId) incident.candidateIds.add(String(event.candidateId));
      if (event.documentInstanceId || event.navigationEpoch !== undefined) {
        incident.navigationLineage.add(`${event.documentInstanceId || 'document-unknown'}:${event.navigationEpoch ?? 'epoch-unknown'}`);
      }
      incident.lastIngestSeq = Math.max(incident.lastIngestSeq, Number(event.ingestSeq || event.seq || 0));
      if (event.eventType === 'MODEL_TERMINAL_RECORDED') incident.terminal = true;
      if (/CONTRADICT|ANOMALY/.test(event.eventType) || event.payload?.conclusion === 'contradicted') incident.contradiction = true;
    });
    return [...indexes.values()].map((incident) => ({
      ...incident,
      candidateIds: [...incident.candidateIds].sort(),
      navigationLineage: [...incident.navigationLineage].sort()
    })).sort((left, right) => left.firstIngestSeq - right.firstIngestSeq || left.incidentId.localeCompare(right.incidentId));
  }

  function taskMatchScore(incident, eventById, task) {
    const allowed = new Set(contracts()?.normalizedSlots?.(task).flatMap((slot) => slot.eventTypes) || []);
    return incident.eventIds.reduce((score, id) => score + (allowed.has(eventById.get(id)?.eventType) ? 1 : 0), 0);
  }

  function selectIncident(events, { platform, task, incidentId = null } = {}) {
    const eventById = new Map((events || []).map((event) => [event.eventId, event]));
    const candidates = indexIncidents(events).filter((incident) => !platform || incident.scope.modelId === platform);
    if (incidentId && !candidates.some((incident) => incident.incidentId === incidentId)) {
      return {
        selected: null,
        selectionReason: 'explicit_incident_not_found',
        otherMatchingIncidents: [],
        matchingIncidentCount: 0
      };
    }
    // A zero task-specific match is still a valid diagnostic incident. For
    // absence-oriented tasks (request not sent / generation not started),
    // requiring the expected event before allowing export would hide the very
    // failure the report is meant to explain. Rank by available evidence, but
    // never use evidence absence as an incident-exclusion predicate.
    const matching = incidentId ? candidates.filter((incident) => incident.incidentId === incidentId) : candidates;
    const ranked = matching.slice().sort((left, right) => {
      const leftScore = taskMatchScore(left, eventById, task) + (left.contradiction ? 4 : 0) + (left.terminal ? 1 : 0);
      const rightScore = taskMatchScore(right, eventById, task) + (right.contradiction ? 4 : 0) + (right.terminal ? 1 : 0);
      return rightScore - leftScore || right.lastIngestSeq - left.lastIngestSeq || left.incidentId.localeCompare(right.incidentId);
    });
    return {
      selected: ranked[0] || null,
      selectionReason: ranked.length ? (incidentId ? 'explicit_incident_then_evidence_rank' : 'task_evidence_rank_then_latest_including_zero_match') : 'no_matching_incident',
      otherMatchingIncidents: ranked.slice(1).map((incident) => incident.incidentId),
      matchingIncidentCount: ranked.length
    };
  }

  function selectIncidentReports(events, { platform = null, task } = {}) {
    const indexed = indexIncidents(events);
    const modelIds = [];
    indexed.forEach((incident) => {
      const modelId = incident.scope.modelId;
      if ((!platform || modelId === platform) && !modelIds.includes(modelId)) modelIds.push(modelId);
    });
    return modelIds.flatMap((modelId) => {
      const selection = selectIncident(events, { platform: modelId, task });
      if (!selection.selected) return [];
      return [selection.selected.incidentId, ...selection.otherMatchingIncidents].map((incidentId, rank) => ({
        incidentId,
        modelId,
        rank,
        selectionReason: selection.selectionReason,
        matchingIncidentCount: selection.matchingIncidentCount
      }));
    });
  }

  function contextValue(context, path) {
    return String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean)
      .reduce((current, key) => current?.[key], context);
  }

  function conditionMatches(context, predicate) {
    if (!predicate) return false;
    const observed = contextValue(context, predicate.path);
    if (observed === undefined || observed === null) return false;
    if (predicate.operator === 'eq') return observed === predicate.value;
    if (predicate.operator === 'in') return Array.isArray(predicate.value) && predicate.value.includes(observed);
    return false;
  }

  function numericEvidence(event) {
    const metadata = event?.payload?.metadata || {};
    for (const key of ['textLength', 'answerLength', 'answerLen', 'extractedTextLength', 'capturedTextLength', 'length', 'growthChars']) {
      const raw = event?.payload?.[key] ?? metadata[key];
      if (raw === undefined || raw === null || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function proofRoleKey(event) {
    const fact = contracts()?.factOf?.(event) || {};
    return [event.eventType, fact.kind || 'unknown', fact.state || 'unknown', event.layer || 'fact'].join('|');
  }

  function selectProofEvents(matched, scoped) {
    if (matched.length <= 2) return matched.slice();
    const selected = new Map();
    const include = (event) => { if (event?.eventId) selected.set(event.eventId, event); };
    include(matched[0]);
    include(matched[matched.length - 1]);
    const referenced = new Set(scoped.flatMap((event) => event.evidenceRefs || []));
    matched.filter((event) => referenced.has(event.eventId)).forEach(include);
    const byRole = new Map();
    matched.forEach((event) => {
      const role = proofRoleKey(event);
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(event);
    });
    byRole.forEach((events) => {
      include(events[0]);
      include(events[events.length - 1]);
    });
    const measured = matched.map((event) => ({ event, value: numericEvidence(event) }))
      .filter((item) => item.value !== null);
    if (measured.length) {
      include(measured.reduce((best, item) => item.value < best.value ? item : best).event);
      include(measured.reduce((best, item) => item.value > best.value ? item : best).event);
    }
    return [...selected.values()].sort((left, right) => Number(left.ingestSeq || left.seq) - Number(right.ingestSeq || right.seq));
  }

  function resolveEvidenceSlots(events, incident, task, context = {}) {
    const scoped = (events || []).filter((event) => exactScope(event, incident.scope));
    const slots = (contracts()?.normalizedSlots?.(task) || []).map((contract) => {
      const allMatched = scoped.filter((event) => contract.eventTypes.includes(event.eventType));
      const matched = selectProofEvents(allMatched, scoped);
      const conditionRequired = contract.criticality === 'conditional' && conditionMatches(context, contract.requiredIf);
      const effectiveCriticality = conditionRequired ? 'required' : contract.criticality;
      return {
        slotId: contract.slotId,
        criticality: contract.criticality,
        effectiveCriticality,
        requiredIf: contract.requiredIf,
        requiredIfMatched: conditionRequired,
        acceptedEventTypes: contract.eventTypes,
        status: matched.length ? 'satisfied' : (effectiveCriticality === 'conditional' ? 'not_observed' : 'unavailable'),
        eventIds: matched.map((event) => event.eventId),
        matchedEventCount: allMatched.length,
        selectedEventCount: matched.length,
        impact: matched.length ? null : `${effectiveCriticality}_evidence_not_available`
      };
    });
    const criticalMissing = slots.filter((slot) => slot.effectiveCriticality === 'critical' && slot.status !== 'satisfied');
    const requiredMissing = slots.filter((slot) => slot.effectiveCriticality === 'required' && slot.status !== 'satisfied');
    return {
      slots,
      sufficiency: criticalMissing.length ? 'insufficient' : (requiredMissing.length ? 'bounded' : 'complete'),
      missingEvidence: [...criticalMissing, ...requiredMissing].map((slot) => ({
        slotId: slot.slotId,
        criticality: slot.effectiveCriticality,
        declaredCriticality: slot.criticality,
        requiredIf: slot.requiredIf,
        impact: slot.impact
      }))
    };
  }

  function buildEvidenceClosure(events, incident, task, { context = {} } = {}) {
    if (!incident) return { events: [], slots: [], sufficiency: 'insufficient', missingEvidence: [{ slotId: 'incident', criticality: 'critical', impact: 'no_matching_incident' }], violations: [] };
    const eventById = new Map((events || []).map((event) => [event.eventId, event]));
    const slotResult = resolveEvidenceSlots(events, incident, task, context);
    const reasons = new Map();
    const violations = [];
    const queue = [];
    function include(eventId, reason) {
      const event = eventById.get(eventId);
      if (!event) {
        violations.push({ invariantId: 'S02', eventId, message: 'referenced evidence is absent' });
        return;
      }
      if ((event.modelId === 'SYSTEM' && !sameRunScope(event, incident.scope))
        || (event.modelId !== 'SYSTEM' && !exactScope(event, incident.scope))) {
        violations.push({ invariantId: 'SCOPE', eventId, message: 'cross-incident evidence rejected' });
        return;
      }
      if (!reasons.has(eventId)) {
        reasons.set(eventId, new Set());
        queue.push(event);
      }
      reasons.get(eventId).add(reason);
    }
    slotResult.slots.forEach((slot) => slot.eventIds.forEach((id) => include(id, `slot:${slot.slotId}`)));
    if (!slotResult.slots.some((slot) => slot.eventIds.length)) {
      const anchorId = incident.eventIds?.[0];
      if (anchorId) include(anchorId, 'scope:incident-anchor');
    }
    while (queue.length) {
      const event = queue.shift();
      (event.evidenceRefs || []).forEach((ref) => include(ref, `evidence-ref:${event.eventId}`));
      if (event.causationId) include(event.causationId, `causation:${event.eventId}`);
      if (event.correlationId) {
        selectProofEvents((events || []).filter((candidate) => candidate.correlationId === event.correlationId), events || [])
          .forEach((candidate) => include(candidate.eventId, `correlation:${event.correlationId}`));
      }
    }
    const materialized = [...reasons.keys()].map((id) => ({
      ...eventById.get(id),
      includedFor: [...reasons.get(id)].sort()
    })).sort((left, right) => Number(left.ingestSeq || left.seq) - Number(right.ingestSeq || right.seq));
    return { ...slotResult, events: materialized, violations };
  }

  const api = Object.freeze({ scopeOf, scopeKey, exactScope, sameRunScope, indexIncidents, selectIncident, selectIncidentReports, selectProofEvents, resolveEvidenceSlots, buildEvidenceClosure });
  root.ProofTelemetryIncidents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
