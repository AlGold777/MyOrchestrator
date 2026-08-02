// Semantic comparator for embedded all-presets reports and standalone reports.
(function initProofTelemetrySemanticComparator(root) {
  'use strict';

  const ProofTelemetry = root.ProofOrientedTelemetry
    || (typeof require === 'function' ? require('./proof-oriented-telemetry.js') : null);

  function sortedUnique(values) {
    return Array.from(new Set((values || []).filter((value) => value !== undefined && value !== null))).sort();
  }

  function normalizeLimitations(limitations) {
    return (limitations || []).map((item) => ({
      code: item?.code || item?.limitationId || null,
      impact: item?.impact || null,
      affectedReportTypes: sortedUnique(item?.affectedReportTypes || [])
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  function normalizeViolations(violations) {
    return (violations || []).map((item) => ({
      invariantId: item?.invariantId || null,
      eventId: item?.eventId || null,
      message: item?.message || null
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  function normalizeSibling(rule, incidentId = null) {
    const predicateResults = (rule?.evaluation?.predicateResults || [])
      .filter((item) => !incidentId || !item.incidentId || item.incidentId === incidentId)
      .map((item) => ({
        modelId: item.modelId || null,
        observedValue: item.observedValue ?? null,
        known: item.known === true,
        matched: item.matched === true
      }));
    return {
      reportType: rule?.reportType || null,
      relation: rule?.relation || null,
      relationClassification: rule?.relationClassification || null,
      requestIf: rule?.requestIf || null,
      matched: predicateResults.some((item) => item.matched),
      predicateResults
    };
  }

  function normalizeSlots(slots, eventIdForSeq = null) {
    return (slots || []).map((slot) => ({
      slotId: slot.slotId,
      status: slot.status,
      effectiveCriticality: slot.effectiveCriticality,
      requiredIfMatched: slot.requiredIfMatched === true,
      eventIds: sortedUnique(slot.eventIds || (slot.eventSeqs || []).map(eventIdForSeq).filter(Boolean)),
      matchedEventCount: Number(slot.matchedEventCount || 0),
      selectedEventCount: Number(slot.selectedEventCount || 0)
    })).sort((left, right) => left.slotId.localeCompare(right.slotId));
  }

  function conclusionsFromSlots(slots) {
    return {
      satisfiedSlotIds: slots.filter((slot) => slot.status === 'satisfied').map((slot) => slot.slotId).sort(),
      blockedSlotIds: slots.filter((slot) => ['critical', 'required'].includes(slot.effectiveCriticality)
        && slot.status !== 'satisfied').map((slot) => slot.slotId).sort()
    };
  }

  function normalizeNoDelivery(value = {}) {
    return {
      occurrenceVerdict: value.occurrenceVerdict ?? null,
      causeVerdict: value.causeVerdict ?? null,
      occurrenceCompleteness: value.occurrenceCompleteness || null,
      causeCompleteness: value.causeCompleteness || null,
      evaluationBoundary: value.evaluationBoundary || null,
      resolutionState: value.resolutionState || null,
      deliveryStages: value.deliveryStages || [],
      lastSuccessfulStage: value.lastSuccessfulStage || null,
      firstObservedUnsuccessfulStage: value.firstObservedUnsuccessfulStage || null,
      failureRange: value.failureRange || null,
      failureStageCode: value.failureStageCode || null,
      mechanismCauseCode: value.mechanismCauseCode || null,
      observabilityLimitationCodes: sortedUnique(value.observabilityLimitationCodes || [])
    };
  }

  function normalizeEmbedded(container, reportType, incidentId) {
    const report = container?.reports?.[reportType];
    const incident = container?.derivedViews?.['incident-timeline']?.data?.[incidentId];
    const summary = report?.diagnosticSummary?.incidents?.[incidentId];
    const applicability = report?.reportDescriptor?.applicability?.byIncident?.[incidentId];
    if (!report || !incident || !summary || !applicability) throw new Error(`embedded semantics missing for ${reportType}/${incidentId}`);
    const bySeq = new Map((container?.ledger?.events || []).map((event) => [Number(event.seq), event.eventId]));
    const slots = normalizeSlots(summary.evidenceSlots, (seq) => bySeq.get(Number(seq)) || null);
    const arbitration = container?.diagnosisArbitration?.byIncident?.[incidentId] || {};
    const relation = arbitration?.relations?.[reportType]
      || { explanationRole: applicability.explanationRole || 'not_applicable', causedBy: applicability.causedBy || null };
    return {
      reportType,
      incident: { incidentId, ...(incident.incidentScope || {}) },
      applicabilityStatus: summary.applicabilityStatus,
      diagnosticVerdict: summary.diagnosticVerdict,
      sufficiency: summary.sufficiency,
      slots,
      conclusions: conclusionsFromSlots(slots),
      invariantViolations: normalizeViolations(summary.invariantViolations),
      limitations: normalizeLimitations(summary.limitations),
      diagnosisArbitration: {
        primaryDiagnosis: arbitration.primaryDiagnosis || applicability.primaryDiagnosis || null,
        confirmedDiagnoses: sortedUnique(arbitration.confirmedDiagnoses || []),
        explanationRole: relation.explanationRole || 'not_applicable',
        causedBy: relation.causedBy || null
      },
      siblings: (report.siblings || []).map((rule) => normalizeSibling(rule, incidentId)),
      registry: {
        version: report.reportDescriptor.dependencyRegistryVersion,
        hash: report.reportDescriptor.dependencyRegistryHash,
        reportVersion: report.reportDescriptor.reportVersion
      },
      ...(reportType === 'no-delivery'
        ? { noDelivery: normalizeNoDelivery(report?.diagnosticSummary?.noDeliveryByIncident?.[incidentId]) }
        : {})
    };
  }

  function normalizeStandalone(report) {
    const summary = report?.diagnosticSummary;
    if (!report || !summary || !report?.correlation?.incidentId) throw new Error('standalone semantics are incomplete');
    const slots = normalizeSlots(summary.evidenceSlots);
    return {
      reportType: report.reportDescriptor.reportType,
      incident: { incidentId: report.correlation.incidentId,
        runSessionId: report.correlation.runSessionId,
        runGeneration: report.correlation.runGeneration,
        modelId: report.correlation.modelId,
        dispatchId: report.correlation.dispatchId,
        generationEpoch: report.correlation.generationEpoch },
      applicabilityStatus: summary.applicability.status,
      diagnosticVerdict: summary.diagnosticVerdict,
      sufficiency: summary.sufficiency,
      slots,
      conclusions: conclusionsFromSlots(slots),
      invariantViolations: normalizeViolations(report.contradictions),
      limitations: normalizeLimitations(report.reportDescriptor.limitations),
      diagnosisArbitration: {
        primaryDiagnosis: report.reportDescriptor.diagnosisArbitration?.primaryDiagnosis || null,
        confirmedDiagnoses: sortedUnique(report.reportDescriptor.diagnosisArbitration?.confirmedDiagnoses || []),
        explanationRole: report.reportDescriptor.diagnosisArbitration?.explanationRole || 'not_applicable',
        causedBy: report.reportDescriptor.diagnosisArbitration?.causedBy || null
      },
      siblings: (report.siblings || []).map((rule) => normalizeSibling(rule)),
      registry: {
        version: report.reportDescriptor.dependencyRegistryVersion,
        hash: report.reportDescriptor.dependencyRegistryHash,
        reportVersion: report.reportDescriptor.reportVersion
      },
      ...(report.reportDescriptor.reportType === 'no-delivery'
        ? { noDelivery: normalizeNoDelivery(summary) }
        : {})
    };
  }

  function differences(left, right, currentPath = '$', output = []) {
    if (ProofTelemetry.stableStringify(left) === ProofTelemetry.stableStringify(right)) return output;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
      || Array.isArray(left) !== Array.isArray(right)) {
      output.push({ path: currentPath, embedded: left, standalone: right });
      return output;
    }
    if (Array.isArray(left)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) differences(left[index], right[index], `${currentPath}[${index}]`, output);
      return output;
    }
    sortedUnique([...Object.keys(left), ...Object.keys(right)]).forEach((key) => {
      differences(left[key], right[key], `${currentPath}.${key}`, output);
    });
    return output;
  }

  function compare(embedded, standalone) {
    const found = differences(embedded, standalone);
    return { equivalent: found.length === 0, differences: found, embedded, standalone };
  }

  async function compareContainer(container, options = {}) {
    if (container?.containerType !== 'all-presets') throw new Error('semantic comparison requires all-presets container');
    const events = container?.ledger?.events || [];
    const incidentEntries = Object.entries(container?.derivedViews?.['incident-timeline']?.data || {});
    const reportTypes = options.reportTypes || ProofTelemetry.REPORT_TYPES;
    const results = [];
    for (const [incidentId, incident] of incidentEntries) {
      for (const reportType of reportTypes) {
        const standalone = await ProofTelemetry.buildStandaloneReport(events, {
          canonicalLedger: true,
          exportedAt: Number(options.exportedAt || Date.parse(container?.manifest?.createdAt) || Date.now()),
          extensionVersion: container?.sharedConfig?.extensionVersion || 'unknown',
          modelId: incident.modelId,
          incidentId,
          reportType
        });
        results.push({ reportType, incidentId, ...compare(
          normalizeEmbedded(container, reportType, incidentId),
          normalizeStandalone(standalone)
        ) });
      }
    }
    return {
      equivalent: results.every((result) => result.equivalent),
      comparisonCount: results.length,
      results
    };
  }

  const api = Object.freeze({
    normalizeEmbedded,
    normalizeStandalone,
    differences,
    compare,
    compareContainer
  });
  root.ProofTelemetrySemanticComparator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
