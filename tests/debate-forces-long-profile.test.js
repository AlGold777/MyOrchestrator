// Locks: the serial-debate dispatcher (runModelBatch) forces the LONG generation-wait
// profile, so debate turns are never truncated by the SHORT default. The Debate page
// has no Long toggle of its own, so this is the only place the profile gets set for it.
const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('debate forces LONG profile', () => {
  test('runModelBatch sets longGenerationMode true and marks the profile long', () => {
    const fnIdx = RESULTS_SRC.indexOf('const runModelBatch = async');
    expect(fnIdx).toBeGreaterThan(-1);
    // Keep the assertion scoped to runModelBatch while allowing pre-dispatch
    // validation/compaction layers to grow without weakening the contract.
    const window = RESULTS_SRC.slice(fnIdx, fnIdx + 12000);
    expect(window).toContain("lastGenerationWaitProfile = 'long'");
    expect(window).toContain('chrome.storage.local.set({ [LONG_GENERATION_MODE_KEY]: true }');
  });

  test('debate end restores the flag to the user main-page choice (profile isolation)', () => {
    const idx = RESULTS_SRC.indexOf('const finalizeSerialDebateRuntime =');
    expect(idx).toBeGreaterThan(-1);
    const block = RESULTS_SRC.slice(idx, idx + 1400);
    expect(block).toContain('writeLongGenerationMode(longModeCheckbox ? longModeCheckbox.checked : true)');
  });
});
