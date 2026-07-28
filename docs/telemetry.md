# Telemetry - tab/session diagnostics

## Native schema 5 ledger v2.81.126 - 2026-07-28

Background runtime ведёт отдельный append-only ledger в
`__proof_telemetry_ledger_v5__`. Запись выполняется до legacy sampling и до
подавления post-terminal noise, поэтому отсутствие строки в старом UI-журнале
не интерпретируется как отсутствие факта.

- Каждое событие получает immutable envelope schema 5, монотонный `seq`,
  уникальный `eventId`, `wallTs`, run-relative `monoMs`, correlation IDs,
  producer и явный layer.
- Записи сериализованы одной mutation chain; export snapshot ждёт завершения
  ранее поставленных append-операций и фиксирует единый boundary.
- При новом run ledger начинается заново; extension update и ручной Clear также
  очищают persistent ledger.
- Exact consecutive no-op events подавляются до persistence.
- Canonical payload проходит metadata-only sanitization до записи.
- JSON export сначала запрашивает `GET_PROOF_TELEMETRY_SNAPSHOT` и строит
  All-presets непосредственно из нативных envelopes. Legacy diagnostics
  используются только как fallback, если native ledger пуст или недоступен.

Для native export `exportAudit.sourceCompatibility.mode` равен
`native-runtime-ledger`, а `canonicalRuntimeEmissionPending=false`.

## Telemetry filters v2.81.125 - 2026-07-28

В toolbar вкладки Telemetry оставлены ровно два фильтра:

- `Platform` — ограничивает события одной платформой;
- `Tasks` — ограничивает события выбранной диагностической задачей: DOM
  Fallback, Pipeline, Streaming, Extraction, Selector, Composer, Send, Error
  или Timeout.

Отдельные `Type`, `Presets` и `Only problems` удалены из UI и экспортного
контура. Выбор `Tasks` использует прежнюю полнотекстовую классификацию события,
поэтому поведение категорий сохранено без третьего параллельного фильтра.

## Proof-oriented export v2.81.124 - 2026-07-28

JSON export на вкладке Telemetry теперь выдаёт канонический контейнер
`all-presets` schema `5.0`, а не набор независимых массивов по платформам.
Точка входа реализации — `shared/proof-oriented-telemetry.js`; UI вызывает её
из `results-devtools.js` после получения полного run-scoped snapshot.

Контейнер содержит:

- один упорядоченный append-only ledger с envelope schema `5`, уникальными
  `eventId`/`seq`, `wallTs` и производным `monoMs`;
- независимые оси submission, generation start, answer identity, наблюдаемой
  генерации, эволюции текста, полноты, extraction, verification, completion,
  observation reliability и finalization;
- восемь embedded reports: `request-not-sent`, `generation-not-started`,
  `truncation`, `true-completion`, `submission-proof`,
  `extraction-integrity`, `forced-success`, `forced-finalization`;
- вычисленные `requestIf` зависимости с результатом по каждой модели;
- compatibility boundary, section hashes, invariant validation, replay marker и
  проверку лимита 1 MB в `exportAudit`;
- только ссылки `eventRefs` внутри отчётов: события не дублируются;
- metadata-only privacy: произвольные details, prompt, answer, HTML, content,
  tokens и credentials не попадают в canonical payload; сохраняются безопасные
  hash/length/state/ID/evidence поля.

### Текущая граница миграции

Runtime продолжает писать совместимые legacy diagnostics. Exporter замораживает
один snapshot и детерминированно преобразует его в canonical ledger. Поэтому
`exportAudit.sourceCompatibility.mode` равен `legacy-runtime-adapter`, а
`canonicalRuntimeEmissionPending=true`. Это намеренная первая стадия cutover:
новый формат, privacy и offline-анализ уже проверяемы, но нативная запись FACT /
INFERENCE / DECISION / ACTION / AUDIT непосредственно в runtime остаётся
следующим этапом. Адаптер не превращает terminal `SUCCESS` в доказательство
completion и не превращает forced finalization в `inferred_complete`.

Нормативный design package находится в
`docs/proof_oriented_telemetry_spec_v1/`; текущий исполняемый контракт этого
этапа задают код и `tests/proof-oriented-telemetry.test.js`.

## Update v2.81.74 - 2026-07-25

Purpose: keep Disput telemetry diagnostic rather than turning it into a second
copy of prompts, model answers and semantic state.

- Disput trace redacts full content fields at ingress, including generic `text`,
  camelCase prompt/answer/HTML names, nested answer evidence, StateMap/context
  snapshots and attachment bodies. Length/hash/IDs remain available.
- Restored trace storage is re-sanitized and immediately rewritten, covering
  events written by older extension versions and removing their raw persisted
  copies (`TraceSchema.VERSION=5`).
- Diagnostic Telemetry-to-Disput bridging uses a safe evidence whitelist and
  drops uninformative legacy info events.
- Derived JSON sections contain event references and compact artifact metadata,
  never embedded copies of canonical events.
- `Only problems` applies to `events`, dispatches, recoveries, divergences,
  participants and barriers through the same visible evidence IDs.
- JSON download has a final deep secret-redaction pass.

## Update v2.81.73 - 2026-07-25

Purpose: make partial generation, tab closure and reasoning/final-answer
confusion visible without exporting provider response content.

- `MODEL_OUTCOME.meta.observedState` distinguishes
  `generating_partial_answer`, `generating`,
  `answer_observed_without_terminal`, `tab_closed_during_generation` and
  terminal state. It also contains latest/max observed text length.
- `TAB_CLOSED.meta` includes `closureState`, terminal/generation flags, last
  answer length and `mappingSource`. `closeOrigin=user_or_external` reflects the
  Chrome API limitation: a removed tab alone does not prove a user click.
- Qwen lifecycle events include `responsePhase` and length/boolean-only
  `phaseEvidence`. `LIFECYCLE_COMPLETION_PHASE_SUSPECT` is a warning when a
  generic completion decision was made on a reasoning-only DOM snapshot.
- `MODEL_FINAL` and `STATE_PROJECTION_COMMITTED` redact full answer text/HTML
  and retain evidence length/hash/source only.
- `MODEL_OUTCOME.meta.consistencyIssues` reports contradictory terminal
  metadata such as `SUCCESS` paired with `doneReason=error`.
- A failed fallback selector is downgraded to informational when another
  selector for the same model/target succeeded in that aggregation window.

## 2026-02-16 12:26 (v2.72.77)
- `SCRIPT_RUNTIME_HARD_STOP_GRACE` added: hard-stop now supports bounded grace extensions when recent runtime activity is present, reducing false timeout terminalization near response completion.
- Runtime activity signals are tracked via diagnostics, prompt submit confirmation, and incoming responses (`lastRuntimeActivityAt/Source`), and used by hard-stop arbitration.
- Passive transport failures now surface as `PING_TRANSPORT_ERROR` (warning) instead of `COMMAND_SEND_ERROR` in ping paths.
- Duplicate terminal responses are ignored with `Response ignored (duplicate terminal)` to prevent repeated `MODEL_FINAL` records.

