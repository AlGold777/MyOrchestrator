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
  return ProofTelemetry.buildLedger(uniqueTypes.map((type, index) => event(type, 1000 + index * 500, {
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
    if (item.eventType === 'EXTRACTION_COMPLETED') {
      metadata.length = reportType === 'cutted' ? 60 : 120;
      typed = { kind: 'extraction', state: reportType === 'empty' ? 'failed' : 'completed' };
    }
    if (item.eventType === 'ANSWER_COMPLETENESS_EVALUATED') {
      typed = { kind: 'answer_completeness', state: reportType === 'cutted' ? 'probably_truncated' : 'unknown' };
    }
    if (item.eventType === 'SUBMISSION_EVIDENCE_CHANGED') typed = { kind: 'submission', state: reportType === 'prompt-not-sent' ? 'failed' : 'confirmed' };
    if (reportType === 'false-success' && item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED') {
      directPayload = { conclusion: 'contradicted', growthChars: 30, growthPct: 25, hashChanged: true };
    }
    if (reportType === 'old-answer' && item.eventType === 'EXTRACTION_COMPLETED') metadata.answerIdentity = 'previous_dispatch';
    if (reportType === 'old-answer' && item.eventType === 'MODEL_TERMINAL_RECORDED') metadata.answerEvidenceDispatchId = 'synthetic-previous-dispatch';
    return {
      ...item,
      clock: {
        ...item.clock,
        producerEpochId: 'synthetic-document-epoch',
        observedAtLocalMonoMs: item.wallTs - 1000
      },
      payload: { ...item.payload, typed, metadata, ...directPayload }
    };
  });
}

async function main() {
  const types = [
    'DISPATCH_BASELINE_CAPTURED',
    'SUBMIT_ACTION_OBSERVED',
    'SUBMISSION_EVIDENCE_CHANGED',
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
    extensionVersion: '2.81.144',
    sampleData: true
  };
  const all = await ProofTelemetry.buildAllPresets(ledger, options);
  fs.writeFileSync(path.join(root, 'all-presets.example.json'), `${JSON.stringify(all, null, 2)}\n`);

  const registry = {
    registryVersion: '4.0.0',
    predicateLanguageVersion: '1.0.0',
    maxEscalationDepth: 2,
    applicability: Object.fromEntries(ProofTelemetry.REPORT_TYPES.map((reportType) => [
      reportType,
      Contracts.normalizedApplicability(reportType)
    ])),
    rules: Object.fromEntries(Object.entries(ProofTelemetry.SIBLING_RULES).map(([source, rules]) => [
      source,
      rules.map(([reportType, predicatePath, operator, value]) => ({
        reportType,
        relation: 'diagnostic-dependency',
        priority: 'required',
        requestIf: { any: [{ path: predicatePath, operator, value }] },
        antiLoop: { sourceReportType: source, requestTargetOnlyOnce: true }
      }))
    ]))
  };
  fs.writeFileSync(path.join(root, 'registry', 'report-dependency-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);

  fs.mkdirSync(presetsDir, { recursive: true });
  for (const filename of fs.readdirSync(presetsDir).filter((name) => name.endsWith('.example.json'))) {
    fs.unlinkSync(path.join(presetsDir, filename));
  }
  for (const reportType of ProofTelemetry.REPORT_TYPES) {
    const reportLedger = ledgerForTypes(Contracts.normalizedSlots(reportType).map((slot) => slot.eventTypes[0]), reportType);
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
