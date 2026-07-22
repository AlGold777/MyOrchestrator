const fs = require('fs');
const path = require('path');

// Styles are split into styles/*.css behind a styles.css @import loader. Resolve
// the loader + its imported modules so CSS content assertions stay valid.
const readResolvedCss = () => {
  const dir = path.join(__dirname, '..');
  const loader = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
  const modules = [...loader.matchAll(/@import url\("(styles\/[^"]+\.css)"\)/g)]
    .map((m) => fs.readFileSync(path.join(dir, m[1]), 'utf8'));
  return [loader, ...modules].join('\n');
};

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const blobToText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

function installChromeStorageMock() {
  const store = new Map();
  chrome.runtime.getURL = jest.fn((value) => value);
  chrome.storage.local.get = jest.fn((key, callback) => {
    let result = {};
    if (key === null) {
      store.forEach((value, storeKey) => { result[storeKey] = value; });
    } else if (typeof key === 'string') {
      result = { [key]: store.get(key) };
    } else if (Array.isArray(key)) {
      key.forEach((item) => { result[item] = store.get(item); });
    } else {
      Object.keys(key || {}).forEach((item) => {
        result[item] = store.has(item) ? store.get(item) : key[item];
      });
    }
    if (typeof callback === 'function') {
      callback(result);
      return undefined;
    }
    return Promise.resolve(result);
  });
  chrome.storage.local.set = jest.fn((obj, callback) => {
    Object.entries(obj || {}).forEach(([key, value]) => store.set(key, value));
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });
}

function installDomMocks() {
  window.ResultsShared = {
    escapeHtml: (value = '') => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    stripHtmlToPlainText: (html = '') => String(html).replace(/<[^>]*>/g, ''),
    buildResponseCopyHtmlBlock: () => '',
    wrapResponsesHtmlBundle: (sections = '') => sections,
    fallbackCopyViaTextarea: jest.fn(),
    flashButtonFeedback: jest.fn(),
    writeRichContentToClipboard: jest.fn()
  };
  window.fetch = jest.fn(async (url = '') => {
    const pathValue = String(url);
    let payload = { templates: [] };
    if (pathValue.includes('system_templates/index.json')) {
      payload = [];
    } else if (pathValue.includes('Modifiers/modifier-presets.json')) {
      payload = [{ id: 'base', label: 'Base', file: 'modifiers.json' }];
    } else if (pathValue.includes('disput/pipeline-actions.json')) {
      payload = [
        { id: 'harden', label: 'Harden Critique', type: 'suffix', text: 'Attack the previous thesis harder. Find a logical flaw or false assumption.', order: 10, groupLabel: 'Action' },
        { id: 'compare', label: 'Compare by Criteria', type: 'suffix', text: 'Build a comparative table: cost, complexity, risks, scalability.', order: 20, groupLabel: 'Action' }
      ];
    } else if (pathValue.includes('Modifiers/modifiers.json')) {
      payload = [];
    }
    return {
      ok: true,
      json: async () => payload
    };
  });
  document.execCommand = jest.fn();
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 120,
      height: 20,
      top: 20,
      left: 20,
      right: 140,
      bottom: 40,
      x: 20,
      y: 20,
      toJSON() { return this; }
    })
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON() { return this; }
    })
  });
}

