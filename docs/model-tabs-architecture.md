# Model tabs architecture

> Нормативный документ для главной страницы результатов и вкладок выбранных
> моделей. Общая карта документации — в `docs/disput-docs/D0_documentation-map.md`.

## Scope

Главная страница (`result_new.html`) запускает один пользовательский prompt на
выбранном наборе моделей. Этот документ описывает только выбор моделей,
владение вкладками, dispatch и связь UI → background → content script.

Debate topology, FSM, prompts и round plans описаны отдельно в
`docs/disput-docs/D2_disput-architecture.md` и protocol specs. Детали CSS-селекторов и ручного
record/override находятся в selector guides; не копировать их сюда.

## Ownership map

| Область | Владелец | Ответственность |
|---|---|---|
| Model buttons и selection UI | `result_new.html`, `results.js`, `content-scripts/model-selection-toolbar.js` | выбор/снятие модели, ограничители схемы, view-scoped persistence |
| Results page orchestration | `results.js`, `results/boot-utils.js`, `results/dom-utils.js` | запуск UI, карточки, prompt, lifecycle display |
| Target catalog | `background/llm-targets.js` | canonical model names, URLs, attach/reuse rules |
| Tab ownership | `background/tab-manager.js`, `background/shared-state.js` | создание, attach/reuse, binding `model → tabId`, session scope |
| Dispatch coordination | `background/dispatch-coordinator.js`, `background/dispatch-state-machine.js` | lock, queue, send boundary, retries and correlation IDs |
| Run orchestration | `background/job-orchestrator.js`, `background/message-router.js` | batch lifecycle, provider recovery, terminal outcome |
| Provider DOM adapter | `content-scripts/unified-answer-pipeline.js`, provider scripts, `content-utils/*` | composer/send/extraction/lifecycle signals |
| Selector configuration | `selectors/*.config.js`, `selectors/config-bundle.*`, `shared/selector-profile-lifecycle.js` | selector candidates, profiles, overrides and health |
| Diagnostics | `background/telemetry-logs.js`, `results-devtools.js`, `shared/telemetry-export.js` | run-scoped evidence, health and export |

`results.js` may render compatibility projections, but it must not invent a
second tab registry. Background owns tab identity and delivery; content scripts
own provider DOM operations.

## Model selection contract

1. The active view owns its selected model set. Main-page selection must not be
   overwritten by a Debate pipeline restore.
2. Model names are canonical `LLM_TARGETS` names. UI aliases are normalized at
   the boundary; downstream state uses the canonical name.
3. Selection changes update header buttons, visible model panels, comparison
   controls, pipeline R1 defaults and the persisted view state through one
   selection-change path.
4. A run snapshots the selected model list into its `pipelineContext` before
   dispatch. Later UI clicks cannot mutate the active run's participant list.
5. A new run with the same model may reuse a tab only after the tab-manager
   readiness/reuse guard confirms URL, loading state, draft state and ownership.

Debate uses its own protocol selection and session state. Main-page model
selection remains independent even when the same `results.js` composition root
is loaded by both entry points.

## Tab lifecycle

The background tab registry is the authority for `model → tabId` and its
session/run binding. A normal lifecycle is:

```text
select models
  -> snapshot run context
  -> attach/reuse or create provider tab
  -> validate URL and tab readiness
  -> bind tab to model + run
  -> dispatch GET_ANSWER
  -> receive PROMPT_SUBMITTED
  -> collect lifecycle/answer evidence
  -> finalize model outcome
  -> release or retain tab according to reuse policy
```

The results page never treats a visible provider tab as proof that the tab
belongs to the current run. Correlation must include, where available,
`pipelineRunId`, `pipelineRoundId`, `pipelineBatchId`, `dispatchId`, `sessionId`,
`model` and `tabId`.

