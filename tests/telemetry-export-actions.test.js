const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');
const messageRouterSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
const proofStoreSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'proof-telemetry-store.js'), 'utf8');
const exportBootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'results-telemetry-export-bootstrap.js'), 'utf8');

describe('Telemetry export actions', () => {
  test('both result pages expose the extension-native sanitized B1 capture action', () => {
    expect(html).toContain('id="capture-b1-skeletons-btn"');
    expect(pipelineHtml).toContain('id="capture-b1-skeletons-btn"');
    expect(resultsSource).toContain("type: 'CAPTURE_B1_SANITIZED_SKELETONS'");
    expect(resultsSource).toContain("downloadDiagnosticsJson('B1 Sanitized Answer Skeletons'");
  });

  test('Telemetry exposes exactly the Platform and Tasks filters', () => {
    const reportTypes = [
      'cutted',
      'false-success',
      'old-answer',
      'no-delivery',
      'prompt-not-inserted',
      'prompt-not-sent',
      'late-end'
    ];
    [html, pipelineHtml].forEach((page) => {
      const start = page.indexOf('<div class="telemetry-filters">');
      const end = page.indexOf('</div>', start);
      const filters = page.slice(start, end);
      expect((filters.match(/<select /g) || []).length).toBe(2);
      expect(filters).toContain('id="telemetry-platform-select"');
      expect(filters).toContain('id="telemetry-task-select"');
      expect(filters).not.toContain('telemetry-type-select');
      expect(filters).not.toContain('telemetry-preset-select');
      expect(filters).not.toContain('telemetry-only-problems');
      const taskStart = filters.indexOf('id="telemetry-task-select"');
      const taskEnd = filters.indexOf('</select>', taskStart);
      const taskValues = Array.from(filters.slice(taskStart, taskEnd).matchAll(/<option value="([^"]+)"/g), (match) => match[1]);
      expect(taskValues).toEqual(['all', ...reportTypes]);
    });
  });

  test('Platform options are not restricted to currently selected models', () => {
    expect(devtoolsSource).toContain('TELEMETRY_PLATFORM_CATALOG.forEach(pushOption)');
    expect(devtoolsSource).toContain('event?.modelId || event?.platform || event?.llmName');
    expect(devtoolsSource).not.toContain('if (selectedNames.length) {\n            selectedNames.forEach(pushOption);');
  });

  test('JSON download icon precedes the textual MD export without changing action ids', () => {
    const jsonAt = html.indexOf('id="telemetry-export-json-btn"');
    const mdAt = html.indexOf('id="export-all-logs-md-telemetry"');
    expect(jsonAt).toBeGreaterThan(-1);
    expect(mdAt).toBeGreaterThan(jsonAt);
    const jsonButton = html.slice(html.lastIndexOf('<button', jsonAt), html.indexOf('</button>', jsonAt));
    expect(jsonButton).toContain('class="diag-icon-btn"');
    expect(jsonButton).toContain('class="ti ti-download"');
    expect(jsonButton).toContain('aria-label="Export telemetry as JSON"');
    expect(jsonButton).not.toContain('>Json');
  });

  test('JSON export loads and builds the proof-oriented schema 5 container', () => {
    expect(html).toContain('src="shared/proof-oriented-telemetry.js"');
    expect(pipelineHtml).toContain('src="shared/proof-oriented-telemetry.js"');
    expect(html).not.toContain('src="shared/telemetry-export.js"');
    expect(pipelineHtml).not.toContain('src="shared/telemetry-export.js"');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry.buildAllPresets');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry.buildStandaloneReport');
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry?.REPORT_EVENT_TYPES');
    expect(devtoolsSource).toContain("type: 'GET_PROOF_TELEMETRY_SNAPSHOT'");
    expect(devtoolsSource).toContain('canonicalLedger: true');
    expect(devtoolsSource).not.toContain('nativeLedgerAvailable ? proofSnapshot.events : grouped');
    expect(devtoolsSource).toContain("modelId !== 'system' && modelId !== platformFilter");
    expect(devtoolsSource).not.toContain("Select a platform for a standalone task report");
    expect(devtoolsSource).toContain('selectIncidentReports?.(canonicalEvents');
    expect(devtoolsSource).toContain('platform: selectedModelId');
    expect(devtoolsSource).not.toContain("platformFilter === 'all' && selectedSet.size && modelId !== 'system'");
    expect(devtoolsSource).toContain('describeSelectedIncident(selection)');
    expect(devtoolsSource).toContain('targets.length');
    expect(devtoolsSource).toContain('incident-${target.rank + 1}');
    expect(devtoolsSource).toContain("proofTelemetryShadowCompare");
  });

  test('JSON snapshot has a short queue wait and exports a marked committed fallback', () => {
    expect(messageRouterSource).toContain('Promise.race([barrierSnapshot, barrierDeadline])');
    expect(messageRouterSource).toContain('setTimeout(() => resolve(timeoutToken), 750)');
    expect(messageRouterSource).toContain('ledger.snapshotCommitted?.({');
    expect(messageRouterSource).toContain('success: true,\n                ...committed,');
    expect(messageRouterSource).not.toContain("error: 'proof_telemetry_snapshot_incomplete'");
    expect(devtoolsSource).not.toContain("proofSnapshot?.error === 'proof_telemetry_snapshot_incomplete'");
    expect(devtoolsSource).toContain('Exporting committed snapshot');
    expect(devtoolsSource).toContain('snapshotConsistency: proofSnapshot.snapshotConsistency');
    expect(devtoolsSource).toContain('snapshotBarrierTimedOut: proofSnapshot.barrierTimedOut === true');
    expect(proofStoreSource).toContain("durability: 'relaxed'");
    expect(proofStoreSource).not.toContain("durability: 'strict'");
  });

  test('JSON snapshot bypasses unrelated background initialization', () => {
    const listenerAt = messageRouterSource.indexOf('chrome.runtime.onMessage.addListener');
    const earlySnapshotAt = messageRouterSource.indexOf("if (message?.type === 'GET_PROOF_TELEMETRY_SNAPSHOT')", listenerAt);
    const initializationGateAt = messageRouterSource.indexOf('if (!isInitialStateReady())', listenerAt);
    expect(listenerAt).toBeGreaterThan(-1);
    expect(earlySnapshotAt).toBeGreaterThan(listenerAt);
    expect(initializationGateAt).toBeGreaterThan(earlySnapshotAt);
    expect(messageRouterSource).toContain('void respondProofTelemetrySnapshot(message, sendResponse)');
  });

  test('both result pages install the JSON export bootstrap before the heavy results script', () => {
    [html, pipelineHtml].forEach((page) => {
      const bootstrapAt = page.indexOf('src="results-telemetry-export-bootstrap.js"');
      const resultsAt = page.indexOf('src="results.js"');
      expect(bootstrapAt).toBeGreaterThan(-1);
      expect(resultsAt).toBeGreaterThan(bootstrapAt);
    });
    expect(exportBootstrapSource).toContain("event.stopImmediatePropagation()");
    expect(exportBootstrapSource).toContain("new CustomEvent('telemetry-export-json-request')");
    expect(devtoolsSource).toContain("addEventListener('telemetry-export-json-request'");
  });

  test('Disput JSON download icon precedes the textual MD export', () => {
    const jsonAt = html.indexOf('id="disput-export-json"');
    const mdAt = html.indexOf('id="disput-export-md"');
    expect(jsonAt).toBeGreaterThan(-1);
    expect(mdAt).toBeGreaterThan(jsonAt);
    const jsonButton = html.slice(html.lastIndexOf('<button', jsonAt), html.indexOf('</button>', jsonAt));
    expect(jsonButton).toContain('class="diag-icon-btn"');
    expect(jsonButton).toContain('class="ti ti-download"');
    expect(jsonButton).toContain('aria-label="Export Disput telemetry as JSON"');
    expect(jsonButton).not.toContain('>Json');
  });

  test('Disput export whitelists diagnostic evidence and deep-redacts JSON', () => {
    expect(resultsSource).toContain('const buildSafeDebateDiagnosticEvidence = (meta = {}) =>');
    expect(resultsSource).toContain('evidence: buildSafeDebateDiagnosticEvidence(meta)');
    expect(resultsSource).not.toContain('evidence: meta');
    expect(resultsSource).toContain('window.SecretRedaction.redactDeep(payload)');
    expect(resultsSource).toContain('window.DebateTraceProjections.filterProblems(payload');
  });
});
