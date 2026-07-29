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

  function selectIncident(events, { platform, task, incidentId = null, verdictByIncident = null } = {}) {
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
    const verdictRank = { confirmed: 4, supported_but_incomplete: 3, unknown: 2, not_confirmed: 1 };
    const ranked = matching.slice().sort((left, right) => {
      const leftVerdict = verdictRank[verdictByIncident?.[left.incidentId]] || 0;
      const rightVerdict = verdictRank[verdictByIncident?.[right.incidentId]] || 0;
      const leftScore = taskMatchScore(left, eventById, task) + (left.contradiction ? 4 : 0) + (left.terminal ? 1 : 0);
      const rightScore = taskMatchScore(right, eventById, task) + (right.contradiction ? 4 : 0) + (right.terminal ? 1 : 0);
      return rightVerdict - leftVerdict || rightScore - leftScore || right.lastIngestSeq - left.lastIngestSeq || left.incidentId.localeCompare(right.incidentId);
    });
    return {
      selected: ranked[0] || null,
      selectionReason: ranked.length ? (incidentId ? 'explicit_incident_then_evidence_rank' : (verdictByIncident ? 'diagnostic_verdict_then_task_evidence_then_latest' : 'task_evidence_rank_then_latest_including_zero_match')) : 'no_matching_incident',
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

  function eventMatchesSlot(event, contract, scoped) {
    const rule = contract.matchRule;
    if (!rule) return true;
    if (rule.fact) {
      const fact = contracts()?.factOf?.(event) || {};
      if (rule.fact.kind && fact.kind !== rule.fact.kind) return false;
      let state = String(fact.state || '').toLowerCase();
      if (fact.kind === 'candidate_identity') state = contracts()?.normalizeIdentityState?.(state) || state;
      const allowedStates = (rule.fact.states || []).map((value) => {
        const normalized = String(value).toLowerCase();
        return fact.kind === 'candidate_identity'
          ? (contracts()?.normalizeIdentityState?.(normalized) || normalized)
          : normalized;
      });
      if (allowedStates.length && !allowedStates.includes(state)) return false;
    }
    if (rule.temporal) {
      const eventById = new Map(scoped.map((candidate) => [candidate.eventId, candidate]));
      if (rule.temporal.afterEventType) {
        const boundary = [...scoped].reverse().find((candidate) => candidate.eventType === rule.temporal.afterEventType
          && Number(candidate.seq) < Number(event.seq));
        if (!boundary) return false;
        const referenced = (event.evidenceRefs || []).map((id) => eventById.get(id)).filter(Boolean);
        if ((rule.temporal.requiresEvidenceRefTypes || []).some((eventType) => !referenced.some((candidate) => candidate.eventType === eventType))) return false;
        if (rule.temporal.requiresPostBoundaryEvidenceRef
          && !referenced.some((candidate) => candidate.eventId !== boundary.eventId && Number(candidate.seq) > Number(boundary.seq) && Number(candidate.seq) < Number(event.seq))) return false;
      }
      if (rule.temporal.closestBeforeEventType) {
        const terminal = [...scoped].reverse().find((candidate) => candidate.eventType === rule.temporal.closestBeforeEventType);
        const closest = terminal && [...scoped].reverse().find((candidate) => candidate.eventType === event.eventType
          && Number(candidate.seq) <= Number(terminal.seq));
        if (!closest || closest.eventId !== event.eventId) return false;
      }
    }
    return true;
  }

  function temporalIntegrity(events, incident, { legacyMode = false } = {}) {
    const scoped = (events || []).filter((event) => exactScope(event, incident.scope));
    const byId = new Map(scoped.map((event) => [event.eventId, event]));
    const violations = [];
    const limitations = [];
    scoped.forEach((event) => {
      const conflict = contracts()?.typedCanonicalConflict?.(event);
      if (conflict) violations.push({
        invariantId: 'TYPED_CANONICAL_CONFLICT',
        eventId: event.eventId,
        affectedReportTypes: Object.keys(contracts()?.REPORT_CONTRACTS || {}),
        affectedSlotIds: [],
        affectedFields: [],
        conflict,
        message: 'typed fact contradicts canonical event payload'
      });
    });
    scoped.filter((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED').forEach((audit) => {
      const terminal = [...scoped].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED' && Number(event.seq) < Number(audit.seq));
      if (!terminal) {
        violations.push({ invariantId: 'TEMPORAL_AUDIT_ORDER', eventId: audit.eventId, affectedReportTypes: ['false-success'], affectedSlotIds: ['post_terminal_audit'], affectedFields: ['postTerminalGrowthProven'], message: 'post-terminal audit precedes terminal boundary' });
        return;
      }
      const referenced = (audit.evidenceRefs || []).map((id) => byId.get(id)).filter(Boolean);
      const terminalLinked = referenced.some((event) => event.eventId === terminal.eventId);
      const observationLinked = referenced.some((event) => event.eventId !== terminal.eventId
        && Number(event.seq) > Number(terminal.seq) && Number(event.seq) < Number(audit.seq));
      if (!terminalLinked || !observationLinked) {
        const item = { code: 'audit_lineage_unavailable', eventId: audit.eventId, affectedReportTypes: ['false-success'], affectedSlotIds: ['post_terminal_audit'], affectedFields: ['postTerminalGrowthProven'], impact: 'post-terminal audit cannot prove growth without terminal and later-observation lineage' };
        if (legacyMode) limitations.push(item);
        else violations.push({ invariantId: 'CAUSAL_AUDIT_LINEAGE', ...item, message: item.impact });
      }
    });
    scoped.filter((event) => event.eventType === 'EXTRACTION_COMPLETED').forEach((extraction) => {
      const terminal = [...scoped].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED' && Number(event.seq) < Number(extraction.seq));
      if (!terminal) return;
      const recoveryLinked = (extraction.evidenceRefs || []).map((id) => byId.get(id)).filter(Boolean)
        .some((event) => ['POLICY_OVERRIDE_APPLIED', 'FINALIZATION_POLICY_EVALUATED'].includes(event.eventType)
          && /recovery|retry|repair/i.test(JSON.stringify(event.payload || {})));
      if (!recoveryLinked) violations.push({ invariantId: 'TEMPORAL_EXTRACTION_AFTER_TERMINAL', eventId: extraction.eventId, affectedReportTypes: ['empty', 'old-answer', 'cutted'], affectedSlotIds: ['extraction_result', 'extraction_boundary'], affectedFields: ['extractionProblemEvidence', 'oldAnswerEvidence', 'incompleteCaptureEvidence'], message: 'post-terminal extraction lacks explicit recovery lineage' });
    });
    const first = (type) => scoped.find((event) => event.eventType === type) || null;
    const last = (type) => [...scoped].reverse().find((event) => event.eventType === type) || null;
    const baseline = first('DISPATCH_BASELINE_CAPTURED');
    const insertion = first('PROMPT_INSERTION_EVALUATED');
    const submit = first('SUBMIT_ACTION_OBSERVED');
    const acceptance = first('SUBMISSION_EVIDENCE_CHANGED') || first('SUBMISSION_INFERRED');
    if (baseline && insertion && Number(insertion.seq) < Number(baseline.seq)) {
      violations.push({ invariantId: 'TEMPORAL_PROMPT_INSERTION_ORDER', eventId: insertion.eventId, affectedReportTypes: ['prompt-not-inserted'], affectedSlotIds: ['dispatch_baseline', 'insertion_outcome'], affectedFields: ['promptNotInsertedEvidence'], message: 'prompt insertion evaluation precedes dispatch baseline' });
    }
    if (insertion && submit && Number(submit.seq) < Number(insertion.seq)) {
      violations.push({ invariantId: 'TEMPORAL_PROMPT_SUBMIT_ORDER', eventId: submit.eventId, affectedReportTypes: ['prompt-not-inserted', 'prompt-not-sent'], affectedSlotIds: ['insertion_outcome', 'submit_action'], affectedFields: ['promptNotInsertedEvidence', 'promptNotSentEvidence'], message: 'submit action precedes prompt insertion evaluation' });
    }
    if (submit && acceptance && Number(acceptance.seq) < Number(submit.seq)) {
      violations.push({ invariantId: 'TEMPORAL_PROMPT_ACCEPTANCE_ORDER', eventId: acceptance.eventId, affectedReportTypes: ['prompt-not-sent'], affectedSlotIds: ['submit_action', 'acceptance_evidence'], affectedFields: ['promptNotSentEvidence'], message: 'submission acceptance evidence precedes submit action' });
    }
    const generationStart = first('GENERATION_START_EVALUATED') || first('GENERATION_SIGNAL_CHANGED');
    const stable = first('STABILITY_INTERVAL_CLOSED');
    if (generationStart && stable && Number(stable.seq) < Number(generationStart.seq)) {
      violations.push({ invariantId: 'TEMPORAL_LATE_END_STABILITY_ORDER', eventId: stable.eventId, affectedReportTypes: ['late-end'], affectedSlotIds: ['generation_state', 'stable_boundary'], affectedFields: ['lateEndEvidence'], message: 'stability boundary precedes generation start' });
    }
    const eligibility = scoped.find((event) => (event.eventType === 'DECISION_RECORDED' || event.eventType === 'FINALIZATION_POLICY_EVALUATED')
      && contracts()?.factOf?.(event)?.state === 'accepted') || null;
    if (stable && eligibility && Number(eligibility.seq) < Number(stable.seq)) {
      violations.push({ invariantId: 'TEMPORAL_LATE_END_ELIGIBILITY_ORDER', eventId: eligibility.eventId, affectedReportTypes: ['late-end'], affectedSlotIds: ['stable_boundary', 'completion_policy', 'decision_lineage'], affectedFields: ['lateEndEvidence'], message: 'terminal eligibility precedes final stability boundary' });
    }
    return { violations, limitations };
  }

  function validateTemporalInvariants(events, incident, options = {}) {
    return temporalIntegrity(events, incident, options).violations;
  }

  function priorIncidentFor(events, incident) {
    const terminal = [...(events || [])].reverse().find((event) => exactScope(event, incident.scope)
      && event.eventType === 'MODEL_TERMINAL_RECORDED');
    const priorIncidentRef = terminal?.priorIncidentRef
      || terminal?.payload?.priorIncidentRef
      || terminal?.payload?.metadata?.priorIncidentRef
      || null;
    if (!priorIncidentRef) return { priorIncidentRef: null, incident: null, terminal };
    const prior = indexIncidents(events).find((candidate) => candidate.incidentId === priorIncidentRef) || null;
    return { priorIncidentRef: String(priorIncidentRef), incident: prior, terminal };
  }

  function resolveEvidenceSlots(events, incident, task, context = {}) {
    const scoped = (events || []).filter((event) => exactScope(event, incident.scope));
    const priorLane = task === 'old-answer' ? priorIncidentFor(events, incident) : { priorIncidentRef: null, incident: null, terminal: null };
    const slots = (contracts()?.normalizedSlots?.(task) || []).map((contract) => {
      const typeMatched = contract.slotId === 'prior_incident_evidence'
        ? (priorLane.incident ? (events || []).filter((event) => exactScope(event, priorLane.incident.scope)
          && contract.eventTypes.includes(event.eventType)) : [])
        : scoped.filter((event) => contract.eventTypes.includes(event.eventType));
      const allMatched = contract.slotId === 'prior_incident_evidence'
        ? typeMatched
        : typeMatched.filter((event) => {
          if (task === 'no-delivery') {
            const sourceSlots = ['incident_identity', 'source_answer_materialized'];
            const renderSlots = ['expected_card_binding', 'card_delivery_outcome', 'source_to_card_comparison'];
            if (sourceSlots.includes(contract.slotId)
              && event.eventId !== context?.derivedViews?.sourceEvidenceEventId) return false;
            if (renderSlots.includes(contract.slotId)
              && event.eventId !== context?.derivedViews?.cardRenderEvidenceEventId) return false;
            if (['delivery_boundary', 'commit_boundary'].includes(contract.slotId)
              && !context?.derivedViews?.deliveryAttemptGraph?.eventIds?.includes(event.eventId)) return false;
          }
          if (task === 'late-end' && contract.slotId === 'candidate_identity'
            && context?.derivedViews?.lateEndCandidateBinding !== 'candidate_proven') return false;
          if (!eventMatchesSlot(event, contract, scoped)) return false;
          const candidateBoundSlot = ['extraction_boundary', 'extraction_result', 'structural_verification', 'post_terminal_mutation',
            'stable_boundary', 'terminal_boundary', 'generation_state', 'text_evolution', 'completion_policy', 'decision_lineage'].includes(contract.slotId);
          const expectedCandidateId = context?.derivedViews?.measurementCandidateId;
          return !(candidateBoundSlot && expectedCandidateId && event.candidateId && String(event.candidateId) !== String(expectedCandidateId));
        });
      const matched = selectProofEvents(allMatched, scoped);
      const rejected = selectProofEvents(typeMatched.filter((event) => !allMatched.includes(event)), scoped);
      const conditionRequired = contract.criticality === 'conditional' && conditionMatches(context, contract.requiredIf);
      const effectiveCriticality = conditionRequired ? 'required' : contract.criticality;
      return {
        slotId: contract.slotId,
        criticality: contract.criticality,
        effectiveCriticality,
        requiredIf: contract.requiredIf,
        requiredIfMatched: conditionRequired,
        acceptedEventTypes: contract.eventTypes,
        matchRule: contract.matchRule,
        ...(contract.slotId === 'prior_incident_evidence' ? { priorIncidentRef: priorLane.priorIncidentRef } : {}),
        status: matched.length ? 'satisfied' : (effectiveCriticality === 'conditional' ? 'not_observed' : 'unavailable'),
        eventIds: matched.map((event) => event.eventId),
        rejectedEventIds: rejected.map((event) => event.eventId),
        matchedEventCount: allMatched.length,
        rejectedEventCount: typeMatched.length - allMatched.length,
        selectedEventCount: matched.length,
        impact: matched.length ? null : (contract.slotId === 'prior_incident_evidence' && priorLane.priorIncidentRef && !priorLane.incident
          ? 'prior_incident_outside_export'
          : `${effectiveCriticality}_evidence_not_available`)
      };
    });
    const criticalMissing = slots.filter((slot) => slot.effectiveCriticality === 'critical' && slot.status !== 'satisfied');
    const requiredMissing = slots.filter((slot) => slot.effectiveCriticality === 'required' && slot.status !== 'satisfied');
    const confidenceLimitations = [];
    if (task === 'cutted' && context?.derivedViews?.measurementComparability === 'single_candidate') {
      confidenceLimitations.push({ code: 'single_candidate_comparability', impact: 'measurement continuity is inferred from a single-candidate incident' });
    }
    const ordinaryRequiredMissing = requiredMissing.filter((slot) => slot.impact !== 'prior_incident_outside_export');
    const externalPriorMissing = requiredMissing.some((slot) => slot.impact === 'prior_incident_outside_export');
    const sufficiency = criticalMissing.length
      ? 'insufficient'
      : (ordinaryRequiredMissing.length || externalPriorMissing || confidenceLimitations.length ? 'bounded' : 'complete');
    const boundedConfirmationBlocked = (task === 'cutted' && context?.derivedViews?.measurementComparability === 'single_candidate')
      || (task === 'old-answer' && externalPriorMissing);
    return {
      slots,
      sufficiency,
      missingRequiredSlotCount: ordinaryRequiredMissing.length,
      confirmationAllowedWhenBounded: criticalMissing.length === 0
        && !boundedConfirmationBlocked
        && (task === 'no-delivery' || ordinaryRequiredMissing.length === 0),
      confidenceLimitations,
      missingEvidence: [...criticalMissing, ...requiredMissing].map((slot) => ({
        slotId: slot.slotId,
        criticality: slot.effectiveCriticality,
        declaredCriticality: slot.criticality,
        requiredIf: slot.requiredIf,
        impact: slot.impact
      }))
    };
  }

  function buildEvidenceClosure(events, incident, task, { context = {}, legacyMode = false } = {}) {
    if (!incident) return { events: [], slots: [], sufficiency: 'insufficient', missingEvidence: [{ slotId: 'incident', criticality: 'critical', impact: 'no_matching_incident' }], violations: [] };
    const eventById = new Map((events || []).map((event) => [event.eventId, event]));
    const slotResult = resolveEvidenceSlots(events, incident, task, context);
    const priorLane = task === 'old-answer' ? priorIncidentFor(events, incident) : { priorIncidentRef: null, incident: null };
    const reasons = new Map();
    const integrity = temporalIntegrity(events, incident, { legacyMode });
    const violations = integrity.violations;
    const queue = [];
    function include(eventId, reason) {
      const event = eventById.get(eventId);
      if (!event) {
        violations.push({ invariantId: 'S02', eventId, message: 'referenced evidence is absent' });
        return;
      }
      const inPriorLane = priorLane.incident && exactScope(event, priorLane.incident.scope);
      if ((event.modelId === 'SYSTEM' && !sameRunScope(event, incident.scope))
        || (event.modelId !== 'SYSTEM' && !exactScope(event, incident.scope) && !inPriorLane)) {
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
    slotResult.slots.forEach((slot) => slot.rejectedEventIds.forEach((id) => include(id, `slot-rejected:${slot.slotId}`)));
    const counterEvidenceTypes = new Set(contracts()?.counterEvidenceTypes?.(task) || []);
    selectProofEvents((events || []).filter((event) => exactScope(event, incident.scope)
      && counterEvidenceTypes.has(event.eventType)), events || [])
      .forEach((event) => include(event.eventId, `counterevidence:${task}`));
    if (priorLane.incident) {
      const priorTypes = new Set(['CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED']);
      selectProofEvents((events || []).filter((event) => exactScope(event, priorLane.incident.scope)
        && priorTypes.has(event.eventType)), events || [])
        .forEach((event) => include(event.eventId, `prior-incident:${priorLane.incident.incidentId}`));
    }
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
    return {
      ...slotResult,
      events: materialized,
      violations,
      limitations: integrity.limitations,
      priorIncidentRef: priorLane.priorIncidentRef,
      evidenceLanes: priorLane.incident ? { currentIncident: incident.incidentId || null, priorIncident: priorLane.incident.incidentId } : { currentIncident: incident.incidentId || null }
    };
  }

  const api = Object.freeze({ scopeOf, scopeKey, exactScope, sameRunScope, indexIncidents, selectIncident, selectIncidentReports, selectProofEvents, eventMatchesSlot, temporalIntegrity, validateTemporalInvariants, priorIncidentFor, resolveEvidenceSlots, buildEvidenceClosure });
  root.ProofTelemetryIncidents = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
