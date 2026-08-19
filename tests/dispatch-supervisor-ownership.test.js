const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);

describe('dispatch supervisor ownership', () => {
  test('supervisor never originates an untouched model first dispatch', () => {
    const supervisor = SOURCE.slice(
      SOURCE.indexOf('async function runPromptDispatchSupervisor'),
      SOURCE.indexOf('async function dispatchPromptToTab')
    );
    expect(supervisor).toContain('if (attempts <= 0 || attempts >= DISPATCH_MAX_ATTEMPTS) continue;');
    expect(supervisor).toContain('entry.lastDispatchError != null');
  });

  test('supervisor serializes explicitly scheduled retries', () => {
    const supervisor = SOURCE.slice(
      SOURCE.indexOf('async function runPromptDispatchSupervisor'),
      SOURCE.indexOf('async function dispatchPromptToTab')
    );
    expect(supervisor).toContain("await dispatchPromptToTab(llmName, tabId");
    expect(supervisor).toMatch(/await dispatchPromptToTab[\s\S]*?break;/);
  });

  test('physical Send evidence preserves the current dispatch identity', () => {
    const dispatch = SOURCE.slice(
      SOURCE.indexOf('async function dispatchPromptToTab'),
      SOURCE.indexOf('const recoveryIntent = options.recoveryIntent')
    );
    expect(dispatch).toContain('entry.providerSendActionObservedDispatchId === currentDispatchId');
    expect(dispatch).toContain("currentProviderStage !== 'send_action_failed'");
    expect(dispatch).toContain("reason: 'send_action_pending_confirmation'");
  });
});
