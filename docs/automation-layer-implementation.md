# Automation Layer — implementation / field-test guide

## Repository and branch

Repository: `AlGold777/MyOrchestrator`

Implementation branch: `codex/automation-layer-independent-v1`

The branch is based directly on `main`.

Important repository observation made during implementation: `automation.html` was not present in `main` or the other existing working branches. The implementation therefore created `automation.html` using the established UI contract from `popup.html`:

- prompt: `#prompt`
- send button: `#send-button`
- model selection: `input[name="llm"]`

If another physical working copy contains an older `automation.html`, preserve its existing controls and port the controller bindings to its actual selectors instead of duplicating the controls.

## Architecture

The implementation uses an event-driven controller above the existing MyOrchestrator runtime.

It does not introduce:

- a second DOM scraper;
- provider-specific automation in `automation.js`;
- model API calls;
- a custom model response envelope;
- a second completion detector.

The existing MyOrchestrator background/content-script stack remains responsible for:

- provider tabs;
- prompt insertion/send;
- provider-specific DOM behavior;
- stale-answer protection;
- completion authority;
- extraction;
- internal dispatch/recovery;
- terminal model status.

The new controller is responsible for:

- the two-stage business flow;
- automation run correlation;
- stage correlation;
- storing accepted stage outputs;
- chronological feed;
- deterministic Round 1 fan-in;
- Round 2 prompt construction;
- checkpoint/reload recovery;
- final artifact export.

## Files

- `automation.html` — automation page using the established prompt/send/model-selection controls.
- `automation.css` — feed/status/diagnostics presentation.
- `automation.js` — browser-side controller.
- `automation/automation-core.js` — pure correlation/fan-in/artifact helpers.
- `tests/automation-layer-core.test.js` — contract tests.
- `docs/automation-layer-implementation.md` — this guide.
- `docs/automation-layer-structural-elements-report.md` — architecture-element report.

## Real runtime integration

Round dispatch uses the existing background message:

```js
chrome.runtime.sendMessage({
  type: 'START_FULLPAGE_PROCESS',
  prompt,
  selectedLLMs: ['GPT', 'Claude'],
  forceNewTabs: true,
  useApiFallback: false,
  sourceView: 'automation',
  pipelineContext: {
    sourceView: 'automation',
    automationRunId,
    automationRound
  }
})
```

The page listens to `chrome.storage.local.jobState` changes.

A result is consumed only when it belongs to the current automation stage.

For live in-memory state the controller can use `pipelineContext`. For persisted/compacted state it uses the stage-scoped persisted identifier:

```text
jobState.session.pipelineRunId == <automationRunId>:R<round>
```

The dispatch sets that value through `pipelineContext.pipelineRunId`, and the existing MyOrchestrator compactor preserves `session.pipelineRunId` across storage/reload.

The controller then uses the existing terminal facts:

- `entry.finalStatusRecorded`
- `entry.finalStatus`
- `entry.finalizedAt`
- `entry.answer`

Only terminal `SUCCESS` with a non-empty accepted answer advances the business flow.

## Why no custom response markers

The existing runtime already has dispatch/session identity, prompt-send evidence, stale-answer guards, completion authority, answer verification and finalization. A second model-visible protocol would duplicate transport responsibility and make the test less representative of the existing product.

The automation layer therefore correlates at the runtime/state boundary instead of requiring the model to echo orchestration metadata.

## Round 1

The user:

1. enters the request in `#prompt`;
2. selects exactly two existing `input[name="llm"]` controls;
3. presses `#send-button`.

The controller starts one existing MyOrchestrator batch with:

- the original prompt;
- the two canonical model names;
- fresh tabs;
- API fallback disabled.

Accepted model results are added to the feed immediately, ordered by `finalizedAt`.

## Fan-in

The machine input for Round 2 is built in selected-model order, not completion order.

Example:

```text
===== SOURCE 1: GPT =====
...
===== END SOURCE 1: GPT =====

===== SOURCE 2: Claude =====
...
===== END SOURCE 2: Claude =====
```

This makes the next prompt reproducible even if Claude completed first.

## Round 2

Round 2 starts automatically after both Round 1 answers are accepted.

The prompt contains:

- the original request;
- the two labelled source answers;
- the fixed synthesis task.

The source blocks are explicitly described as data, not instructions.

Round 2 runs through another fresh MyOrchestrator batch with API fallback disabled.

## Feed

The main feed is chronological.

Each accepted answer shows:

- model;
- acceptance time;
- round;
- accepted answer text.

System transitions such as Round 1 start/completion, Round 2 start and overall completion are short separate messages.

Diagnostics are kept in the collapsed `Runtime / Diagnostics` area, not mixed into the reading flow.

## Failure model

The Automation Controller does not implement a competing retry loop.

The existing MyOrchestrator runtime already owns provider dispatch/recovery. The controller waits for its final result.

If one model reaches terminal non-success after that existing recovery process, the automation run becomes `ERROR`. It never treats one successful model as overall success.

Already accepted answers remain in the feed and stored state.

## Persistence and reload recovery

Controller state is checkpointed in:

`chrome.storage.local['automationLayerWebRuntimeTest.v1']`

On page reload:

1. the feed and controller phase are reconstructed;
2. the controller inspects persisted `jobState`;
3. if it belongs to the same automation run and round, monitoring resumes;
4. terminal event keys prevent duplicate feed messages;
5. if a dispatch intent was persisted but no matching run exists, the controller performs one recovery dispatch;
6. if a supposedly running state cannot be reconciled, the controller fails closed instead of guessing.

## Artifacts

On successful Round 2 completion the page automatically downloads:

- `automation-<run-id>-result.txt`
- `automation-<run-id>-audit.json`

The TXT contains the user request and both rounds.

The audit JSON contains the controller state, feed and journal.

Manual re-download buttons remain available.

## Local automated verification

Run:

```bash
npm test -- --runInBand tests/automation-layer-core.test.js
```

The tests cover:

- model-name normalization from existing UI values;
- deterministic fan-in ordering;
- Round 2 prompt composition;
- run/round correlation;
- acceptance chronology from `finalizedAt`;
- duplicate-event suppression after reconciliation/reload;
- result artifact composition.

## Required real Chrome field test

Load the branch as an unpacked extension, authenticate the chosen provider web UIs and open:

```text
chrome-extension://<extension-id>/automation.html
```

Verify:

1. exactly two models are selected;
2. the original request is sent through real Web UI;
3. answers appear in the feed in acceptance chronology;
4. no API fallback occurs;
5. Round 2 starts without user action;
6. Round 2 receives both Round 1 answers;
7. both final answers appear in the same feed;
8. result TXT and audit JSON download automatically;
9. reload during a round restores the controller;
10. a provider terminal failure produces `ERROR`, not false `COMPLETED`.

The current execution environment used to produce this branch cannot authenticate into the user's local Chrome provider sessions, so the real provider run remains the required final field test.
