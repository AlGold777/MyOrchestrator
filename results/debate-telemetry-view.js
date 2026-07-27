// DOM projection for the Disput diagnostics tab. Runtime control is forbidden here.
(function initDebateTelemetryView(root) {
  'use strict';

  const problemContextFilter = root.ProblemContextFilter
    || (typeof module !== 'undefined' && module.exports ? require('../shared/problem-context-filter') : null);
  const clear = (node) => { while (node?.firstChild) node.removeChild(node.firstChild); };
  const text = (tag, value, className = '') => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value == null ? '' : value);
    return el;
  };
  const duration = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : '—';
  const syncFilter = (doc, id, values, allLabel) => {
    const select = doc.getElementById(id);
    if (!select) return 'all';
    const previous = select.value || 'all';
    const normalized = Array.from(new Set(values.filter(Boolean).map(String))).sort();
    const signature = normalized.join('|');
    if (select.dataset.values !== signature) {
      clear(select);
      const all = doc.createElement('option'); all.value = 'all'; all.textContent = allLabel; select.appendChild(all);
      normalized.forEach((value) => { const option = doc.createElement('option'); option.value = value; option.textContent = value; select.appendChild(option); });
      select.dataset.values = signature;
      select.value = normalized.includes(previous) ? previous : 'all';
    }
    return select.value || 'all';
  };
  const renderTable = (target, headers, rows, emptyText) => {
    if (!target) return;
    clear(target);
    if (!rows.length) { target.appendChild(text('p', emptyText, 'diag-empty')); return; }
    const table = document.createElement('table');
    table.className = 'telemetry-rounds-table disput-trace-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => headerRow.appendChild(text('th', header)));
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.className) tr.className = row.className;
      row.cells.forEach((cell) => tr.appendChild(text('td', cell)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    target.appendChild(table);
  };

  function render(report, doc = document) {
    if (!report || !doc) return false;
    const onlyProblems = doc.getElementById('disput-only-problems')?.checked === true;
    const eventModels = report.events.flatMap((event) => [event.payload?.model, event.payload?.participant].concat(event.payload?.participants || [])).filter(Boolean);
    const stageFilter = syncFilter(doc, 'disput-stage-filter', report.stageExecutions.map((stage) => stage.stageId), 'All stages');
    const modelFilter = syncFilter(doc, 'disput-model-filter', report.participantExecutions.map((item) => item.participantId).concat(eventModels), 'All models');
    const typeFilter = syncFilter(doc, 'disput-type-filter', report.events.map((event) => event.eventType), 'All event types');
    const severityFilter = doc.getElementById('disput-severity-filter')?.value || 'all';
    const matchesStage = (stageId) => stageFilter === 'all' || String(stageId || '') === stageFilter;
    const matchesModel = (models) => modelFilter === 'all' || (Array.isArray(models) ? models : [models]).map(String).includes(modelFilter);
    const health = doc.getElementById('disput-health-summary');
    if (health) {
      clear(health);
      const grid = doc.createElement('div');
      grid.className = 'disput-health-grid';
      [
        ['Health', report.health.classification], ['Outcome', report.health.terminalOutcome],
        ['Topology', report.metadata.topology || '—'], ['Preset', report.metadata.presetId || '—'],
        ['Duration', duration(report.runOutcome.durationMs)], ['Stages', `${report.stageExecutions.filter((stage) => ['success', 'skipped'].includes(stage.status)).length}/${report.stageExecutions.length}`],
        ['Problems', report.diagnoses.length], ['Manual recovery', report.health.manualRecoveryCount],
        ['Forced completion', report.health.forcedCompletionCount], ['Data', report.metadata.dataCompleteness]
      ].forEach(([label, value]) => {
        const item = doc.createElement('div'); item.className = 'disput-health-item';
        item.appendChild(text('span', label, 'disput-health-label'));
        item.appendChild(text('strong', value, `disput-health-value disput-health-${report.health.severity}`));
        grid.appendChild(item);
      });
      health.appendChild(grid);
    }
    const visibleDiagnoses = report.diagnoses.filter((item) => matchesStage(item.affectedStageId) && matchesModel(item.affectedParticipant || []) && (severityFilter === 'all' || item.severity === severityFilter));
    renderTable(doc.getElementById('disput-problems'), ['Severity', 'Code', 'Stage', 'Model', 'Evidence'], visibleDiagnoses.map((item) => ({
      className: `disput-severity-${item.severity}`,
      cells: [item.severity, item.code, item.affectedStageId || '—', item.affectedParticipant || '—', item.summary || item.reasonCode || '—']
    })), 'No diagnosed problems.');
    const stageBase = report.stageExecutions.filter((stage) => matchesStage(stage.stageId) && matchesModel((stage.expected?.participants || []).concat(stage.actual?.participants || [])));
    const visibleStages = onlyProblems ? stageBase.filter((stage) => stage.deviations.length || ['failed', 'skipped'].includes(stage.status)) : stageBase;
    renderTable(doc.getElementById('disput-plan-actual'), ['Stage', 'Kind', 'Expected', 'Actual', 'Time', 'Status', 'Deviation'], visibleStages.map((stage) => ({
      className: `disput-stage-${stage.status}`,
      cells: [stage.stageId, stage.kind || '—', (stage.expected?.participants || []).join(', ') || '—', (stage.actual?.participants || []).join(', ') || '—', duration(stage.durationMs), stage.status, stage.deviations.join(', ') || '—']
    })), 'No compiled Debate plan has been observed.');
    const participantBase = report.participantExecutions.filter((item) => matchesModel(item.participantId));
    const visibleParticipants = onlyProblems ? participantBase.filter((item) => item.recoveries || item.submitStatus === 'failed') : participantBase;
    renderTable(doc.getElementById('disput-participants'), ['Model', 'Stages', 'Submit', 'Completion', 'Recovery', 'Final'], visibleParticipants.map((item) => ({
      cells: [item.participantId, `${item.completedStages}/${item.expectedStages}`, item.submitStatus, item.completionStatus, String(item.recoveries), item.finalStatus || '—']
    })), 'No participant evidence.');
    const critical = doc.getElementById('disput-critical-path');
    if (critical) {
      clear(critical);
      critical.appendChild(text('p', report.criticalPath ? `Slowest stage: ${report.criticalPath.stageId} (${duration(report.criticalPath.durationMs)})` : 'Critical path is not available yet.'));
      const waits = report.barriers.filter((barrier) => barrier.outcome === 'waiting' || barrier.outcome === 'timeout' || Number(barrier.durationMs) > 0);
      if (waits.length) {
        critical.appendChild(text('p', `Barrier waits: ${waits.length}`));
        waits.forEach((barrier) => critical.appendChild(text('p', `${barrier.stageId}: ${duration(barrier.durationMs)} · critical ${barrier.criticalParticipant || 'unknown'} · pending ${(barrier.pendingParticipants || []).join(', ') || 'none'}`)));
      }
    }
    const eventBase = report.events.filter((event) => {
      const models = [event.payload?.model, event.payload?.participant].concat(event.payload?.participants || []).filter(Boolean);
      return matchesStage(event.correlation?.stageId) && matchesModel(models) && (typeFilter === 'all' || event.eventType === typeFilter) && (severityFilter === 'all' || event.severity === severityFilter);
    });
    const visibleEvents = onlyProblems && problemContextFilter
      ? problemContextFilter.filterWithContext(eventBase, {
        getContextKey: (event) => event?.correlation?.stageId || event?.stageId || '__unscoped__'
      })
      : (onlyProblems ? eventBase.filter((event) => ['warning', 'high', 'critical'].includes(event.severity)) : eventBase);
    renderTable(doc.getElementById('disput-raw-events'), ['Seq', 'Time', 'Type', 'Source', 'Stage', 'Reason'], visibleEvents.map((event) => ({
      className: `disput-severity-${event.severity}`,
      cells: [event.receivedSeq, new Date(event.sourceTimestamp).toLocaleTimeString(), event.eventType, event.source, event.correlation?.stageId || '—', event.reasonCode || '—']
    })), 'No Debate trace events.');
    const status = doc.getElementById('disput-trace-status');
    if (status) status.textContent = `${report.integrity.eventsTotal} events · ${report.metadata.dataCompleteness}`;
    return true;
  }

  const api = Object.freeze({ render });
  root.DebateTelemetryView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
