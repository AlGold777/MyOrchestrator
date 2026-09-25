# Automation Layer

`automation.html` runs a two-round workflow through the existing MyOrchestrator Web runtime.

## Use

1. Load or reload this extension from `chrome://extensions` after updating the local checkout.
2. Open the extension's Automation page.
3. Sign in to the provider sites that you plan to use.
4. Select exactly two model buttons, enter the request, and press the send button.
5. Follow both rounds in the Automation feed. Round 2 starts when both Round 1 responses reach terminal `SUCCESS` with non-empty answers.
6. Download the result and audit JSON from the run controls. Successful runs download both files automatically.

The page uses the existing composer (`#modTa`), selected `.llm-button` controls, and `#debate-run-toggle-btn`. Its capture-phase handler routes that button to Automation so the ordinary debate handler cannot start a competing run.

## Runtime behavior

- Both rounds dispatch `START_FULLPAGE_PROCESS` with fresh tabs and API fallback disabled.
- Each stage is correlated by `pipelineRunId = <automationRunId>:R<round>`.
- The background MyOrchestrator owns provider interaction, completion detection, extraction, and provider recovery.
- If a model has no terminal progress for 20 seconds, the Automation Supervisor calls the existing `GET_IT_BATCH` primitive for non-terminal models only. It allows up to two bounded recovery passes per round and never resends the model prompt or extracts provider DOM itself.
- Automation accepts only terminal successful responses with non-empty answers. A terminal failure ends the overall run.
- Recovery lifecycle events (`ANSWER_PENDING_FINALIZATION`, `RECOVERY_STARTED`, `RECOVERY_ACCEPTED`, and `FINALIZATION_STALLED`) are shown in the feed and diagnostic journal. Exhausted recovery ends in `FINALIZATION_STALLED` and keeps audit export available.
- The feed is ordered by runtime `finalizedAt`; Round 2 input combines Round 1 answers in selected-model order.
- Controller checkpoints are stored in `chrome.storage.local` under `automationLayer.v1`. Runtime `jobState` is read through the existing compressed-storage decoder.

## Local field test

Open the unpacked extension in Chrome, authenticate the selected providers, and run one two-model request. Confirm both Round 1 responses appear, Round 2 starts automatically, both final answers appear, and TXT plus audit JSON downloads complete. Reload the Automation page during a run once to verify recovery. If provider answers appear without terminal runtime state, confirm `GET_IT_BATCH` recovery events appear; a run still lacking terminal results after two passes should enter `FINALIZATION_STALLED` and remain available for audit export.

Automated core tests are in `tests/automation-layer-core.test.js`. The actual provider field test requires the user's authenticated Chrome sessions.
