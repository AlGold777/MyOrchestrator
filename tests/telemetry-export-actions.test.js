const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

describe('Telemetry export actions', () => {
  test('both result pages expose the extension-native sanitized B1 capture action', () => {
    expect(html).toContain('id="capture-b1-skeletons-btn"');
    expect(pipelineHtml).toContain('id="capture-b1-skeletons-btn"');
    expect(resultsSource).toContain("type: 'CAPTURE_B1_SANITIZED_SKELETONS'");
    expect(resultsSource).toContain("downloadDiagnosticsJson('B1 Sanitized Answer Skeletons'");
  });

  test('Telemetry exposes exactly the Platform and Tasks filters', () => {
    const reportTypes = [
      'request-not-sent',
      'generation-not-started',
      'truncation',
      'true-completion',
      'submission-proof',
      'extraction-integrity',
      'forced-success',
      'forced-finalization'
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