## Manual Test Procedure
Purpose: verify Telemetry Timeline and Telemetry Rounds without real model traffic.

The Telemetry toolbar orders export actions as JSON download, then MD. JSON uses
the same `ti-download` icon language as model-card export on the main page while
retaining the accessible label `Export telemetry as JSON`; MD remains a textual
button because it exports the combined human-readable All Logs report.
The Disput toolbar follows the same ordering and icon contract: JSON download
first with `ti-download`, followed by the textual MD export.

### Option A — Playwright (automated)
1) Install deps:
```
npm install
```
2) Create `tmp-run-telemetry-check.js` in repo root:
```js
const { chromium } = require('playwright');

(async () => {
  const extPath = '/Users/restart/Downloads/LLM_Codex';
  const userDataDir = '/tmp/pw-llm-codex-profile';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const getExtensionId = async () => {
    const workers = context.serviceWorkers();
    if (workers.length) {
      const url = workers[0].url();
      const match = url.match(/chrome-extension:\/\/(.*?)\//);
      return match ? match[1] : null;
    }
    const worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/(.*?)\//);
    return match ? match[1] : null;
  };

  const extensionId = await getExtensionId();
  if (!extensionId) {
    console.error('Extension ID not found');
    await context.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#telemetry-tab', { timeout: 15000, state: 'attached' });
  await page.evaluate(() => {
    const tab = document.getElementById('telemetry-tab');
    tab && tab.click();
  });

  await page.waitForFunction(() => {
    const panel = document.getElementById('telemetry-tabpanel');
    return panel && !panel.hasAttribute('hidden');
  }, null, { timeout: 15000 });

  const runSessionId = Date.now();
  const dispatchId = `Grok:${runSessionId}:1`;
  const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

  await page.evaluate(async ({ baseMeta }) => {
    const send = (event) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
    });

    const now = Date.now();
    const events = [
      {
        ts: now,
        type: 'TELEMETRY',
        label: 'ROUND1_START',
        details: 'dispatching prompt',
        level: 'error',
        meta: { ...baseMeta, round: 1 }
      },
      {
        ts: now + 200,
        type: 'PIPELINE',
        label: 'PIPELINE_STEP',
        details: '',
        level: 'error',
        meta: { ...baseMeta, step: 'streaming_start' }
      },
      {
        ts: now + 400,
        type: 'TELEMETRY',
        label: 'ROUND1_END',
        details: 'dispatch complete',
        level: 'error',
        meta: { ...baseMeta, round: 1, durationMs: 400 }
      }
    ];

    for (const evt of events) {
      await send(evt);
    }

    if (typeof window.__telemetryRefreshHook === 'function') {
      window.__telemetryRefreshHook();
    }
  }, { baseMeta });

  await page.waitForTimeout(1500);

  const timelineText = await page.locator('#telemetry-timeline').innerText();
  const roundsText = await page.locator('#telemetry-rounds').innerText();

  console.log('--- Telemetry Timeline ---');
  console.log(timelineText.trim());
  console.log('--- Telemetry Rounds ---');
  console.log(roundsText.trim());

  await context.close();
})();
```
3) Run:
```
node tmp-run-telemetry-check.js
```
Expected:
- Timeline shows `ROUND1_START`, `PIPELINE_STEP`, `ROUND1_END`.
- Rounds shows `Grok` row with R1 done + duration.
Optional CI command:
```
HEADLESS=1 npm run test:telemetry
```
Note:
- The automated test includes Round2 markers (`ROUND2_START/END`) to confirm R2 shows up in Telemetry Rounds.
Optional focus-stuck check:
- Send a `FOCUS_STUCK` event and confirm the round cell turns yellow with a tooltip.

### Option B — manual (DevTools console)
1) Open results page:
```
chrome-extension://<ID>/result_new.html
```
2) Switch to **Telemetry** tab.
3) In DevTools Console:
```js
const runSessionId = Date.now();
const dispatchId = `Grok:${runSessionId}:1`;
const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

const send = (event) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
});

const now = Date.now();
Promise.resolve()
  .then(() => send({
    ts: now,
    type: 'TELEMETRY',
    label: 'ROUND1_START',
    details: 'dispatching prompt',
    level: 'error',
    meta: { ...baseMeta, round: 1 }
  }))
  .then(() => send({
    ts: now + 200,
    type: 'PIPELINE',
    label: 'PIPELINE_STEP',
    details: '',
    level: 'error',
    meta: { ...baseMeta, step: 'streaming_start' }
  }))
  .then(() => send({
    ts: now + 400,
    type: 'TELEMETRY',
    label: 'ROUND1_END',
    details: 'dispatch complete',
    level: 'error',
    meta: { ...baseMeta, round: 1, durationMs: 400 }
  }))
  .then(() => {
    if (window.__telemetryRefreshHook) window.__telemetryRefreshHook();
  });
```
Expected:
- Timeline shows the three events.
- Rounds shows `Grok` row with R1 done.

## Update v2.72.00 - 2026-01-31 22:04 UTC
Purpose: stabilize telemetry schema and add detector/selector signal tracing.
- Telemetry normalization now enforces `runSessionId`/`dispatchId` and stamps `schemaVersion=2`, so every event has consistent correlation keys. (File: `background/telemetry-logs.js`)
- Pipeline steps emit `PIPELINE_STEP` with `meta.step`, and `STATE_CHANGE` captures FSM transitions (INIT→DISPATCHING→GENERATING→FINALIZING→COLLECTING→DONE/ERROR). (File: `content-scripts/unified-answer-pipeline.js`)
- Completion detector now emits `DETECTOR_TICK` and `DETECT_DONE` with signals, stability, focus/hidden, and score metadata. (File: `content-scripts/unified-answer-watcher.js`)
- Selector diagnostics are aggregated into `SELECTOR_STATS` with hit/miss ratios and selector pack version. (File: `content-scripts/unified-answer-watcher.js`)
- Structured telemetry errors added for `PORT_CLOSED`, `HANDSHAKE_TIMEOUT`, and `RECOVERY_ACTION`. (File: `background/dispatch-coordinator.js`)
- `MODEL_MISSING` now carries an integrity snapshot for faster RCA. (File: `background/job-orchestrator.js`)
- Telemetry Summary groups by `dispatchId` and understands `PIPELINE_STEP`. (File: `results-devtools.js`)