For provider-tab lifecycle messages, `dispatchId` and `runSessionId` are not
optional compatibility hints. `PROMPT_SUBMITTED`, `LLM_RESPONSE_READY`,
`ANSWER_SNAPSHOT`, `LLM_RESPONSE` and `FINAL_LLM_RESPONSE` must match the exact
current dispatch and run session. An id from `recentDispatchIds`, missing
correlation, a sender without an active model binding or a different bound tab
is stale evidence and is quarantined. Submit waiters are scoped by
`model + dispatchId`; a late confirmation from attempt N cannot release attempt
N+1.

### Extension reload reset

An extension update/reload starts a new extension runtime and must not project
the previous runtime's telemetry or model statuses onto the main page.

- `background/index.js` registers the update lifecycle listener before the
  orchestration bundle loads. State hydration must await the resulting startup
  barrier, so `jobState`, `llmTabMap` and `__diagnostics_events__` are removed
  before `loadJobState()` and `TabMapManager.load()` can restore them.
- A normal MV3 service-worker wake is not a reset. The barrier times out into
  the normal hydration path, preserving an active run across worker suspension.
- `REGISTER_RESULTS_TAB` returns an authoritative global-state snapshot. The
  results page replaces its live status projection from that snapshot; an
  empty snapshot clears old main-page/pipeline indicators and the local
  diagnostics view.
- Historical debate-feed indicators are immutable run records and are not part
  of the live-indicator reset.
- Persisted user preferences, notes, saved pipelines and layout settings are
  outside this reset boundary.
- Manual extension reload detection uses a marker in `chrome.storage.session`,
  not only `runtime.onInstalled`. A missing marker denotes a new extension
  runtime and clears volatile local run state, diagnostics, cross-view live UI
  state and both main/pipeline model-selection keys before hydration. A normal
  MV3 worker wake retains the marker and does not clear state.
- Results-tab registration carries a short-lived `runtimeReset` signal so every
  already-open results view clears live model buttons, answer indicators,
  diagnostics rows and the in-page telemetry cache. Reloading the page is not
  required for this projection reset.

## Dispatch and focus policy

- Per-model dispatch locks prevent overlapping sends to one provider.
- A focus mutex protects only the critical activation → send phase.
- `allow_focus_steal_enabled` controls whether the user-facing window may be
  activated. The default path uses an isolated automation window and does not
  steal user focus.
- Human-presence/keepalive activity must yield while dispatch is active.
- `PROMPT_SUBMITTED` is evidence that the send action was initiated; a call to
  `GET_ANSWER` alone is not proof of delivery.
- Failed submission attempts are retried by the background supervisor with
  bounded backoff. A provider timeout must not block unrelated models.
- If the model binding changes after a command was prepared, that command is
  quarantined. It is never rerouted to the replacement tab with the old
  `tabSessionId` or dispatch identity; the supervisor creates a fresh dispatch.

The canonical dispatch boundary is `background/dispatch-coordinator.js`.
Changes to focus or retry timing belong in `docs/timing-map.md` and the relevant
policy/config, not in this document.

## Content-script boundary

Content scripts may inspect and mutate provider DOM, detect composer/send state,
and emit lifecycle evidence. They must not own the global model-to-tab map,
background retry policy or results-page selection state.

The stable contract is:

- background → content: `HEALTH_CHECK_PING`, `GET_ANSWER`, `STOP_ALL` and
  model-specific command payloads;
- content → background: `PROMPT_SUBMITTED`, lifecycle events and answer payloads;
- every event carries model/run/tab metadata whenever the source knows it.

### Provider dispatch change safety

Provider dispatch is an integration boundary with the live page runtime, not
only a DOM algorithm. A visually changed `textarea` or `contenteditable` does
not prove that the provider framework accepted the value into its application
state. Conversely, jsdom/unit tests can prove ordering, ownership and
fail-closed rules, but cannot prove browser `isTrusted`, React/ProseMirror state
acceptance or the provider's real submit shortcut.

Changes at this boundary follow these rules:

1. Preserve the last live-confirmed transport as a named baseline. A fix for
   prompt comparison, attachment chips, selector ownership or confirmation
   evidence must not replace input and Send transports unless the transport is
   itself the demonstrated fault.
