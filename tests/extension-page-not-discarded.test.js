// Reported 2026-07-31: the main page periodically loses all its content — an
// empty tab with no address — and comes back complete as soon as the extension
// button is clicked.
//
// That signature is Chrome's memory saver discarding the tab: the document is
// torn down while the tab keeps its slot, and re-activation reloads it and
// rehydrates from storage, which is why nothing is actually lost. A long run
// leaves the page backgrounded for minutes, which is when discard happens.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');

describe('extension pages are not auto-discarded', () => {
  test('the protection sets autoDiscardable false', () => {
    const helper = SRC.slice(
      SRC.indexOf('const codexProtectExtensionPageTab'),
      SRC.indexOf('const codexExtensionPageUrls')
    );
    expect(helper).toContain('autoDiscardable: false');
    expect(helper).toContain('Number.isInteger(tabId)');
  });

  test('it covers both extension pages', () => {
    const urls = SRC.slice(
      SRC.indexOf('const codexExtensionPageUrls'),
      SRC.indexOf('// Re-assert on startup')
    );
    expect(urls).toContain('pipeline_panel.html');
    expect(urls).toContain('result_new.html');
  });

  test('it is re-asserted after a load, since the flag is per-tab and not persistent', () => {
    const listener = SRC.slice(
      SRC.indexOf('chrome.tabs.onUpdated.addListener'),
      SRC.indexOf('chrome.tabs.query({ url: codexExtensionPageUrls() }')
    );
    expect(listener).toContain("changeInfo.status !== 'complete'");
    expect(listener).toContain('codexProtectExtensionPageTab(tabId)');
  });

  test('existing pages are protected at startup, not only newly created ones', () => {
    const startup = SRC.slice(
      SRC.indexOf('chrome.tabs.query({ url: codexExtensionPageUrls() }'),
      SRC.indexOf('[BACKGROUND] Extension page discard protection failed')
    );
    expect(startup).toContain('codexProtectExtensionPageTab(tab?.id)');
  });

  test('a page opened from the action button is protected too', () => {
    const actionAt = SRC.indexOf('chrome.action.onClicked.addListener');
    expect(actionAt).toBeGreaterThan(-1);
    const action = SRC.slice(
      actionAt,
      SRC.indexOf('[BACKGROUND] Fast action open registration failed', actionAt)
    );
    // Both branches: the reused existing tab and the newly created one.
    expect(action).toContain('codexProtectExtensionPageTab(existing.id)');
    expect(action).toContain('codexProtectExtensionPageTab(tab?.id)');
  });
});