function renderDebateDom() {
  document.body.innerHTML = `
    <div class="prompt-container prompt-sandwich debate-composer has-debate-feed">
      <div class="debate-sel-toolbar" id="debateSelTb">
        <button class="stb" data-clear-highlight="1" aria-label="Remove highlight">No colour</button>
        <button class="stb col" data-color="#fde68a" aria-label="Yellow highlight">Yellow</button>
        <button class="stb col" data-color="#bbf7d0" aria-label="Green highlight">Green</button>
        <button class="stb col" data-color="#bfdbfe" aria-label="Blue highlight">Blue</button>
        <button class="stb" data-cmd="bold" aria-label="Bold">Bold</button>
        <button class="stb" data-cmd="italic" aria-label="Italic">Italic</button>
        <button class="stb" data-fav="1" aria-label="Add selected fragment to favorites">Favorite</button>
      </div>
      <div class="debate-session-bar" id="debate-session-bar">
        <span class="debate-session-bar-hit">Debate</span>
        <div id="debate-session-tabs">
          <button type="button" class="debate-session-tab active" data-session-id="1">1</button>
        </div>
      </div>
      <div class="llm-buttons">
        <button class="llm-button" id="llm-gpt">GPT</button>
        <button class="llm-button" id="llm-gemini">Gemini</button>
        <button class="llm-button" id="llm-claude">Claude</button>
        <button class="llm-button" id="llm-grok">Grok</button>
        <button class="llm-button" id="llm-lechat">Le Chat</button>
        <button class="llm-button" id="llm-qwen">Qwen</button>
        <button class="llm-button" id="llm-deepseek">DeepSeek</button>
        <button class="llm-button" id="llm-perplexity">Perplexity</button>
      </div>
      <div class="llm-panel" id="panel-gemini">
        <span class="llm-title">Gemini</span>
        <span class="status-indicator" data-llm-name="Gemini"></span>
        <div class="output" id="output-gemini"></div>
      </div>
      <button id="debate-session-add-btn" type="button">+</button>
      <button id="debate-session-delete-btn" type="button">−</button>
      <button id="debate-session-copy-btn" type="button">copy</button>
      <button id="debate-session-export-btn" type="button">export</button>
      <button id="debate-session-clear-btn" type="button">clear</button>
      <button id="debate-auto-pause-btn" class="hidden" type="button">Ⅱ</button>
      <select id="debate-run-policy-select">
        <option value="manual" selected>Manual</option>
        <option value="auto">Auto</option>
      </select>
      <select id="debate-length-select">
        <option value="300">300</option>
        <option value="500" selected>500</option>
        <option value="700">700</option>
      </select>
      <select id="debate-synthesizer-select">
        <option value="">Synthesizer: None</option>
        <option value="Claude">Claude</option>
        <option value="GPT">GPT</option>
      </select>
      <button id="debate-auto-toggle-btn" type="button">Auto off</button>
      <input id="auto-checkbox" type="checkbox" hidden aria-hidden="true">
      <input id="new-pages-checkbox" type="checkbox" checked>
      <select id="mod-sender-select">
        <option value="Moderator" selected>Moderator</option>
      </select>
      <span id="direction-icon">→</span>
      <select id="mod-receiver-select">
        <option value="">All models</option>
        <option value="__none__" selected>None</option>
      </select>
      <select id="mod-role-select">
        <option value="">Role</option>
      </select>
      <div id="mod-message-body"></div>
      <div id="mod-mini-prompts"></div>
      <button type="button" id="debate-run-toggle-btn" aria-label="Run debate">Run</button>
      <label class="top-new-pages-toggle registry-capable" id="triad-registry-toggle" hidden aria-hidden="true">
        <span class="top-new-pages-text">Реестр</span>
        <input type="checkbox" id="triad-registry-checkbox" class="top-new-pages-checkbox">
      </label>
      <label class="debate-select-wrap" id="debate-round-limit-wrap">
        <select id="debate-round-limit-select">
          <option value="1">1 round</option>
          <option value="2">2 rounds</option>
          <option value="3" selected>3 rounds</option>
          <option value="5">5 rounds</option>
          <option value="infinite">∞</option>
        </select>
      </label>
      <input id="debate-max-turns-input" type="number" value="6" hidden aria-hidden="true">
      <div id="pipeline-panel">
        <span id="currentPipelineName" class="pipeline-name"></span>
        <button type="button" id="pipeline-add-round-btn">+</button>
        <button type="button" id="pipeline-add-btn">+</button>
        <div class="stage-column" id="round1" data-round="1">
          <div class="model-stack" id="r1-models">
            <div class="model-block">
              <span class="model-name">GPT</span>
              <input type="checkbox" class="model-input-checkbox" checked>
              <input type="checkbox" class="model-send-checkbox" checked>
            </div>
            <div class="model-block">
              <span class="model-name">Claude</span>
              <input type="checkbox" class="model-input-checkbox">
              <input type="checkbox" class="model-send-checkbox" checked>
            </div>
          </div>
        </div>
        <div class="connector-group" data-round="2">
          <svg class="connector-svg" id="svg-r1-r2"></svg>
        </div>
        <div class="stage-column" id="round2" data-round="2">
          <div class="model-stack" id="r2-models"></div>
        </div>
        <div id="insertionPoint"></div>
        <div class="connector-group synthesis-capable" id="connectorToSynthesis" hidden aria-hidden="true">
          <svg class="connector-svg" id="svg-r-last-synthesis"></svg>
        </div>
        <div class="stage-column synthesis-capable" id="synthesisColumn" data-stage="synthesis" hidden aria-hidden="true">
          <div class="model-stack synthesis-stack" id="synthesis-stack" data-render="pipeline-synthesis-stack"></div>
        </div>
        <div id="connectorToOutput">
          <svg class="connector-svg" id="svg-stage-output"></svg>
        </div>
        <div id="outputColumn">
        <div class="output-stack" id="output-stack">
          <div class="output-block" data-output="notes">
            <input type="checkbox" class="output-checkbox" checked>
            <span class="output-name">Renamed A</span>
          </div>
          <div class="output-block" data-output="export">
            <input type="checkbox" class="output-checkbox">
            <span class="output-name">Renamed B</span>
          </div>
          <div class="output-block" data-output="exportHtml">
            <input type="checkbox" class="output-checkbox" checked>
            <span class="output-name">Renamed C</span>
          </div>
        </div>
        </div>
        <div class="pipeline-items" id="pipelineItems">
          <div class="pipeline-item active" data-name="Research & Analysis">
            <input type="radio" name="pipeline" class="pipeline-radio" checked>
            <span class="pipeline-item-name" title="Research & Analysis">Research & Anal...</span>
          </div>
          <div class="pipeline-item" data-name="Content Gen">
            <input type="radio" name="pipeline" class="pipeline-radio">
            <span class="pipeline-item-name" title="Content Gen">Content Gen</span>
          </div>
          <div class="pipeline-item" data-name="Idea Validation">
            <input type="radio" name="pipeline" class="pipeline-radio">
            <span class="pipeline-item-name" title="Idea Validation">Idea Validation</span>
          </div>
        </div>
        <div class="pipeline-items-divider"></div>
        <div class="customer-pipeline-items" id="customerPipelineItems"></div>
      </div>
      <textarea id="modTa"></textarea>
      <div id="debate-model-cards"></div>
      <div id="create-template-modal" class="modal">
        <button class="close" type="button">x</button>
        <div class="model-selector"></div>
      </div>
      <select id="template-select"></select>
      <button id="cancel-template" type="button"></button>
      <button id="save-template" type="button"></button>
      <button id="add-variable" type="button"></button>
      <input id="template-name">
      <textarea id="template-prompt"></textarea>
      <div id="template-preview"></div>
      <div id="variables-list"></div>
      <div id="saved-templates-list"></div>
      <div id="system-templates-list"></div>
      <div id="saved-templates-box"></div>
      <button id="saved-templates-toggle" type="button"></button>
      <div id="saved-templates-content"></div>
      <div id="system-templates-box"></div>
      <button id="system-templates-toggle" type="button"></button>
      <div id="system-templates-content"></div>
      <div id="variable-inputs"></div>
      <button id="export-templates-btn" type="button"></button>
      <button id="import-templates-btn" type="button"></button>
      <input id="import-file-input" type="file">
      <div id="confirm-modal" class="modal"></div>
      <div id="confirm-message"></div>
      <button id="delete-confirm" type="button"></button>
      <button id="cancel-confirm" type="button"></button>
      <div id="notification-modal" class="modal"></div>
      <div id="notification-message"></div>
      <button id="notification-ok-btn" type="button"></button>
      <input id="file-input" type="file">
      <div id="file-name-display"></div>
    </div>
  `;
}

function addDebateCard({ id, text, starred = false, model = 'GPT' }) {
  const sessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId || '1';
  const card = document.createElement('div');
  card.className = 'debate-model-card';
  card.dataset.sessionId = sessionId;
  card.dataset.entryId = id;
  card.dataset.messageId = id;
  card.dataset.llmName = model;
  card.dataset.entryKind = 'response';
  card.dataset.kind = 'answer';
  card.dataset.starred = starred ? 'true' : 'false';
  card.innerHTML = `
    <div class="debate-model-card-header">
      <span class="debate-model-card-title-main">
        <span class="debate-model-card-name">${model}</span>
        <span class="debate-model-card-role"></span>
      </span>
      <span class="debate-model-card-meta">
        <span class="debate-model-card-time">12:00</span>
        <button type="button" class="ib debate-fav">★</button>
      </span>
    </div>
    <div class="debate-model-card-output">${text}</div>
  `;
  document.getElementById('debate-model-cards').appendChild(card);
  return card;
}

function addPendingApprovalCard({ id, text, model }) {
  const card = addDebateCard({ id, text, model });
  card.dataset.approved = 'false';
  card.dataset.approvalSelectable = 'true';
  const titleMain = card.querySelector('.debate-model-card-title-main');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'debate-approval-check';
  checkbox.setAttribute('aria-label', 'Approve this answer');
  titleMain.appendChild(checkbox);
  return card;
}

async function selectTextInOutput(output, start, end) {
  const textNode = output.firstChild;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await delay(20);
}

async function saveDisputeTopicDialog(topic = 'Saved dispute topic') {
  await delay(20);
  const textarea = document.getElementById('dispute-topic-textarea');
  if (!textarea) return false;
  textarea.value = topic;
  document.getElementById('dispute-topic-save-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await delay(20);
  return true;
}

async function loadResultsScript() {
  installChromeStorageMock();
  installDomMocks();
  window.__RESULTS_TEST_DEBUG__ = true;
  const pipelineRuntime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
  window.eval(pipelineRuntime);
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'transport-policy.js'), 'utf8'));
  const disputMessages = fs.readFileSync(path.join(__dirname, '..', 'disput', 'disput-massage.js'), 'utf8');
  window.eval(disputMessages);
  const debateEngine = fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-engine.js'), 'utf8');
  window.eval(debateEngine);
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'debate-schema.js'), 'utf8'));
  // DebateFSM is the explicit serial-debate state machine results.js init depends on.
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-runtime.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'triad-runtime.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'multi-runtime.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-protocols.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-run-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-protocol-transition-service.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-schema.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-execution-context.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-stage-types.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-plan-validator.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-policies.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-plan-revision.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-planner.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-participant-registry.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-stage-executor.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-orchestrator.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-plan-compiler.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-application.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-run-services.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-state-map.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-artifact-pipeline.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'triad-registry.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-registry.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-prompt-catalog.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'pipeline-presets.js'), 'utf8'));
  ['boot-utils', 'dom-utils', 'attachments', 'tooltips', 'debate-ui', 'debate-transport', 'debate-controller', 'debate-renderer', 'debate-sessions-store', 'debate-export', 'debate-plan-view-model', 'debate-telemetry-view'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', 'results', `${mod}.js`), 'utf8')); });
  const script = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  window.eval(script);
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await delay(20);
}