2. Change one transaction gate at a time: attachment evidence, input,
   prompt verification, Send, and Send confirmation are separate gates. A
   patch for one gate must include a regression assertion that the other
   live-confirmed gates retain their order and fallback.
3. Provider input requires two facts after its settle window: the current live
   composer contains the exact prompt evidence and the provider has not
   reverted/replaced that composer. If isolated-world synthetic input is
   visible but fails this gate, the adapter may perform one sender-gated native
   input recovery, then must reacquire and reverify the composer before Send.
4. Unit tests are necessary but insufficient for a transport change. Before a
   provider release is called verified, a real-page smoke must cover at least
   the no-attachment path `input → Send → PROMPT_SUBMITTED → generation`. An
   attachment change additionally requires a separate attachment/chip/modal
   smoke. Open live smoke work stays in `next-steps`; changelog wording must say
   that the transport is unverified until the smoke succeeds.
5. The smoke is evidence-based. For Perplexity the expected no-attachment
   sequence is exact prompt preparation (or one
   `PROVIDER_TRUSTED_INPUT_DISPATCHED` recovery),
   `PROVIDER_TRUSTED_ENTER_DISPATCHED` or scoped trusted Send,
   `PROMPT_SUBMITTED`, then a new user turn or new generation evidence.
   `prompt_not_present`, a remaining prompt with no new turn, or only a generic
   busy marker fails the smoke.
6. A later refactor may remove the live-confirmed baseline only after the new
   path passes the same real-page matrix. Passing source-order tests or a mocked
   rich-editor test is not sufficient evidence for that removal.

## Attachment dispatch contract

Composer dispatch is a transaction with four ordered gates:

```text
attachment evidence (when files exist)
  -> reacquire live composer
  -> verify current prompt content
  -> confirm send evidence
  -> publish PROMPT_SUBMITTED
```

The provider pipeline owns this transaction from attachment start until either
confirmed Send or terminal failure. While the content adapter reports that
pipeline active, verification/recovery rounds must not clear `dispatchInFlight`,
reset its state machine or issue a repair resend. Recovery observes the original
transaction first; concurrent composer writers are forbidden.

Round telemetry distinguishes handler termination from protocol completion. If
R2 encounters an active provider-owned R1 transaction, R2 ends with semantic
outcome `deferred`, never `done`: prompt verification did not execute. While
deferred, R2 must not send collection probes into the busy content-script port;
the original pipeline resolves ownership through `PROMPT_SUBMITTED` or terminal
failure. Export and DevTools render this state explicitly as `deferred`.

Firing DOM events, observing any non-empty composer text, or exhausting a send
strategy is not success. `ContentUtils.ensurePromptPrepared` owns the shared
prompt-content gate. Its rich-editor comparison removes zero-width formatting
characters and accepts either the complete normalized prompt or independent
head-and-tail fingerprints from the same request; arbitrary non-empty text or a
single short prefix is insufficient. Provider adapters remain responsible for
reacquiring their live composer and for provider-specific send evidence.

- Prompt injection with files is gated on confirmed attachment delivery. If
  attachment confirmation fails, the provider script must stop with
  `attachment_failed` or an explicit manual-required signal; it must not
  continue as if the prompt were sent.
- Attachment confirmation is evidence-based, not click-based. Each delivery
  vector captures a baseline first; confirmation may come from provider
  selectors, upload-progress disappearance, file-input evidence where the
  provider exposes it, or stable filename evidence across open shadow roots. A
  pre-existing chip or stale file label must not confirm a new request.
- Provider adapters own their ordered attachment vectors, but once a vector is
  confirmed the same files must not be resent through the remaining vectors
  when the provider is marked `singleDispatch`.
- If an attachment rerender replaces the composer, the adapter must reacquire
  the live connected composer before prompt injection. A disconnected or stale
  cached composer is not valid for the send phase.