## Update v2.72.01 - 2026-01-31 22:40 UTC
Purpose: harden canonical telemetry output and verify Round2 visibility.
- `PIPELINE_COMPLETE` is deduplicated per `runSessionId|dispatchId|llmName`. (File: `background/telemetry-logs.js`)
- `ROUND*_START/END` now always includes `dispatchId` in meta. (File: `background/job-orchestrator.js`)
- Telemetry DevTools test now includes Round2 markers in Timeline/Rounds checks. (File: `tests/telemetry-devtools-check.js`)

## Update v2.72.02 - 2026-01-31 22:53 UTC
Purpose: add visibility, tab-level, performance, and interaction telemetry.
- `DISPATCH_*` and `PIPELINE_*` include `visibilityState/hasFocus` metadata. (Files: `background/dispatch-coordinator.js`, `content-scripts/unified-answer-pipeline.js`)
- `TAB_READY_*`, `TAB_VISIT`, and `HANDSHAKE_TIMEOUT` include `discarded/windowId/lastAccessedAgeMs`. (Files: `background/tab-manager.js`, `background/human-presence.js`, `background/dispatch-coordinator.js`)
- `AUDIO_CONTEXT_OK/FAIL` logs keep-alive status for TabProtector. (Files: `content-scripts/pipeline-modules.js`, `content-scripts/unified-answer-pipeline.js`)
- `DETECTOR_TICK/DETECT_DONE` now include `responseTextLength`, `growthRate`, `timeToFirstToken`, `timeToStopVisible`, `timeToRegenerateVisible`. (File: `content-scripts/unified-answer-watcher.js`)
- User markers: `USER_FOCUS_CHANGE`, `HUMAN_VISIT_START/END`, `MANUAL_PING_SUCCESS/FAIL`. (Files: `background/human-presence.js`, `background/message-router.js`)
- `RUN_SUMMARY` emits session totals (duration, success %, stalled, avg round times, error distribution). (File: `background/job-orchestrator.js`)

## Update v2.72.03 - 2026-01-31 23:07 UTC
Purpose: highlight focus-stuck events in Telemetry Rounds.
- `FOCUS_STUCK` emitted when a model tab keeps focus for >30s without switching to results/other models. (File: `background/human-presence.js`)
- Telemetry Rounds highlights the round cell in yellow, shows time in the cell, and exposes a timeout tooltip. (File: `results-devtools.js`)

## Update v2.72.35 - 2026-02-12 22:25 CET
Purpose: close two telemetry gaps that hid real completion and long-lived same-tab focus states.
- Same-tab `source` transitions now rearm or clear hard-cap deterministically, so `human_visit/automation_focus` cannot silently bypass `HUMAN_VISIT_HARD_CAP` after ownership switch. (File: `background/human-presence.js`)
- Markdown export now maps `MODEL_FINAL/FINAL_STATUS` to `R4 END` (and `ROUND0_TAB_OPENED` to `R0 END`), aligning `All Logs` round matrix with actual terminal events. (File: `results.js`)
- Version pinned to `2.72.35` for this behavior set. (File: `manifest.json`)

## Update v2.72.64 - 2026-02-13 14:03 CET
Purpose: stop geometry regressions during tab focus and reduce false dispatch loops on GPT/Gemini.
- Tab activation no longer forces window state to `normal`; only window focus and tab activation are applied, preserving current browser geometry. (File: `background/tab-manager.js`)
- Round1 now emits explicit skip reasons (`tab_not_found`, `tab_not_ready`) and performs a retry tab-resolution path before skipping, so Gemini-like misses are visible and recoverable. (File: `background/job-orchestrator.js`)
- Pre-dispatch health ping no longer triggers eager reload in Round1/first attempts; reload is limited to retry-supervisor attempts, reducing channel churn (`message port/channel closed`). (File: `background/dispatch-coordinator.js`)
- Gemini now throws `send_failed` when send is not confirmed and does not emit `PROMPT_SUBMITTED` on unconfirmed send. (File: `content-scripts/content-gemini.js`)
- ChatGPT now reuses an already prepared composer prompt for duplicate dispatches within a short window instead of rewriting the text, reducing delete/reinsert loops on retries. (File: `content-scripts/content-chatgpt.js`)
- Version pinned to `2.72.64`. (File: `manifest.json`)

