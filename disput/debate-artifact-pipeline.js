// Canonical semantic pipeline for the universal discussion runtime:
// accepted response -> deterministic Artifact -> StateDelta -> atomic commit -> StateMap.
(function initDebateArtifactPipeline(root) {
  'use strict';

  const StateMap = root.DebateStateMap || (typeof require === 'function' ? require('./debate-state-map') : null);
  const ResponseAcceptance = root.DebateResponseAcceptance || (typeof require === 'function' ? require('./debate-response-acceptance') : null);
  const text = (value) => String(value == null ? '' : value).trim();
  const list = (value) => Array.isArray(value) ? value : [];
  const stableHash = (value) => {
    const source = text(value); let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const artifactTypeFor = (purpose) => ({
    position: 'claim', critique: 'objection', verification: 'evidence', evidence_review: 'evidence',
    response: 'revision', contradiction_resolution: 'revision', dissent_examination: 'dissent',
    context_compaction: 'finding', synthesis: 'synthesis_conclusion', audit: 'audit',
    human_judgment: 'human_decision'
  }[text(purpose)] || 'finding');
  const operationForPurpose = (purpose) => ({
    position: 'opening', critique: 'critique', verification: 'verification', evidence_review: 'verification',
    response: 'response', contradiction_resolution: 'resolve_contradiction',
    dissent_examination: 'examine_dissent', context_compaction: 'compact_context',
    synthesis: 'synthesis', audit: 'synthesis_audit', human_judgment: 'human_gate'
  }[text(purpose)] || 'opening');
  const statusFor = (type) => ({
    claim: 'asserted', objection: 'raised', evidence: 'supported', revision: 'proposed',
    dissent: 'recorded', synthesis_conclusion: 'accepted', human_decision: 'accepted'
  }[type] || 'recorded');

  function extractArtifacts({ stage = {}, participant = {}, text: responseText } = {}) {
    const body = text(responseText);
    if (!body) return [];
    const participantId = text(participant.participantId || participant.model || 'unknown');
    const type = artifactTypeFor(stage.purpose);
    const audit = type === 'audit' ? ResponseAcceptance?.parseAuditVerdict?.(body) : null;
    const targetId = type === 'audit' ? text(list(stage.inputArtifactIds)[0]) : '';
    const fingerprint = stableHash(`${stage.runId}|${stage.stageInstanceId}|${participantId}|${type}|${body}`);
    return [Object.freeze({
      id: `artifact-${fingerprint}`,
      type,
      status: type === 'audit' ? (audit?.verdict === 'pass' ? 'verified' : 'contested') : statusFor(type),
      title: body,
      text: body,
      owner: participantId,
      ...(targetId ? { targetId } : {}),
      ...(audit?.ok ? { auditVerdict: audit.verdict, issues: Object.freeze(audit.issues.slice()) } : {}),
      extractionConfidence: 1,
      provenance: Object.freeze({
        runId: text(stage.runId), stageInstanceId: text(stage.stageInstanceId),
        participantId, responseHash: stableHash(body)
      })
    })];
  }

  function proposeStateDelta({ stage = {}, participant = {}, artifacts = [], context = {} } = {}) {
    const normalized = list(artifacts).filter((artifact) => artifact?.id && artifact?.type && artifact?.provenance);
    if (!normalized.length) return null;
    return Object.freeze({
      deltaId: `delta-${text(stage.stageInstanceId)}-${text(participant.participantId || participant.model)}`,
      stageInstanceId: text(stage.stageInstanceId),
      participantId: text(participant.participantId || participant.model),
      expectedCaseVersion: context.caseVersion == null ? null : Number(context.caseVersion),
      artifacts: Object.freeze(normalized.slice())
    });
  }

  function projectStateMap(stateOrCase = {}) {
    const debateCase = stateOrCase.debateCase || stateOrCase;
    const artifacts = list(debateCase.artifacts);
    const artifactRecord = Object.fromEntries(artifacts.map((artifact) => [artifact.id, artifact]));
    const projected = (root.DebateStateMap || StateMap)?.project?.({
      caseId: debateCase.caseId || stateOrCase.runId,
      runId: stateOrCase.runId || debateCase.caseId,
      title: debateCase.topic?.title || debateCase.title || '',
      artifacts: artifactRecord,
      sourceEvents: debateCase.sourceEvents || [],
      technicalStatus: stateOrCase.lifecycle || debateCase.lifecycle || 'running',
      epistemicOutcome: debateCase.epistemicOutcome || 'pending'
    }) || { artifacts: artifactRecord };
    const synthesis = artifacts.findLast?.((artifact) => artifact.type === 'synthesis_conclusion')
      || artifacts.slice().reverse().find((artifact) => artifact.type === 'synthesis_conclusion');
    const currentAudits = artifacts.filter((artifact) => artifact.type === 'audit' && artifact.targetId === synthesis?.id);
    const latestAudit = currentAudits.at(-1);
    const validAudit = latestAudit && latestAudit.auditVerdict === 'pass' && latestAudit.status === 'verified' ? latestAudit : null;
    return Object.freeze({
      ...projected,
      artifacts: artifactRecord,
      synthesisArtifactId: synthesis?.id || '',
      validAuditArtifactId: validAudit?.id || '',
      currentSynthesisAuditId: latestAudit?.id || '',
      currentSynthesisAuditVerdict: latestAudit?.auditVerdict || ''
    });
  }

  function commitStateDelta({ state, delta } = {}) {
    if (!state?.debateCase || !delta) return { applied: false, reason: 'semantic_state_unavailable' };
    if (delta.expectedCaseVersion != null && Number(delta.expectedCaseVersion) !== Number(state.caseVersion)) {
      return { applied: false, reason: 'case_version_stale' };
    }
    const existing = list(state.debateCase.artifacts);
    const known = new Map(existing.map((artifact) => [artifact.id, artifact]));
    const additions = list(delta.artifacts).filter((artifact) => artifact?.id && !known.has(artifact.id));
    if (!additions.length) return { applied: false, reason: 'no_state_change' };
    const nextArtifacts = [...existing, ...additions.map((artifact) => ({ ...artifact }))];
    state.debateCase = { ...state.debateCase, artifacts: nextArtifacts };
    return { applied: true, appliedArtifactIds: additions.map((artifact) => artifact.id), stateMap: projectStateMap(state) };
  }

  const api = Object.freeze({ stableHash, artifactTypeFor, operationForPurpose, extractArtifacts, proposeStateDelta, commitStateDelta, projectStateMap });
  root.DebateArtifactPipeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
