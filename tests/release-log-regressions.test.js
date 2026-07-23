const fs = require('fs');
const path = require('path');

// Styles are split into styles/*.css behind a styles.css @import loader. Resolve
// the loader + its imported modules so CSS content assertions stay valid.
const readResolvedCss = () => {
  const dir = path.join(__dirname, '..');
  const loader = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
  const modules = [...loader.matchAll(/@import url\("(styles\/[^"]+\.css)(?:\?[^"]+)?"\)/g)]
    .map((m) => fs.readFileSync(path.join(dir, m[1]), 'utf8'));
  return [loader, ...modules].join('\n');
};

describe('release log regression guards', () => {
  test('Favourite card exposes TXT export immediately after its HTML export', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const htmlButtonIndex = source.indexOf('class="panel-action-btn panel-export-html-btn favorite-export-btn"');
    const txtButtonIndex = source.indexOf('id="favorite-export-txt-btn"');
    const clearButtonIndex = source.indexOf('class="panel-action-btn panel-clear-response-btn favorite-clear-btn"');

    expect(htmlButtonIndex).toBeGreaterThan(-1);
    expect(txtButtonIndex).toBeGreaterThan(htmlButtonIndex);
    expect(clearButtonIndex).toBeGreaterThan(txtButtonIndex);
    expect(source).toContain("event.target.closest('#favorite-export-txt-btn')");
    expect(source).toContain('anchor.download = `Favourite ${dateStr}.txt`;');
    expect(source).toContain('const textContent = `=== Favourite ===\\n${favoriteText}`;');
  });

  test('TXT export sits after the all-responses HTML export and downloads plain text', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const htmlButtonIndex = html.indexOf('id="export-html-btn"');
    const txtButtonIndex = html.indexOf('id="export-txt-btn"');
    const copyButtonIndex = html.indexOf('id="copy-all-btn"');

    expect(htmlButtonIndex).toBeGreaterThan(-1);
    expect(txtButtonIndex).toBeGreaterThan(htmlButtonIndex);
    expect(copyButtonIndex).toBeGreaterThan(txtButtonIndex);
    expect(html).toContain('aria-label="Export all responses as TXT">txt</button>');
    expect(source).toContain("event.target.closest('#export-txt-btn')");
    expect(source).toContain("type: 'text/plain;charset=utf-8'");
    expect(source).toContain('anchor.download = `LLMs answers ${formatNamedExportStamp(now)}.txt`;');
  });

  test('response selection toolbar also works inside the Favourite card', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).not.toContain('target.id === favoriteOutputId');
    expect(source).toContain('function favoriteEntryFromSelectionRange(range = responseSelectionState.range)');
    expect(source).toContain("rangeEl?.closest?.('.favorite-item-body[contenteditable=\"true\"]')");
    expect(source).toContain('syncFavoriteEntryFromBody(favoriteBody);');
    expect(source).toContain('const selectedFavorite = favoriteEntryFromSelectionRange();');
  });

  test('model selectors and response cards use the canonical UI order', () => {
    const expectedButtonIds = [
      'llm-gpt', 'llm-gemini', 'llm-claude', 'llm-grok', 'llm-zai',
      'llm-qwen', 'llm-deepseek', 'llm-lechat', 'llm-perplexity'
    ];
    const expectedPanelIds = expectedButtonIds.map((id) => id.replace('llm-', 'panel-'));
    const readOrder = (html, ids) => ids
      .map((id) => ({ id, index: html.indexOf(`id="${id}"`) }))
      .sort((a, b) => a.index - b.index)
      .map(({ id }) => id);
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');

    expectedButtonIds.forEach((id) => {
      expect(pipelineHtml.indexOf(`id="${id}"`)).toBeGreaterThan(-1);
      expect(resultHtml.indexOf(`id="${id}"`)).toBeGreaterThan(-1);
    });
    expectedPanelIds.forEach((id) => expect(resultHtml.indexOf(`id="${id}"`)).toBeGreaterThan(-1));
    expect(readOrder(pipelineHtml, expectedButtonIds)).toEqual(expectedButtonIds);
    expect(readOrder(resultHtml, expectedButtonIds)).toEqual(expectedButtonIds);
    expect(readOrder(resultHtml, expectedPanelIds)).toEqual(expectedPanelIds);
  });

  test('state map actions use icon buttons and keep Case before Export', () => {
    const htmlFiles = ['pipeline_panel.html', 'result_new.html'];
    htmlFiles.forEach((file) => {
      const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const history = html.indexOf('data-map-mode="history"');
      const caseExport = html.indexOf('data-case-export');
      const mapExport = html.indexOf('data-map-export');
      expect(history).toBeGreaterThan(-1);
      expect(caseExport).toBeGreaterThan(history);
      expect(mapExport).toBeGreaterThan(caseExport);
      expect(html).toContain('data-map-mode="history" title="История" aria-label="История"><i class="ti ti-history"');
      expect(html).toContain('data-case-export title="Экспорт дела" aria-label="Экспорт дела"><i class="ti ti-folder"');
      expect(html).toContain('data-map-export title="Экспорт карты" aria-label="Экспорт карты"><i class="ti ti-download"');
      expect(html).not.toContain('data-map-mode="history">История</button>');
      expect(html).not.toContain('data-case-export title="Экспорт дела">Case</button>');
      expect(html).not.toContain('data-map-export title="Экспорт карты">Export</button>');
    });
  });

  test('telemetry export accentuates the active Generation Wait Profile', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    // Captured at dispatch so the export reflects the profile actually used.
    expect(source).toContain("lastGenerationWaitProfile = (longModeCheckbox && longModeCheckbox.checked) ? 'long' : 'short';");
    // Prominent header line in the All Logs markdown export.
    expect(source).toContain('const profileLine = `Generation wait profile: **${lastGenerationWaitProfile === \'long\' ? \'LONG\' : \'SHORT\'}**');
    // Profile getter exposed via ResultsShared so devtools export can include it.
    expect(source).toContain('window.ResultsShared.getGenerationWaitProfile = () => lastGenerationWaitProfile;');
    // Structured field in the Telemetry JSON export (in results-devtools.js).
    const devtools = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');
    expect(devtools).toContain('generationWaitProfile: window.ResultsShared?.getGenerationWaitProfile?.()');
  });

  test('API direct transport is gated by the explicit feature flag', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

    expect(source).toContain('const apiUsed = await tryApiDirect(llmName, prompt, attachments);');
    expect(source).toContain("const API_TRANSPORT_FEATURE_FLAG_KEY = 'feature_api_transport_enabled';");
    expect(source).toContain('recordApiTransportFeatureDisabled(llmName, attachments, \'start_model\');');
    expect(source).toContain("details: 'web_ui:api_transport_feature_disabled'");
    expect(source).toContain('dispatchReason');
  });

  test('round exports do not infer R4 completion from MODEL_FINAL', () => {
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const devtoolsSource = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

    expect(resultsSource).not.toContain("normalizedLabel === 'MODEL_FINAL' || normalizedLabel === 'FINAL_STATUS'");
    expect(devtoolsSource).not.toContain("normalizedLabel === 'MODEL_FINAL' || normalizedLabel === 'FINAL_STATUS'");
  });

  test('disput is consolidated onto a single runtime (no shadow background executor)', () => {
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const backgroundIndex = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');
    const routerSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    // DebateEngine is still loaded — but only as a transcript/persistence/template
    // utility for the UI, not as a parallel runtime. The background service worker
    // must not load disput modules at all: the transport layer stays
    // speaker-agnostic (graph-mode audit, docs/graph-mode/AUDIT_REPORT.md).
    expect(pipelineHtml).toContain('<script src="disput/debate-engine.js"></script>');
    expect(resultHtml).toContain('<script src="disput/debate-engine.js"></script>');
    expect(backgroundIndex).not.toContain('disput/debate-engine.js');
    expect(backgroundIndex).not.toContain('disput/disput-massage.js');
    expect(resultsSource).toContain('const DebateEngineRuntime = window.DebateEngine || null;');
    expect(resultsSource).toContain('function collectDebateArtifact()');

    // The shadow background executor and its message sync are gone: serialDebateState
    // in results.js is the single source of truth.
    expect(backgroundIndex).not.toContain('debate-executor.js');
    expect(routerSource).not.toContain('DebateBackgroundExecutor');
    expect(resultsSource).not.toContain("type: 'START_DEBATE_RUN'");
    expect(resultsSource).not.toContain("type: debatePaused ? 'PAUSE_DEBATE' : 'RESUME_DEBATE'");
    expect(resultsSource).not.toContain("type: 'CANCEL_DEBATE'");
  });

  test('Telemetry and Disput are separate devtools tabs with separate exports', () => {
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    [pipelineHtml, resultHtml].forEach((html) => {
      expect(html).toContain('id="telemetry-tab"');
      expect(html).toContain('id="disput-tab"');
      expect(html.indexOf('id="telemetry-tab"')).toBeLessThan(html.indexOf('id="disput-tab"'));
      expect(html.indexOf('id="disput-tab"')).toBeLessThan(html.indexOf('id="selectors0-tab"'));
      expect(html).toContain('id="disput-tabpanel"');
      expect(html).toContain('id="disput-export-md"');
      expect(html).toContain('id="disput-export-json"');
      expect(html).toContain('id="telemetry-export-json-btn"');
      expect(html.indexOf('id="telemetry-export-json-btn"')).toBeLessThan(html.indexOf('id="export-all-logs-md-telemetry"'));
      expect(html).not.toContain('id="telemetry-disput-btn"');
      expect(html).not.toContain('id="export-disput-flow-md"');
      const telemetryStart = html.indexOf('id="telemetry-tabpanel"');
      const disputStart = html.indexOf('id="disput-tabpanel"');
      const telemetryBlock = telemetryStart >= 0 && disputStart >= 0 ? html.slice(telemetryStart, disputStart) : '';
      const disputEnd = html.indexOf('id="selectors0-tabpanel"', disputStart);
      const disputBlock = disputStart >= 0 && disputEnd >= 0 ? html.slice(disputStart, disputEnd) : '';
      expect(telemetryBlock).toContain('All platforms');
      expect(telemetryBlock).toContain('All types');
      expect(telemetryBlock).toContain('Presets');
      expect(disputBlock).not.toContain('All platforms');
      expect(disputBlock).not.toContain('All types');
      expect(disputBlock).not.toContain('Presets');
      expect(disputBlock.indexOf('id="disput-export-json"')).toBeLessThan(disputBlock.indexOf('id="disput-export-md"'));
      expect(disputBlock).toContain('class="ti ti-download"');
      expect(disputBlock).toContain('>MD</button>');
      expect(disputBlock).not.toContain('>Json</button>');
      const actionsBlock = telemetryBlock;
      expect(actionsBlock).not.toContain('id="telemetry-refresh-btn"');
      expect(actionsBlock).not.toContain('id="telemetry-copy-btn"');
      expect(actionsBlock).not.toContain('id="telemetry-reset-btn"');
      expect(actionsBlock).not.toContain('{ }</button>');
      expect(actionsBlock).not.toContain('↻</button>');
      expect(actionsBlock).not.toContain('🗑</button>');
    });
    expect(source).toContain('function buildDisputTelemetryMarkdown(telemetryEvents = [])');
    expect(source).toContain('function buildDisputProtocolTheoryMarkdown()');
    expect(source).toContain('## Execution Plan');
    expect(source).not.toContain('B0 | Model B silent init | no | no | openingStatementB');
    expect(source).toContain('window.DebateTraceProjections.buildReport');
    expect(source).toContain('function normalizeTelemetryDisputRows(events = [])');
    expect(source).toContain("'PROMPT_SUBMITTED_ACCEPTED'");
    expect(source).toContain("'MODEL_FINAL'");
    expect(source).toContain("'PIPELINE_ERROR'");
    expect(source).toContain("event.target.closest('#disput-export-md')");
    expect(source).toContain("event.target.closest('#disput-export-json')");
    expect(source).toContain('function buildDisputExportPayload(telemetryEvents = [])');
    expect(source).toContain("downloadDiagnosticsMarkdown('Disput Flow', markdown, disputBtn);");
    expect(source).toContain("downloadDiagnosticsJson('Disput Flow', payload, disputBtn);");
    [pipelineHtml, resultHtml].forEach((html) => {
      expect(html).toContain('id="disput-health-summary"');
      expect(html).toContain('id="disput-problems"');
      expect(html).toContain('id="disput-plan-actual"');
      expect(html).toContain('id="disput-participants"');
      expect(html).toContain('id="disput-critical-path"');
      expect(html).toContain('id="disput-raw-events"');
    });
  });

  test('debate round limit syncs Pro columns without adding an extra Disput round', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).toContain('const syncPipelineRoundsToDebateLimit = () => {');
    expect(source).toContain('const roundLimit = getDebateRoundLimit();');
    expect(source).toContain("const targetRounds = roundLimit === 'infinite'");
    expect(source).toContain('? 1\n                : Math.max(1, Math.min(50, Number(roundLimit) || 1));');
    expect(source).toContain('if (!insertionPoint) {\n                updatePipelineAll();\n                return;\n            }');
    expect(source).toContain('const targetRounds = Math.max(1, Math.min(50, Number(roundLimit) || 1));');
    expect(source).toContain('while (roundCounter < targetRounds) {\n                addRound();\n            }');
    expect(source).not.toContain('while (roundCounter <= targetRounds)');
    expect(source).toContain('syncPipelineRoundModelsFromSelectedLLMs({ force: true });\n            syncPipelineRoundsToDebateLimit();\n            if (window.__pendingPipelineSynthesizer !== undefined) {\n                const restoredPlan = draftPlanForCanvas(getActiveDraftPlan());\n                persistActiveDraftPlan(restoredPlan);\n                delete window.__pendingPipelineSynthesizer;\n            }\n            window.syncDebateSchemeUi?.();');
    expect(source).toContain('syncDebateRoundStepperUi();\n            syncDebateAutoPauseButton();\n            syncDebateAutoToggleButton();\n            if (typeof syncAutoToggleState === \'function\') syncAutoToggleState();\n            syncPipelineChromeControls();\n            updatePipelineAll();');
    expect(source).toContain('syncPipelineRoundsToDebateLimit();\n            updateDebateButtonsUi();');
    expect(source).toContain('syncDebateRoundStepperUi();\n            syncPipelineRoundsToDebateLimit();\n            updateDebateButtonsUi();');
  });

  test('debate length stepper is rendered left of the run button and pipeline export uses download icon', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const css = readResolvedCss();

    expect(html).toContain('id="debate-length-select"');
    expect(html).toContain('id="debate-round-limit-select"');
    expect(html.indexOf('id="pipeline-panel-toggle-title"')).toBeLessThan(html.indexOf('id="debate-length-select"'));
    expect(html.indexOf('id="debate-round-limit-select"')).toBeLessThan(html.indexOf('id="debate-length-select"'));
    expect(html.indexOf('id="debate-round-limit-select"')).toBeGreaterThan(-1);
    expect(html).toContain('id="pipeline-export-btn"');
    expect(html).toContain('title="Export pipelines"');
    expect(html).toContain('<i class="ti ti-download" aria-hidden="true"></i>');
    expect(html).toContain('id="pipeline-import-btn"');
    expect(html).toContain('title="Import pipelines"');
    expect(html).toContain('<i class="ti ti-upload" aria-hidden="true"></i>');
    expect(css).toContain('.pipeline-page .llm-controls {');
    expect(css).toContain('margin-top: 15px;');
    expect(css).toContain('.debate-select-wrap {');
    expect(css).toContain('.debate-select-wrap::after {');
    expect(css).toContain('.debate-select {');
    expect(css).toContain('.pipeline-flow #connectorToOutput,');
    expect(css).toContain('.pipeline-flow #outputColumn {');
    expect(css).toContain('align-self: center;');
    expect(css).toContain('justify-content: center;');
    expect(css).toContain('.pipeline-flow .connector-group.pipeline-stage-future .connector-line,');
    expect(css).toContain('.pipeline-flow .stage-column.pipeline-stage-future .model-block,');
    expect(css).toContain('--pipeline-block-height: 59.52px;');
    expect(css).toContain('--pipeline-block-gap: 11px;');
    expect(css).toContain('animation: none;');
  });

  test('pipeline control buttons are placed directly below the prompt group with vertical input layout', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const css = readResolvedCss();

    expect(source).toContain("promptGroupForPipelineControls.insertAdjacentElement('afterend', pipelineControlButtons);");
    expect(source).toContain("document.body.classList.contains('pipeline-page') && promptGroupForPipelineControls");
    expect(source).toContain("pipelineControlButtons.style.marginTop = '0px';");
    expect(source).not.toContain("promptSectionForPipelineControls.insertAdjacentElement('afterend', pipelineControlButtons);");
    expect(css).toContain('.pipeline-page .app-main .input-section');
    expect(css).toContain('flex-direction: column;');
    expect(css).toContain('align-items: stretch;');
    expect(css).toContain('.pipeline-page .prompt-group');
    expect(css).toContain('margin-bottom: 0;');
    expect(css).toContain('.pipeline-page .prompt-group + .control-buttons');
    expect(css).toContain('margin-top: 0;');
    expect(css).toContain('.pipeline-page .attachment-bar.is-empty');
    expect(css).toContain('min-height: 0;');
    expect(css).toContain('.pipeline-panel-toggle-title {');
    expect(css).toContain('margin: 0;');
    expect(css).toContain('.msg-header {');
    expect(css).toContain('display: grid;');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);');
    expect(css).toContain('.msg-head-left .pipeline-panel-toggle-title {');
    expect(css).toContain('.msg-head-center {');
    expect(css).toContain('justify-self: center;');
    expect(css).toContain('grid-column: 2;');
    expect(css).toContain('transform: none;');
    expect(css).toContain('.debate-select-wrap[hidden] {');
    expect(css).toContain('display: none !important;');
    expect(css).toContain('#debate-round-limit-select {');
    expect(css).toContain('width: 86px;');
    expect(css).toContain('padding-right: 24px;');
    expect(css).toContain('.msg-head-right-top > .debate-btn {');
    expect(css).toContain('.msg-head-right-top > .prompt-mode-btn {');
    expect(css).toContain('.pipeline-modifiers-section {');
    expect(css).toContain('.pipeline-modifiers-container {');
    expect(css).toContain('.pipeline-page .prompt-group:has(.prompt-container.prompt-sandwich.debate-composer:not(.has-debate-feed)) {');
    expect(css).toContain('margin-top: clamp(0px, calc((100dvh - 322px) / 2 - 3px), 360px);');
    expect(css).toContain('padding: 2.5px 9px 0;');
    expect(css).toContain('font-size: 16px;');
    expect(css).toContain('line-height: 1.45;');
    expect(css).toContain('gap: 4px;');
    expect(css).toContain('margin-right: 12px;');
    expect(css).toContain('transform: translateX(16px);');
    expect(css).toContain('.pipeline-item-delete {');
    expect(css).toContain('margin-left: 5px;');
    expect(css).toContain('.pipeline-items {');
    expect(css).toContain('grid-auto-flow: column;');
    expect(css).toContain('grid-template-rows: repeat(3, max-content);');
    expect(css).toContain('grid-auto-columns: 220px;');
    expect(css).toContain('.pipeline-items-row {');
    expect(css).toContain('display: contents;');
    expect(css).toContain('width: 220px;');
    expect(css).toContain('.modal {');
    expect(css).toContain('align-items: center;');
    expect(css).toContain('#prompt-modal {');
    expect(css).toContain('#prompt-modal .modal-content {');
    expect(css).toContain('#prompt-modal .modal-buttons {');
    expect(css).toContain('.modal-text-input {');
    expect(css).toContain('margin-left: 5px;');
    expect(css).toContain('column-gap: 12px;');
  });

  test('pro controls use one msg-header run button and list add action while output column is gated by R1 models', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const css = readResolvedCss();

    expect(html).toContain('<div class="pipeline-list-header-actions" aria-label="Pipeline actions">');
    expect(html).toContain('id="debate-run-toggle-btn"');
    expect(html).toContain('id="pipeline-panel-toggle-title"');
    expect(html.indexOf('id="pipeline-toggle-modifiers-btn"')).toBeLessThan(html.indexOf('id="pipeline-panel-toggle-title"'));
    expect(html.indexOf('id="pipeline-panel-toggle-title"')).toBeLessThan(html.indexOf('id="debate-length-select"'));
    expect(html.indexOf('id="debate-round-limit-select"')).toBeLessThan(html.indexOf('id="debate-length-select"'));
    expect(html.indexOf('id="debate-round-limit-select"')).toBeGreaterThan(-1);
    expect(html.indexOf('<div class="msg-head-center">')).toBeLessThan(html.indexOf('id="mod-sender-select"'));
    expect(html).not.toContain('id="mod-role-select"');
    expect(html).not.toContain('id="mod-send-btn"');
    expect(html).not.toContain('id="pipeline-run-btn"');
    expect(html).not.toContain('id="pipeline-round-stepper-down"');
    expect(html).not.toContain('id="pipeline-round-stepper-value"');
    expect(html).not.toContain('id="pipeline-round-stepper-up"');
    expect(html).toContain('id="pipeline-add-round-btn"');
    expect(html).not.toContain('id="removeRoundBtn"');
    expect(html).toContain('id="pipeline-save-btn"');
    expect(html).not.toContain('id="pipeline-delete-btn"');
    expect(html).toContain('<h3>Pipelines</h3>');
    expect(html).toContain('id="pipeline-add-btn"');
    expect(html).toContain('id="round1" data-round="1"');
    expect(html.indexOf('id="pipeline-add-btn"')).toBeGreaterThan(html.indexOf('<div class="pipeline-list-header">'));
    expect(html).not.toContain('<div class="round-buttons">');
    expect(css).toContain('.pipeline-list-header-actions');
    expect(css).toContain('margin-left: auto;');
    expect(css).toContain('.output-column-hidden');
    expect(css).toContain('min-height: 0;');
    expect(css).toContain('.pipeline-flow .connector-group.pipeline-stage-future .connector-line,');
    expect(css).toContain('.pipeline-flow .stage-column.pipeline-stage-future .model-block,');
    expect(source).toContain("state.rememberWhenHidden = true;");
    expect(source).toContain("state.visible = !outputColumn?.classList?.contains('output-column-hidden');");
    expect(source).toContain("pipelineCanvas?.classList.remove('pipeline-canvas-empty');");
    expect(source).toContain("outputColumn?.classList.remove('output-column-hidden');");
    expect(source).toContain("outputColumn?.setAttribute('data-remember-output-state', 'true');");
  });

  test('debate transcript persists across navigation but is cleared on explicit page reload', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    // Boot/reload helpers were extracted to results/boot-utils.js (self-refactor).
    const bootUtils = fs.readFileSync(path.join(__dirname, '..', 'results', 'boot-utils.js'), 'utf8');

    expect(bootUtils).toContain("const DEBATE_TRANSCRIPT_STORAGE_KEY = 'llmCortexDebateEngineState.v1';");
    expect(bootUtils).toContain('const clearDebateTranscriptOnReload = () => new Promise((resolve) => {');
    expect(bootUtils).toContain('if (!isPageReloadNavigation()) {');
    expect(bootUtils).toContain('storage.remove(DEBATE_TRANSCRIPT_STORAGE_KEY');
    // results.js still wires the extracted helpers and the reload-clear call site.
    expect(source).toContain('} = window.ResultsBootUtils;');
    expect(source).toContain("clearDebateTranscriptOnReload().catch?.((err) => console.warn('[RESULTS] debate transcript reload clear failed', err));");
    expect(source).toContain('if (isPageReloadNavigation()) return Promise.resolve(false);');
    expect(source).toContain('return DebateEngineRuntime.loadStore()');
  });

  test('every HTML entrypoint that loads results.js also loads its results/ modules first', () => {
    // results.js destructures window.ResultsBootUtils / ResultsDomUtils / ResultsTooltips
    // at init; if a page loads results.js without them, init throws and the whole
    // UI (all buttons) breaks. Guard presence AND load order on every entrypoint.
    const requiredModules = [
      'results/boot-utils.js',
      'results/dom-utils.js',
      'results/attachments.js',
      'results/tooltips.js',
      'results/debate-ui.js',
      'results/debate-transport.js',
      'results/debate-controller.js',
      'results/debate-renderer.js',
      'results/debate-sessions-store.js',
      'results/debate-export.js'
    ];
    ['result_new.html', 'pipeline_panel.html'].forEach((file) => {
      const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const resultsIdx = html.indexOf('src="results.js"');
      expect(resultsIdx).toBeGreaterThan(-1);
      requiredModules.forEach((mod) => {
        const modIdx = html.indexOf(`src="${mod}"`);
        expect(modIdx).toBeGreaterThan(-1);
        expect(modIdx).toBeLessThan(resultsIdx);
      });
    });
  });

  test('Pro Disput rounds mirror header-selected models instead of default judge models', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const runtime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
    const css = readResolvedCss();

    expect(source).toContain('const syncPipelineRoundModelsFromSelectedLLMs = ({ force = false } = {}) => {');
    expect(source).toContain('for (let roundIndex = 1; roundIndex <= roundCounter; roundIndex++) {');
    expect(source).toContain("const stack = document.getElementById(`r${roundIndex}-models`);");
    expect(source).toContain('stack.innerHTML = nextHtml;');
    expect(source).toContain('const buildSelectedRoundModelBlocksHtml = (withRole = true) => {');
    expect(source).toContain("pipelineCanvas?.classList.remove('pipeline-canvas-empty');");
    expect(runtime).toContain('onlyActive = false,');
    expect(runtime).toContain('.filter(({ index }) => !onlyActive || activeSet.has(index))');
    expect(runtime).toContain('activeIndices: [], withRole: false, onlyActive: true');
    expect(runtime).toContain('activeIndices: [], withRole: true, onlyActive: true');
    expect(source).toContain("pipelineCanvas?.classList.remove('pipeline-canvas-empty');");
    expect(source).toContain('const setR1ModelsFromSelectedLLMs = (options = {}) => syncPipelineRoundModelsFromSelectedLLMs(options);');
    expect(source).toContain('const buildSelectedRoundModelBlocksHtml = (withRole = true) => {');
    expect(source).toContain('const judgeBlocksHtml = buildSelectedRoundModelBlocksHtml(true);');
    expect(source).toContain('syncPipelineRoundModelsFromSelectedLLMs({ force: true });');
    expect(source).toContain('await initPipelineList();\n        setTimeout(() => syncPipelineRoundsToDebateLimit(), 0);\n        updatePipelineAll();');
    expect(source).toContain("document.addEventListener('llm-selection-change', () => {");
    expect(source).toContain('resetPipelineStatusIndicators();\n            setR1ModelsFromSelectedLLMs({ force: true });');
  });

  test('serial pipeline start defines tab policy and Pro output is HTML-only', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const runtime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');

    expect(source).toContain('const forceNewTabs = newPagesCheckbox ? newPagesCheckbox.checked : true;');
    expect(source).toContain('forceNewTabs,');
    expect(source).toContain("const normalizeRoundLimitValue = (value, fallback = 'infinite') => {");
    expect(source).toContain("applyRoundLimitToPipelineConfig(config, getLongRoundLimitOverride(key) || config.protocol.roundLimit || '3');");
    expect(source).toContain("if (!String(envelope.answer || '').trim()) {");
    expect(source).toContain('const pipelineExportBuildDebateFeedHtml = () => {');
    expect(source).toContain('const pipelineExportDownloadDebateFeedHtml = (button = null) => {');
    expect(source).toContain("const ok = pipelineExportDownloadDebateFeedHtml(btn);");
    expect(source).toContain('const ok = pipelineExportDownloadDebateFeedHtml();');
    expect(runtime).toContain("{ key: 'exportHtml', label: 'Export HTML', desc: 'HTML', checked: true }");
    expect(runtime).not.toContain("key: 'notes'");
    expect(runtime).not.toContain("key: 'export', label: 'Export'");
  });

  test('DebateEngine turns and feed cards carry stable response ids', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const engine = fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-engine.js'), 'utf8');

    expect(source).toContain("responseId: card?.dataset?.responseId || '',");
    expect(source).toContain("message.responseId = `response-${message.id}`;");
    expect(source).toContain('if (message.responseId) card.dataset.responseId = message.responseId;');
    expect(source).toContain('responseId: message.responseId || null,');
    expect(engine).toContain('responseId: input.responseId ? String(input.responseId) : null,');
  });

  test('sidebar restored model cards remain visible when stream preview is active', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const css = readResolvedCss();

    expect(source).toContain("panel.classList.remove('llm-panel-expanded', 'llm-panel-session-restored');");
    expect(source).toContain('delete panel.dataset.restoredResponse;');
    expect(source).toContain("panel.classList.add('llm-panel-session-restored');");
    expect(source).toContain("panel.dataset.restoredResponse = 'true';");
    expect(source).toContain("outputEl.style.maxHeight = EXPANDED_PANEL_OUTPUT_MAX_HEIGHT;");
    expect(source).toContain("outputEl.style.minHeight = '240px';");
    expect(source).toContain('window.__sidebarSessionsDebug = {');
    expect(css).toContain('body.llm-stream-preview-open .llm-results .llm-panel:not(.favorite-panel) .output {\n  display: block;\n  min-height: 0;\n  max-height: 3.2em;\n  overflow: hidden;');
    expect(source).toContain("const PREVIEW_PANEL_OUTPUT_MAX_HEIGHT = '3.2em';");
    expect(source).toContain("outputEl.style.maxHeight = PREVIEW_PANEL_OUTPUT_MAX_HEIGHT;");
    expect(source).toContain("outputEl.dataset.collapsedMaxHeight = document.body.classList.contains('llm-stream-preview-open')");
    expect(css).toContain('body.llm-stream-preview-open .llm-results .llm-panel.llm-panel-session-restored:not(.favorite-panel) .output {\n  display: block;');
    expect(css).not.toContain('.llm-results.view-grid .llm-panel.llm-panel-session-restored:not(.favorite-panel) {\n  grid-column: 1 / -1;');
  });

  test('pipeline model send checkboxes stay inside the block and align to its right edge', () => {
    const css = readResolvedCss();

    expect(css).toContain('.model-header {\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    width: 100%;\n    min-width: 0;');
    expect(css).toContain('.model-name {\n    min-width: 0;\n    flex: 1 1 auto;\n    overflow: hidden;');
    expect(css).toContain('.model-checkbox {\n    width: 13px;\n    height: 13px;\n    flex: 0 0 13px;\n    margin: 0;');
    expect(css).toContain('.model-block-inspect-btn {');
    expect(css).toContain('flex: 0 0 18px;');
  });

  test('closed Disput composer keeps the run button inside the right edge of moderator input', () => {
    const css = readResolvedCss();

    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer:not(.has-debate-feed) .msg-header {\n    flex: 0 0 auto;\n    align-items: center;\n    grid-template-columns: auto minmax(0, 1fr) auto;');
    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer:not(.has-debate-feed) .msg-head-right-top {\n    gap: 4px;\n    justify-content: flex-end;\n    overflow: visible;');
    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer:not(.has-debate-feed) .msg-head-center {\n    min-width: 0;\n    max-width: 100%;\n    transform: none;');
    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer:not(.has-debate-feed) .msg-head-right {\n    width: auto;\n    min-width: 0;\n    max-width: 100%;');
  });

  test('saved sidebar session selection on Debate navigates back to main results page', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).toContain("const sidebarSessionViewIntentKey = 'llmSidebarPendingSessionView';");
    expect(source).toContain('const navigateToMainViewForSidebarSession = async (sessionId) => {');
    expect(source).toContain("if (!id || getCurrentViewKey() === 'main') return false;");
    expect(source).toContain('[sidebarSessionViewIntentKey]: {');
    expect(source).toContain("window.location.href = 'result_new.html';");
    expect(source).toContain('const consumeSidebarSessionViewIntent = async () => {');
    expect(source).toContain('if (getCurrentViewKey() !== \'main\') return null;');
    expect(source).toContain('if (targetId !== CURRENT_SESSION_ID && await navigateToMainViewForSidebarSession(targetId)) return;');
    expect(source).toContain('const pendingSidebarSessionId = await consumeSidebarSessionViewIntent();');
    expect(source).toContain('await switchSidebarSessionView(pendingSidebarSessionId);');
  });

  test('sidebar session backup preserves prompt text outside and inside snapshots', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).toContain('promptText: String(');
    expect(source).toContain('|| session.savedPromptText');
    expect(source).toContain('const rawSnapshot = session.pageSnapshot && typeof session.pageSnapshot === \'object\'');
    expect(source).toContain('promptText: rawSnapshot.promptText');
    expect(source).toContain('|| session.savedPromptText');
    expect(source).toContain('promptText: inlineSnapshot.promptText,');
    expect(source).toContain('activeSession.promptText = snapshot.promptText;');
    expect(source).toContain('existingSession.promptText = pageSnapshot.promptText;');
    expect(source).toContain('promptText: pageSnapshot.promptText,');
    expect(source).toContain('const previewPromptText = normalizedSnapshot.promptText || String(session.promptText || \'\').trim();');
    expect(source).toContain('const previewText = formatSessionPreview(session.urls, previewPromptText);');
  });

  test('Current sidebar session restores prompt, cards, and exact model selection snapshot', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).toContain('if (snapshot.modelSelectionCaptured || snapshot.selectedModels.length) {');
    expect(source).toContain('applySidebarSessionModelSelection(snapshot.selectedModels);');
    expect(source).toContain('const currentSnapshot = sessionsState.currentSnapshot || normalizeSessionPageSnapshot();');
    expect(source).toContain('await applySidebarSessionPageSnapshot(currentSnapshot);');
    expect(source).toContain('restoreSessionPreview(currentSnapshot);');
    expect(source).toContain('const restoreSessionPreview = (snapshot = null) => {');
    expect(source).toContain('const normalizedSnapshot = snapshot ? normalizeSessionPageSnapshot(snapshot) : null;');
    expect(source).toContain('const restoredText = normalizedSnapshot?.promptText ?? sessionPreview.text;');
  });

  test('deleting active saved sidebar session returns textarea to Current session', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const css = readResolvedCss();

    expect(source).toContain('if (sessionsState.activeViewId === session.id) {');
    expect(source).toContain('const currentSnapshot = sessionsState.currentSnapshot || normalizeSessionPageSnapshot();');
    expect(source).toContain('await applySidebarSessionPageSnapshot(currentSnapshot);');
    expect(source).toContain('restoreSessionPreview(currentSnapshot);');
    expect(css).toContain('--sidebar-left-width: 280px;');
    expect(css).toContain('--sidebar-left-min: 280px;');
  });

  test('left sidebar header has no search box and actions stay right aligned', () => {
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const css = readResolvedCss();

    [resultHtml, pipelineHtml].forEach((html) => {
      expect(html).not.toContain('id="notes-search"');
      expect(html).not.toContain('id="notes-search-clear"');
      expect(html).toContain('id="notes-add-root"');
      expect(html).toContain('id="sessions-save-btn"');
    });
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) 56px;');
    expect(css).toContain('justify-self: end;');
    expect(css).toContain('.app-sidebar-left .sidebar-title');
    expect(css).toContain('justify-self: start;');
    expect(css).toContain('text-align: left;');
  });

  test('notes backup import keeps note tabs instead of pruning empty imported tabs', () => {
    const service = fs.readFileSync(path.join(__dirname, '..', 'notes', 'notes-service.js'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(service).toContain('const tabs = await readStoreRecords(stores[STORES.TABS]);');
    expect(service).toContain('await clearAndInsert(stores[STORES.TABS], safeTabs);');
    expect(source).not.toContain('await pruneEmptyTabs();');
  });

  test('session backup filename selection excludes the json extension', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    expect(source).toContain("selectionEnd: defaultFilename.length - '.json'.length");
    expect(source).toContain('promptDialogInput.setSelectionRange(0, Math.min(selectionEnd, promptDialogInput.value.length));');
  });

  test('saved sessions can be added without replacing the current session set', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const resultHtml = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');
    const pipelineHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');

    [resultHtml, pipelineHtml].forEach((html) => {
      expect(html.indexOf('id="notes-hint-sessions-add"')).toBeGreaterThan(-1);
      expect(html.indexOf('id="notes-hint-sessions-add"')).toBeLessThan(html.indexOf('id="notes-hint-backup-export"'));
    });
    expect(source).toContain('const addSavedSessions = async () => {');
    expect(source).toContain('while (usedIds.has(normalized.id)) {');
    expect(source).toContain('sessionsState.sessions = [...sessionsState.sessions, ...addedSessions];');
    expect(source).toContain('attachBackupAction(notesHintSessionsAddBtn, addSavedSessions);');
  });
});