- Attachment adapters must preserve provider-specific transport choices
  without turning this document into a selector catalog. For example, Gemini
  routes attachments through background materialization and trusted file-input
  dispatch, while ChatGPT waits for the real enabled Send control and validates
  submission against the pre-send user-turn count.
- For Gemini, successful trusted `DOM.setFileInputFiles` assignment is delivery
  evidence. The native input may be cleared immediately and the visible file
  chip may live outside the isolated-world selector surface, so absence of a
  second DOM match must not turn an assigned file into `attachment_failed`.
  After attachment, the adapter must verify that the normalized prompt prefix
  is present in the reacquired live composer before any send gesture.
- Send-control discovery is fail-closed around adjacent composer controls.
  Provider selector results and fallback candidates must reject microphone,
  voice/recording, stop, attachment and upload controls before interaction.
  This guard applies to Qwen and ChatGPT even when a generic selector finder or
  `type="submit"` fallback supplies the candidate. Qwen may click only a control
  with explicit Send evidence (`type=submit`, send-labelled attributes/classes
  or a dedicated send icon). Generic SVG, arrow, primary styling, proximity to
  the composer and the substring `paper` are not Send evidence. Attachment,
  paperclip, add-file/upload, voice and stop identity is an unconditional veto,
  including identity exposed only by a descendant icon. The normal and
  emergency click paths must run the same safety predicate and stay scoped to
  the live composer; keyboard/form fallbacks remain non-click alternatives.
- Some providers rerender or replace the composer after upload; Grok, Qwen,
  Perplexity, DeepSeek and Le Chat must re-resolve the composer after upload
  completes before the prompt is injected. A negative control token such as
  `voice` normally rejects a send candidate. For Qwen, unsafe attachment/voice/
  stop identity always wins even when stale framework classes also contain
  `send`; this prevents an adjacent file control from being clicked repeatedly.
- Qwen attachment delivery uses the current native upload contract directly:
  hidden `input#filesUpload[type="file"][multiple]` receives materialized files
  through trusted `DOM.setFileInputFiles`. Synthetic drop, paste, plus-menu
  clicks and generic file-input discovery are not Qwen attachment transports.
  Native assignment is dispatch evidence only. The adapter waits for settled
  file-input/filename/chip evidence before it reacquires
  `textarea.message-input-textarea`, verifies the prompt and sends.
- An unconfirmed delivery vector cannot suppress later vectors. DeepSeek,
  Perplexity and Le Chat may proceed from unconfirmed drop to the next configured
  method; only confirmed evidence closes their attachment gate.
- Z.ai accepts a manual file copy plus Ctrl+V, but synthetic paste is not an
  equivalent delivery vector because the page may require a trusted event.
  Z.ai and Perplexity therefore use background materialization plus trusted
  `DOM.setFileInputFiles` on the provider's live native file input. The request
  message must preserve its attachment payload end-to-end. After assignment,
  the adapter reacquires the composer, passes the shared exact-prompt gate and
  confirms Send before publishing `PROMPT_SUBMITTED`; failure is closed rather
  than sending a prompt without its requested file.
- Le Chat may replace its ProseMirror root after attachment delivery. If the
  cached composer fails the exact-prompt check, the adapter may reacquire a
  connected provider composer that itself contains the exact normalized current
  prompt. Arbitrary non-empty text is never sufficient evidence.
- Perplexity submission is one prompt-owned transaction, not a cascade of
  synthetic keyboard and generic click attempts. Preparation, dispatch and
  confirmation use the same normalized prompt predicate: a continuous prompt
  is accepted, and a rich editor may interleave an attachment/chip node only
  when both independent prompt-end fingerprints remain present. If the shared
  preparation attempt is visually inserted but rejected/reverted by
  Perplexity's React state, the adapter performs one sender-gated native
  replacement on the focused visible composer (`SelectAll` plus
  `Input.insertText`), waits for React to settle, reacquires the live composer
  and reruns the same exact-prompt predicate. It cannot proceed to Send solely
  because text was briefly visible. Background then focuses that matching live
  composer and dispatches one native Enter through the debugger input domain.
  If no submission evidence appears while the same prompt remains, the only
  fallback is a sender-gated trusted click on an enabled Send/Submit/Ask control
  discovered in the matching composer's nearest ownership scopes. Candidate
  controls reject microphone, voice, attachment, upload, stop, cancel, model
  and tool identities; cached or global generic buttons are not eligible.
  Confirmation requires at least one current transaction signal: the prompt
  left the composer, a new user turn appeared, or a
  stop/streaming/generating control became newly visible relative to the
  pre-submit baseline. A pre-existing generation control or stale generic
  busy/loading marker is not evidence. `PROMPT_SUBMITTED` is published only
  after this gate.
