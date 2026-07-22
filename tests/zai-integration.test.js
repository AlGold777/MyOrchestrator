const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Z.ai integration contract', () => {
  test('manifest grants and injects all required scripts on chat.z.ai', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const pattern = '*://chat.z.ai/*';
    expect(manifest.host_permissions).toContain(pattern);
    expect(manifest.content_scripts[0].matches).toContain(pattern);
    expect(manifest.content_scripts[0].js).toContain('selectors/zai.config.js');
    const adapterBlock = manifest.content_scripts.find((entry) => entry.js?.includes('content-scripts/content-zai.js'));
    expect(adapterBlock).toBeTruthy();
    expect(adapterBlock.matches).toEqual([pattern]);
  });

  test('selector profile exposes audited composer, send and response fallbacks', () => {
    const context = { self: {}, console };
    vm.runInNewContext(read('selectors/zai.config.js'), context);
    const config = context.self.SelectorConfigRegistry['Z.ai'];
    expect(config.versions[0].selectors.composer).toContain('#chat-input');
    expect(config.versions[0].selectors.sendButton).toContain('#send-message-button');
    expect(config.versions[0].selectors.response.primary.length).toBeGreaterThanOrEqual(3);
    expect(config.versions[0].observation.endGenerationMarkers.length).toBeGreaterThan(0);
  });

  test('content load order preserves the full Z.ai versioned profile', () => {
    const document = { querySelector: (selector) => ['#chat-input', '#send-message-button'].includes(selector) ? {} : null };
    const context = {
      self: {}, document, console,
      chrome: { storage: { local: { get: () => {}, remove: () => {} } }, runtime: { onMessage: { addListener: () => {} } } }
    };
    ['selectors/config-bundle.js', 'selectors/zai.config.js', 'selectors-config.js']
      .forEach((file) => vm.runInNewContext(read(file), context));
    const selectorConfig = context.self.SelectorConfig;
    expect(selectorConfig.models['Z.ai'].versions).toHaveLength(1);
    expect(selectorConfig.detectUIVersion('Z.ai')).toBe('zai-2026-q2');
    expect(selectorConfig.getSelectorsFor('Z.ai', 'zai-2026-q2', 'composer')).toContain('#chat-input');
  });

  test('adapter implements the runtime message contract', () => {
    const source = read('content-scripts/content-zai.js');
    [
      'CHECK_READINESS', 'GET_ANSWER', 'GET_FINAL_ANSWER', 'GET_ANSWER_NO_FOCUS',
      'HEALTH_CHECK_PING', 'ANTI_SLEEP_PING', 'STOP_AND_CLEANUP',
      'HUMANOID_FORCE_STOP', 'getResponses', 'SCRIPT_LOADED'
    ].forEach((messageType) => expect(source).toContain(messageType));
    expect(source).toContain("const MODEL = 'Z.ai'");
    expect(source).toContain("hostname === 'chat.z.ai'");
  });

  test('attachments use confirmed paste before the exact prompt and send gates', () => {
    const adapter = read('content-scripts/content-zai.js');
    const handler = read('content-scripts/attachment-handler.js');
    const zaiConfig = handler.slice(handler.indexOf("'Z.ai': {"));
    expect(zaiConfig).toContain("strategies: ['provider-cdp-file-input']");
    expect(adapter).toContain('attachments: message.attachments || []');
    expect(adapter).toContain('attachmentHandler.attach(MODEL, options.attachments)');
    expect(adapter).toContain('Z.ai attachment upload not confirmed');
    expect(adapter).toContain('ContentUtils.ensurePromptPrepared');
    expect(adapter.indexOf('if (!sendConfirmed)')).toBeLessThan(adapter.indexOf("type: 'PROMPT_SUBMITTED'"));
  });

  test('results UI and pipeline expose the canonical model', () => {
    expect(read('result_new.html')).toContain('id="llm-zai"');
    expect(read('result_new.html')).toContain('id="output-zai"');
    expect(read('pipeline_panel.html')).toContain('id="llm-zai"');
    expect(read('pipeline/pipeline-runtime.js')).toContain("{ name: 'Z.ai', defaultActive: false }");
    expect(read('results.js')).toContain("'zai': 'Z.ai'");
  });

  test('model label is rejected as UI noise, not accepted as an answer', () => {
    const classifier = require('../shared/answer-content-classifier');
    expect(classifier.classify('Z.ai').contentClass).toBe(classifier.CLASSES.UI_NOISE);
    expect(classifier.isTerminalEligible('Z.ai')).toBe(false);
  });
});
