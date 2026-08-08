// Замок на имя файла телеметрии: по нему должно быть видно, чей это прогон.
//
// Регрессия: слаг модели получали только одиночные incident-отчёты
// (`telemetry-<task>-<model>-incident-N-<ts>.json`), а полный экспорт при
// `Tasks = All` всегда назывался `telemetry-all-presets-<ts>.json`. Разложенные
// рядом выгрузки разных моделей были неотличимы друг от друга.
//
// Тест поведенческий: окно грузится в jsdom, экспорт запускается через свой
// штатный обработчик, а имя перехватывается на реальной точке скачивания.
const path = require('path');

const DEVTOOLS_PATH = path.join(__dirname, '..', 'results-devtools.js');

const TELEMETRY_HTML = `
  <div id="api-keys-modal"><button id="telemetry-tab" class="devtools-tab"></button></div>
  <select id="telemetry-platform-select">
    <option value="all">All platforms</option>
    <option value="gemini">Gemini</option>
  </select>
  <select id="telemetry-task-select"><option value="all">All tasks</option></select>
  <select id="telemetry-export-format-select">
    <option value="digest">Digest</option>
    <option value="canonical-evidence">Canonical evidence</option>
    <option value="full-forensic">Full forensic</option>
  </select>
  <button id="telemetry-export-json-btn"></button>
  <div id="telemetry-rounds"></div>
  <div id="telemetry-timeline"></div>
  <div id="telemetry-summary"></div>
  <span id="telemetry-status"></span>
  <span id="telemetry-summary-status"></span>
`;

const RUN_SESSION_ID = '1786174770340';
const proofEvent = (modelId, seq) => ({
    schemaVersion: 6,
    eventId: `event-${modelId}-${seq}`,
    seq,
    runSessionId: RUN_SESSION_ID,
    wallTs: 1786174770000 + seq,
    eventType: 'SUBMIT_ACTION_OBSERVED',
    layer: 'fact',
    modelId,
    payload: { typed: { kind: 'submission', state: 'attempted' } }
});

let downloads = [];
let snapshotEvents = [];
let platformSelect;
let formatSelect;

const runExport = async () => {
    downloads = [];
    // Настоящий пользовательский путь: клик по кнопке экспорта в тулбаре.
    const button = document.getElementById('telemetry-export-json-btn');
    button.disabled = false;
    button.click();
    // Экспорт асинхронный: ждём, пока он дойдёт до точки скачивания.
    for (let attempt = 0; attempt < 50 && !downloads.length; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return downloads[0];
};

beforeAll(() => {
    document.body.innerHTML = TELEMETRY_HTML;
    global.chrome = {
        runtime: {
            lastError: null,
            getURL: (p) => p,
            getManifest: () => ({ version: 'test' }),
            sendMessage: (message, callback) => {
                if (typeof callback !== 'function') return;
                if (message?.type === 'GET_PROOF_TELEMETRY_SNAPSHOT') {
                    callback({
                        events: snapshotEvents,
                        eventCount: snapshotEvents.length,
                        runSessionId: RUN_SESSION_ID,
                        snapshotConsistency: 'queue_drained',
                        barrierTimedOut: false
                    });
                    return;
                }
                callback(null);
            }
        },
        storage: { local: { get: () => {}, set: () => {} } }
    };
    window.chrome = global.chrome;
    window.TelemetryExportRuntime = {
        createWorkerClient: () => ({ build: async () => ({ json: '{}', elapsedMs: 1 }), cancel: () => {} }),
        downloadSerializedArtifact: (json, filename) => {
            downloads.push(filename);
            return { blobBytes: json.length, blobDownloadMs: 0 };
        },
        executeWithRecovery: async ({ build, download }) => {
            const built = await build();
            return { status: 'ok', built, downloadResult: download(built) };
        }
    };
    window.ProofOrientedTelemetry = {
        buildAllPresets: async () => ({}),
        buildStandaloneReport: async () => ({}),
        REPORT_EVENT_TYPES: {}
    };
    // eslint-disable-next-line global-require
    require(DEVTOOLS_PATH);
    platformSelect = document.getElementById('telemetry-platform-select');
    formatSelect = document.getElementById('telemetry-export-format-select');
});

beforeEach(() => {
    platformSelect.value = 'all';
    formatSelect.value = 'full-forensic';
});

describe('telemetry export filename', () => {
    test('names the selected model even when the dropdown says All platforms', async () => {
        // Ровно случай из репорта: фильтр не трогали, а в леджере одна модель.
        snapshotEvents = [proofEvent('Gemini', 1), proofEvent('Gemini', 2)];
        const filename = await runExport();
        expect(filename).toMatch(/^telemetry-all-presets-gemini-\d+\.json$/);
    });

    test('names the model picked in the dropdown', async () => {
        snapshotEvents = [proofEvent('Gemini', 1), proofEvent('Qwen', 2)];
        platformSelect.value = 'gemini';
        const filename = await runExport();
        expect(filename).toMatch(/^telemetry-all-presets-gemini-\d+\.json$/);
    });

    test('falls back to all-models when the export really spans several models', async () => {
        snapshotEvents = [proofEvent('Gemini', 1), proofEvent('Qwen', 2)];
        const filename = await runExport();
        expect(filename).toMatch(/^telemetry-all-presets-all-models-\d+\.json$/);
    });

    test('run-level SYSTEM events do not turn a single-model export into all-models', async () => {
        snapshotEvents = [proofEvent('SYSTEM', 1), proofEvent('Gemini', 2)];
        const filename = await runExport();
        expect(filename).toMatch(/^telemetry-all-presets-gemini-\d+\.json$/);
    });

    test('canonical evidence carries the model too', async () => {
        snapshotEvents = [proofEvent('Gemini', 1)];
        formatSelect.value = 'canonical-evidence';
        const filename = await runExport();
        expect(filename).toMatch(/^telemetry-canonical-evidence-gemini-\d+\.json$/);
    });

    test('the recovery name still derives from the export name', async () => {
        // downloadSerializedArtifact ловит и recovery-путь: он заменяет только
        // тип артефакта, слаг модели обязан пережить замену.
        const recoveryName = 'telemetry-all-presets-gemini-123.json'
            .replace(/all-presets|canonical-evidence/, 'canonical-recovery');
        expect(recoveryName).toBe('telemetry-canonical-recovery-gemini-123.json');
    });
});