- Perplexity native file assignment is not success by itself. The attachment
  transport first probes for a provider-owned live file input, then performs at
  most one trusted click on «Add files or tools» and probes again because the
  input may be created lazily with the menu. If that probe succeeds,
  `DOM.setFileInputFiles` targets the input directly; the transport must not
  continue clicking the concrete paid-plan upload item merely because no
  `Page.fileChooserOpened` event fired. A chooser backend node remains an
  accepted alternative. Every click is followed by input/chooser and current
  URL reconciliation; reaching `/pro/payment` suspends the attempt immediately
  instead of issuing another click. Native assignment must still produce
  observable chip/filename evidence before prompt submission can continue.
- Internal attachment materialization is infrastructure, not a user download.
  While temporary local files are created through `chrome.downloads`, the
  browser download UI is suppressed with reference-counted ownership and always
  restored in `finally`; this requires the explicit `downloads.ui` permission.
  Suppression failure is fail-closed (`download_ui_suppression_unavailable`): no
  internal download may start and Chrome's download bubble must not open.
- Trusted attachment delivery may use the background `chrome.debugger` API
  (CDP) for a provider tab. Chrome can therefore show its browser-level
  “debugging this browser” notification; that notification is expected and is
  not evidence that the extension is watching the user's screen or actions.
  The debugger scope is limited to the bound provider tab and the current
  dispatch: DOM/file-input or chooser commands and their result are read, then
  the debugger target is detached in `finally`. No screenshots, keystroke
  stream or unrelated tabs are collected by this transport.
- Before Perplexity composer discovery, the adapter may dismiss a page-owned
  modal only when the dialog text explicitly identifies an upgrade/plan/package
  promotion and it exposes an explicit Close/Dismiss/Not now control. File menus,
  generic dialogs and browser UI are outside this cleanup contract. The guard
  remains active throughout native attachment assignment and confirmation,
  because Perplexity may render the promotion over the unchanged chat URL only
  after `DOM.setFileInputFiles`. An icon-only SVG × is eligible only when it is
  a small top-right control geometrically owned by that promotion-gated dialog.
  Current same-page markup may omit dialog/modal semantics entirely; in that
  case the adapter first resolves the observed control contract
  `button.reset.interactable.select-none.outline-none`, walks only to its nearest
  promotion-text ancestor, verifies top-right ownership, and clicks that exact
  button. Closing such a modal is cleanup, not attachment evidence.
- If that same-page promotion caused the native attachment attempt to finish
  without persistent evidence, the adapter re-arms the correlated blocker and
  retries the complete attachment transaction once after the modal is closed.
  Prompt preparation and Send remain behind this retry; a second failed attempt
  is terminal for the attachment and cannot create duplicate file delivery.
- Perplexity confirmation requires evidence that is still present at the settle
  gate: a new attachment chip, filename, populated provider input or configured
  upload completion evidence. A transient generic `upload` node that appears
  while the paid-plan modal is opening and then disappears cannot be retained
  as proof of delivery. With no persistent evidence, attachment fails closed
  and prompt submission does not continue without the requested file.
- A first navigation to `/pro/payment?…origin=fileUpload` is a transient
  Perplexity blocker, not proof that upload capability is unavailable. Before
  the trusted upload control can navigate, the content adapter stores a
  same-origin marker containing a unique token plus `runSessionId` and
  `dispatchId`, then waits for background acknowledgement of
  `PROVIDER_TRANSIENT_BLOCKER_STARTED` in the `ARMED` phase. A normal upload
  completion cancels that state; therefore only the navigation initiated by
  this exact dispatch owns the handoff.
