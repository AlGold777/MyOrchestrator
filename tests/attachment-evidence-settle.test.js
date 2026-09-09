/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/attachment-handler.js'), 'utf8');

function setup() {
  const input = { files: [{}] };
  const body = { innerText: '' };
  const c = {
    Date, setTimeout, console,
    document: { body, querySelectorAll: selector => selector === 'input[type="file"]' ? [input] : [] }
  };
  c.window = c; c.self = c;
  vm.runInNewContext(source.replace('    hydrateAttachments\n', '    hydrateAttachments, waitForUploadConfirmation\n'), c);
  return { c, body };
}

beforeEach(() => jest.useFakeTimers().setSystemTime(1000));
afterEach(() => jest.useRealTimers());

test('a provider-rendered filename uses normal settling, not the 15-second input-only delay', async () => {
  const { c, body } = setup();
  body.innerText = 'evidence.txt';
  const pending = c.AttachmentHandler.waitForUploadConfirmation({
    confirmSelectors: ['.file-chip'], confirmGoneSelectors: [],
    inputFileCountIsEvidence: true, inputEvidenceSettleMs: 15000, settleMs: 800, pollMs: 100
  }, 1, { confirmCount: 0, filenameEvidenceCount: 0 }, [{ name: 'evidence.txt' }], 4000, false);
  await jest.advanceTimersByTimeAsync(800);
  expect(await pending).toEqual(expect.objectContaining({ confirmed: true, elapsedMs: 800 }));
});

test('synthetic delivery cannot confirm from input.files, while trusted input still needs its longer settle', async () => {
  const { c } = setup();
  const config = {
    confirmSelectors: ['.file-chip'], inputFileCountIsEvidence: true,
    inputEvidenceSettleMs: 15000, settleMs: 800, pollMs: 100
  };
  const observe = (trusted, budget) => c.AttachmentHandler.waitForUploadConfirmation(
    config, 1, { confirmCount: 0, filenameEvidenceCount: 0 }, [{ name: 'evidence.txt' }], budget, trusted
  );
  const synthetic = observe(false, 16000);
  const trusted = observe(true, 16000);
  await jest.advanceTimersByTimeAsync(16000);
  expect((await synthetic).confirmed).toBe(false);
  expect(await trusted).toEqual(expect.objectContaining({ confirmed: true, elapsedMs: 15000 }));
});

test('Gemini drop/paste strategies do not accept a populated file input as upload evidence', async () => {
  const { c } = setup();
  Object.assign(c, {
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    File: class { constructor(parts, name) { this.name = name; } },
    CustomEvent: class {},
    dispatchEvent() {},
    ContentUtils: { ensureMainWorldBridge: async () => true, getMainBridgeToken: () => 'test', reportDispatchStage() {} },
    chrome: { runtime: { sendMessage() {} } }
  });
  c.document.querySelector = () => null;
  const pending = c.AttachmentHandler.attach('Gemini', [{
    name: 'evidence.txt', base64: 'data:text/plain;base64,eA=='
  }]);
  await jest.advanceTimersByTimeAsync(100000);
  expect(await pending).toEqual(expect.objectContaining({ success: false, reason: 'TIMEOUT' }));
});
