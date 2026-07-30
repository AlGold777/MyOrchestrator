#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('../shared/proof-telemetry-policy.js');
const Contracts = require('../shared/proof-telemetry-contracts.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

const root = path.join(__dirname, '..', 'docs', 'proof_oriented_telemetry_spec_v1');
const presetsDir = path.join(root, 'presets');

function event(eventType, ts, metadata = {}) {
  return {
    ts,
    label: eventType,
    proofEventType: eventType,
    platform: 'GPT',
    meta: {
      runSessionId: 'synthetic-run',
      runGeneration: 1,
      dispatchId: 'synthetic-dispatch',
      generationEpoch: 1,
      ...metadata
    }
  };
}

function ledgerForTypes(types, reportType = null) {
  const uniqueTypes = [...new Set(types)];
  let ledger = ProofTelemetry.buildLedger(uniqueTypes.map((type, index) => event(type, 1000 + index * 500, {
    textLength: ['TEXT_STATE_CHANGED', 'STABILITY_INTERVAL_CLOSED', 'EXTRACTION_COMPLETED'].includes(type) ? 120 : undefined,
    answerLength: type === 'MODEL_TERMINAL_RECORDED' ? 120 : undefined,
    finalStatus: ['DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED'].includes(type) ? 'SUCCESS' : undefined,
    answerIdentity: type === 'CANDIDATE_IDENTITY_INFERRED' ? 'current_dispatch' : undefined
  })), { runSessionId: 'synthetic-run' }).map((item) => {
    const metadata = { ...(item.payload?.metadata || {}) };
    let typed = Contracts.factOf(item);
    let directPayload = {};
    if (item.eventType === 'MODEL_TERMINAL_RECORDED') {
      Object.assign(metadata, { terminalStatus: 'SUCCESS', answerLen: reportType === 'cutted' ? 60 : 120 });
      typed = { kind: 'terminal_action', state: 'SUCCESS' };
    }
    if (item.eventType === 'TEXT_STATE_CHANGED' || item.eventType === 'GENERATION_SIGNAL_CHANGED') metadata.textLength = 120;
    if (item.eventType === 'PAGE_HEALTH_OBSERVED' || item.eventType === 'OBSERVER_HEALTH_OBSERVED') {
      metadata.pageHealth = 'reliable';
      typed = { kind: 'observation', state: 'reliable' };
    }
    if (item.eventType === 'OBSERVATION_FRAME_CAPTURED') {
      metadata.observationCoverage = 'complete';
      metadata.maximumSignalSkewMs = 250;
      metadata.contentScriptAvailable = true;
      typed = { kind: 'observation', state: 'reliable' };
    }
    if (['OBSERVATION_INTERVAL_CLOSED', 'OBSERVER_HEALTH_INTERVAL_CLOSED'].includes(item.eventType)) {
      directPayload = { observationCoverage: 'complete', continuous: true, gapMs: 0 };
      typed = { kind: 'observation_interval', state: 'closed' };
    }
    if (item.eventType === 'EXTRACTION_COMPLETED') {
      metadata.length = reportType === 'cutted' ? 60 : 120;
      directPayload = { status: reportType === 'empty' ? 'failed' : 'completed' };
      typed = { kind: 'extraction', state: reportType === 'empty' ? 'failed' : 'completed' };
    }
    if (item.eventType === 'ANSWER_COMPLETENESS_EVALUATED') {
      typed = { kind: 'answer_completeness', state: reportType === 'cutted' ? 'probably_truncated' : 'unknown' };
    }
    if (item.eventType === 'SUBMISSION_EVIDENCE_CHANGED') typed = { kind: 'submission', state: reportType === 'prompt-not-sent' ? 'failed' : 'confirmed' };
    if (reportType === 'prompt-not-inserted' && item.eventType === 'SUBMISSION_EVIDENCE_CHANGED') typed = { kind: 'submission', state: 'attempted' };
    if (item.eventType === 'PROMPT_INSERTION_EVALUATED') {
      directPayload = { insertionState: reportType === 'prompt-not-inserted' ? 'failed' : 'inserted' };
      typed = { kind: 'prompt_insertion', state: reportType === 'prompt-not-inserted' ? 'failed' : 'inserted' };
    }
    if (reportType === 'false-success' && item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED') {
      directPayload = { conclusion: 'contradicted', growthChars: 30, growthPct: 25, hashChanged: true, auditPossible: true };
    }
    if (reportType === 'late-end' && item.eventType === 'DECISION_RECORDED') {
      directPayload = { accepted: true, mode: 'policy_eligible', evidenceTier: 3, blockers: [] };
      typed = { kind: 'decision', state: 'accepted' };
    }
    if (reportType === 'old-answer' && item.eventType === 'EXTRACTION_COMPLETED') metadata.answerIdentity = 'previous_dispatch';
    if (reportType === 'old-answer' && item.eventType === 'CANDIDATE_IDENTITY_INFERRED') typed = { kind: 'candidate_identity', state: 'previous_dispatch' };
    if (reportType === 'old-answer' && item.eventType === 'MODEL_TERMINAL_RECORDED') metadata.answerEvidenceDispatchId = 'synthetic-previous-dispatch';
    if (reportType === 'no-delivery' && ['ANSWER_SOURCE_MATERIALIZED', 'ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_COMMIT_EVALUATED', 'ANSWER_CARD_RENDER_EVALUATED'].includes(item.eventType)) {
      Object.assign(metadata, {
        attemptId: 'synthetic-attempt-1',
        payloadEvidenceId: 'payload:synthetic-dispatch:synthetic-attempt-1:12345678',
        normalizationVersion: 'answer-proof-normalization@1.0.0'
      });
      if (item.eventType === 'ANSWER_SOURCE_MATERIALIZED') Object.assign(metadata, { sourceProofLevel: 'direct_preterminal', normalizedHash: 'fnv1a:12345678', normalizedLength: 120 });
      if (item.eventType === 'ANSWER_DELIVERY_ACKNOWLEDGED') metadata.outcome = 'accepted';
      if (item.eventType === 'ANSWER_COMMIT_EVALUATED') Object.assign(metadata, { outcome: 'accepted', overwrite: false });
      if (item.eventType === 'ANSWER_CARD_RENDER_EVALUATED') Object.assign(metadata, {
        expectedCardId: 'panel-gpt',
        observedCardId: 'panel-gpt',
        outcome: 'empty',
        contentClass: 'empty',
        expectedNormalizationVersion: 'answer-proof-normalization@1.0.0',
        evaluationBoundaryId: 'boundary:synthetic-dispatch:synthetic-attempt-1:automatic_terminal',
        evaluationBoundaryType: 'automatic_terminal',
        resolutionState: 'unresolved'
      });
    }
    return {
      ...item,
      ...(reportType ? { candidateId: 'synthetic-candidate' } : {}),
      clock: {
        ...item.clock,
        producerEpochId: 'synthetic-document-epoch',
        observedAtLocalMonoMs: item.wallTs - 1000
      },
      payload: { ...item.payload, typed, metadata, ...directPayload }
    };
  });
  if (reportType) {
    if (reportType !== 'false-success') ledger = ledger.filter((item) => item.eventType !== 'POST_TERMINAL_AUDIT_COMPLETED');
    const baseOrder = new Map([
      ['DISPATCH_BASELINE_CAPTURED', 10],
      ['SUBMIT_ACTION_OBSERVED', 20],
      ['SUBMISSION_EVIDENCE_CHANGED', 30],
      ['PROMPT_INSERTION_EVALUATED', 35],
      ['PAGE_CONTEXT_OBSERVED', 40],
      ['PAGE_HEALTH_OBSERVED', 41],
      ['OBSERVER_HEALTH_OBSERVED', 42],
      ['OBSERVER_HEALTH_INTERVAL_CLOSED', 43],
      ['OBSERVATION_INTERVAL_CLOSED', 44],
      ['GENERATION_START_EVALUATED', 50],
      ['GENERATION_SIGNAL_CHANGED', 51],
      ['OBSERVATION_FRAME_CAPTURED', 52],
      ['CANDIDATE_SET_CHANGED', 55],
      ['CANDIDATE_IDENTITY_INFERRED', 56],
      ['ANSWER_SOURCE_MATERIALIZED', 57],
      ['TEXT_STATE_CHANGED', 60],
      ['STABILITY_INTERVAL_CLOSED', 61],
      ['EXTRACTION_COMPLETED', 65],
      ['STRUCTURAL_VERIFICATION_EVALUATED', 66],
      ['ANSWER_COMPLETENESS_EVALUATED', 67],
      ['ANSWER_DELIVERY_ACKNOWLEDGED', 68],
      ['ANSWER_DELIVERY_REJECTED', 68],
      ['ANSWER_COMMIT_EVALUATED', 69],
      ['COMPLETION_HYPOTHESIS_EVALUATED', 70],
      ['TERMINAL_DEADLINE_REACHED', 72],
      ['FINALIZATION_POLICY_EVALUATED', 73],
      ['POLICY_OVERRIDE_APPLIED', 74],
      ['DECISION_RECORDED', 75],
      ['MODEL_TERMINAL_RECORDED', 80],
      ['ANSWER_CARD_RENDER_EVALUATED', 81],
      ['MISSING_EVIDENCE_RECORDED', 90],
      ['POST_TERMINAL_AUDIT_COMPLETED', 100]
    ]);
    const lateEndOrder = new Map([
      ['OBSERVER_HEALTH_OBSERVED', 1],
      ['CANDIDATE_SET_CHANGED', 2],
      ['CANDIDATE_IDENTITY_INFERRED', 3],
      ['GENERATION_SIGNAL_CHANGED', 4],
      ['STABILITY_INTERVAL_CLOSED', 5],
      ['TEXT_STATE_CHANGED', 6],
      ['COMPLETION_HYPOTHESIS_EVALUATED', 7],
      ['DECISION_RECORDED', 8],
      ['MODEL_TERMINAL_RECORDED', 9],
      ['POST_TERMINAL_AUDIT_COMPLETED', 10]
    ]);
    const order = reportType === 'late-end' ? lateEndOrder : baseOrder;
    if (reportType === 'false-success') order.set('TEXT_STATE_CHANGED', 90);
    ledger = ledger.sort((left, right) => Number(order.get(left.eventType) || 85) - Number(order.get(right.eventType) || 85));
    ledger.forEach((item, index) => {
      item.seq = index + 1;
      item.ingestSeq = index + 1;
      item.wallTs = 1000 + index * 500;
      item.clock.observedAtLocalMonoMs = index * 500;
      item.clock.ingestMonoMs = index + 1;
      if (reportType === 'late-end' && item.eventType === 'MODEL_TERMINAL_RECORDED') {
        item.wallTs += 2000;
        item.clock.observedAtLocalMonoMs += 2000;
      }
      if (['prompt-not-sent', 'prompt-not-inserted'].includes(reportType)
        && ['OBSERVATION_INTERVAL_CLOSED', 'OBSERVER_HEALTH_INTERVAL_CLOSED'].includes(item.eventType)) {
        item.wallTs += Contracts.THRESHOLDS.generationStartTimeoutMs;
        item.clock.observedAtLocalMonoMs += Contracts.THRESHOLDS.generationStartTimeoutMs;
      }
    });
    const audit = ledger.find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    const terminal = ledger.find((item) => item.eventType === 'MODEL_TERMINAL_RECORDED');
    const laterObservation = ledger.find((item) => terminal && Number(item.seq) > Number(terminal.seq)
      && Number(item.seq) < Number(audit?.seq) && item.eventType !== 'MISSING_EVIDENCE_RECORDED');
    if (audit && terminal && laterObservation) audit.evidenceRefs = [terminal.eventId, laterObservation.eventId];
  }
  return ledger;
}

async function main() {
  const types = [
    'DISPATCH_BASELINE_CAPTURED',
    'SUBMIT_ACTION_OBSERVED',
    'SUBMISSION_EVIDENCE_CHANGED',
    'PROMPT_INSERTION_EVALUATED',
    'PAGE_CONTEXT_OBSERVED',
    'PAGE_HEALTH_OBSERVED',
    'GENERATION_START_EVALUATED',
    'GENERATION_SIGNAL_CHANGED',
    'OBSERVATION_FRAME_CAPTURED',
    'CANDIDATE_SET_CHANGED',
    'CANDIDATE_IDENTITY_INFERRED',
    'TEXT_STATE_CHANGED',
    'STABILITY_INTERVAL_CLOSED',
    'EXTRACTION_COMPLETED',
    'STRUCTURAL_VERIFICATION_EVALUATED',
    'ANSWER_COMPLETENESS_EVALUATED',
    'COMPLETION_HYPOTHESIS_EVALUATED',
    'TERMINAL_DEADLINE_REACHED',
    'FINALIZATION_POLICY_EVALUATED',
    'POLICY_OVERRIDE_APPLIED'
  ];
  const ledger = ledgerForTypes(types);
  const options = {
    canonicalLedger: true,
    runSessionId: 'synthetic-run',
    exportedAt: 12000,
    extensionVersion: '2.81.168',
    sampleData: true
  };
  const all = await ProofTelemetry.buildAllPresets(ledger, options);
  fs.writeFileSync(path.join(root, 'all-presets.example.json'), `${JSON.stringify(all, null, 2)}\n`);

  const registry = ProofTelemetry.dependencyRegistrySnapshot();
  fs.writeFileSync(path.join(root, 'registry', 'report-dependency-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);

  fs.mkdirSync(presetsDir, { recursive: true });
  for (const filename of fs.readdirSync(presetsDir).filter((name) => name.endsWith('.example.json'))) {
    fs.unlinkSync(path.join(presetsDir, filename));
  }
  for (const reportType of ProofTelemetry.REPORT_TYPES) {
    let reportLedger = ledgerForTypes(Contracts.normalizedSlots(reportType).map((slot) => (
      reportType !== 'false-success' && slot.eventTypes.includes('MISSING_EVIDENCE_RECORDED')
        ? 'MISSING_EVIDENCE_RECORDED'
        : slot.eventTypes[0]
    )), reportType);
    if (reportType === 'old-answer') {
      const priorIncidentRef = 'incident:synthetic-run|1|GPT|synthetic-previous-dispatch|0';
      const prior = ['EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'].map((eventType, index) => {
        const source = reportLedger.find((item) => item.eventType === eventType);
        return {
          ...JSON.parse(JSON.stringify(source)),
          eventId: `${source.eventId}-prior`,
          dispatchId: 'synthetic-previous-dispatch',
          generationEpoch: 0,
          payload: {
            ...JSON.parse(JSON.stringify(source.payload)),
            typed: eventType === 'EXTRACTION_COMPLETED'
              ? { kind: 'extraction', state: 'completed' }
              : { kind: 'terminal_action', state: 'SUCCESS' },
            metadata: { ...source.payload.metadata, answerIdentity: 'current_dispatch', terminalStatus: 'SUCCESS' }
          },
          seq: index + 1,
          ingestSeq: index + 1
        };
      });
      reportLedger.forEach((item, index) => {
        item.seq = index + 3;
        item.ingestSeq = index + 3;
        if (item.eventType === 'MODEL_TERMINAL_RECORDED') item.payload.metadata.priorIncidentRef = priorIncidentRef;
      });
      reportLedger = [...prior, ...reportLedger];
    }
    const report = await ProofTelemetry.buildStandaloneReport(reportLedger, {
      ...options,
      modelId: 'GPT',
      reportType
    });
    fs.writeFileSync(path.join(presetsDir, `${reportType}.example.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
