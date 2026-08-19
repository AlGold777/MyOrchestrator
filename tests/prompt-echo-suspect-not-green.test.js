// Architectural guard: "suspect ≠ green". A terminal FAILURE must not be re-greened by
// preserving a fake answer — a prompt-echo (Claude's 394 = answer_prompt_echo) or a
// suspect-short scrape. The existing isPromptEchoAnswerCandidate already flags clean
// prompt prefixes via its overlap branch; this locks the preservation-path gate.
const fs = require('fs');
const path = require('path');

const ORCH_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);
const TELEMETRY_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'telemetry-logs.js'),
  'utf8'
);
const GROK_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-grok.js'),
  'utf8'
);
const MANIFEST = require('../manifest.json');
const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

describe('prompt-echo / suspect is not a green answer (preservation path)', () => {
  test('terminal-failure preservation refuses echo / suspect-short, and the event is pinned', () => {
    expect(ORCH_SRC).toContain('const preservedEcho = isPromptEchoAnswerCandidate(preservedAnswer');
    expect(ORCH_SRC).toContain('!preservedEcho && !preservedSuspectShort');
    expect(ORCH_SRC).toContain('PRESERVED_EVIDENCE_REJECTED');
    expect(TELEMETRY_SRC).toContain('PRESERVED_EVIDENCE_REJECTED');
  });

  test('Grok cannot finalize scraped page text before submit confirmation', () => {
    expect(ORCH_SRC).toContain("details: 'grok_submit_unconfirmed'");
    expect(ORCH_SRC).toContain('&& !entry.promptSubmittedAt');
    expect(ORCH_SRC).toContain("error = { type: 'send_failed'");
  });

  test('prompt/UI scaffolding is rejected before success finalization', () => {
    expect(ORCH_SRC).toContain("['ui_noise', 'provider_error'].includes(answerContentClassification?.contentClass)");
    expect(ORCH_SRC).toContain("type: `answer_${rejectedClass}`");
  });

  test('Grok ordinary prompt input does not attach the Chrome debugger', () => {
    expect(GROK_SRC).toContain('async function grokClipboardPaste');
    expect(GROK_SRC).toContain('await forceComposerValue(input, payload)');
    expect(GROK_SRC).not.toContain("type: 'GROK_TRUSTED_INPUT_REQUEST'");
    expect(GROK_SRC).not.toContain("new ClipboardEvent('paste'");
    expect(GROK_SRC).not.toContain("execCommand?.('paste'");
    expect(MANIFEST.permissions).toEqual(expect.arrayContaining(['clipboardRead', 'clipboardWrite']));
    expect(GROK_SRC).not.toContain("type: 'GROK_TRUSTED_INPUT_REQUEST'");
    expect(ROUTER_SRC).toContain("'GROK_TRUSTED_INPUT_REQUEST',");
    expect(ROUTER_SRC).toContain("reason: 'debugger_route_disabled'");
  });

  test('Grok requires the entire normalized prompt before send', () => {
    expect(GROK_SRC).toContain('normalizedValue === normalizedPrompt');
    expect(GROK_SRC).toContain('normalizedValue !== normalizedPrompt');
    expect(GROK_SRC).toContain('Grok rejected both page input transactions.');
    expect(GROK_SRC).not.toContain('await humanoid.typeText(composer, prompt');
  });

  test('the packaged extension cannot use chrome.debugger', () => {
    expect(MANIFEST.permissions).not.toContain('debugger');
    expect(ROUTER_SRC).toContain('const BROWSER_DEBUGGING_DISABLED = true;');
    expect(ROUTER_SRC).toContain("reject(new Error('browser_debugging_disabled'))");
  });

  test('Grok waits through a five-second full-prompt commit window before send', () => {
    expect(GROK_SRC).toContain('async function waitForGrokComposerCommit');
    expect(GROK_SRC).toContain('waitForGrokComposerCommit(composer, prompt, 5000, 250)');
    expect(GROK_SRC).toContain("label: 'GROK_COMPOSER_COMMIT_CONFIRMED'");
    expect(GROK_SRC).toContain("label: 'GROK_COMPOSER_COMMIT_MISMATCH'");
    const commitAt = GROK_SRC.indexOf('const committedComposer = await waitForGrokComposerCommit');
    const sendAt = GROK_SRC.indexOf('attemptSendViaCtrlEnter(composer)', commitAt);
    expect(commitAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(commitAt);
  });

  // 2026-08-05: reordered to match Le Chat's contract (ports/lechat-pasted-request-send).
  // Ctrl+Enter is now first — once the composer commit window above confirms
  // the exact prompt is in place, Grok's own shortcut submits it without
  // depending on a send-button selector lookup having found anything, or on
  // that button's disabled state. The button click remains a fallback.
  test('Grok tries Ctrl+Enter before the send button lookup', () => {
    const commitAt = GROK_SRC.indexOf('const committedComposer = await waitForGrokComposerCommit');
    const buttonAt = GROK_SRC.indexOf('dispatchSuccess = await attemptSendViaButton(sendBtn, composer)', commitAt);
    const ctrlEnterAt = GROK_SRC.indexOf('dispatchSuccess = await attemptSendViaCtrlEnter(composer)', commitAt);
    expect(ctrlEnterAt).toBeGreaterThan(commitAt);
    expect(buttonAt).toBeGreaterThan(ctrlEnterAt);
  });

  test('Grok reports dispatch confirmation only after strict posted-turn verification', () => {
    const dispatchSuccessAt = GROK_SRC.indexOf('if (!dispatchSuccess)');
    const earlySubmittedAt = GROK_SRC.indexOf("submitConfirmationSource: 'dispatch_success'", dispatchSuccessAt);
    const verifyAt = GROK_SRC.indexOf('const submittedPrompt = await waitForGrokSubmittedPrompt');
    const verifiedSubmittedAt = GROK_SRC.indexOf('promptTurnVerified: true', verifyAt);
    expect(dispatchSuccessAt).toBeGreaterThan(-1);
    expect(earlySubmittedAt).toBe(-1);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(GROK_SRC.indexOf('GROK_SENT_PROMPT_MISMATCH', verifyAt)).toBeGreaterThan(verifyAt);
    expect(GROK_SRC.indexOf('stopGrokWrongGeneration()', verifyAt)).toBeGreaterThan(verifyAt);
    expect(verifiedSubmittedAt).toBeGreaterThan(verifyAt);
    expect(TELEMETRY_SRC).toContain('GROK_SENT_PROMPT_MISMATCH');
  });

  test('Grok accepts Markdown-rendered equivalence but still rejects truncation', () => {
    expect(GROK_SRC).toContain('const normalizeGrokRenderedPrompt');
    expect(GROK_SRC).toContain("matchMode: strictMatch ? 'strict' : (renderedMatch ? 'rendered_markdown' : 'mismatch')");
    expect(GROK_SRC).toContain('matches: strictMatch || renderedMatch');

    const normalize = (text = '') => String(text)
      .normalize('NFC')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]+/gm, '')
      .replace(/[•◦▪]/g, ' ')
      .replace(/[*_~`]+/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const source = '# Проверка\n- **Первый** пункт\n- [Второй](https://example.com) пункт';
    const rendered = 'Проверка\nПервый пункт\nВторой пункт';
    expect(normalize(source)).toBe(normalize(rendered));
    expect(normalize(rendered.slice(0, -5))).not.toBe(normalize(source));
  });

  test('a changed or unverifiable submitted Grok payload maps to NO_SEND', () => {
    expect(ORCH_SRC).toContain("'send_payload_mismatch', 'send_payload_unverified'");
    expect(ORCH_SRC).toContain("return 'NO_SEND'");
  });

  describe('isPromptEchoAnswerCandidate semantics (mirror of the source)', () => {
    const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isEcho = (answerText, promptText) => {
      const answer = normalize(answerText);
      const prompt = normalize(promptText);
      if (!answer || !prompt || prompt.length < 80) return false;
      if (answer === prompt) return true;
      if (answer.includes(prompt) && answer.length <= prompt.length + 180) return true;
      const promptHead = prompt.slice(0, Math.min(prompt.length, 240));
      if (promptHead.length >= 80 && answer.startsWith(promptHead)) return true;
      const limit = Math.min(prompt.length, answer.length);
      let overlap = 0;
      for (let i = 0; i < limit; i += 1) { if (answer[i] !== prompt[i]) break; overlap += 1; }
      return overlap >= Math.min(limit, Math.floor(prompt.length * 0.9));
    };

    const PROMPT = 'Ссылайся на следующее содержимое: ' + 'детали запроса '.repeat(20); // >> 80 chars

    test('the (near-)full prompt is an echo', () => {
      expect(isEcho(PROMPT, PROMPT)).toBe(true);
    });
    test('a clean prompt-prefix fragment is already flagged (overlap branch)', () => {
      // Documents that a clean leading slice of the prompt is caught — so a value that
      // is NOT caught (e.g. Grok 206) is therefore not a clean prefix: a layer-1 (input)
      // problem, not a finalization one.
      expect(isEcho(PROMPT.slice(0, 206), PROMPT)).toBe(true);
      expect(isEcho(PROMPT.slice(0, 20), PROMPT)).toBe(true);
    });
    test('a genuine answer that is not a prompt slice passes', () => {
      expect(isEcho('Вот развёрнутый ответ по существу вопроса, который ничего общего с формулировкой запроса не имеет.', PROMPT)).toBe(false);
    });
    test('no prompt (or tiny prompt) never flags echo', () => {
      expect(isEcho('anything at all here', 'tiny')).toBe(false);
    });
  });
});