## Update v2.72.65 - 2026-02-13 14:14 CET
Purpose: prevent silent Round1 misses for Claude/Gemini and auto-recover from `ROUND2 not_confirmed`.
- Round0 now waits for per-model tab binding readiness after `deferDispatch` startup, instead of assuming tab creation is complete immediately. Timeout path emits `ROUND0_BIND_WAIT_TIMEOUT`. (File: `background/job-orchestrator.js`)
- Round1 integrity guard now runs before dispatch (`ensureRoundEntries(..., pre_round1)`), and missing model entries are repaired before per-model dispatch. (File: `background/job-orchestrator.js`)
- Round2 adds model-scoped repair dispatch for `Claude` and `Gemini`: when prompt confirmation is still missing after verify visits, dispatcher state is reset and a focused resend is attempted with telemetry (`ROUND2_REPAIR_DISPATCH_START/OK/FAIL/ERROR`). (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.65`. (File: `manifest.json`)

## Update v2.72.66 - 2026-02-14 18:52 CET
Purpose: eliminate duplicate prompt insertion in Claude on retry cycles when send is not confirmed.
- Claude prompt-prepared dedupe is now keyed by prompt fingerprint (instead of session-scoped fingerprint), so retries in a new dispatch/session do not reinsert the same text. (File: `content-scripts/content-claude.js`)
- Claude now skips typing/paste whenever composer already contains the expected prompt head, then proceeds directly to send confirmation path. (File: `content-scripts/content-claude.js`)
- Version pinned to `2.72.66`. (File: `manifest.json`)

## Update v2.72.67 - 2026-02-14 19:07 CET
Purpose: stop aggressive Claude tab reload loops caused by passive `getResponses` recovery.
- Passive transport recovery (`reinject/reload`) is now disabled by default for background `getResponses` probes, so automatic collection ticks do not reload model tabs on every channel error. (File: `background/dispatch-coordinator.js`)
- Manual ping keeps explicit recovery enabled, preserving on-demand repair behavior when user triggers it intentionally. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.67`. (File: `manifest.json`)

## Update v2.72.68 - 2026-02-14 23:30 CET
Purpose: scope telemetry export/UI to the latest run and remove stale-round artifacts.
- `All Logs` markdown export now scopes telemetry to the current run session and trims to the latest run cycle (`latest ROUND0_START`), then applies the same scope to diagnostics logs. (File: `results.js`)
- Telemetry round aggregation now normalizes `ROUND*_COMPLETE` as round end and infers missing `R0..R3` end markers when `R4` is already complete, eliminating false `running` cells after finalization. (Files: `results.js`, `results-devtools.js`)
- DevTools Telemetry now renders timeline/rounds on the current run scope instead of the full cache, reducing stale mixed-session rows. (File: `results-devtools.js`)
- Manual ping transport errors for models already in terminal state are logged as warning (`Manual ping skipped (terminal)`) instead of hard error, reducing false red noise. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.68`. (File: `manifest.json`)

## Update v2.72.69 - 2026-02-14 23:55 CET
Purpose: hide pre-run telemetry noise and keep exports strictly scoped to active execution.
- `All Logs` now returns an empty telemetry/diagnostics section when no active run is detected (`no ROUND0_START` and no `runSessionId`), instead of exporting unscoped startup events like `SCRIPT_LOADED`. (File: `results.js`)
- Run scoping now falls back to the latest `ROUND0_START` cycle only when session ids are unavailable, and diagnostics are filtered by the same bounded time window. (File: `results.js`)
- DevTools telemetry bridge/export/copy now always uses scoped events only; it no longer falls back to full cache when scoped list is empty. (File: `results-devtools.js`)
- Version pinned to `2.72.69`. (File: `manifest.json`)

## Update v2.72.70 - 2026-02-15 00:14 CET
Purpose: fix false `cycle fallback` when a valid run id is present.
- Fixed run-scope resolver guard: `runSessionId = null` is no longer coerced to `0`, so current run id is correctly auto-detected from telemetry events. (File: `results.js`)
- Applied the same fix in DevTools run-scope filter to keep timeline/rounds/export aligned with the active run. (File: `results-devtools.js`)
- Version pinned to `2.72.70`. (File: `manifest.json`)

## Update v2.72.71 - 2026-02-15 09:06 CET
Purpose: prevent long Round2 stalls from blocking Round3/Round4 and reduce false model-missing alarms.
- Added a hard batch budget for Round2 verification (`ROUND2_BATCH_MAX_MS=45000`). When budget is exhausted, remaining models are force-marked with `ROUND2_SKIP batch_timeout`, and collection probes are scheduled for confirmed prompts so the run advances autonomously to later rounds. (File: `background/job-orchestrator.js`)
- Added `ROUND2_CUTOFF` telemetry to make forced cutover explicit in logs when Round2 exceeds batch budget. (File: `background/job-orchestrator.js`)
- Hardened post-round integrity check: it now verifies active session, restores missing entries via `ensureRoundEntries`, and only then evaluates `MODEL_MISSING`, reducing false positives after manual tab activity. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.71`. (File: `manifest.json`)

## Update v2.72.72 - 2026-02-15 09:16 CET
Purpose: enforce deterministic reveal scroll before response collection to reduce yellow-state lag.
- Added `runPreCollectScrollNudge` in orchestrator: focused tab performs `up-half -> down-bottom` scroll nudge before collection probes, with telemetry (`PRECOLLECT_NUDGE`, `PRECOLLECT_NUDGE_SKIP`, `PRECOLLECT_NUDGE_ERROR`). (File: `background/job-orchestrator.js`)
- Round2 now runs this pre-collect nudge before `round2_probe` in confirmed/auto-cutoff paths, so prompt-confirmed models get a reveal pass before `getResponses`. (File: `background/job-orchestrator.js`)
- Round3 now runs the same nudge before `round3_collect` ping for incomplete models. (File: `background/job-orchestrator.js`)
- Manual ping now runs the same nudge before `getResponses` for non-terminal models. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.72`. (File: `manifest.json`)

## Update v2.72.73 - 2026-02-15 10:20 CET
Purpose: eliminate yellow stalls for Claude/Grok when answer is already visible but collection ping does not finalize model status.
- `getResponses` ping meta now includes active run scope (`runSessionId/sessionId/dispatchId`) and `forceEmitOnUnchanged`, so ping extraction remains tied to current dispatch and can re-emit stable answers when needed. (File: `background/job-orchestrator.js`)
- Claude content script now implements `action: getResponses` with non-destructive DOM extraction (`withSmartScroll` + stability check + completion signal) and emits `LLM_RESPONSE`/`MANUAL_PING_RESULT` instead of dropping ping requests. (File: `content-scripts/content-claude.js`)
- Grok and Qwen ping extraction now re-emit non-empty answers on `unchanged` when background requests forced emission, preventing false yellow states where answer exists but was ignored as cache-equal. (Files: `content-scripts/content-grok.js`, `content-scripts/content-qwen.js`)
- Version pinned to `2.72.73`. (File: `manifest.json`)

## Update v2.72.74 - 2026-02-15 21:51 CET
Purpose: enforce a hard script-stop limit to prevent endless content-script activity and focus lock loops.
- Added a per-model hard-stop guard `SCRIPT_RUNTIME_HARD_STOP_MS = 180000` in dispatch coordinator. On timeout, background emits `SCRIPT_RUNTIME_HARD_STOP`, sends `HUMANOID_FORCE_STOP` + `STOP_AND_CLEANUP` to the model tab, and finalizes with `script_runtime_hard_stop`. (File: `background/dispatch-coordinator.js`)
- Guard lifecycle is now explicit: timer starts on first `GET_ANSWER` dispatch attempt, is cleared on final model response, and all active guards are cleared during global stop/reset. (Files: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`)
- Version pinned to `2.72.74`. (File: `manifest.json`)

## Update v2.72.75 - 2026-02-15 23:31 CET
Purpose: stop false ERROR finalization after real success and reduce hard-stop/terminal ping telemetry noise.
- Hard-stop timer is now armed from confirmed submit state (`PROMPT_SUBMITTED` / confirmed dispatch), so `180000ms` is counted from real generation start, not from first speculative `GET_ANSWER` call. (Files: `background/dispatch-coordinator.js`, `background/message-router.js`)
- `SCRIPT_RUNTIME_HARD_STOP` logging is now single-source via telemetry emit (removed duplicate pipeline append path), reducing duplicate hard-stop rows in timeline/export. (File: `background/dispatch-coordinator.js`)
- Added terminal monotonic guard: once model is finalized with success terminal status, later failure payloads for the same dispatch are ignored (`Response ignored (terminal success locked)`), preventing `SUCCESS -> ERROR` downgrade races. (File: `background/job-orchestrator.js`)
- Manual ping now short-circuits terminal models before transport send, avoiding avoidable `COMMAND_SEND_ERROR` noise after completion. (File: `background/job-orchestrator.js`)
- Version pinned to `2.72.75`. (File: `manifest.json`)

