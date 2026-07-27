// shared/telemetry-export.js
// Run summary builder for telemetry exports.
//
// Defect background (run 1781134505984, v2.74.97): the devtools JSON export
// serialized only the UI-filtered table view, so with no active filter it
// contained round events alone — no MODEL_FINAL / FINALIZATION_DECISION for any
// model — while the markdown "All Logs" export of the same run had them. A JSON
// export must be self-sufficient: full run-scoped events plus a per-model
// outcome summary and an explicit marker when the export was taken mid-run.

(function initTelemetryExport(root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const RUN_SUMMARY_GROUP_KEY = '<RUN_SUMMARY>';

  const TERMINAL_STATUSES = [
    'COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN',
    'ERROR', 'CRITICAL_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED',
    'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT',
    'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'
  ];

  function normalizeLabel(event) {
    return String(event?.label || event?.meta?.event || '').trim();
  }

  function resolvePlatformName(event) {
    return String(
      event?.platform
      || event?.llmName
      || event?.meta?.llmName
      || event?.meta?.platform
      || ''
    ).trim();
  }

  function extractStatusToken(text) {
    const token = String(text || '').trim().split(/[\s|:]+/)[0] || '';
    const upper = token.toUpperCase();
    return TERMINAL_STATUSES.includes(upper) ? upper : null;
  }

  // Terminal signal priority: explicit MODEL_FINAL beats finalization decisions,
  // which beat plain status labels, so a late "Status:" echo cannot override the
  // recorded final outcome.
  function resolveTerminalSignal(event) {
    const label = normalizeLabel(event);
    if (!label) return null;
    if (label === 'MODEL_FINAL') {
      const status = extractStatusToken(event?.details) || extractStatusToken(event?.meta?.finalStatus);
      return status ? { status, source: 'MODEL_FINAL', weight: 3 } : null;
    }
    if (label === 'FINALIZATION_DECISION') {
      const detail = String(event?.details || '');
      if (!/accepted/i.test(detail)) return null;
      const status = extractStatusToken(detail);
      return status ? { status, source: 'FINALIZATION_DECISION', weight: 2 } : null;
    }
    if (/^Status:\s*/i.test(label)) {
      const status = extractStatusToken(label.replace(/^Status:\s*/i, ''));
      return status ? { status, source: 'STATUS_LABEL', weight: 1 } : null;
    }
    const directStatus = extractStatusToken(label);
    if (directStatus && String(event?.type || '').toUpperCase() === 'TELEMETRY') {
      return { status: directStatus, source: 'TERMINAL_LABEL', weight: 1 };
    }
    return null;
  }

  function buildModelOutcome(platform, events = []) {
    let best = null;
    let lastEventTs = 0;
    let latestObservedTextLength = 0;
    let maxObservedTextLength = 0;
    let latestLifecycleState = null;
    let latestLifecycleAt = 0;
    let tabClosed = null;
    events.forEach((event) => {
      const ts = Number(event?.ts || 0) || 0;
      if (ts > lastEventTs) lastEventTs = ts;
      const label = normalizeLabel(event);
      const observedLength = Number(
        event?.meta?.textLength
        || event?.meta?.answerLength
        || event?.meta?.answerLen
        || 0
      ) || 0;
      if (observedLength > 0 && ts >= latestLifecycleAt) {
        latestObservedTextLength = observedLength;
      }
      maxObservedTextLength = Math.max(maxObservedTextLength, observedLength);
      if (/^ANSWER_(START_DETECTED|GENERATING|TEXT_STABLE|COMPLETE_DETECTED|PARTIAL_ON_TIMEOUT|COMPLETE_TIMEOUT)$/.test(label)) {
        latestLifecycleState = event?.meta?.state || label;
        latestLifecycleAt = Math.max(latestLifecycleAt, ts);
      }
      if (label === 'TAB_CLOSED' && (!tabClosed || ts >= tabClosed.ts)) {
        tabClosed = {
          ts,
          closureState: event?.meta?.closureState || event?.details || 'tab_closed',
          generationActive: event?.meta?.generationActive ?? null,
          answerLength: Number(event?.meta?.answerLength || 0) || 0
        };
      }
      const signal = resolveTerminalSignal(event);
      if (!signal) return;
      if (!best
        || signal.weight > best.weight
        || (signal.weight === best.weight && ts >= best.ts)) {
        best = { ...signal, ts };
      }
    });
    const generationActive = !best && (
      latestLifecycleState === 'GENERATING'
      || latestLifecycleState === 'ANSWER_STARTED'
      || latestLifecycleState === 'ANSWER_GENERATING'
      || latestLifecycleState === 'ANSWER_START_DETECTED'
    );
    const observedState = tabClosed?.closureState === 'tab_closed_during_generation'
      ? 'tab_closed_during_generation'
      : generationActive && latestObservedTextLength > 0
        ? 'generating_partial_answer'
        : generationActive
          ? 'generating'
          : best
            ? 'terminal'
            : latestObservedTextLength > 0
              ? 'answer_observed_without_terminal'
              : 'no_terminal_outcome';
    const consistencyIssues = [];
    const finalEvent = [...events].reverse().find((event) => normalizeLabel(event) === 'MODEL_FINAL');
    if (
      best?.status === 'SUCCESS'
      && String(finalEvent?.meta?.doneReason || '').toLowerCase() === 'error'
    ) {
      consistencyIssues.push('success_with_error_done_reason');
    }
    return {
      ts: best?.ts || lastEventTs || Date.now(),
      type: 'SUMMARY',
      label: 'MODEL_OUTCOME',
      platform,
      details: best ? best.status : 'no_terminal_outcome',
      level: best ? 'info' : 'warning',
      meta: {
        llmName: platform,
        terminal: Boolean(best),
        finalStatus: best?.status || null,
        finalSignalSource: best?.source || null,
        finalizedAt: best?.ts || null,
        lastEventTs: lastEventTs || null,
        eventsCount: events.length,
        observedState,
        generationActive,
        latestLifecycleState,
        latestLifecycleAt: latestLifecycleAt || null,
        latestObservedTextLength,
        maxObservedTextLength,
        tabClosed,
        consistencyIssues
      }
    };
  }

  // groups: { '<GPT>': [events], ... } — the same shape the JSON export already
  // uses. Returns the summary group to append under RUN_SUMMARY_GROUP_KEY.
  function buildRunSummaryGroup(groups = {}, { runSessionId = null, exportedAt = Date.now() } = {}) {
    const summaryEntries = [];
    const pendingModels = [];
    const pendingStages = {};
    const modelNames = [];
    Object.entries(groups || {}).forEach(([groupKey, events]) => {
      const platform = String(groupKey || '').replace(/^<|>$/g, '');
      if (!platform || platform === 'ROUNDS' || platform === 'unknown') return;
      modelNames.push(platform);
      const outcome = buildModelOutcome(platform, Array.isArray(events) ? events : []);
      summaryEntries.push(outcome);
      if (!outcome.meta.terminal) {
        pendingModels.push(platform);
        pendingStages[platform] = {
          stage: outcome.meta.observedState || 'unknown',
          lifecycle: outcome.meta.latestLifecycleState || null,
          latestObservedTextLength: outcome.meta.latestObservedTextLength || 0,
          reason: outcome.details || 'no_terminal_outcome'
        };
      }
    });
    summaryEntries.push({
      ts: Number(exportedAt) || Date.now(),
      type: 'SUMMARY',
      label: 'RUN_EXPORT_STATE',
      platform: 'RUN',
      details: pendingModels.length ? 'export_during_active_run' : 'run_complete',
      level: pendingModels.length ? 'warning' : 'info',
      meta: {
        schemaVersion: SCHEMA_VERSION,
        runSessionId: runSessionId || null,
        exportedAt: Number(exportedAt) || Date.now(),
        models: modelNames,
        pendingModels,
        pendingStages,
        exportComplete: pendingModels.length === 0,
        complete: pendingModels.length === 0
      }
    });
    return summaryEntries;
  }

  function appendRunSummary(groups = {}, options = {}) {
    const next = { ...(groups || {}) };
    next[RUN_SUMMARY_GROUP_KEY] = buildRunSummaryGroup(groups, options);
    return next;
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    RUN_SUMMARY_GROUP_KEY,
    resolveTerminalSignal,
    buildModelOutcome,
    buildRunSummaryGroup,
    appendRunSummary
  });

  root.TelemetryExport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
