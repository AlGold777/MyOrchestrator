/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'results-telemetry-export-bootstrap.js'), 'utf8');

describe('telemetry JSON export bootstrap', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    document.body.innerHTML = `
      <button id="telemetry-export-json-btn"><span id="download-icon">download</span></button>
      <p id="telemetry-status"></p>`;
    delete window.__TELEMETRY_EXPORT_BOOTSTRAP_READY__;
    delete window.__DEVTOOLS_TELEMETRY_READY__;
    delete window.__PENDING_TELEMETRY_JSON_EXPORT__;
    delete window.__TELEMETRY_EXPORT_CLICKED_AT__;
    delete window.ensureTelemetryDevtoolsLoaded;
    window.chrome = { runtime: { getURL: jest.fn((name) => `chrome-extension://test/${name}`) } };
    window.eval(source);
  });

  afterEach(() => {
    delete window.chrome;
  });

  test('captures an early click, loads devtools immediately and resumes the same export', async () => {
    let resumed = 0;
    document.addEventListener('telemetry-export-json-request', () => { resumed += 1; }, { once: true });

    document.getElementById('download-icon').click();

    const script = document.querySelector('script[data-telemetry-devtools]');
    expect(script).not.toBeNull();
    expect(script.src).toBe('chrome-extension://test/results-devtools.js');
    expect(window.__PENDING_TELEMETRY_JSON_EXPORT__).toBe(true);
    expect(document.getElementById('telemetry-export-json-btn').disabled).toBe(true);
    expect(document.getElementById('telemetry-status').textContent).toBe('Loading JSON exporter…');

    window.__DEVTOOLS_TELEMETRY_READY__ = true;
    script.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await Promise.resolve();

    expect(resumed).toBe(1);
  });
});