## Update v2.72.76 - 2026-02-16 01:56 CET
Purpose: stabilize round orchestration by separating run state from tab cleanup events and gating Round4 by real model completion.
- `SPA_NAVIGATION` no longer performs hard cleanup of model runtime state; it now marks tab readiness stale, stores navigation metadata, and emits scoped telemetry. This prevents active run entries from being deleted on normal SPA URL transitions. (File: `background/message-router.js`)
- Cleanup manager now preserves active run model entries (`jobState.llms`) for selected session models; on tab cleanup it resets transient tab/dispatch fields instead of deleting model state. This removes the `ROUND_STATE_REPAIR` collapse pattern caused by mid-run entry deletion. (File: `background/cleanup-manager.js`)
- Added explicit Round4 completion gate: orchestrator now waits for non-terminal models before focusing results tab, force-finalizes stalled `no_send` models after grace period, and applies a bounded gate timeout with deterministic terminalization. (File: `background/job-orchestrator.js`)
- Added canonical model-entry factory (`buildInitialLlmEntry`) and reused it in start/repair flows to avoid partial recovery records that break later rounds and human-visit logic. (File: `background/job-orchestrator.js`)
- Human-presence scheduler now avoids focusing results while rounds are in progress and tracks pending state from session-selected models, reducing false returns to the extension page during active run orchestration. (File: `background/human-presence.js`)
- Version pinned to `2.72.76`. (File: `manifest.json`)

## Update v2.72.15 - 2026-02-02 10:03 UTC
Purpose: stabilize round visibility and stop focus loops on completed models.
- Round3 now emits skip markers for already-completed models, so the matrix shows completion instead of empty cells. (File: `background/job-orchestrator.js`)
- Missing model entries are restored before Round2 to keep R2/R4 markers from dropping for models that completed early. (File: `background/job-orchestrator.js`)
- Human visit loop ignores models with final status markers even if their status string is stale, preventing unnecessary focus bouncing. (File: `background/human-presence.js`)

## Update v2.72.18 - 2026-02-02 16:14 UTC
Purpose: reduce post-R2 stalls and prevent premature Claude hard-timeout finalization.
- After `ROUND2_END`, models without `MODEL_FINAL` schedule a short auto-collect visit + `getResponses` to capture late answers. (File: `background/job-orchestrator.js`)
- Round3 skip markers are emitted only when `MODEL_FINAL` is recorded, avoiding false skips on in-progress models. (File: `background/job-orchestrator.js`)
- Claude hard-timeout now triggers a retry extraction window and is marked as degraded before final ERROR. (File: `background/job-orchestrator.js`)
- Streaming hard-timeout budget is extended for Claude during generation. (File: `content-scripts/unified-answer-pipeline.js`)

## Update v2.72.19 - 2026-02-03 18:23 UTC
Purpose: keep focus scoped to the current run while allowing safe fallback.
- Current run tracks `boundTabIds` and uses them as the primary scope when resolving/attaching tabs. (Files: `background/job-orchestrator.js`, `background/tab-manager.js`)
- When run scope is empty, resolvers fall back to eligible tabs with a `RUN_SCOPE_FALLBACK` telemetry marker for auditability. (File: `background/tab-manager.js`)
- Attach telemetry records whether a tab came from the bound scope or from fallback. (File: `background/tab-manager.js`)

## Update v2.72.30 - 2026-02-04 20:21 UTC
Purpose: wipe cached telemetry on startup to keep timeline fresh.
- `CLEAR_DIAG_EVENTS` is invoked on `chrome.runtime.onStartup`/`onInstalled`, resetting `__diagnostics_events__` so Telemetry Timeline no longer replays old runs after an extension reload. (File: `background/message-router.js`)

## Update v2.72.34 - 2026-02-12 20:26 CET
Purpose: prevent focus hangs and preserve round/final visibility under heavy telemetry noise.
- Human visit flow now has a hard-cap timeout (`HUMAN_VISIT_HARD_CAP`) that force-ends stuck visits after 12s and releases focus ownership. (File: `background/human-presence.js`)
- Passive `getResponses` channel now attempts recovery (reinject/reload + ready-check) on `message port closed` / dead receiver before failing, with `PASSIVE_SEND_RECOVERY_ATTEMPT/RESULT` telemetry. (File: `background/dispatch-coordinator.js`)
- Telemetry DevTools cache trimming is now pin-aware: `ROUND*`, `MODEL_FINAL`, `FINAL_STATUS`, `FOCUS_STUCK`, and critical submit markers are retained when the 400-event UI cap is reached. (File: `results-devtools.js`)
- Telemetry Rounds treats `MODEL_FINAL/FINAL_STATUS` as `R4 END`, so results completion is shown even when explicit `ROUND4_END` was not emitted. (File: `results-devtools.js`)

## Update v2.72.33 - 2026-02-12 18:16 CET
Purpose: reduce yellow-state lag and stabilize Round2 visibility.
- Added per-model adaptive response probing started from `promptSubmittedAt` (not from global run start): fast -> medium -> slow intervals with an automatic stop window. (File: `background/job-orchestrator.js`)
- `PROMPT_SUBMITTED` now triggers adaptive probing immediately for the confirmed model, so delayed finalization can be captured without manual tab visits. (File: `background/message-router.js`)
- Round2 now always emits `ROUND2_START` and `ROUND2_END` for every selected model, including skip paths (`api_dispatch`, `already_confirmed`, `tab_not_found`, `not_confirmed`). (File: `background/job-orchestrator.js`)
- Adaptive probe timers are cleared on final model status and global stop to avoid stale background polling. (File: `background/job-orchestrator.js`)

## Update v2.72.31 - 2026-02-12 14:03 UTC
Purpose: reduce lag between visual answer completion and `MODEL_FINAL`.
- Round2 and Round3 now trigger immediate response probes (`getResponses`) right after forced visits, so finalized answers are collected without waiting for later rounds or manual actions. (File: `background/job-orchestrator.js`)
- Human visit simulation adds a completion nudge scroll pattern (up ~half-screen, then down to bottom) that mirrors effective manual behavior and helps completion signals settle faster. (File: `background/human-presence.js`)

## Update v2.72.16 - 2026-02-02 11:29 UTC
Purpose: mark R0 as complete when a tab is opened.
- `ROUND0_TAB_OPENED` now resolves as the R0 completion marker for the model row. (File: `results-devtools.js`)

## Update v2.72.17 - 2026-02-02 15:03 UTC
Purpose: remove the unstable paired All Logs export.
- Removed the "All ±" paired export button and its handler. (Files: `result_new.html`, `results.js`)

## Update v2.72.14 - 2026-02-02 09:19 UTC
Purpose: hide startup telemetry noise until a model is selected or a filter is applied.
- Telemetry Timeline stays empty unless a model is selected or filters are set, preventing early SCRIPT_LOADED entries. (File: `results-devtools.js`)

## Update v2.72.12 - 2026-02-02 08:44 UTC
Purpose: enforce short verification visits for autonomy and make pre-collect focus deterministic.
- Round2 now performs 1–2 forced automation visits (5–8s) with light scroll to confirm prompt submission without manual focus. (Files: `background/job-orchestrator.js`, `background/human-presence.js`)
- Round3 pre-collect now runs a short forced visit before collection, replacing the no-op when human-presence is inactive. (File: `background/job-orchestrator.js`)
- Automation visits accept custom dwell/scroll timing and emit a distinct visit reason for traceability. (File: `background/human-presence.js`)

