const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { validateContainer } = require('../scripts/validate-proof-telemetry.js');

const ROOT = path.join(__dirname, '..');
const WORKER_DIR = path.join(ROOT, 'workers');

const runtimeEvent = (label, ts, meta = {}) => ({
  ts,
  type: 'TELEMETRY',
  label,
  level: 'info',
  platform: 'GPT',
  meta: {
    llmName: 'GPT',
    runSessionId: 42,
    dispatchId: 'GPT:42:1',
    generationEpoch: 1,
    ...meta
  }
});

function loadWorker(messages) {
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    TextEncoder,
    setTimeout,
    clearTimeout
  });
  context.self = context;
  context.postMessage = (message) => messages.push(message);
  context.importScripts = (...resources) => {
    resources.forEach((resource) => {
      const filename = path.resolve(WORKER_DIR, resource);
      vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    });
  };
  const filename = path.join(WORKER_DIR, 'telemetry-export-worker.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return context;
}

describe('telemetry export worker', () => {
  test('builds, redacts and returns a valid all-presets JSON document', async () => {
    const events = ProofTelemetry.buildLedger({
      '<GPT>': [
        runtimeEvent('DISPATCH_BASELINE_CAPTURED', 1000),
        runtimeEvent('DISPATCH_SEND', 1100),
        runtimeEvent('PROMPT_SUBMITTED_ACCEPTED', 1200),
        runtimeEvent('ANSWER_START_DETECTED', 1300, { textLength: 8 }),
        runtimeEvent('ANSWER_TEXT_STABLE', 1400, { textLength: 120 }),
        runtimeEvent('ANSWER_VERIFICATION_RECORDED', 1500, { textLength: 120, verified: true }),
        runtimeEvent('MODEL_FINAL', 1600, { finalStatus: 'SUCCESS', answerLen: 120 })
      ]
    }, { runSessionId: 42, exportedAt: 2000 });
    const messages = [];
    const worker = loadWorker(messages);

    const request = {
      data: {
        type: 'BUILD_FULL_TELEMETRY_JSON',
        requestId: 'worker-test',
        events,
        options: {
          canonicalLedger: true,
          runSessionId: 42,
          exportedAt: 2000,
          extensionVersion: '2.81.222',
          snapshotConsistency: 'queue_drained'
        }
      }
    };
    // JSON round-trip inside the VM mirrors the browser's structured clone:
    // worker payload objects belong to the worker realm, not the page realm.
    await vm.runInContext(`self.onmessage(${JSON.stringify(request)})`, worker);

    expect(messages.map((message) => message.type)).toEqual(['stage', 'stage', 'complete']);
    expect(messages.filter((message) => message.type === 'stage').map((message) => message.stage))
      .toEqual(['building', 'serializing']);
    const complete = messages.find((message) => message.type === 'complete');
    const container = JSON.parse(complete.json);
    expect(container.containerType).toBe('all-presets');
    expect(container.ledger.events).toHaveLength(events.length);
    expect(container.sharedConfig.dependencyRegistry.eventInventoryVersion).toBe('1.0.0');
    expect(container.exportAudit.completeness).toEqual(expect.objectContaining({
      snapshotCompleteness: 'queue_drained',
      runCompleteness: 'unknown',
      exportedDuringActiveRun: false
    }));
    const validation = await validateContainer(container);
    // This intentionally sparse fixture lacks terminal audit/decision lineage,
    // but transport through the worker must not introduce structural, hash, or
    // byte-accounting corruption of its own.
    expect(validation.errors.map((error) => error.code))
      .not.toEqual(expect.arrayContaining(['JSON_SCHEMA', 'HASH_MISMATCH', 'SIZE_MISMATCH']));
    expect(validation.errors.map((error) => error.code).sort()).toEqual(['S06', 'S15']);
  });
});