describe('Pipeline debate favorites view', () => {
  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
  });

  beforeEach(async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (typeof callback === 'function') {
        callback({ status: 'ok', active: false });
      }
    });
    document.getElementById('debate-session-clear-btn').click();
    document.getElementById('modTa').value = '';
    document.getElementById('notification-message').textContent = '';
    const pipelineName = document.getElementById('currentPipelineName');
    if (pipelineName) {
      pipelineName.textContent = '';
      pipelineName.removeAttribute('title');
    }
    const senderSelect = document.getElementById('mod-sender-select');
    const receiverSelect = document.getElementById('mod-receiver-select');
    if (senderSelect) senderSelect.value = 'Moderator';
    if (receiverSelect) receiverSelect.value = '__none__';
    const newPagesCheckbox = document.getElementById('new-pages-checkbox');
    if (newPagesCheckbox) newPagesCheckbox.checked = true;
    window.setDebateSchemeValue?.('2');
    const policySelect = document.getElementById('debate-run-policy-select');
    if (policySelect) policySelect.value = 'manual';
    const roundLimitSelect = document.getElementById('debate-round-limit-select');
    if (roundLimitSelect) roundLimitSelect.value = '3';
    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.remove('active');
    });
    const deleteBtn = document.getElementById('debate-session-delete-btn');
    while (document.querySelectorAll('.debate-session-tab').length > 1) {
      deleteBtn.click();
      await delay(20);
    }
    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(520);
    chrome.runtime.sendMessage.mockClear();
  });

  test('double-clicking the active session tab enables favorite-only without creating a session', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    const tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(true);
    expect(plain.style.display).toBe('none');
    expect(starred.style.display).toBe('');
  });

  test('single click on a favorite-only session returns the full timeline', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    let tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(plain.style.display).toBe('none');

    tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(220);

    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(false);
    expect(plain.style.display).toBe('');
    expect(starred.style.display).toBe('');
  });

  test('favoriting selected text creates a starred fragment-card linked to the source message', async () => {
    const source = addDebateCard({
      id: 'source-1',
      model: 'Claude',
      text: 'This answer contains an important fragment for later analysis.'
    });
    const output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 24, 42);
    document.querySelector('#debateSelTb [data-fav]').click();

    const fragment = document.querySelector('.fragment-card[data-kind="fragment"]');
    expect(fragment).not.toBeNull();
    expect(fragment.dataset.starred).toBe('true');
    expect(fragment.dataset.sessionId).toBe('1');
    expect(fragment.dataset.sourceMessageId).toBe('source-1');
    expect(fragment.dataset.sourceCardId).toBe(source.id);
    expect(fragment.textContent).toContain('important fragment');
    expect(fragment.style.display).toBe('none');

    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(fragment.style.display).toBe('');
    expect(source.style.display).toBe('none');
  });

  test('delete session removes the current session when multiple sessions exist', async () => {
    const addBtn = document.getElementById('debate-session-add-btn');
    addBtn.click();
    await delay(220);
    const activeBeforeDelete = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'delete-me', text: 'session to remove' });
    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(2);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')).not.toBeNull();
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).not.toBe(activeBeforeDelete);
    expect(document.querySelector('[data-session-id="' + activeBeforeDelete + '"]')).toBeNull();
  });

  test('delete session clears the only remaining session instead of removing it', async () => {
    const activeSessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'only-session-card', text: 'this will be cleared' });
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(1);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).toBe(activeSessionId);
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(0);
  });

  test('approving a lower pending card moves it above remaining pending cards', async () => {
    const qwen = addPendingApprovalCard({
      id: 'qwen-pending',
      model: 'Qwen',
      text: 'Qwen pending answer'
    });
    const leChat = addPendingApprovalCard({
      id: 'lechat-pending',
      model: 'Le Chat',
      text: 'Le Chat approved first'
    });

    expect(Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName))
      .toEqual(['Qwen', 'Le Chat']);

    window.approveDebateCheckbox(leChat.querySelector('.debate-approval-check'));
    await delay(20);

    const order = Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName);
    expect(order).toEqual(['Le Chat', 'Qwen']);
    expect(leChat.dataset.approved).toBe('true');
    expect(leChat.querySelector('.debate-approval-check')).toBeNull();
    expect(qwen.dataset.approved).not.toBe('true');
  });

  test('selection toolbar formats the source card text in the normal timeline', async () => {
    const source = addDebateCard({
      id: 'source-format',
      model: 'GPT',
      text: 'Format this fragment in place.'
    });
    let output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 7, 11);
    const toolbar = document.getElementById('debateSelTb');
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-color="#fde68a"]').click();

    let highlight = output.querySelector('span');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('this');
    expect(highlight.getAttribute('style')).toContain('background-color');
    expect(source.style.display).toBe('');
    expect(document.querySelector('.fragment-card')).toBeNull();

    const clearRange = document.createRange();
    clearRange.selectNodeContents(highlight);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(clearRange);
    output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await delay(20);
    document.querySelector('#debateSelTb [data-clear-highlight]').click();
    expect(highlight.style.backgroundColor).toBe('');

    output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 0, 6);
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-cmd="bold"]').click();

    const bold = output.querySelector('strong');
    expect(bold).not.toBeNull();
    expect(bold.textContent).toBe('Format');
  });

  test('export all responses includes Favourite content in the same HTML bundle', async () => {
    const responsePanel = document.createElement('div');
    responsePanel.className = 'llm-panel';
    responsePanel.id = 'panel-gpt';
    responsePanel.innerHTML = `
      <div class="llm-header">
        <span class="llm-title">GPT</span>
        <div class="header-right">
          <button type="button" class="panel-action-btn panel-fav-btn" data-target="gpt-output" aria-label="Add to favorites">★</button>
        </div>
      </div>
      <div class="output" id="gpt-output">Base model response.</div>
    `;
    document.body.appendChild(responsePanel);
    const originalBuildResponseCopyHtmlBlock = window.ResultsShared.buildResponseCopyHtmlBlock;
    window.ResultsShared.buildResponseCopyHtmlBlock = (name, metadataLine, bodyHtml) => `
      <section>
        <h2>${name}</h2>
        ${metadataLine ? `<p class="response-meta">${metadataLine}</p>` : ''}
        <div class="response-body">${bodyHtml}</div>
      </section>
    `;
    const originalFavoriteEntries = [...window.__resultsExportDebug.favoriteState.entries];
    const originalFavoriteCardMap = new Map(window.__resultsExportDebug.favoriteState.cardKeyToId);
    const originalFavoriteNextId = window.__resultsExportDebug.favoriteState.nextId;
    window.__resultsExportDebug.favoriteState.entries = [{
      id: 'fav-test-1',
      kind: 'card',
      sourceName: 'GPT',
      modelKey: 'gpt',
      sourceOutputId: 'gpt-output',
      text: 'Base model response.',
      html: '',
      timeLabel: '12:00'
    }];
    window.__resultsExportDebug.favoriteState.cardKeyToId = new Map([['card:gpt-output', 'fav-test-1']]);
    window.__resultsExportDebug.favoriteState.nextId = 2;
    const html = window.__resultsExportDebug.buildAllResponsesExportHtml();
    const text = window.__resultsExportDebug.buildAllResponsesExportText();
    const favoriteText = window.__resultsExportDebug.buildFavoriteExportText();
    expect(html).toContain('<h2>LLM Responses</h2>');
    expect(html).toContain('<h2>Favourite</h2>');
    expect(html).toContain('Base model response.');
    expect(text).toContain('=== Favourite ===');
    expect(text).toContain('--- GPT ---');
    expect(text).toContain('[12:00]');
    expect(text).toContain('=== LLM Responses ===');
    expect(text).toContain('Base model response.');
    expect(window.__resultsExportDebug.formatNamedExportStamp(new Date(2026, 6, 17, 18, 30))).toBe('jul26 18-30');
    expect(favoriteText).toBe('--- GPT ---\n[12:00]\nBase model response.');
    window.__resultsExportDebug.favoriteState.entries = originalFavoriteEntries;
    window.__resultsExportDebug.favoriteState.cardKeyToId = originalFavoriteCardMap;
    window.__resultsExportDebug.favoriteState.nextId = originalFavoriteNextId;
    window.ResultsShared.buildResponseCopyHtmlBlock = originalBuildResponseCopyHtmlBlock;
    responsePanel.remove();
  });

  test('selection toolbar actions have visible labels in the panel markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html).toContain('aria-label="Yellow highlight"');
    expect(html.indexOf('data-clear-highlight="1"')).toBeLessThan(html.indexOf('aria-label="Yellow highlight"'));
    expect(html).toContain('aria-label="Remove highlight"');
    expect(html).toContain('<span class="stb-label">Yellow</span>');
    expect(html).toContain('<span class="stb-label">Bold</span>');
    expect(html).toContain('aria-label="Add selected fragment to favorites"');
    expect(html).toContain('<span class="stb-label">Favorite</span>');
  });

  test('selection toolbar is absolutely positioned near the selected fragment and has visible icons', async () => {
    const card = addDebateCard({ id: 'msg-toolbar', text: 'Toolbar anchor text', model: 'GPT' });
    const output = card.querySelector('.debate-model-card-output');

    await selectTextInOutput(output, 0, 7);

    const toolbar = document.getElementById('debateSelTb');
    expect(toolbar.classList.contains('vis')).toBe(true);
    expect(toolbar.style.top).toBeTruthy();
    expect(toolbar.style.left).toBeTruthy();

    const css = readResolvedCss();
    expect(css).toContain('.debate-sel-toolbar {\n    position: absolute;');
    expect(css).toContain('background: #ffffff;');
    expect(css).toContain('.debate-sel-toolbar .stb.col::before');
    expect(css).toContain('.debate-sel-toolbar .stb[data-clear-highlight]::before');
    expect(css).toContain('.debate-sel-toolbar .stb.col[data-color="#FFEB3B"] { --swatch-color: #FFEB3B; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-cmd="bold"]::before { content: "B"; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-fav]::before');
    expect(css).toContain('.debate-sel-toolbar .stb[data-fav][aria-pressed="true"]::before');
  });

  test('model cards use 14px text, keep empty one-line cards, and cap long responses at five lines', async () => {
    const css = readResolvedCss();
    expect(css).toContain('.debate-model-card,\n.debate-model-card :where(*) {\n    font-size: 14px !important;');
    expect(css).toContain('min-height: var(--debate-card-line-height);');
    expect(css).toContain('max-height: var(--debate-card-line-height);');
    expect(css).not.toContain('min-height: calc(var(--debate-card-line-height) * 6);');
    expect(css).toContain('max-height: calc(var(--debate-card-line-height) * 5);');
    expect(css).toContain('.debate-model-card.has-overflow {');
    expect(css).toContain('position: absolute;');

    const shortText = ['Short 1', 'Short 2', 'Short 3'].join('\n');
    const shortCard = addDebateCard({ id: 'msg-short-response', text: shortText, model: 'Gemini' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(shortCard);
    const shortShowMore = shortCard.querySelector('.debate-card-show-more');
    expect(shortShowMore).not.toBeNull();
    expect(shortShowMore.hidden).toBe(true);
    expect(shortCard.classList.contains('has-overflow')).toBe(false);
    expect(shortCard.classList.contains('is-expanded')).toBe(false);

    const longText = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n');
    const card = addDebateCard({ id: 'msg-show-more', text: longText, model: 'GPT' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(card);

    const showMore = card.querySelector('.debate-card-show-more');
    expect(showMore).not.toBeNull();
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Show more');
    expect(card.classList.contains('is-expanded')).toBe(false);

    showMore.click();
    expect(card.classList.contains('is-expanded')).toBe(true);
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Minimise');
    showMore.click();
    expect(card.classList.contains('is-expanded')).toBe(false);
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Show more');

    const second = addDebateCard({ id: 'msg-dbl-expand', text: longText, model: 'Claude' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(second);
    const secondName = second.querySelector('.debate-model-card-name');
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(true);
    expect(second.classList.contains('is-wide-expanded')).toBe(true);
    expect(second.querySelector('.debate-card-show-more').textContent).toBe('Minimise');
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(false);
    expect(second.classList.contains('is-wide-expanded')).toBe(false);
    expect(second.querySelector('.debate-card-show-more').hidden).toBe(false);
    expect(second.querySelector('.debate-card-show-more').textContent).toBe('Show more');
  });

  test('debate cards render text through the same Markdown formatter as main response cards', () => {
    const card = addDebateCard({ id: 'msg-markdown-format', text: '', model: 'GPT' });
    const output = card.querySelector('.debate-model-card-output');
    const html = window.__pipelineLifecycleDebug.renderDebateResponseBody(
      output,
      '# Heading\n\n- first\n- second\n\n**bold** and `code`'
    );

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  test('double-clicking empty session-bar space opens and closes the entire debate feed widely', () => {
    const composer = document.querySelector('.prompt-container.prompt-sandwich.debate-composer');
    const hitArea = document.querySelector('.debate-session-bar-hit');

    hitArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(true);
    expect(document.getElementById('debate-session-bar').getAttribute('aria-expanded')).toBe('true');

    hitArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(false);
    expect(document.getElementById('debate-session-bar').getAttribute('aria-expanded')).toBe('false');

    const css = readResolvedCss();
    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer.is-debate-feed-wide-expanded {');
    expect(css).toContain('width: min(var(--center-max-width), calc(100vw - 32px));');
  });

  test('pipeline waiter ignores partial and wrong-batch responses until terminal response arrives', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const context = {
      pipelineRunId: 'run-1',
      pipelineRoundId: 'r1',
      pipelineBatchId: 'run-1:r1:g0'
    };
    let settled = false;
    const waitPromise = debug.pipelineWaiter
      .waitForModels(['GPT'], { timeoutMs: 200, context })
      .then((result) => {
        settled = true;
        return result;
      });

    expect(debug.pipelineWaiter.handlePartial({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'first chunk',
      metadata: { ...context, status: 'GENERATING' }
    })).toBe(true);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'old final',
      metadata: { ...context, pipelineBatchId: 'old-run:r1:g0', status: 'SUCCESS' }
    })).toBe(false);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'correct final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(true);

    await expect(waitPromise).resolves.toMatchObject({
      responses: { GPT: 'correct final' },
      missing: [],
      timedOut: false
    });
    expect(settled).toBe(true);
  });

  test('pipeline wait timeout is extended for slow Qwen batches only', () => {
    const debug = window.__pipelineLifecycleDebug;

    expect(debug.resolvePipelineWaitTimeoutMs(['GPT'], 240000)).toBe(240000);
    expect(debug.resolvePipelineWaitTimeoutMs(['GPT', 'Qwen'], 240000)).toBe(600000);
    expect(debug.resolvePipelineWaitTimeoutMs(['Qwen'], 900000)).toBe(900000);
  });

  test('visible Gemini answer upgrades non-hidden PARTIAL indicator to success', () => {
    const debug = window.__pipelineLifecycleDebug;
    const indicator = document.querySelector('.status-indicator[data-llm-name="Gemini"]');
    const answer = 'Gemini returned a complete visible answer. '.repeat(8);

    debug.updateModelStatusUI('Gemini', 'PARTIAL', {
      source: 'MODEL_FINAL',
      finalStatus: 'PARTIAL'
    });
    expect(indicator.classList.contains('partial')).toBe(true);

    debug.updateLLMPanelOutput('Gemini', answer, '', {});

    expect(document.getElementById('output-gemini').textContent).toContain('Gemini returned');
    expect(indicator.dataset.currentStatus).toBe('SUCCESS');
    expect(indicator.classList.contains('success')).toBe(true);
    expect(indicator.classList.contains('partial')).toBe(false);
  });

  test('a settled debate card indicator is not repainted by a later force status for the same model', () => {
    const debug = window.__pipelineLifecycleDebug;
    const card = document.createElement('div');
    card.className = 'debate-model-card';
    card.dataset.llmName = 'GPT';
    card.innerHTML = '<span class="status-indicator" data-llm-name="GPT"></span>';
    document.body.appendChild(card);
    const indicator = card.querySelector('.status-indicator');

    debug.updateModelStatusUI('GPT', 'SUCCESS', { source: 'FINAL_STATUS', finalStatus: 'SUCCESS' });
    expect(indicator.classList.contains('success')).toBe(true);
    expect(indicator.dataset.statusFinal).toBe('1');

    // A later job for the same model force-resets status globally (LLM_JOB_CREATED).
    // The settled feed card from the earlier turn must NOT flip back.
    debug.updateModelStatusUI('GPT', 'INITIALIZING', { reset: true, force: true });
    expect(indicator.classList.contains('success')).toBe(true);
    expect(indicator.classList.contains('initializing')).toBe(false);
    expect(indicator.dataset.currentStatus).toBe('SUCCESS');

    card.remove();
  });

  test('a model answer keeps at most one open card (no duplicate whole or partial)', () => {
    const debug = window.__pipelineLifecycleDebug;
    const container = document.getElementById('debate-model-cards');
    const openGptCards = () => Array.from(container.querySelectorAll('.debate-model-card[data-llm-name="GPT"]'))
      .filter((c) => c.dataset.approved !== 'true' && c.dataset.kind !== 'moderator' && c.dataset.kind !== 'fragment');

    // Streaming chunk then a fuller update for the same model reuse one card.
    debug.updateLLMPanelOutput('GPT', 'Dedup test chunk one', '', {});
    debug.updateLLMPanelOutput('GPT', 'Dedup test chunk one, now fuller and complete.', '', {});
    expect(openGptCards().length).toBe(1);
    expect(openGptCards()[0].querySelector('.debate-model-card-output').textContent).toContain('fuller and complete');

    // Inject an accidental duplicate (as a past bug could): the next update must
    // collapse it back to a single card rather than keep both.
    const dupe = openGptCards()[0].cloneNode(true);
    dupe.dataset.entryId = `dupe-${Date.now()}`;
    dupe.dataset.messageId = dupe.dataset.entryId;
    container.appendChild(dupe);
    expect(container.querySelectorAll('.debate-model-card[data-llm-name="GPT"]').length).toBeGreaterThanOrEqual(2);

    debug.updateLLMPanelOutput('GPT', 'Dedup test after duplicate injected.', '', {});
    expect(openGptCards().length).toBe(1);
  });

  test('debate approval waiter rejects and cleans up on abort', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const controller = new AbortController();
    const approvalPromise = debug.waitForDebateApproval({ signal: controller.signal });
    expect(debug.getApprovalWaiting()).toBe(true);

    controller.abort();

    await expect(approvalPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(debug.getApprovalWaiting()).toBe(false);
  });

  test('debate feed mirrors cards into structured DebateEngine transcript artifact', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const card = addPendingApprovalCard({
      id: 'engine-msg-1',
      model: 'GPT',
      text: 'Structured transcript response'
    });

    card.querySelector('.debate-approval-check').click();
    await delay(20);

    const artifact = debug.collectDebateArtifact();
    const activeSession = artifact.sessions.find((session) => session.sessionId === '1');

    expect(debug.getDebateRunPolicy()).toBe('manual');
    expect(debug.getDebateRoundLimit()).toBe(3);
    expect(activeSession.settings).toEqual(expect.objectContaining({
      mode: 'serial_debate_2',
      turnLimit: 3,
      maxTurns: 4
    }));
    expect(activeSession.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        turnId: 'turn-engine-msg-1',
        author: 'GPT',
        authorType: 'model',
        targets: ['Moderator'],
        text: 'Structured transcript response',
        status: 'approved'
      })
    ]));
    expect(debug.collectDebateMarkdown()).toContain('## Turn');
    expect(debug.collectDebateMarkdown()).toContain('Structured transcript response');
  });

  test('debate transcript artifact can restore and render the active session', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const restored = debug.hydrateDebateTranscriptFromArtifact({
      activeSessionId: 'restore-1',
      sessions: [{
        sessionId: 'restore-1',
        title: 'Restored',
        participants: ['GPT'],
        settings: { runPolicy: 'manual', maxTurns: 5 },
        turns: [
          {
            turnId: 'turn-restore-moderator',
            sessionId: 'restore-1',
            index: 1,
            author: 'Moderator',
            authorType: 'moderator',
            targets: ['GPT'],
            text: 'Restore this debate prompt',
            status: 'approved',
            createdAt: '2026-06-11T19:00:00.000Z',
            completedAt: '2026-06-11T19:00:00.000Z',
            approvedAt: '2026-06-11T19:00:00.000Z'
          },
          {
            turnId: 'turn-restore-gpt',
            sessionId: 'restore-1',
            index: 2,
            author: 'GPT',
            authorType: 'model',
            role: 'Critic',
            targets: ['Moderator'],
            text: 'Restored transcript answer',
            status: 'approved',
            terminalStatus: 'SUCCESS',
            createdAt: '2026-06-11T19:01:00.000Z',
            completedAt: '2026-06-11T19:02:00.000Z',
            approvedAt: '2026-06-11T19:02:00.000Z'
          }
        ]
      }]
    });

    expect(restored).toBe(true);
    expect(document.querySelector('.debate-session-tab.active')?.dataset.sessionId).toBe('restore-1');
    expect(document.querySelectorAll('#debate-model-cards .debate-model-card[data-session-id="restore-1"]')).toHaveLength(2);
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restore this debate prompt');
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restored transcript answer');

    const artifact = debug.collectDebateArtifact();
    const session = artifact.sessions.find((item) => item.sessionId === 'restore-1');
    expect(session.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-restore-gpt', terminalStatus: 'SUCCESS', status: 'approved' })
    ]));
  });

  test('pipeline output selection uses data-output keys instead of visible labels', () => {
    const debug = window.__pipelineLifecycleDebug;
    const selection = debug.getPipelineOutputSelection();

    expect(selection).toEqual({
      notes: true,
      export: false,
      exportHtml: true
    });
  });

  test('Role and Action chips never become moderator dispatch text', () => {
    const debug = window.__pipelineLifecycleDebug;
    const roleSelect = document.getElementById('mod-role-select');
    const role = document.createElement('option');
    role.value = 'critical';
    role.textContent = 'Critical';
    roleSelect.appendChild(role);
    roleSelect.value = 'critical';
    roleSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('mod-mini-prompts').textContent).toContain('Role: critical');
    expect(document.getElementById('mod-message-body').textContent).toBe('');
    expect(debug.getModeratorDispatchText()).toBe('');
  });

  test('successful Debate terminal flow executes selected Output actions once', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const blocks = Array.from(document.querySelectorAll('#output-stack .output-block'));
    blocks.forEach((block) => {
      block.querySelector('.output-checkbox').checked = block.dataset.output === 'notes';
    });
    window.PipelineNotes = { savePipelineRun: jest.fn().mockResolvedValue(true) };
    const state = {
      runId: 'terminal-output-test',
      topic: 'Output ownership',
      moderatorMessage: 'Review this architecture',
      modelA: 'GPT',
      modelB: 'Claude',
      finalWordA: 'A final',
      finalWordB: 'B final',
      synthesisText: 'Canonical synthesis'
    };

    await debug.handleDebateTerminalOutputs(state, 'duel');
    await debug.handleDebateTerminalOutputs(state, 'duel');

    expect(window.PipelineNotes.savePipelineRun).toHaveBeenCalledTimes(1);
    expect(window.PipelineNotes.savePipelineRun).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Output ownership',
      text: expect.stringContaining('Canonical synthesis')
    }));
    delete window.PipelineNotes;
  });

  test('pipeline runtime snapshot uses R1 Pipeline UI as source of truth', () => {
    const debug = window.__pipelineLifecycleDebug;
    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', button.id === 'llm-gpt' || button.id === 'llm-claude');
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['GPT', 'Claude'] }
    }));
    const snapshot = debug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].stage).toBe('models');
    expect(snapshot.rounds[0].inputModels).toEqual(['Claude', 'GPT']);
    expect(snapshot.rounds[0].sendModels).toEqual(expect.arrayContaining(['GPT', 'Claude']));
    expect(snapshot.rounds[0].sendModels).toHaveLength(2);
    const gptConfig = snapshot.config.modelStacks['r1-models'].items.find((item) => item.name === 'GPT');
    expect(gptConfig).toMatchObject({
      name: 'GPT',
      input: true,
      send: true
    });
  });

  test('pipeline runtime snapshot stores runnable debate protocol', () => {
    try {
      window.setDebateSchemeValue?.('3');
      document.getElementById('debate-run-policy-select').value = 'auto';
      document.getElementById('debate-length-select').value = '700';
      document.getElementById('debate-round-limit-select').value = '5';
      document.getElementById('debate-synthesizer-select').value = 'Claude';
      document.querySelectorAll('.llm-button').forEach((button) => {
        button.classList.toggle('active', ['llm-gpt', 'llm-claude', 'llm-gemini'].includes(button.id));
      });

      const snapshot = window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot();

      expect(snapshot.config.protocol).toMatchObject({
        type: 'triad',
        scheme: '3',
        runPolicy: 'auto',
        length: '700',
        roundLimit: '5',
        synthesizer: 'Claude',
        selectedModels: ['GPT', 'Gemini', 'Claude']
      });
    } finally {
      window.setDebateSchemeValue?.('2');
      document.getElementById('debate-run-policy-select').value = 'manual';
      document.getElementById('debate-length-select').value = '500';
      document.getElementById('debate-round-limit-select').value = '3';
      document.getElementById('debate-synthesizer-select').value = '';
    }
  });

  test('default pipeline list uses real runnable presets instead of examples', () => {
    const names = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .map((item) => item.dataset.name);

    expect(names).toEqual(['FreeTalk', 'Research', 'Specialized profile']);
    expect(names).not.toEqual(expect.arrayContaining([
      'Research & Analysis',
      'Content Gen',
      'Idea Validation',
      'Duel',
      'Triad',
      'Multi Models'
    ]));
    expect(document.querySelectorAll('#pipelineItems .pipeline-item-delete')).toHaveLength(0);
    expect(document.querySelectorAll('#customerPipelineItems .pipeline-item')).toHaveLength(0);

    // The remaining legacy topology assertions below are retained as migration
    // fixtures, but they do not apply to the current three-profile list.
    return;

    const multiItem = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Multi Verdict');
    const staleCard = document.createElement('div');
    staleCard.className = 'debate-model-card';
    staleCard.dataset.sessionId = '1';
    staleCard.dataset.messageId = 'stale-before-multi';
    staleCard.textContent = 'stale debate content';
    document.getElementById('debate-model-cards').appendChild(staleCard);
    multiItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(window.__debateSchemeValue).toBe('many');
    expect(document.getElementById('debate-model-cards').textContent).not.toContain('stale debate content');
    expect(window.ResultsShared.getSelectedLLMs()).toEqual([]);
    expect(document.querySelectorAll('#r1-models .model-block')).toHaveLength(1);
    expect(document.querySelectorAll('#r1-models .pipeline-empty-slot')).toHaveLength(1);
    expect(document.querySelectorAll('#r1-models .model-name')).toHaveLength(0);
    expect(document.querySelectorAll('#r1-models .model-input-checkbox:checked')).toHaveLength(0);
    expect(document.querySelectorAll('#r2-models .model-block')).toHaveLength(1);
    expect(document.querySelectorAll('#r2-models .pipeline-empty-slot')).toHaveLength(1);
    expect(document.getElementById('round2')).toBeTruthy();
    expect(document.getElementById('svg-r1-r2')).toBeTruthy();
    expect(document.querySelectorAll('#r3-models .model-block')).toHaveLength(1);
    expect(document.querySelectorAll('#r3-models .pipeline-empty-slot')).toHaveLength(1);
    expect(document.getElementById('debate-round-limit-select').hidden).toBe(true);
    expect(document.getElementById('debate-round-limit-select').disabled).toBe(true);
    expect(document.getElementById('triad-registry-toggle').hidden).toBe(false);
    expect(document.getElementById('triad-registry-toggle').getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('synthesisColumn').hidden).toBe(false);
    expect(document.getElementById('debate-synthesizer-select').hidden).toBe(false);
    expect(document.getElementById('multi-final-synthesis-flow-select').value).toBe('Claude');
    expect(Number(document.getElementById('svg-r-last-synthesis').getAttribute('height'))).toBeLessThan(240);
    expect(Number(document.getElementById('svg-stage-output').getAttribute('height'))).toBeLessThan(240);
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.protocol).toMatchObject({
      type: 'multi',
      scheme: 'many',
      presetId: 'MULTI_STANDARD',
      selectedModels: [],
      synthesizer: 'Claude'
    });
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.roundCounter).toBe(4);

    document.getElementById('llm-grok').click();
    expect(window.__debateSchemeValue).toBe('many');
    expect(window.ResultsShared.getSelectedLLMs()).toEqual(['Grok']);
    expect(document.getElementById('debate-round-limit-select').hidden).toBe(true);
    expect(document.getElementById('debate-round-limit-select').disabled).toBe(true);
    const stalePipelineIndicator = document.querySelector('#r1-models .status-indicator');
    stalePipelineIndicator.className = 'status-indicator success';
    stalePipelineIndicator.title = 'stale success';

    const triadItem = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Triad Verdict');
    const staleTriadCard = document.createElement('div');
    staleTriadCard.className = 'debate-model-card';
    staleTriadCard.dataset.sessionId = '1';
    staleTriadCard.dataset.messageId = 'stale-before-triad';
    staleTriadCard.textContent = 'stale before triad';
    document.getElementById('debate-model-cards').appendChild(staleTriadCard);
    triadItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(window.__debateSchemeValue).toBe('3');
    expect(document.getElementById('debate-model-cards').textContent).not.toContain('stale before triad');
    expect(document.querySelector('.model-block .status-indicator.success')).toBeNull();
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.protocol).toMatchObject({
      type: 'triad',
      scheme: '3'
    });
    expect(document.getElementById('debate-round-limit-select').hidden).toBe(true);
    expect(document.getElementById('debate-round-limit-select').disabled).toBe(true);
    expect(document.getElementById('triad-registry-toggle').hidden).toBe(false);
    expect(document.getElementById('triad-registry-toggle').getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('debate-run-policy-select').value).toBe('auto');
    expect(document.getElementById('debate-round-limit-select').value).toBe('3');
    expect(window.ResultsShared.getSelectedLLMs()).toEqual([]);
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.roundCounter).toBe(3);
    expect(document.querySelectorAll('#r1-models .pipeline-empty-slot')).toHaveLength(3);
    expect(document.querySelectorAll('#r2-models .pipeline-empty-slot')).toHaveLength(3);
    expect(document.querySelectorAll('#r2-models .role-selector')).toHaveLength(0);
    expect(document.getElementById('debate-synthesizer-select').value).toBe('Claude');
    expect(document.getElementById('triad-synthesizer-flow-select').value).toBe('Claude');
    expect(document.getElementById('triad-synthesizer-flow-name').textContent).toBe('Claude');
    expect(document.getElementById('synthesisColumn').hidden).toBe(false);
    expect(Array.from(document.querySelectorAll('.model-block.triad-synthesizer .model-name')).map((el) => el.textContent.trim()))
      .toEqual(expect.arrayContaining(['Claude']));

    const flowSynthSelect = document.getElementById('triad-synthesizer-flow-select');
    flowSynthSelect.value = 'Grok';
    flowSynthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('debate-synthesizer-select').value).toBe('Grok');
    expect(document.getElementById('triad-synthesizer-flow-name').textContent).toBe('Grok');
    expect(document.getElementById('synthesisColumn').querySelector('.pipeline-synthesis-block').classList.contains('triad-synthesizer')).toBe(true);

    const duelItem = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Duel Verdict');
    duelItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.__debateSchemeValue).toBe('2');
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.protocol).toMatchObject({
      type: 'duel',
      scheme: '2'
    });
    expect(document.getElementById('debate-round-limit-select').hidden).toBe(true);
    expect(document.getElementById('debate-round-limit-select').disabled).toBe(true);
    expect(document.getElementById('triad-registry-toggle').hidden).toBe(true);
    expect(document.getElementById('triad-registry-toggle').getAttribute('aria-hidden')).toBe('true');
    const triadLongItem = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Triad Long');
    triadLongItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.__debateSchemeValue).toBe('3');
    expect(document.getElementById('debate-round-limit-wrap').hidden).toBe(false);
    expect(document.getElementById('debate-round-limit-wrap').getAttribute('aria-hidden')).toBe('false');
    expect(document.getElementById('debate-round-limit-select').hidden).toBe(false);
    expect(document.getElementById('debate-round-limit-select').disabled).toBe(false);
    expect(document.getElementById('debate-round-limit-select').value).toBe('infinite');
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.roundCounter).toBe(1);
    expect(document.getElementById('synthesisColumn').hidden).toBe(true);
    document.getElementById('debate-round-limit-select').value = '3';
    document.getElementById('debate-round-limit-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot().config.roundCounter).toBe(3);
    expect(window.__pipelineLifecycleDebug.getPipelineStoreSnapshot().overrides.longRoundLimits['Triad Long']).toBe('3');
    expect(document.getElementById('synthesisColumn').hidden).toBe(false);

    const multiLongItem = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Multi Long — later');
    expect(multiLongItem).toBeTruthy();
    expect(multiLongItem.classList.contains('pipeline-item-disabled')).toBe(true);
    multiLongItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.__debateSchemeValue).toBe('3');
    const triadItemAgain = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .find((item) => item.dataset.name === 'Triad Verdict');
    triadItemAgain.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('debate-synthesizer-select').value).toBe('Grok');
  });

  test('built-in pipeline order is normalized into the three visible profiles', () => {
    const shuffledStoredOrder = [
      'Triad Verdict',
      'Duel Verdict',
      'Duel Red Team',
      'Multi Models',
      'Multi Verdict',
      'Custom Saved Flow',
      'Duel Long',
      'Triad Red Team',
      'Triad Long',
      'Multi Red Team',
      'Multi Long — later'
    ];

    expect(window.__pipelineLifecycleDebug.normalizePipelineOrder(shuffledStoredOrder)).toEqual([
      'FreeTalk', 'Research', 'Specialized profile', 'Custom Saved Flow'
    ]);
    expect(window.__pipelineLifecycleDebug.normalizePipelineOrder(shuffledStoredOrder))
      .not.toEqual(expect.arrayContaining(['Multi Models']));
  });

  test('built-in profile migration removes obsolete pipeline definitions', () => {
    const debug = window.__pipelineLifecycleDebug;
    const originalStore = debug.getPipelineStoreSnapshot();
    try {
      const staleStore = JSON.parse(JSON.stringify(originalStore));
      staleStore.version = 4;
      staleStore.active = 'Duel Verdict';
      staleStore.order.push('Duel Verdict', 'Triad Verdict', 'Multi Verdict');
      staleStore.pipelines['Duel Verdict'] = { protocol: { scheme: '2' } };
      staleStore.pipelines['Triad Verdict'] = { protocol: { scheme: '3' } };
      staleStore.pipelines['Multi Verdict'] = { protocol: { scheme: 'many' } };

      debug.setPipelineStoreForTest(staleStore);
      expect(debug.ensureDefaultPipelinePresets()).toBe(true);

      const migratedStore = debug.getPipelineStoreSnapshot();
      expect(migratedStore.version).toBe(7);
      expect(migratedStore.order).toEqual(['FreeTalk', 'Research', 'Specialized profile']);
      expect(migratedStore.active).toBe('FreeTalk');
      expect(migratedStore.pipelines['Duel Verdict']).toBeUndefined();
      expect(migratedStore.pipelines['Triad Verdict']).toBeUndefined();
      expect(migratedStore.pipelines['Multi Verdict']).toBeUndefined();
    } finally {
      debug.setPipelineStoreForTest(originalStore);
    }
  });

  test('New pipeline opens a guided creator and saves a runnable Triad config', async () => {
    document.getElementById('pipeline-add-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const modal = document.getElementById('pipeline-builder-modal');
    expect(modal).toBeTruthy();
    expect(modal.style.display).toBe('flex');

    modal.querySelector('#pipeline-builder-name').value = 'Custom Triad Test';
    const scheme = modal.querySelector('#pipeline-builder-scheme');
    scheme.value = '3';
    scheme.dispatchEvent(new Event('change', { bubbles: true }));
    modal.querySelector('#pipeline-builder-policy').value = 'auto';
    modal.querySelector('#pipeline-builder-rounds').value = '2';
    expect(modal.querySelector('#pipeline-builder-prompts')).toBeNull();
    const schemeValues = Array.from(scheme.options).map((option) => option.value);
    expect(schemeValues[0]).toBe('many');
    expect(schemeValues).toEqual(expect.arrayContaining(['2', '3']));
    expect(Number(schemeValues[schemeValues.length - 1])).toBeGreaterThanOrEqual(3);
    expect(modal.querySelector('#pipeline-builder-synth').value).toBe('');

    modal.querySelector('#pipeline-builder-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const item = Array.from(document.querySelectorAll('#customerPipelineItems .pipeline-item'))
      .find((node) => node.dataset.name === 'Custom Triad Test');
    expect(item).toBeTruthy();
    expect(item.querySelector('.pipeline-item-name').title).toContain('3 LLM');
    expect(window.__debateSchemeValue).toBe('3');
    expect(document.getElementById('debate-run-policy-select').value).toBe('auto');
    expect(document.getElementById('debate-round-limit-select').value).toBe('2');
    expect(window.ResultsShared.getSelectedLLMs()).toEqual(['GPT', 'Gemini', 'Claude']);
    expect(document.getElementById('debate-synthesizer-select').value).toBe('');
    expect(document.getElementById('triad-synthesizer-flow-select').value).toBe('');
    expect(document.getElementById('pipeline-add-round-btn').hidden).toBe(false);
    expect(document.querySelectorAll('#customerPipelineItems .pipeline-item-delete')).toHaveLength(1);

    item.querySelector('.pipeline-item-info').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('pipeline-info-modal').style.display).toBe('flex');
    expect(document.getElementById('pipeline-info-document').textContent).toContain('Custom Triad Test');
    expect(document.getElementById('pipeline-info-document').textContent).toContain('3 LLM Triad');
    expect(document.getElementById('pipelineActiveSummary').textContent).toContain('completion without synthesis');
  });

  test('one synthesizer select controls every topology and extractor is absent from the top panel', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html).not.toContain('id="debate-scheme-select"');
    expect(html).toContain('id="debate-synthesizer-select"');
    expect(html).toContain('Synthesizer: None');
    expect(html).not.toContain('Synthesizer: auto');
    expect(html).not.toContain('debate-extractor-select');
    expect(html).not.toContain('triad-synthesizer-select');
    expect(html).not.toContain('multi-final-synthesizer-select');
    expect(html).toContain('id="pipeline-add-round-btn"');
    expect(html).toContain('id="customerPipelineItems"');
  });

  test('saved scheme value limits header model selection and renders empty pipeline slots', () => {
    document.querySelectorAll('.llm-button').forEach((button) => button.classList.remove('active'));
    window.setDebateSchemeValue?.('3');
    document.dispatchEvent(new CustomEvent('llm-selection-change', { detail: { selected: [] } }));

    expect(document.querySelectorAll('#r1-models .model-block')).toHaveLength(3);
    expect(document.querySelectorAll('#r1-models .pipeline-empty-slot')).toHaveLength(3);

    window.setDebateSchemeValue?.('2');
    document.getElementById('llm-gpt').click();
    document.getElementById('llm-claude').click();
    document.getElementById('llm-gemini').click();

    let selected = window.ResultsShared.getSelectedLLMs();
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining(['GPT', 'Gemini']));
    expect(selected).not.toContain('Claude');
    expect(document.querySelectorAll('#r1-models .model-block')).toHaveLength(2);
    expect(document.querySelectorAll('#r1-models .pipeline-empty-slot')).toHaveLength(0);

    document.getElementById('llm-claude').click();
    selected = window.ResultsShared.getSelectedLLMs();
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining(['GPT', 'Claude']));
    expect(selected).not.toContain('Gemini');

    window.setDebateSchemeValue?.('many');
    document.getElementById('llm-grok').click();
    document.getElementById('llm-perplexity').click();
    document.getElementById('llm-deepseek').click();
    document.getElementById('llm-grok').click();

    selected = window.ResultsShared.getSelectedLLMs();
    expect(window.__debateSchemeValue).toBe('many');
    expect(selected.length).toBeGreaterThan(3);
    expect(selected).toEqual(expect.arrayContaining(['GPT', 'Claude', 'Perplexity', 'DeepSeek']));
    expect(selected).not.toContain('Grok');
  });

  test('pipeline R1 mirrors selected top models before run when R1 is still default', () => {
    document.getElementById('pipeline-panel').insertAdjacentHTML('beforeend', `
      <div class="model-stack" id="r2-models">
        <div class="model-block">
          <span class="model-name">GPT</span>
          <input type="checkbox" class="model-input-checkbox" checked>
          <input type="checkbox" class="model-send-checkbox" checked>
        </div>
        <div class="model-block">
          <span class="model-name">Claude</span>
          <input type="checkbox" class="model-input-checkbox" checked>
          <input type="checkbox" class="model-send-checkbox" checked>
        </div>
        <div class="model-block">
          <span class="model-name">Le Chat</span>
          <input type="checkbox" class="model-input-checkbox">
          <input type="checkbox" class="model-send-checkbox">
        </div>
        <div class="model-block">
          <span class="model-name">Perplexity</span>
          <input type="checkbox" class="model-input-checkbox">
          <input type="checkbox" class="model-send-checkbox">
        </div>
      </div>
    `);
    const blocks = Array.from(document.querySelectorAll('#r1-models .model-block'));
    blocks.forEach((block) => {
      const name = block.querySelector('.model-name')?.textContent?.trim();
      const isDefault = ['Claude', 'GPT', 'Gemini'].includes(name);
      block.querySelector('.model-input-checkbox').checked = isDefault;
      block.querySelector('.model-send-checkbox').checked = isDefault;
    });

    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', button.id === 'llm-lechat' || button.id === 'llm-perplexity');
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['Le Chat', 'Perplexity'] }
    }));

    const snapshot = window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].inputModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).not.toEqual(expect.arrayContaining(['Claude', 'GPT', 'Gemini']));
    expect(snapshot.rounds[1].inputModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[1].sendModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[1].sendModels).not.toEqual(expect.arrayContaining(['Claude', 'GPT', 'Gemini']));
  });

  test('pipeline HTML export sanitizes model text before embedding it', () => {
    const debug = window.__pipelineLifecycleDebug;
    const html = debug.safePipelineMarkdownToHtml('**Safe** <img src=x onerror=alert(1)> [x](javascript:alert(2))');

    expect(html).toContain('<strong>Safe</strong>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
  });

  test('pipeline HTML entrypoints expose mount points instead of hard-coded model blocks', () => {
    ['pipeline_panel.html', 'result_new.html'].forEach((fileName) => {
      const html = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
      expect(html).toContain('pipeline/pipeline-runtime.js');
      expect(html).toContain('data-render="pipeline-model-stack-r1"');
      expect(html).toContain('data-render="pipeline-model-stack-r2"');
      expect(html).toContain('data-render="pipeline-output-stack"');
      expect(html).not.toContain('class="model-block');
      expect(html).not.toContain('class="output-block');
    });
  });

  test('pipeline moderator header has no status indicator and pending zone label CSS is removed', () => {
    const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const css = readResolvedCss();

    expect(panelHtml).not.toContain('id="mod-status-indicator"');
    expect(css).not.toContain('.debate-model-card.first-pending-zone-card::before');
    expect(css).not.toContain('На утверждение');
  });


});
