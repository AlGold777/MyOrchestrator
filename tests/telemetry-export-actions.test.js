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

  test('Telemetry exposes the Only problems filter backed by the shared context utility', () => {
    expect(html).toContain('id="telemetry-only-problems"');
    const checkboxAt = html.indexOf('id="telemetry-only-problems"');
    expect(html.slice(html.lastIndexOf('<input', checkboxAt), html.indexOf('>', checkboxAt))).toContain('checked');
    expect(html).toContain('src="shared/problem-context-filter.js"');
    expect(pipelineHtml).toContain('id="telemetry-only-problems" checked');
    expect(pipelineHtml).toContain('src="shared/problem-context-filter.js"');
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
    expect(devtoolsSource).toContain('window.ProofOrientedTelemetry.buildAllPresets');
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