- On the payment document, the adapter correlates the same marker, advances the
  blocker to `ACTIVE`, and waits for background acknowledgement before clicking
  the explicit page-owned Close/× control (with `history.back()` only as the
  page-navigation fallback). It does not close a manually opened or stale
  payment page lacking a valid marker.
- After the chat document is restored, the adapter first registers its
  `runtime.onMessage` listener and waits for a visible, enabled composer. It
  then publishes `PROVIDER_TRANSIENT_BLOCKER_CLEARED`; background probes that
  exact `documentId` and accepts the clear only when the document returns the
  same token, dispatch identity and positive composer evidence. The marker is
  removed only after this acknowledgement. Lost callbacks use bounded,
  identity-preserving retries against the marker's fixed 120-second expiry;
  retries do not extend ownership indefinitely. Background atomically changes
  `ACTIVE` to `PROBING` before the document probe, so concurrent clear signals
  cannot create parallel resume dispatches.
- `GET_ANSWER` is a command-delivery channel: Perplexity acknowledges it
  immediately with `{ accepted, dispatchId, tabSessionId }`; later submission
  and answer lifecycle travel through `PROMPT_SUBMITTED` and `LLM_RESPONSE`.
  Provider navigation therefore cannot turn an already accepted command into
  a false `connection_failed`. A matching navigation-time transport close is
  deferred, while a callback from an obsolete run/dispatch/tab is quarantined.
- Resume cancels the old in-progress dispatch through the valid state path
  `SUBMITTING → ERROR → IDLE`, invalidates any stale pre-terminal recovery, and
  creates a new dispatch with the original prompt and attachments. Telemetry
  may publish `PROVIDER_TRANSIENT_BLOCKER_RESUME` and increment the resume count
  only after the restored document has immediately accepted that new command;
  provider focus ownership is retained through this acceptance. Old transport,
  provider-pipeline and answer lifecycle signals owned by the cancelled
  dispatch are quarantined rather than allowed to finalize the resumed run.
  A duplicate clear for the same token is a no-op; only a second complete
  `STARTED → CLEARED` cycle after an accepted resume becomes terminal
  `attachment_unavailable`. The prompt is never sent without its file.
- Synthetic drag cleanup is provider-specific. ChatGPT follows
  `dragenter → dragover → drop` with `dragleave → dragend` so its DRAG&DROP
  overlay cannot remain during generation. This cleanup is not a shared Qwen
  behavior because Qwen no longer uses synthetic drag for attachments.

## Readiness and reuse contract

`ensureTabReadyForDispatch` succeeds only for an existing, eligible,
non-discarded provider tab whose navigation status is `complete` and whose URL
is not a placeholder. URL eligibility alone is not readiness. Content-script
health and page/composer readiness remain separate later gates.

Global reuse (`New pages` disabled) is fail-closed. Before taking over an
unbound user tab, the background probe must positively establish all of the
following:

- no draft exists in any composer candidate;
- no visible generation/stop control exists;
- no visible modal/dialog blocks the page;
- the probe itself returned a trustworthy result.

An unavailable or failed probe rejects that candidate and falls back to another
eligible tab or a newly created tab. A tab created for an obsolete run session
is closed instead of being left as an unowned orphan.

## Fresh answer and completion contract

A pre-existing assistant node is baseline evidence, not answer-start evidence.
The current response may enter `ANSWER_STARTED` only when at least one of these
signals belongs to the current dispatch:

- a new assistant node appears after submit;
- the baseline assistant node changes after `promptSubmittedAt`;
- a trusted stop/loading/streaming/progress signal appears.

Text length by itself never proves answer start. `LLM_RESPONSE_READY` carries
the current `dispatchId` and `runSessionId`, and background applies the same
exact-correlation gate as for the final response.