## Update v2.72.11 - 2026-02-02 07:07 UTC
Purpose: prevent duplicated session summaries and repeated finalization counters.
- Model finalization now records a one-time final status marker and skips `responsesCollected`/`completed` increments on repeated responses, avoiding multiple `RUN_SUMMARY` emissions after manual pings. (File: `background/job-orchestrator.js`)

## Update v2.72.09 - 2026-02-01 21:37 UTC
Purpose: restore service worker startup after telemetry buffer changes.
- Fixed duplicate global identifiers in the background scripts by namespacing diagnostics buffer helpers, preventing `Identifier 'PINNED_LABELS' has already been declared` during worker boot. (File: `background/message-router.js`)

## Update v2.72.08 - 2026-02-01 12:13 UTC
Purpose: preserve Round markers in exports even after heavy manual intervention.
- All Logs export now prefers the unfiltered telemetry cache and merges it with runtime diagnostics, so R1/R2/R3 markers are not lost when UI filters are active. (File: `results.js`)
- Diagnostics storage trimming now preserves `ROUND*` and final-status markers by evicting unpinned entries first, and `GET_DIAG_EVENTS` uses the same pinned-aware trimming. (Files: `background/telemetry-logs.js`, `background/message-router.js`)

## Update v2.72.06 - 2026-02-01 09:19 UTC
Purpose: recover send attempts when the content channel is dead.
- Send now attempts a reinject/reload recovery on `message port closed` / `receiving end does not exist`, retries once, and emits `SEND_RECOVERY_ATTEMPT` / `SEND_RECOVERY_RESULT` plus `SEND_SKIPPED` on failure. (File: `background/dispatch-coordinator.js`)

## Update v2.72.07 - 2026-02-01 12:13 UTC
Purpose: add canonical final, budgets, foreground leasing, and detector diagnostics.
- `MODEL_FINAL` captures the canonical final status, done reason, duration, answer length, provider, focus switches, and foreground time. (File: `background/job-orchestrator.js`)
- Phase budgets emit `BUDGET_EXHAUSTED` for dispatch/generation/collect timeouts. (Files: `background/job-orchestrator.js`, `background/dispatch-coordinator.js`)
- Foreground leases emit `LEASE_GRANTED/LEASE_RELEASED` with duration and accumulated foreground time. (File: `background/human-presence.js`)
- `DETECT_DONE` now carries `stableChecksUsed` and `lastChangeMsAgo`. (File: `content-scripts/unified-answer-watcher.js`)

## Update v2.72.05 - 2026-02-01 09:20 UTC
Purpose: standardize command-send errors and preserve reasons.
- `COMMAND_SEND_ERROR` replaces the old label and stores `meta.reason` for reliable RCA. (Files: `background/dispatch-coordinator.js`, `background/job-orchestrator.js`)

## Update v2.72.04 - 2026-01-31 23:29 UTC
Purpose: export full telemetry with rounds table and surface All Logs in Telemetry.
- All Logs export now includes a Telemetry Rounds table in the Markdown output. (File: `results.js`)
- Telemetry toolbar includes a short All Logs button (no `.md`). (File: `result_new.html`)

## Update v2.71.99 - 2026-01-31 02:00 UTC
Purpose: trim noisy telemetry by deduplicating tab-visits, condensing Round0, and aggregating selector misses.
- `TAB_VISIT` is now carried only via diagnostics logs instead of both diagnostics and telemetry, eliminating the duplicate rows that previously appeared in the timeline. (File: `background/human-presence.js`)
- Round0 now emits only per-model `ROUND0_TAB_OPENED` markers plus a single `ROUND0_COMPLETE` summary, so the opening phase adds at most two rows per model instead of four. (File: `background/job-orchestrator.js`)
- Selector miss diagnostics are grouped every ~5 seconds and emitted as aggregated events (`SELECTOR_MISS` with `aggregated=true` and a count/duration), dramatically reducing the spam that used to appear when selectors missed while a tab ran in the background. (File: `content-scripts/unified-answer-watcher.js`)
- DevTools now keeps the Telemetry Timeline empty until you either select a model or apply a filter, preventing the initial `SCRIPT_LOADED` noise from showing up as a Grok event. (File: `results-devtools.js`)

## Update v2.71.77 - 2026-01-30 21:20 UTC
Purpose: backfill Telemetry Rounds from diagnostics when telemetry storage misses per-model round events.
- Telemetry refresh now injects `ROUND*`/`TAB_VISIT` entries from the in-page diagnostics cache via `window.__getDiagnosticLogs`, so the Rounds matrix can render per-model progress even if sampling drops the telemetry events. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.69 - 2026-01-30 20:05 UTC
Purpose: make the diagnostics 🗑️ control actually drops persisted logs.
- The diagnostics clear button now empties the local `llmLogs` cache before posting `CLEAR_DIAG_EVENTS`, so clicking it removes both the UI rows and the storage-held `__diagnostics_events__`. (File: `results.js`)

## Update v2.71.68 - 2026-01-30 19:15 UTC
Purpose: ensure the telemetry toolbar buttons keep firing even when the DOM around them changes.
- Telemetry action clicks now walk up the event path and match the button selector before dispatching the refresh/reset/copy/export handlers, so emojis or rewrites inside the button still trigger the DevTools actions. (File: `results-devtools.js`)

## Update v2.71.76 - 2026-01-30 20:55 UTC
Purpose: keep Telemetry Rounds from losing diagnostics-derived round events on refresh.
- Telemetry refresh now merges new storage events into the live cache instead of replacing it, preserving round markers added from diagnostics streams. (File: `results-devtools.js`)

## Update v2.71.75 - 2026-01-30 20:40 UTC
Purpose: fill round cells even when only global ROUNDS events exist.
- Telemetry Rounds now merges global `ROUNDS` start/end events into per-model rows when per-model markers are missing. (File: `results-devtools.js`)

## Update v2.71.74 - 2026-01-30 20:20 UTC
Purpose: make Telemetry Rounds resilient to label formatting differences.
- Round detection now uses `meta.round` when available and normalizes labels before parsing, so round cells populate even if separators differ. (File: `results-devtools.js`)

## Update v2.71.73 - 2026-01-30 20:00 UTC
Purpose: prevent double execution of telemetry refresh/reset.
- Removed page-level delegated click handler; refresh/reset are now handled solely inside `results-devtools.js`. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.72 - 2026-01-30 19:45 UTC
Purpose: surface refresh failures in UI and harden refresh/reset flow.
- Telemetry refresh now reports runtime errors/status in the toolbar; fallback hooks remain to guarantee handler execution. (File: `results-devtools.js`)

