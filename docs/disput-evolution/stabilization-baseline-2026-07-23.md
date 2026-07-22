# Disput stabilization baseline — 2026-07-23

## Repository checkpoint

- The supplied folder had no Git metadata.
- A local repository was initialized to provide task-level rollback.
- Baseline commit: `cccc556` (`chore: capture pre-stabilization baseline`).
- Implementation branch: `codex/disput-stabilization-v2.1`.

## Test baseline

Command:

```text
npm test -- --runInBand
```

Result before stabilization changes:

- 163 test suites passed;
- 995 tests passed;
- 0 snapshots;
- Jest time: 47.767 seconds;
- process exit code: 0.

Observed non-fatal test noise:

- stale `baseline-browser-mapping` package warning;
- jsdom lacks `URL.createObjectURL` in one export path;
- expected diagnostic warnings from selector/background tests.

These warnings did not fail the baseline and must not be confused with regressions introduced by stabilization work.

## Current execution-path facts

- Legacy remains the production path.
- `universalEngine` remains default-off.
- Universal production wiring hard gate exists, but production ports and semantic artifact pipeline are incomplete.
- `results.js` is the active composition root and must not receive parallel conflicting edits.
