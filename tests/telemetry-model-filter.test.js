// Поведенческий замок на фильтр моделей в окне телеметрии.
//
// Регрессия, которую он ловит: выпадающий список моделей пересекался (AND) с
// кнопками LLM в шапке страницы. Из-за этого «All platforms» означало не «все»,
// а «выбранные в шапке» — список умел только сужаться внутри шапки и никогда не
// расширялся. При прогоне одной модели любое допустимое значение фильтра давало
// один и тот же результат, а остальные — пустой таймлайн, и фильтр выглядел
// неработающим. Плюс сам список опций строился из захардкоженного каталога из
// десяти платформ, поэтому предлагал модели, событий по которым нет в принципе.
//
// Проверяем не текст исходника, а работу: грузим модуль в jsdom и дёргаем его
// собственный мост.
const fs = require('fs');
const path = require('path');

const DEVTOOLS_PATH = path.join(__dirname, '..', 'results-devtools.js');

const RUN_SESSION_ID = 1786140669676;

const TELEMETRY_HTML = `
  <div id="api-keys-modal">
    <button id="telemetry-tab" class="devtools-tab"></button>
  </div>
  <div id="telemetry-tabpanel">
    <select id="telemetry-platform-select"><option value="all">All platforms</option></select>
    <select id="telemetry-task-select"><option value="all">All tasks</option><option value="cutted">cutted</option></select>
    <select id="telemetry-export-format-select"><option value="digest">Digest</option></select>
    <div id="telemetry-rounds"></div>
    <div id="telemetry-timeline"></div>
    <div id="telemetry-summary"></div>
    <span id="telemetry-status"></span>
    <span id="telemetry-summary-status"></span>
  </div>
  <div class="llm-selector">
    <button id="llm-qwen" class="llm-button active">Qwen</button>
  </div>
`;

// События таймлайна (legacy-форма, .platform) и канонические (.modelId) должны
// сужаться одним и тем же предикатом.
let eventSeq = 0;
const legacyEvent = (platform, type = 'DISPATCH_START') => ({
    ts: Date.now() + (eventSeq += 1),
    platform,
    type,
    label: `${type}-${eventSeq}`,
    meta: { runSessionId: RUN_SESSION_ID, dispatchId: `${platform}:${RUN_SESSION_ID}:1` }
});
const proofEvent = (modelId, eventType = 'SUBMIT_ACTION_OBSERVED') => ({ modelId, eventType, payload: {} });

// Проекция в DOM ленивая: она происходит, только когда окно телеметрии реально
// открыто. Тесту, который проверяет таймлайн, нужно это состояние.
const withVisibleTelemetrySurface = (run) => {
    const modal = document.getElementById('api-keys-modal');
    const tab = document.getElementById('telemetry-tab');
    modal.classList.add('is-visible');
    tab.classList.add('is-active');
    try {
        run();
    } finally {
        modal.classList.remove('is-visible');
        tab.classList.remove('is-active');
    }
};

let bridge;
let platformSelect;
let taskSelect;

beforeAll(() => {
  document.body.innerHTML = TELEMETRY_HTML;
  global.chrome = {
    runtime: {
      lastError: null,
      sendMessage: () => {},
      getURL: (p) => p,
      getManifest: () => ({ version: 'test' })
    },
    storage: { local: { get: () => {}, set: () => {} } }
  };
  window.chrome = global.chrome;
  window.TelemetryExportRuntime = {
    createWorkerClient: () => ({ build: async () => ({}), cancel: () => {} }),
    downloadSerializedArtifact: () => {},
    executeWithRecovery: async () => ({})
  };
  // eslint-disable-next-line global-require
  require(DEVTOOLS_PATH);
  bridge = window.DevtoolsTelemetryBridge;
  platformSelect = document.getElementById('telemetry-platform-select');
  taskSelect = document.getElementById('telemetry-task-select');
  ['qwen', 'gpt'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    platformSelect.appendChild(option);
  });
});

beforeEach(() => {
  platformSelect.value = 'all';
  taskSelect.value = 'all';
});

describe('telemetry model filter', () => {
  test('the module exposes its filter through the bridge', () => {
    expect(typeof bridge?.applyActiveFilter).toBe('function');
    expect(typeof bridge?.isFilterActive).toBe('function');
    expect(typeof bridge?.getActivePlatformNames).toBe('function');
  });

  test('"All platforms" keeps every model even when the header has one LLM active', () => {
    // Кнопка Qwen в шапке активна (см. TELEMETRY_HTML) — раньше именно она
    // молча выбрасывала GPT-события при значении «All platforms».
    expect(document.querySelectorAll('.llm-button.active').length).toBe(1);
    const events = [legacyEvent('Qwen'), legacyEvent('GPT'), legacyEvent('Gemini')];
    expect(bridge.applyActiveFilter(events)).toHaveLength(3);
    expect(bridge.isFilterActive()).toBe(false);
    expect(bridge.getActivePlatformNames()).toEqual([]);
  });

  test('the dropdown widens beyond the header selection instead of only narrowing inside it', () => {
    platformSelect.value = 'gpt';
    const events = [legacyEvent('Qwen'), legacyEvent('GPT'), legacyEvent('GPT')];
    const filtered = bridge.applyActiveFilter(events);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((event) => event.platform === 'GPT')).toBe(true);
    expect(bridge.isFilterActive()).toBe(true);
    expect(bridge.getActivePlatformNames()).toEqual(['gpt']);
  });

  test('picking a model narrows the list, and switching back to all restores it', () => {
    const events = [legacyEvent('Qwen'), legacyEvent('GPT')];
    platformSelect.value = 'qwen';
    expect(bridge.applyActiveFilter(events)).toHaveLength(1);
    platformSelect.value = 'all';
    expect(bridge.applyActiveFilter(events)).toHaveLength(2);
  });

  test('canonical events filter by modelId with the same dropdown value', () => {
    platformSelect.value = 'qwen';
    const events = [proofEvent('Qwen'), proofEvent('GPT'), proofEvent('SYSTEM')];
    const filtered = bridge.applyActiveFilter(events);
    expect(filtered.map((event) => event.modelId)).toEqual(['Qwen']);
  });

  test('the timeline shows events when nothing is filtered', () => {
    // Раньше при пустом выборе LLM в шапке и «All platforms» таймлайн возвращал
    // пустой массив и писал «No telemetry events» поверх полного леджера.
    document.querySelectorAll('.llm-button.active').forEach((btn) => btn.classList.remove('active'));
    withVisibleTelemetrySurface(() => {
      document.dispatchEvent(new CustomEvent('telemetry-event', {
        detail: { events: [legacyEvent('Qwen'), legacyEvent('GPT')] }
      }));
    });
    expect(bridge.getFilteredEvents().length).toBeGreaterThan(0);
    expect(document.getElementById('telemetry-timeline').textContent)
      .not.toContain('No telemetry events');
    document.getElementById('llm-qwen').classList.add('active');
  });

  test('the model dropdown only offers models present in the ledger', () => {
    withVisibleTelemetrySurface(() => {
      document.dispatchEvent(new CustomEvent('telemetry-event', {
        detail: { events: [legacyEvent('Qwen'), legacyEvent('Qwen')] }
      }));
    });
    const values = Array.from(platformSelect.options).map((option) => option.value);
    expect(values).toContain('all');
    expect(values).toContain('qwen');
    // Каталог из десяти платформ больше не подмешивается: DeepSeek в этом
    // прогоне не участвовал, предлагать его — предлагать заведомо пустой экран.
    expect(values).not.toContain('deepseek');
    expect(values).not.toContain('system');
  });
});