## Update v2.71.71 - 2026-01-30 19:25 UTC
Purpose: make telemetry refresh/reset callable even if UI handlers miss the click.
- Telemetry script now exposes global hooks (`__telemetryRefreshHook`, `__telemetryResetHook`), and the page-level capture handler invokes them with a retry. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.70 - 2026-01-30 19:05 UTC
Purpose: ensure telemetry refresh/reset works even if button handlers were missed.
- Telemetry toolbar clicks now re-inject the telemetry script and dispatch explicit refresh/reset events as a fallback. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.67 - 2026-01-30 18:35 UTC
Purpose: guarantee telemetry DevTools logic loads even if initial script injection fails.
- Results now re-injects `results-devtools.js` if telemetry boot flag is missing, and the telemetry script guards against double init. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.66 - 2026-01-30 18:20 UTC
Purpose: ensure Telemetry toolbar actions fire even if the buttons are injected after script load.
- Telemetry action buttons now have a capture-phase delegated click handler, so refresh/reset/copy/export work reliably. (File: `results-devtools.js`)

## Update v2.71.65 - 2026-01-30 18:05 UTC
Purpose: ensure Telemetry Rounds updates even when filters return zero timeline events.
- Telemetry Rounds now renders from the full telemetry cache before timeline filtering, so it stays current even if the timeline is empty. (File: `results-devtools.js`)

## Update v2.71.64 - 2026-01-30 17:50 UTC
Purpose: keep Telemetry Rounds in sync with live diagnostic events instead of relying only on refresh polling.
- Live `LLM_DIAGNOSTIC_EVENT` messages now broadcast `telemetry-event` updates to the DevTools telemetry view, which merges and de-duplicates incoming events before rendering. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.63 - 2026-01-30 17:30 UTC
Purpose: ensure Telemetry Rounds refreshes when the devtools tab is activated programmatically.
- Devtools tab changes now dispatch a `devtools-tab-change` event so Telemetry can start/stop auto-refresh reliably. (Files: `results.js`, `results-devtools.js`)

## Update v2.71.62 - 2026-01-30 17:20 UTC
Purpose: ensure Telemetry Rounds recognizes round events even when labels are stored in meta.
- Telemetry Rounds now resolves round labels from `label`, `meta.event`, or `event`, so entries still render when the label is stored only in metadata. (File: `results-devtools.js`)

## Update v2.71.61 - 2026-01-30 16:55 UTC
Purpose: ensure per-model round telemetry is never sampled out.
- Per-model `ROUND#_*` events are now forced through telemetry sampling so Telemetry Rounds always fills per model even when sampling is off. (File: `background/job-orchestrator.js`)

## Update v2.71.60 - 2026-01-30 16:40 UTC
Purpose: make the Telemetry Timeline entirely neutral.
- The timeline no longer adds `is-flagged` decorations for ROUND2_VERIFY/TAB_VISIT; entries rely only on their level for coloring. (File: `results-devtools.js`)
- The `telemetry-row.is-flagged` style was removed because the DOM no longer emits that class. (File: `styles.css`)

## Update v2.71.59 - 2026-01-30 16:10 UTC
Purpose: bring Telemetry Rounds to the top and shorten the column headers to R0‑R4.
- Telemetry Rounds is now the first card so the matrix is immediately visible, with the Timeline and Summary stacked beneath it. (Files: `result_new.html`, `results-devtools.js`)
- Column labels were shortened from “Round0…Round4” to “R0…R4” while keeping the rounded metadata intact. (File: `results-devtools.js`)

## Update v2.71.58 - 2026-01-30 15:55 UTC
Purpose: present Telemetry Rounds as a per-model matrix with colored round statuses.
- Each row now represents a model; columns cover Round0–Round4 with time stamps, durations, and visit notes sourced from the new per-model telemetry events. (Files: `results-devtools.js`, `styles.css`)
- Per-model `ROUND#_*` events and forced `TAB_VISIT` telemetry are emitted by the background so the matrix always has fresh data even when sampling would normally drop it. (Files: `background/job-orchestrator.js`, `background/human-presence.js`)

## Update v2.71.57 - 2026-01-30 15:35 UTC
Purpose: improve Telemetry Rounds and Summary readability.
- Telemetry Rounds now shows the model name as the first column. (Files: `results-devtools.js`, `styles.css`)
- Telemetry Summary columns are reordered to show model before time. (Files: `results-devtools.js`, `styles.css`)

## Update v2.71.56 - 2026-01-30 15:20 UTC
Purpose: guarantee round/visit telemetry is always recorded and visible.
- Round start/end events are now forced through telemetry sampling so `ROUND*_START/END` never vanish from Telemetry Rounds. (File: `background/job-orchestrator.js`)
- `TAB_VISIT` telemetry is forced through sampling for full alignment with Diagnostics. (File: `background/human-presence.js`)
- Telemetry Rounds uses the full telemetry cache (not filtered by selected model), and JSON exports always include round/visit events. (File: `results-devtools.js`)

## Update v2.71.55 - 2026-01-30 15:00 UTC
Purpose: ensure Telemetry Summary/Rounds populate even when no LLM is manually selected.
- Telemetry filtering now defaults to showing all events instead of showing nothing when no LLM is selected. (File: `results-devtools.js`)
- Platform/type filters now populate from actual telemetry events when no selection is active, so the summary/rounds list can render immediately. (File: `results-devtools.js`)

## Update v2.71.54 - 2026-01-30 14:45 UTC
Purpose: let the expanded Telemetry Summary and Telemetry Rounds blocks open reliably from the DevTools panel.
- headers under `Telemetry Summary` and `Telemetry Rounds` now respond to a single click or keyboard activation (Enter/Space) in addition to double-click, so these cards open/close immediately without getting stuck collapsed. (File: `results-devtools.js`)
- the cards’ toggle controls now keep their expanded/collapsed aria state in sync with the header tooltip text. (File: `results-devtools.js`)

## Update v2.71.53 - 2026-01-30 14:30 UTC
Purpose: restore Perplexity’s early readiness signal so ACK_READY resolves before prompt dispatch.
- `SCRIPT_READY_EARLY` from the Perplexity content script now triggers in telemetry, showing the earliest moment the platform’s composer is ready and preventing the background from giving up on message channels that are still booting.
- `PERPLEXITY_ACK_BYPASS` remains documented under v2.71.52; the new signal complements it by confirming the tab really reached the composer before we skip the full ACK wait.

## Update v2.71.52 - 2026-01-30 13:45 UTC
Purpose: allow Perplexity dispatch to proceed even when ACK_READY is not emitted.
- `PERPLEXITY_ACK_BYPASS` records when ACK_READY wait is skipped so GET_ANSWER can proceed.