Completion needs fresh-turn evidence plus corroboration: stable answer text,
trusted absence of stop/loading/progress indicators and the configured
completion confidence. Old regenerate/copy/completion controls cannot complete
a new dispatch. The unified pipeline's final stability checks are a mandatory
gate; unstable text returns `answer_not_stable` and remains recoverable rather
than being published as terminal success.

Generating-indicator evidence учитывает полную видимость элемента: нулевой
размер, `display:none`, `visibility:hidden` и `opacity:0` не являются активной
генерацией. Единственное исключение для видимого generic loading-class —
stuck-busy guard: после длительной стабильности текста и тишины мутаций он
может быть признан декоративным только при подтверждённом отсутствии Stop и
progressbar. Видимые Stop и progressbar не обходятся.

Зарегистрированный DOM-кандидат принадлежит конкретному `traceId`. При старте
нового dispatch кандидат с другим trace удаляется до захвата baseline, поэтому
элемент прошлого ответа не может закрепить новый lifecycle на stale DOM node.

“Latest answer” means the last eligible assistant turn in DOM order after the
turn anchor. Automatic extraction does not use answer length as a recency
signal and does not reuse a cached answer element as proof of latestness.
Baseline signature, positional anchor, prompt-echo classification and provider
error classification remain independent safeguards; none substitutes for
dispatch identity or fresh-turn evidence.

Recovery follows the same rule. `preserved_pending`, `preserved_answer` and
snapshot text are candidates, not current-run evidence. A recovery candidate
is fresh only when it differs from the dispatch baseline and is backed by one
of: content-confirmed submit for the same dispatch, correlated lifecycle
completion, or a new DOM answer node after the positional anchor. Text length,
`forceTerminalSuccess` and submit inferred from that same text cannot establish
freshness.

Consequently, baseline-only text does not block repair resend, does not confirm
Round 2 and cannot produce `PROMPT_SUBMITTED_INFERRED`. Materialize recovery
rejects a baseline-equivalent candidate before finalization. Without completion
evidence, a fresh salvaged candidate is at most `PARTIAL`; without freshness it
remains `NO_SEND`/recoverable and can never become `SUCCESS`.

Provider-specific selector details belong in `selectors/*.config.js` and the
selector tooling guides. If a selector breaks, first use the health/override
path; only then change the canonical selector config.

## Diagnostics

For “model tab did not receive the prompt”, inspect the run in this order:

1. target resolution and selected model snapshot;
2. tab attach/reuse decision and URL/status readiness;
3. `DISPATCH_*` events and lock/retry metadata;
4. `HEALTH_CHECK_*` response from the content script;
5. `PROMPT_SUBMITTED` evidence;
6. lifecycle/answer terminal evidence.

For “old answer accepted as new”, additionally verify that
`ANSWER_START_DETECTED`, `ANSWER_COMPLETE_DETECTED`, `LLM_RESPONSE_READY` and
the accepted response all carry the same current dispatch identity, and inspect
the captured baseline/anchor plus the selected DOM candidate order.

A green UI card without matching terminal evidence is not a successful run.
Stale-tab signals must be rejected rather than repaired by changing the UI.

## Change checklist

When changing model tabs or main-page selection:

1. Update the owner module from the ownership table.
2. Preserve run correlation and tab ownership guards.
3. Add/adjust focused tests for selection, tab scope, dispatch or lifecycle.
4. Update this document only when the contract or ownership changes.
5. Add one concise entry to `docs/CHANGELOG.md`.
6. Put unresolved work in `docs/disput-docs/reports/D19_disput-next-steps.md`, not in this document.

Related operational documents:

- `docs/selectors-tab-first-run-guide.md` — first-run selector workflow;
- `docs/devtools-selectors-user-guide.md` — selector health/override UI;
- `docs/storage-tab-guide.md` — storage-oriented tab troubleshooting;
- `docs/session-stability-ops.md` — focus/session manual validation;
- `docs/timing-map.md` — timing values and ladder decisions.
