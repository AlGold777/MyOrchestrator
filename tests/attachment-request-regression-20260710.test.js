const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const handler = read('content-scripts/attachment-handler.js');
const router = read('background/message-router.js');

const providers = {
  Grok: read('content-scripts/content-grok.js'),
  Gemini: read('content-scripts/content-gemini.js'),
  Qwen: read('content-scripts/content-qwen.js'),
  Perplexity: read('content-scripts/content-perplexity.js'),
  DeepSeek: read('content-scripts/content-deepseek.js'),
  'Le Chat': read('content-scripts/content-lechat.js')
};

describe('attachment request regression 2026-07-10', () => {
  test('uses filename evidence and prevents duplicate delivery on false selector timeouts', () => {
    expect(handler).toContain('const countFilenameEvidence =');
    expect(handler).toContain('filenameEvidenceCount >= baselineFilenameEvidence + expectedCount');
    expect(handler).toContain('attempted && config.singleDispatch');

    for (const [startLabel, endLabel] of [
      ['Perplexity: {', 'Qwen: {'],
      ['DeepSeek: {', "'Le Chat': {"],
      ["'Le Chat': {", '\n  };']
    ]) {
      const start = handler.indexOf(startLabel);
      const end = handler.indexOf(endLabel, start + startLabel.length);
      expect(handler.slice(start, end)).not.toContain('singleDispatch: true');
    }
  });

  test('Qwen uses its exact native file input through trusted CDP', () => {
    const qwenConfig = handler.slice(handler.indexOf('Qwen: {'), handler.indexOf('DeepSeek: {'));
    // The CDP vector stays first, but a CDP-only list is forbidden: the `debugger`
    // permission was removed in 2.81.112, so without a fallback an attachment
    // failure aborted the entire dispatch and the prompt was never inserted.
    expect(qwenConfig).toMatch(/strategies: \['qwen-cdp-file-input',/);
    expect(qwenConfig).toContain("'input'");
    expect(qwenConfig).not.toContain('dispatchIsEvidence: true');
    expect(qwenConfig).toContain('inputFileCountIsEvidence: true');
    expect(qwenConfig).toContain('inputEvidenceSettleMs: 10000');
    expect(qwenConfig).not.toContain("strategies: ['drop', 'input']");
    expect(handler).toContain("type: 'QWEN_CDP_ATTACH_REQUEST'");
    expect(router).toContain("case 'QWEN_CDP_ATTACH_REQUEST'");
    expect(router).toContain("document.querySelector('input#filesUpload[type=\"file\"]')");
    expect(router).toContain('dispatchQwenCdpAttachments');
    expect(router).toContain('QWEN_CDP_FILES_ASSIGNED');
    expect(providers.Qwen).toContain('Qwen trusted attachment handler unavailable');
  });

  test('re-resolves provider composers after attachment UI rerenders', () => {
    expect(providers.Grok).toContain('Composer refreshed after attachment');
    expect(providers.Gemini).toContain('Gemini input field disappeared after attachment upload');
    expect(providers.Perplexity).toContain('Perplexity input field disappeared after attachment upload');
    expect(providers.DeepSeek).toContain('DeepSeek input field disappeared after attachment upload');
    expect(providers['Le Chat']).toContain('Le Chat input field disappeared after attachment upload');
  });

  test('Gemini rejects the help/status control as an upload trigger', () => {
    expect(router).toContain('file not attached');
    expect(router).toContain('файл не прикреплен');
    expect(router).toContain('дополнительные параметры');
    expect(router).toContain('открыть меню загрузки');
  });

  test('Gemini trusts successful CDP assignment and verifies prompt insertion before send', () => {
    const geminiConfig = handler.slice(handler.indexOf('Gemini: {'), handler.indexOf('Perplexity: {'));
    expect(geminiConfig).toContain('dispatchIsEvidence: true');
    expect(handler).toContain("reason: 'TRUSTED_DISPATCH'");
    expect(providers.Gemini).toContain('Gemini prompt injection failed');
    expect(providers.Gemini).toContain("type: 'prompt_injection_failed'");
    expect(providers.Gemini).toContain('scoreGeminiSendButtonCandidate(sendButton, inputField) < 8');
    expect(providers.Gemini).toContain('function normalizeGeminiComposerText');
    expect(providers.Gemini).not.toContain('normalizeForComparison(');
    expect(providers.Qwen).toContain('Qwen composer refreshed after attachment');
  });

  test('GPT waits for an enabled attachment send button and confirms against the pre-send turn count', () => {
    const gpt = read('content-scripts/content-chatgpt.js');
    expect(gpt).toContain('attachmentSendDeadline = Date.now() + 45000');
    expect(gpt).toContain("details: 'attachment_send_button'");
    expect(gpt).toContain('after > preSendUserCount');
    expect(gpt).toContain('attach|attachment|upload|add file|file picker|paperclip|voice|microphone');
  });
});