## Update v2.71.50 - 2026-01-30 13:00 UTC
Purpose: surface Round2 verification and tab visit timing in telemetry.
- `ROUND2_VERIFY` events now appear in telemetry with `prompt not confirmed` details, matching diagnostics’ round2 warnings.
- Every `TAB_VISIT` written to diagnostics also emits telemetry for the source/duration, so round monitoring sees the same “human visit” footprint.
- The DevTools telemetry timeline highlights these `ROUND2_VERIFY`/`TAB_VISIT` rows for quick review, and the Markdown export includes a “Note: Round2 verification events...” reminder at the top.
- Previous entries remain documented under v2.71.49/v2.71.48 for continuity.

## Update v2.71.49 - 2026-01-30 08:00 UTC
Purpose: align diagnostics + telemetry with the final response status and accelerate Perplexity recovery.
- `FINAL_STATUS` diagnostic entry (type: `FINAL_STATUS`) is emitted together with the `RESPONSE` telemetry so both tabs share the same success/failure signal.  
- `PERPLEXITY_ACK_RETRY` marks when ACK_READY recovery triggers an immediate retry for Perplexity so we can spot aggressive fallbacks.
- `ACK_READY_RECOVERY_OK` and `ROUND2_RETRY_OK` remain documented under v2.71.48 for continuity.
Purpose: surface ROUND telemetry in DevTools and make the exported logs Markdown-friendly.
- The DevTools Telemetry tab now renders three cards: summary, a dedicated **Telemetry Rounds** list (shows `ROUND#_*` start/end markers sorted newest-first), and the timeline. Rounds are enumerated by the background helper `emitRoundEvent()` so their timestamps/labels are always consistent with the orchestration flow.
- “All Logs” exports switched from HTML to Markdown with telemetry first (table with Time/Platform/Event/Level/Details) followed by diagnostics sections. The markdown includes version/export metadata and ensures the first rows remain the freshest telemétrie entries for easy comparison.

## Update v2.54.24 - 2025-12-22 23:14 UTC
Purpose: unify pipeline telemetry routing and reduce volume with 5% session sampling.
- `PIPELINE_EVENT` is now a first-class IPC channel routed into diagnostics storage.
- Background applies per-session telemetry sampling (`TELEMETRY_SAMPLE_RATE=0.05`), with errors bypassing sampling.
- `STOP_DISAPPEARED` is emitted when the stop button vanishes during streaming.
- Verbose criteria logs: `LLMExtension.flags.verboseAnswerWatcher = true` or `localStorage.__verbose_answer_watcher = 'true'`.

## Update v2.54.8 - 2025-12-21 06:59 UTC
Purpose: surface telemetry meta in diagnostics UI and add content-pipeline events for full traceability.
- Diagnostics UI now renders `meta` JSON for each entry so timing/snapshot data is visible.
- UnifiedAnswerPipeline emits `PIPELINE_*` events (start/prep/stream/finalize/complete/error).
- Dispatch adds `PROMPT_SUBMITTED_TIMEOUT` to capture no-confirmation cases.
- Background emits `RUN_END` per model on first response to capture final status.
- Per-model overrides provide `llmName` to pipeline so events attach to correct model logs.

## Update v2.54.7 - 2025-12-21 06:40 UTC
Purpose: define the telemetry schema needed to analyze tab lifecycle and dispatch flow.

## Base schema (v2.72.00)
Purpose: standard fields for correlating events across tabs, queue, and responses.
- `ts` - event timestamp (ms).
- `extVersion` - extension version.
- `runSessionId` - run/session id (jobState.session.startTime).
- `dispatchId` - dispatch id per model (llmName:session:attempt).
- `llmName` - model name.
- `tabId` - tab id.
- `event` / `label` - telemetry event name.
- `details`/`level` - human-readable details and severity.
- `meta` - extra fields (snapshot, timing, reason, selectorPackVersion, detector snapshot).

## Event catalog (v2.72.00)
Purpose: complete trace from dispatch to completion detection.
- `PIPELINE_STEP` with `meta.step` (`pipeline_start`, `preparation_start/done`, `streaming_start/done`, `finalization_start/done`).
- `STATE_CHANGE` with `meta.from`/`meta.to` transitions.
- `DETECTOR_TICK` / `DETECT_DONE` for completion detector signals.
- `SELECTOR_STATS` with aggregated hit/miss ratios.
- `PORT_CLOSED`, `HANDSHAKE_TIMEOUT`, `RECOVERY_ACTION` structured errors.

## Base schema (v2.54.7)
Purpose: standard fields for correlating events across tabs, queue, and responses.
- `ts` - event timestamp (ms).
- `extVersion` - extension version.
- `sessionId` - run/session id (jobState.session.startTime).
- `requestId` - LLM request id.
- `llmName` - model name.
- `tabId` - tab id.
- `event` - telemetry event name.
- `details`/`level` - human-readable details and severity.
- `meta` - extra fields (snapshot, timing, reason, dispatchId).

## Event catalog (v2.54.7)
Purpose: complete trace from tab open to prompt confirmation.
- `RUN_START` - session start per model.
- `RUN_END` - first response received per model (success/error).
- `TAB_CREATED` - new tab created.
- `TAB_REUSE_CANDIDATE` / `TAB_REUSE_REJECTED` - reuse attempt and rejection.
- `ATTACH_CANDIDATE` / `TAB_ATTACHED` / `ATTACH_REJECTED` - attach flow and rejection.
- `TAB_READY_CHECK` / `TAB_READY_WAIT_END` / `TAB_READY_FAIL` - tab readiness (load/reload).
- `TAB_DISCARDED_RELOAD` - discarded tab recovery.
- `DISPATCH_LOCK_ACQUIRE` / `DISPATCH_START` / `DISPATCH_SEND` - queue and send phase.
- `PROMPT_SUBMITTED_ACCEPTED` / `PROMPT_SUBMITTED_REJECTED` / `PROMPT_SUBMITTED_STALE` - submit confirmation handling.
- `PROMPT_SUBMITTED_TIMEOUT` - submit confirmation timeout (no signal received).
- `PIPELINE_START` / `PREPARATION_*` / `STREAMING_*` / `FINALIZATION_*` / `PIPELINE_COMPLETE` / `PIPELINE_ERROR` - content pipeline phases.
- `STOP_DISAPPEARED` - stop button vanished (completion heuristic).
- `SCRIPT_HEALTH_FAIL` - health check failure.
- `SCRIPT_REINJECT_START` / `SCRIPT_REINJECT_RESULT` - content script reinject.
- `TAB_CLOSED` - tab closed (removeInfo).

## Snapshot schema (v2.54.7)
Purpose: quick tab context at event time.
- `url`, `status`, `discarded`, `active`, `lastAccessed`, `windowId`, `pinned`, `audible`, `title`.
