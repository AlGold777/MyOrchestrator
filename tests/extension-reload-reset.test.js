const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('extension reload state reset', () => {
  test('state hydration waits for the runtime-epoch cleanup barrier', () => {
    const indexSource = read('background/index.js');
    const routerSource = read('background/message-router.js');

    expect(indexSource).toContain('self.__extensionLifecycleReady = new Promise');
    expect(indexSource).toContain("const EXTENSION_RUNTIME_EPOCH_KEY = '__llm_extension_runtime_epoch_v1'");
    expect(indexSource).toContain("'llmComparatorSelectedModelsByView.main'");
    expect(indexSource).toContain("'llmComparatorSelectedModelsByView.pipeline'");
    expect(indexSource).toContain("'llmComparatorCrossViewUiState'");
    expect(indexSource).toContain("resetVolatileRuntime('new_extension_runtime')");
    expect(indexSource).toMatch(/onInstalled\.addListener[\s\S]*details\?\.reason !== 'update'/);
    expect(indexSource).toContain('chrome.storage.local.remove(\n        EXTENSION_VOLATILE_LOCAL_KEYS');
    expect(indexSource).toContain('chrome.storage.session.clear');
    expect(routerSource).toMatch(/await self\.__extensionLifecycleReady;[\s\S]*await Promise\.all\(\[loadJobState\(\), TabMapManager\.load\(\)\]\)/);
  });

  test('results registration reconciles an authoritative snapshot', () => {
    const routerSource = read('background/message-router.js');
    const resultsSource = read('results.js');

    expect(routerSource).toMatch(/case 'REGISTER_RESULTS_TAB':[\s\S]*state: buildGlobalStateSnapshot\(\{ includeAnswers: true \}\)/);
    expect(routerSource).toContain('runtimeReset');
    expect(resultsSource).toContain("syncStatusFromGlobalState(pageWasReloaded ? {} : (response?.state || {}), { replace: true });");
    expect(resultsSource).toContain('function clearLiveResponseCards()');
    expect(resultsSource).toContain('const pageWasReloaded = isPageReloadNavigation();');
    expect(resultsSource).toContain("if (pageWasReloaded || response?.runtimeReset === true || !hasLiveSnapshot) {");
    expect(resultsSource).toContain("syncStatusFromGlobalState(pageWasReloaded ? {} : (response?.state || {}), { replace: true });");
    expect(resultsSource).toContain('clearLiveResponseCards();');
    expect(resultsSource).toContain('applyModelButtonSelection([]);');
    expect(resultsSource).toContain("new CustomEvent('extension-runtime-reset'");
    expect(resultsSource).toContain('resetLiveStatusIndicators();');
    expect(resultsSource).toContain("detail: { source: 'extension_reload_reconcile' }");
  });

  test('telemetry UI drops its in-page cache on runtime reset', () => {
    const devtoolsSource = read('results-devtools.js');
    expect(devtoolsSource).toContain("document.addEventListener('extension-runtime-reset'");
    expect(devtoolsSource).toContain('telemetryCache = [];');
    expect(devtoolsSource).toContain('telemetryEventKeys = new Set();');
  });
});
