(function initSelectorResolverV2() {
  if (window.LLMExtension?.SelectorResolverV2) return;

  const VERSION = '2.0.0';
  const CACHE_KEY_PREFIX = 'selector_resolver_v2::';
  const SELECTOR_HEALTH_PROFILE_KEY = 'selector_health_profile_v1';
  const MIN_EXTRACTED_ANSWER_LENGTH_FOR_NO_FALLBACK = 80;
  const MAX_COMPOSER_CANDIDATES = 120;
  const MAX_BUTTON_CANDIDATES = 180;
  const MAX_ANSWER_CANDIDATES = 120;
  const DEFAULT_TIMEOUT_MS = 1500;

  const SELECTOR_RESOLVER_V2_DEFAULTS = {
    enabled: true,
    useCache: true,
    useSpatialHeuristics: true,
    useVisualResolver: false,
    maxCandidatesLogged: 5,
    minComposerScore: 55,
    minSendButtonScore: 50,
    minAnswerScore: 50
  };

  const MODEL_SCORE_OVERRIDES = {
    Perplexity: {
      minComposerScore: 45,
      minSendButtonScore: 45,
      minAnswerScore: 45
    },
    Grok: {
      minComposerScore: 50
    },
    Gemini: {
      minComposerScore: 50
    },
    'Le Chat': {
      minComposerScore: 50
    }
  };

  const COMPOSER_SELECTORS = [
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]',
    'div[contenteditable]',
    'p[contenteditable]',
    'input[type="text"]',
    'input[type="search"]',
    '[aria-multiline="true"]'
  ];

  const BUTTON_SELECTORS = [
    'button',
    '[role="button"]',
    'button[type="submit"]',
    '[aria-label]',
    '[title]',
    '[data-testid]',
    'svg'
  ];

  const ANSWER_SELECTORS = [
    '[data-testid*="conversation"]',
    '[data-testid*="message"]',
    '[data-message-author-role="assistant"]',
    'article',
    'main article',
    '[class*="response"]',
    '[class*="assistant"]',
    '.prose',
    '.markdown',
    '[role="article"]'
  ];

  const PROMPT_HINT_RE = /prompt|chat|message|ask|write|type|escrib|envoy|напиш|сообщ|введ|send a message/i;
  const SEND_HINT_RE = /send|submit|arrow|up|send message|enviar|envoyer|отправ/i;
  const BAD_BUTTON_RE = /attach|upload|file|mic|audio|voice|image|settings|menu|copy|regenerate|stop/i;
  const SEARCH_HINT_RE = /search|find|buscar|recherche|поиск/i;
  const SIDEBAR_TAG_RE = /^(ASIDE|NAV|HEADER|FOOTER)$/;

  let cachedSettings = null;
  let settingsPromise = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function shortHash(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function timeoutResult(stage, diagnostics = {}) {
    return {
      ok: false,
      element: null,
      method: 'none',
      selector: null,
      score: 0,
      confidence: 0,
      fingerprint: null,
      diagnostics: Object.assign({
        failureReason: stage || 'resolver_timeout'
      }, diagnostics || {})
    };
  }

  async function readStorage(key) {
    try {
      if (chrome?.storage?.local?.get) {
        const result = await chrome.storage.local.get({ [key]: null });
        return result?.[key] ?? null;
      }
    } catch (_) {}
    try {
      const raw = window.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function writeStorage(key, value) {
    try {
      if (chrome?.storage?.local?.set) {
        await chrome.storage.local.set({ [key]: value });
        return true;
      }
    } catch (_) {}
    try {
      window.localStorage?.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  async function getSettings() {
    if (cachedSettings) return cachedSettings;
    if (!settingsPromise) {
      settingsPromise = readStorage('selectorResolverV2Settings')
        .then((stored) => Object.assign({}, SELECTOR_RESOLVER_V2_DEFAULTS, stored || {}))
        .catch(() => Object.assign({}, SELECTOR_RESOLVER_V2_DEFAULTS))
        .then((settings) => {
          cachedSettings = settings;
          return settings;
        });
    }
    return settingsPromise;
  }

  function getThreshold(modelName, key, fallbackValue) {
    return MODEL_SCORE_OVERRIDES?.[modelName]?.[key] ?? fallbackValue;
  }

  function sanitizeOptionsForDiagnostics(opts = {}) {
    return {
      modelName: typeof opts.modelName === 'string' ? opts.modelName : null,
      role: typeof opts.role === 'string' ? opts.role : null,
      reason: typeof opts.reason === 'string' ? opts.reason : null,
      traceId: typeof opts.traceId === 'string' ? opts.traceId : null,
      selectors: Array.isArray(opts.selectors) ? opts.selectors.slice(0, 10) : []
    };
  }

  function getComputedSignal(el) {
    try {
      return window.getComputedStyle(el);
    } catch (_) {
      return null;
    }
  }

  function getElementRect(el) {
    try {
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return null;
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    } catch (_) {
      return null;
    }
  }

  function isLikelyOffscreen(rect) {
    if (!rect) return true;
    const vw = Math.max(1, window.innerWidth || document.documentElement?.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
    if (rect.width <= 1 || rect.height <= 1) return true;
    if (rect.bottom < 0 || rect.right < 0) return true;
    if (rect.top > vh || rect.left > vw) return true;
    return false;
  }

  function hasHiddenAncestor(el) {
    let node = el?.parentElement || null;
    let depth = 0;
    while (node && depth < 12) {
      const style = getComputedSignal(node);
      if (node.getAttribute?.('aria-hidden') === 'true') return true;
      if (style) {
        if (style.display === 'none') return true;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
        if (Number(style.opacity || '1') <= 0.05) return true;
      }
      node = node.parentElement;
      depth += 1;
    }
    return false;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = getElementRect(el);
    const style = getComputedSignal(el);
    if (!rect || !style) return false;
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity || '1') <= 0.05) return false;
    if (isLikelyOffscreen(rect)) return false;
    if (hasHiddenAncestor(el)) return false;
    return true;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    const ariaDisabled = String(el.getAttribute?.('aria-disabled') || '').toLowerCase();
    if (ariaDisabled === 'true') return true;
    return false;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const contentEditable = String(el.getAttribute?.('contenteditable') || '').toLowerCase();
    if (contentEditable === 'true' || contentEditable === 'plaintext-only') return true;
    const tagName = String(el.tagName || '').toUpperCase();
    if (tagName === 'TEXTAREA') return !el.readOnly;
    if (tagName === 'INPUT') {
      const type = String(el.getAttribute?.('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url'].includes(type) && !el.readOnly;
    }
    if (String(el.getAttribute?.('role') || '').toLowerCase() === 'textbox') return !el.readOnly;
    return false;
  }

  function isInteractable(el) {
    if (!isVisible(el)) return false;
    if (isDisabled(el)) return false;
    const style = getComputedSignal(el);
    if (style?.pointerEvents === 'none' && !el.isContentEditable) return false;
    if (el.readOnly) return false;
    return !!el.isConnected;
  }

  function getAccessibleText(el) {
    if (!el) return '';
    const bits = [
      el.getAttribute?.('aria-label') || '',
      el.getAttribute?.('title') || '',
      el.getAttribute?.('placeholder') || '',
      el.getAttribute?.('data-testid') || '',
      el.innerText || '',
      el.textContent || ''
    ];
    return normalizeText(bits.filter(Boolean).join(' ')).slice(0, 500);
  }

  function buildCandidateSnapshot(el) {
    let rect = null;
    let style = null;
    try {
      const r = el.getBoundingClientRect();
      rect = {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height
      };
    } catch (_) {}

    try {
      const cs = getComputedStyle(el);
      style = {
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        overflowY: cs.overflowY,
        position: cs.position,
        zIndex: cs.zIndex
      };
    } catch (_) {}

    return {
      el,
      rect,
      style,
      tagName: el.tagName,
      role: el.getAttribute?.('role') || '',
      type: el.getAttribute?.('type') || '',
      ariaLabel: el.getAttribute?.('aria-label') || '',
      title: el.getAttribute?.('title') || '',
      placeholder: el.getAttribute?.('placeholder') || '',
      dataTestId: el.getAttribute?.('data-testid') || '',
      text: getAccessibleText(el)
    };
  }

  function buildRectBucket(rect) {
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const xPct = centerX / vw;
    const yPct = centerY / vh;
    const xBucket = Math.max(0, Math.min(4, Math.floor(xPct * 5)));
    const yBucket = Math.max(0, Math.min(4, Math.floor(yPct * 5)));
    const horizontal = xPct < 0.33 ? 'left' : xPct > 0.66 ? 'right' : 'center';
    const vertical = yPct < 0.33 ? 'top' : yPct > 0.66 ? 'bottom' : 'middle';
    return { xBucket, yBucket, region: `${vertical}-${horizontal}` };
  }

  function stableClassTokens(el) {
    const raw = String(el?.className || '').split(/\s+/).filter(Boolean);
    const filtered = raw.filter((token) => {
      if (token.length > 32) return false;
      if (/\d{4,}/.test(token)) return false;
      if (/[A-Fa-f0-9]{8,}/.test(token)) return false;
      if (token.includes(':')) return false;
      return /^[a-z0-9_-]+$/i.test(token);
    });
    return filtered.slice(0, 8);
  }

  function buildElementFingerprint(el) {
    if (!el) return null;
    const rect = getElementRect(el);
    const parent = el.parentElement || null;
    const nearbyText = normalizeText([
      parent?.getAttribute?.('aria-label') || '',
      parent?.textContent || ''
    ].join(' ')).slice(0, 120);
    return {
      tagName: String(el.tagName || '').toLowerCase(),
      role: String(el.getAttribute?.('role') || '').toLowerCase(),
      type: String(el.getAttribute?.('type') || '').toLowerCase(),
      ariaLabel: normalizeText(el.getAttribute?.('aria-label') || '').slice(0, 120),
      title: normalizeText(el.getAttribute?.('title') || '').slice(0, 120),
      placeholder: normalizeText(el.getAttribute?.('placeholder') || '').slice(0, 120),
      dataTestId: normalizeText(el.getAttribute?.('data-testid') || '').slice(0, 120),
      classTokens: stableClassTokens(el),
      textHash: shortHash(normalizeText(getAccessibleText(el)).slice(0, 200)),
      rectBucket: rect ? buildRectBucket(rect) : null,
      parentTag: String(parent?.tagName || '').toLowerCase(),
      parentRole: String(parent?.getAttribute?.('role') || '').toLowerCase(),
      parentClassTokens: stableClassTokens(parent),
      siblingButtonCount: parent ? parent.querySelectorAll?.('button,[role="button"]').length || 0 : 0,
      nearbyTextHash: shortHash(nearbyText)
    };
  }

  function rectBucketSimilar(a, b) {
    if (!a || !b) return false;
    return (
      Math.abs((a.xBucket || 0) - (b.xBucket || 0)) <= 1 &&
      Math.abs((a.yBucket || 0) - (b.yBucket || 0)) <= 1 &&
      a.region === b.region
    );
  }

  function calculateFingerprintSimilarity(a, b) {
    if (!a || !b) return 0;
    const fields = [
      { key: 'tagName', weight: 2 },
      { key: 'role', weight: 1 },
      { key: 'type', weight: 1 },
      { key: 'ariaLabel', weight: 2 },
      { key: 'title', weight: 1 },
      { key: 'placeholder', weight: 2 },
      { key: 'dataTestId', weight: 2 },
      { key: 'parentTag', weight: 1 },
      { key: 'parentRole', weight: 1 },
      { key: 'textHash', weight: 1 },
      { key: 'nearbyTextHash', weight: 1 },
      { key: 'siblingButtonCount', weight: 1 }
    ];
    let matched = 0;
    let total = 0;
    for (const { key, weight } of fields) {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) continue;
      total += weight;
      if (String(av || '') === String(bv || '')) {
        matched += weight;
      }
    }
    total += 1;
    if (Array.isArray(a.classTokens) && Array.isArray(b.classTokens)) {
      const setA = new Set(a.classTokens);
      const setB = new Set(b.classTokens);
      const intersection = [...setA].filter((x) => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size || 1;
      if (intersection / union >= 0.5) matched += 1;
    }
    total += 1;
    if (Array.isArray(a.parentClassTokens) && Array.isArray(b.parentClassTokens)) {
      const setA = new Set(a.parentClassTokens);
      const setB = new Set(b.parentClassTokens);
      const intersection = [...setA].filter((x) => setB.has(x)).length;
      const union = new Set([...setA, ...setB]).size || 1;
      if (intersection / union >= 0.5) matched += 1;
    }
    total += 1;
    if (rectBucketSimilar(a.rectBucket, b.rectBucket)) {
      matched += 1;
    }
    return total ? matched / total : 0;
  }

  function detectUiRevision(modelName) {
    try {
      const cfg = window.SelectorConfig || window.LLMExtension?.SelectorConfig;
      if (cfg && typeof cfg.detectUIVersion === 'function') {
        return cfg.detectUIVersion(modelName, document) || 'unknown';
      }
    } catch (_) {}
    return 'unknown';
  }

  function isUniqueSelector(selector, root = document, limit = 1) {
    if (!selector || selector.length > 300) return false;
    try {
      const matches = root.querySelectorAll(selector);
      return matches.length > 0 && matches.length <= limit;
    } catch (_) {
      return false;
    }
  }

  function cssEscape(value) {
    const source = String(value || '');
    if (window.CSS?.escape) return window.CSS.escape(source);
    return source.replace(/["\\]/g, '\\$&');
  }

  function buildStableSelector(el) {
    const diagnostics = { candidateCount: 0, rejectedReasons: [] };
    if (!el) {
      return { selector: null, unique: false, strategy: 'none', diagnostics: { candidateCount: 0, rejectedReasons: ['element_missing'] } };
    }
    const candidates = [];
    const tag = String(el.tagName || '').toLowerCase();
    const id = el.getAttribute?.('id');
    if (id && !/^\d/.test(id)) {
      candidates.push({ selector: `#${cssEscape(id)}`, strategy: 'id' });
    }
    ['data-testid', 'data-test', 'data-cy'].forEach((attr) => {
      const value = el.getAttribute?.(attr);
      if (value) {
        candidates.push({ selector: `${tag}[${attr}="${cssEscape(value)}"]`, strategy: attr });
      }
    });
    const ariaLabel = normalizeText(el.getAttribute?.('aria-label') || '');
    const role = normalizeText(el.getAttribute?.('role') || '');
    const placeholder = normalizeText(el.getAttribute?.('placeholder') || '');
    if (ariaLabel) {
      candidates.push({ selector: `${tag}${role ? `[role="${cssEscape(role)}"]` : ''}[aria-label="${cssEscape(ariaLabel)}"]`, strategy: 'aria-label' });
    }
    if (placeholder) {
      candidates.push({ selector: `${tag}[placeholder="${cssEscape(placeholder)}"]`, strategy: 'placeholder' });
    }
    if (role && el.parentElement) {
      const parentTag = String(el.parentElement.tagName || '').toLowerCase();
      candidates.push({ selector: `${parentTag} ${tag}[role="${cssEscape(role)}"]`, strategy: 'role-parent' });
    }
    let node = el;
    const path = [];
    for (let depth = 0; depth < 5 && node && node.nodeType === 1; depth += 1) {
      const parent = node.parentElement;
      const currentTag = String(node.tagName || '').toLowerCase();
      if (!parent) {
        path.unshift(currentTag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = siblings.indexOf(node) + 1;
      path.unshift(`${currentTag}:nth-of-type(${Math.max(1, index)})`);
      node = parent;
    }
    if (path.length) {
      candidates.push({ selector: path.join(' > '), strategy: 'nth-of-type' });
    }
    diagnostics.candidateCount = candidates.length;
    for (const candidate of candidates.slice(0, 12)) {
      if (!candidate.selector || candidate.selector.length > 300) {
        diagnostics.rejectedReasons.push('selector_too_long');
        continue;
      }
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(candidate.selector));
      } catch (_) {
        matches = [];
      }
      if (matches.length === 1 && matches[0] === el) {
        return {
          selector: candidate.selector,
          unique: true,
          strategy: candidate.strategy,
          diagnostics
        };
      }
    }
    diagnostics.rejectedReasons.push('no_unique_selector_found');
    return {
      selector: null,
      unique: false,
      strategy: candidates.length ? 'best_effort' : 'none',
      diagnostics
    };
  }

  function queryAllDeep(root, selectors, maxShadowDepth = 2, hasBudget = null) {
    const selectorText = Array.isArray(selectors) ? selectors.join(',') : selectors;
    const results = [];
    const visited = new Set();
    const MAX_SHADOW_HOST_SCAN_NODES = 500;
    const MAX_TOTAL_RESULTS = 300;

    function scan(node, depth) {
      if (!node || visited.has(node)) return;
      if (typeof hasBudget === 'function' && !hasBudget()) return;
      if (results.length >= MAX_TOTAL_RESULTS) return;
      visited.add(node);
      try {
        if (typeof node.querySelectorAll === 'function') {
          const found = Array.from(node.querySelectorAll(selectorText));
          for (const el of found) {
            if (results.length >= MAX_TOTAL_RESULTS) break;
            results.push(el);
          }
        }
      } catch (_) {}
      if (depth >= maxShadowDepth) return;
      if (typeof hasBudget === 'function' && !hasBudget()) return;
      let all = [];
      try {
        if (typeof node.querySelectorAll === 'function') {
          all = Array.from(node.querySelectorAll('*'));
        }
      } catch (_) {
        all = [];
      }
      if (all.length > MAX_SHADOW_HOST_SCAN_NODES) {
        all = all.slice(0, MAX_SHADOW_HOST_SCAN_NODES);
      }
      for (const el of all) {
        if (typeof hasBudget === 'function' && !hasBudget()) break;
        try {
          if (el.shadowRoot) {
            scan(el.shadowRoot, depth + 1);
          }
        } catch (_) {}
      }
    }

    scan(root || document, 0);
    return [...new Set(results)].filter(Boolean);
  }

  function addReason(candidate, type, value) {
    if (value) candidate.reasons.push(type);
  }

  function addPenalty(candidate, type, value) {
    if (value) candidate.penalties.push(type);
  }

  function baseCandidate(el, role, selector, source) {
    const snapshot = buildCandidateSnapshot(el);
    return {
      el,
      role,
      selector: selector || null,
      source: source || 'semantic',
      score: 0,
      reasons: [],
      penalties: [],
      rect: snapshot.rect,
      text: snapshot.text,
      attrs: snapshot,
      fingerprint: buildElementFingerprint(el)
    };
  }

  function nearComposerRect(candidateRect, composerRect, maxDistance) {
    if (!candidateRect || !composerRect) return false;
    const dx = Math.max(0, Math.max(composerRect.left - candidateRect.right, candidateRect.left - composerRect.right));
    const dy = Math.max(0, Math.max(composerRect.top - candidateRect.bottom, candidateRect.top - composerRect.bottom));
    return Math.sqrt((dx * dx) + (dy * dy)) <= maxDistance;
  }

  function scoreComposerCandidate(candidate) {
    const { el, rect, text, attrs } = candidate;
    let score = 0;
    const tag = String(el.tagName || '').toUpperCase();
    const role = String(el.getAttribute?.('role') || '').toLowerCase();
    const hintText = normalizeText([
      attrs.placeholder,
      attrs.ariaLabel,
      attrs.title,
      text
    ].join(' '));
    if (el.isContentEditable || tag === 'TEXTAREA' || role === 'textbox') {
      score += 30;
      addReason(candidate, 'editable_kind', true);
    }
    if (isVisible(el)) {
      score += 15;
      addReason(candidate, 'visible', true);
    } else {
      score -= 40;
      addPenalty(candidate, 'hidden', true);
    }
    if (isInteractable(el)) {
      score += 10;
      addReason(candidate, 'interactable', true);
    } else if (isDisabled(el) || el.readOnly) {
      score -= 30;
      addPenalty(candidate, 'disabled_or_readonly', true);
    }
    if ((rect?.width || 0) >= 240) {
      score += 10;
      addReason(candidate, 'wide_enough', true);
    }
    if ((rect?.height || 0) >= 32) {
      score += 8;
      addReason(candidate, 'tall_enough', true);
    }
    const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
    const top = rect?.top || 0;
    if (top >= vh * 0.45) {
      score += 15;
      addReason(candidate, 'lower_55pct', true);
    }
    if (top >= vh * 0.65) {
      score += 10;
      addReason(candidate, 'lower_35pct', true);
    }
    const container = el.closest?.('form, main, [role="main"], [data-testid*="chat"], [data-testid*="composer"], section, article');
    if (container) {
      score += 8;
      addReason(candidate, 'chat_container', true);
    }
    if (PROMPT_HINT_RE.test(hintText)) {
      score += 8;
      addReason(candidate, 'prompt_hint', true);
    }
    if (document.activeElement === el || el.contains?.(document.activeElement)) {
      score += 5;
      addReason(candidate, 'active_element', true);
    }
    const nearbyButton = Array.from((container || document).querySelectorAll?.('button,[role="button"]') || [])
      .find((button) => nearComposerRect(getElementRect(button), rect, 160));
    if (nearbyButton) {
      score += 5;
      addReason(candidate, 'nearby_button', true);
    }
    if (el.closest?.('aside, nav, header, footer')) {
      score -= 25;
      addPenalty(candidate, 'chrome_container', true);
    }
    if (normalizeText(text).length > 2000) {
      score -= 25;
      addPenalty(candidate, 'too_much_text', true);
    }
    if ((rect?.width || 0) < 120 || (rect?.height || 0) < 24) {
      score -= 15;
      addPenalty(candidate, 'tiny', true);
    }
    if (SEARCH_HINT_RE.test(hintText) && (el.closest?.('header, nav, aside') || tag === 'INPUT')) {
      score -= 15;
      addPenalty(candidate, 'search_box', true);
    }
    if (top < vh * 0.5 && document.activeElement !== el) {
      score -= 10;
      addPenalty(candidate, 'upper_half', true);
    }
    candidate.score = score;
    return score;
  }

  function scoreSendButtonCandidate(candidate, composerEl) {
    const { el, rect, text, attrs } = candidate;
    const composerRect = getElementRect(composerEl);
    let score = 0;
    const accessible = normalizeText([
      attrs.ariaLabel,
      attrs.title,
      text,
      attrs.dataTestId
    ].join(' '));
    const tag = String(el.tagName || '').toUpperCase();
    if (isInteractable(el) && (tag === 'BUTTON' || el.getAttribute?.('role') === 'button' || el.tabIndex >= 0)) {
      score += 25;
      addReason(candidate, 'visible_clickable', true);
    } else if (isDisabled(el)) {
      score -= 50;
      addPenalty(candidate, 'disabled', true);
    } else if (!isVisible(el)) {
      score -= 50;
      addPenalty(candidate, 'hidden', true);
    }
    if (nearComposerRect(rect, composerRect, 250)) {
      score += 20;
      addReason(candidate, 'near_composer', true);
    } else {
      score -= 25;
      addPenalty(candidate, 'far_from_composer', true);
    }
    if (composerRect && rect && rect.left >= composerRect.left - 20 && rect.top >= composerRect.top - 20) {
      score += 15;
      addReason(candidate, 'right_or_bottom_right', true);
    }
    if (composerEl && el.closest?.('form, [data-testid*="composer"], section, article') && composerEl.closest?.('form, [data-testid*="composer"], section, article') === el.closest?.('form, [data-testid*="composer"], section, article')) {
      score += 15;
      addReason(candidate, 'same_container', true);
    }
    if (SEND_HINT_RE.test(accessible)) {
      score += 15;
      addReason(candidate, 'send_hint', true);
    }
    if (tag === 'SVG' || el.querySelector?.('svg')) {
      const isSmallSquare = (rect?.width || 0) <= 64 && (rect?.height || 0) <= 64;
      if (isSmallSquare) {
        score += 10;
        addReason(candidate, 'small_svg', true);
      }
    }
    if (String(el.getAttribute?.('type') || '').toLowerCase() === 'submit') {
      score += 8;
      addReason(candidate, 'type_submit', true);
    }
    if (/send|submit/i.test(attrs.dataTestId || '')) {
      score += 8;
      addReason(candidate, 'testid_send', true);
    }
    if (!isDisabled(el)) {
      score += 5;
      addReason(candidate, 'enabled', true);
    }
    if (BAD_BUTTON_RE.test(accessible)) {
      score -= 35;
      addPenalty(candidate, 'wrong_button_kind', true);
    }
    if (el.closest?.('aside, header, nav')) {
      score -= 20;
      addPenalty(candidate, 'chrome_container', true);
    }
    if ((rect?.width || 0) > 120 || (rect?.height || 0) > 120) {
      score -= 20;
      addPenalty(candidate, 'huge_button', true);
    }
    candidate.score = score;
    return score;
  }

  function scoreAnswerCandidate(candidate) {
    const { el, rect, text, attrs } = candidate;
    let score = 0;
    const normalized = normalizeText(text);
    if (isVisible(el)) {
      score += 25;
      addReason(candidate, 'visible', true);
    } else {
      score -= 40;
      addPenalty(candidate, 'hidden', true);
    }
    if (normalized.length >= 80) {
      score += 20;
      addReason(candidate, 'text_80', true);
    }
    const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
    if ((rect?.top || 0) >= vh * 0.45) {
      score += 15;
      addReason(candidate, 'lower_page', true);
    }
    if (el.matches?.('.prose,.markdown,[class*="markdown"],[class*="prose"]') || el.querySelector?.('pre, code, ul, ol, table, p')) {
      score += 10;
      addReason(candidate, 'markdown_like', true);
    }
    if (el.querySelector?.('p, ul, ol, code, pre, table')) {
      score += 10;
      addReason(candidate, 'rich_content', true);
    }
    if (el.closest?.('main,[role="main"],[data-testid*="conversation"],[data-testid*="chat"]')) {
      score += 10;
      addReason(candidate, 'chat_area', true);
    }
    if (attrs.role === 'article' || /message|assistant/i.test(attrs.dataTestId || '')) {
      score += 8;
      addReason(candidate, 'message_like', true);
    }
    if (el.closest?.('[data-testid*="conversation"], [data-testid*="thread"]')) {
      score += 5;
      addReason(candidate, 'conversation_area', true);
    }
    if (isEditable(el) || el.matches?.('textarea,input,[role="textbox"],[contenteditable="true"]')) {
      score -= 30;
      addPenalty(candidate, 'composer_like', true);
    }
    if (el.closest?.('aside, nav, header, footer')) {
      score -= 25;
      addPenalty(candidate, 'chrome_container', true);
    }
    if (/you said|user|prompt/i.test(normalized.slice(0, 80))) {
      score -= 20;
      addPenalty(candidate, 'user_prompt_like', true);
    }
    if (normalized.length < 20) {
      score -= 20;
      addPenalty(candidate, 'tiny_text', true);
    }
    candidate.score = score;
    return score;
  }

  function dedupeElements(elements, limit) {
    const seen = new Set();
    const out = [];
    for (const el of elements || []) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      out.push(el);
      if (out.length >= limit) break;
    }
    return out;
  }

  function collectCandidates({
    role,
    selectors,
    root = document,
    composerEl = null,
    hasBudget = null
  }) {
    let targetSelectors = selectors;
    let limit = MAX_COMPOSER_CANDIDATES;
    if (role === 'sendButton') {
      targetSelectors = selectors || BUTTON_SELECTORS;
      limit = MAX_BUTTON_CANDIDATES;
    } else if (role === 'answer') {
      targetSelectors = selectors || ANSWER_SELECTORS;
      limit = MAX_ANSWER_CANDIDATES;
    } else {
      targetSelectors = selectors || COMPOSER_SELECTORS;
    }
    const raw = queryAllDeep(root, targetSelectors, 2, hasBudget);
    let nodes = raw;
    if (role === 'sendButton' && composerEl) {
      const composerRect = getElementRect(composerEl);
      nodes = raw
        .map((el) => {
          if (String(el.tagName || '').toUpperCase() === 'SVG') {
            return el.closest?.('button,[role="button"],[tabindex],a') || el;
          }
          return el;
        })
        .filter((el) => {
          if (!el) return false;
          if (el.closest?.('form') && composerEl.closest?.('form') && el.closest('form') === composerEl.closest('form')) return true;
          if (nearComposerRect(getElementRect(el), composerRect, 250)) return true;
          const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
          return (getElementRect(el)?.top || 0) >= vh * 0.6;
        });
    }
    return dedupeElements(nodes, limit).map((el) => baseCandidate(el, role, null, 'semantic'));
  }

  function buildResolverSuccess(method, role, candidate, diagnostics = {}) {
    const stable = buildStableSelector(candidate.el);
    return {
      ok: true,
      element: candidate.el,
      method,
      selector: stable?.selector || null,
      score: candidate.score,
      confidence: clamp(candidate.score / 100, 0, 1),
      fingerprint: candidate.fingerprint,
      diagnostics: Object.assign({
        role,
        reasons: candidate.reasons,
        penalties: candidate.penalties,
        stableSelector: stable
      }, diagnostics || {})
    };
  }

  function extractSelectorsFromConfig(config, role) {
    if (!config || typeof config !== 'object') return [];
    const direct = config?.selectors?.[role];
    if (Array.isArray(direct)) return direct.filter(Boolean);
    if (direct && typeof direct === 'object') {
      return [
        ...(Array.isArray(direct.primary) ? direct.primary : []),
        ...(Array.isArray(direct.fallback) ? direct.fallback : [])
      ].filter(Boolean);
    }
    return [];
  }

  function compareAnswerDomRecency(a, b) {
    if (a?.el === b?.el) return 0;
    try {
      const pos = a?.el?.compareDocumentPosition?.(b?.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch (_) {}
    const aBottom = Number(a?.rect?.bottom || 0);
    const bBottom = Number(b?.rect?.bottom || 0);
    return aBottom - bBottom;
  }

  function bestCandidate(candidates, role = null, minScore = -Infinity) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    if (role === 'answer') {
      const eligible = candidates.filter((candidate) => Number(candidate?.score || 0) >= minScore);
      if (!eligible.length) return null;
      return eligible.slice().sort(compareAnswerDomRecency)[eligible.length - 1] || null;
    }
    return candidates.slice().sort((a, b) => b.score - a.score)[0] || null;
  }

  function candidateSummary(candidates, maxItems) {
    return (candidates || []).slice(0, maxItems).map((candidate) => ({
      score: candidate.score,
      tagName: String(candidate.el?.tagName || '').toLowerCase(),
      reasons: candidate.reasons.slice(0, 4),
      penalties: candidate.penalties.slice(0, 4)
    }));
  }

  function roleStorageKey(modelName, role) {
    return `${CACHE_KEY_PREFIX}${modelName}::${role}`;
  }

  function selectorHealthElementType(role = '') {
    const normalized = String(role || '').trim();
    if (normalized === 'answer') return 'response';
    return normalized || 'unknown';
  }

  async function getSelectorHealthProfile(modelName, role) {
    if (!modelName || !role) return null;
    const snapshot = await readStorage(SELECTOR_HEALTH_PROFILE_KEY);
    const profiles = snapshot?.profiles && typeof snapshot.profiles === 'object' ? snapshot.profiles : {};
    const directKey = `${modelName}::${role}`;
    const normalizedKey = `${modelName}::${selectorHealthElementType(role)}`;
    return profiles[directKey] || profiles[normalizedKey] || null;
  }

  async function loadCachedResolution({ modelName, role }) {
    if (!modelName || !role) return null;
    return readStorage(roleStorageKey(modelName, role));
  }

  async function saveSuccessfulResolution({
    modelName,
    role,
    candidate,
    score,
    confidence,
    source
  }) {
    if (!modelName || !role || !candidate?.el) return null;
    const stable = buildStableSelector(candidate.el);
    const existing = await loadCachedResolution({ modelName, role });
    const payload = {
      version: VERSION,
      modelName,
      role,
      selector: stable?.unique === true ? stable.selector : null,
      selectorUnique: stable?.unique === true,
      fingerprint: candidate.fingerprint || buildElementFingerprint(candidate.el),
      score: Number(score || candidate.score || 0),
      confidence: Number(confidence || clamp((candidate.score || 0) / 100, 0, 1)),
      source: source || candidate.source || 'semantic',
      urlHost: window.location.hostname,
      urlPathHint: window.location.pathname.split('/').slice(0, 3).join('/'),
      uiRevision: detectUiRevision(modelName),
      savedAt: existing?.savedAt || Date.now(),
      lastUsedAt: Date.now(),
      successCount: Number(existing?.successCount || 0) + 1,
      failureCount: Number(existing?.failureCount || 0)
    };
    await writeStorage(roleStorageKey(modelName, role), payload);
    return payload;
  }

  async function validateCachedResolution({
    modelName,
    role,
    cached,
    root = document
  }) {
    const entry = cached || await loadCachedResolution({ modelName, role });
    if (!entry) {
      return { ok: false, reason: 'cache_missing' };
    }
    if (Number(entry.failureCount || 0) >= 3) {
      return { ok: false, reason: 'cache_failure_threshold_reached' };
    }
    if (!entry.selector || entry.selectorUnique !== true) {
      return { ok: false, reason: 'cache_selector_missing_or_not_unique' };
    }
    let el = null;
    try {
      el = (root || document).querySelector(entry.selector);
    } catch (_) {
      el = null;
    }
    if (!el) {
      entry.failureCount = Number(entry.failureCount || 0) + 1;
      await writeStorage(roleStorageKey(modelName, role), entry);
      return { ok: false, reason: 'cache_selector_not_found' };
    }
    const visibilityOk = role === 'answer' ? isVisible(el) : isInteractable(el);
    if (!visibilityOk) {
      entry.failureCount = Number(entry.failureCount || 0) + 1;
      await writeStorage(roleStorageKey(modelName, role), entry);
      return { ok: false, reason: 'cache_element_not_valid' };
    }
    const currentFingerprint = buildElementFingerprint(el);
    const currentRevision = detectUiRevision(modelName);
    let requiredSimilarity = 0.55;
    if (
      entry.uiRevision &&
      entry.uiRevision !== 'unknown' &&
      currentRevision &&
      currentRevision !== 'unknown' &&
      entry.uiRevision !== currentRevision
    ) {
      requiredSimilarity = 0.75;
    }
    const similarity = calculateFingerprintSimilarity(entry.fingerprint, currentFingerprint);
    if (similarity < requiredSimilarity) {
      entry.failureCount = Number(entry.failureCount || 0) + 1;
      await writeStorage(roleStorageKey(modelName, role), entry);
      return {
        ok: false,
        reason: 'fingerprint_similarity_below_threshold',
        similarity,
        requiredSimilarity,
        cachedUiRevision: entry.uiRevision || 'unknown',
        currentUiRevision: currentRevision || 'unknown'
      };
    }
    entry.lastUsedAt = Date.now();
    entry.successCount = Number(entry.successCount || 0) + 1;
    await writeStorage(roleStorageKey(modelName, role), entry);
    return {
      ok: true,
      element: el,
      selector: entry.selector,
      similarity,
      fingerprint: currentFingerprint,
      cached: entry
    };
  }

  function emitResolutionMetric(payload = {}) {
    try {
      chrome.runtime.sendMessage(Object.assign({
        type: 'METRIC_EVENT',
        event: 'selector_resolution',
        resolverVersion: VERSION
      }, payload));
    } catch (_) {}
  }

  function emitFailureMetric(modelName, role, reason, candidateCount, failureReason) {
    try {
      chrome.runtime.sendMessage({
        type: 'SELECTOR_METRIC',
        event: 'selector_search_failed',
        payload: {
          modelName,
          elementType: role,
          resolverVersion: VERSION,
          reason,
          candidateCount,
          failureReason
        }
      });
    } catch (_) {}
  }

  async function resolveByRole(options = {}) {
    const {
      modelName,
      role,
      selectors = [],
      config = null,
      root = document,
      preferCached = true,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      traceId = null,
      reason = 'dispatch',
      composerEl = null
    } = options;
    const startedAt = Date.now();
    const settings = await getSettings();
    if (!settings.enabled) {
      return timeoutResult('resolver_disabled', { options: sanitizeOptionsForDiagnostics(options) });
    }
    const selectorHealthProfile = await getSelectorHealthProfile(modelName, role);
    const selectorProfileLifecycle = window.SelectorProfileLifecycle?.decide
      ? window.SelectorProfileLifecycle.decide(selectorHealthProfile || {})
      : {
          status: String(selectorHealthProfile?.profileStatus || 'unknown').toLowerCase(),
          action: String(selectorHealthProfile?.profileStatus || '').toLowerCase() === 'broken' ? 'fallback_only' : 'use_current',
          reason: String(selectorHealthProfile?.profileStatus || '').toLowerCase() === 'broken'
            ? 'selector_profile_broken_no_last_known_good'
            : 'profile_not_restrictive',
          exactEnabled: String(selectorHealthProfile?.profileStatus || '').toLowerCase() !== 'broken',
          cacheEnabled: String(selectorHealthProfile?.profileStatus || '').toLowerCase() !== 'broken',
          fallbackOnly: String(selectorHealthProfile?.profileStatus || '').toLowerCase() === 'broken',
          rollbackRequired: false,
          selectedVersion: null
        };
    const selectorProfileStatus = selectorProfileLifecycle.status || 'unknown';
    const selectorProfileBroken = selectorProfileStatus === 'broken';
    const hasBudget = () => (Date.now() - startedAt) < timeoutMs;
    const diagnostics = {
      role,
      traceId,
      reason,
      cacheUsed: false,
      cacheValid: false,
      selectorProfileStatus,
      selectorProfileBroken,
      selectorProfileLifecycle,
      selectorHealthProfile: selectorHealthProfile ? {
        hits: selectorHealthProfile.hits || 0,
        failures: selectorHealthProfile.failures || 0,
        total: selectorHealthProfile.total || 0,
        updatedAt: selectorHealthProfile.updatedAt || null
      } : null
    };
    const resolvedSelectors = [...extractSelectorsFromConfig(config, role), ...selectors].filter(Boolean);
    const semanticSelectors = role === 'composer'
      ? COMPOSER_SELECTORS
      : role === 'sendButton'
        ? BUTTON_SELECTORS
        : ANSWER_SELECTORS;
    const minScoreDefault = role === 'composer'
      ? settings.minComposerScore
      : role === 'sendButton'
        ? settings.minSendButtonScore
        : settings.minAnswerScore;
    const minScore = getThreshold(
      modelName,
      role === 'composer' ? 'minComposerScore' : role === 'sendButton' ? 'minSendButtonScore' : 'minAnswerScore',
      minScoreDefault
    );
    if (!hasBudget()) return timeoutResult('resolver_timeout_before_exact', diagnostics);

    if (!selectorProfileLifecycle.exactEnabled) {
      diagnostics.exactSkipped = true;
      diagnostics.exactSkipReason = selectorProfileLifecycle.reason || 'selector_profile_blocked';
    }
    for (const selector of selectorProfileLifecycle.exactEnabled ? resolvedSelectors : []) {
      if (!hasBudget()) return timeoutResult('resolver_timeout_before_exact', diagnostics);
      try {
        const matches = queryAllDeep(root, selector, 2, hasBudget);
        const exactCandidates = [];
        for (const el of matches) {
          const valid = role === 'answer' ? isVisible(el) : role === 'sendButton' ? isInteractable(el) : isEditable(el) && isInteractable(el);
          if (!valid) continue;
          const candidate = baseCandidate(el, role, selector, 'exact');
          if (role === 'composer') scoreComposerCandidate(candidate);
          if (role === 'sendButton') scoreSendButtonCandidate(candidate, composerEl);
          if (role === 'answer') scoreAnswerCandidate(candidate);
          exactCandidates.push(candidate);
        }
        const bestExact = bestCandidate(exactCandidates, role, minScore);
        if (bestExact && bestExact.score >= minScore) {
          const result = buildResolverSuccess('exact', role, bestExact, diagnostics);
          await saveSuccessfulResolution({ modelName, role, candidate: bestExact, source: 'exact' });
          emitResolutionMetric({
            modelName,
            elementType: role,
            method: 'exact',
            layer: 'exact',
            ok: true,
            score: result.score,
            confidence: result.confidence,
            selector: result.selector,
            reason,
            traceId,
            diagnostics: {
              candidateCount: exactCandidates.length,
              topCandidates: candidateSummary(exactCandidates.sort((a, b) => b.score - a.score), settings.maxCandidatesLogged),
              failureReason: null,
              cacheUsed: false,
              cacheValid: false,
              elapsedMs: Date.now() - startedAt
            }
          });
          return result;
        }
      } catch (_) {}
    }

    if (!hasBudget()) return timeoutResult('resolver_timeout_before_cache', diagnostics);
    if (preferCached && settings.useCache && selectorProfileLifecycle.cacheEnabled && role !== 'answer') {
      diagnostics.cacheUsed = true;
      const cached = await validateCachedResolution({ modelName, role, root });
      if (cached?.ok && cached.element) {
        diagnostics.cacheValid = true;
        const candidate = baseCandidate(cached.element, role, cached.selector, 'cache');
        if (role === 'composer') scoreComposerCandidate(candidate);
        if (role === 'sendButton') scoreSendButtonCandidate(candidate, composerEl);
        if (role === 'answer') scoreAnswerCandidate(candidate);
        const result = buildResolverSuccess('cache', role, candidate, Object.assign({}, diagnostics, { similarity: cached.similarity }));
        emitResolutionMetric({
          modelName,
          elementType: role,
          method: 'cache',
          layer: 'cache',
          ok: true,
          score: result.score,
          confidence: result.confidence,
          selector: result.selector,
          reason,
          traceId,
          diagnostics: {
            candidateCount: 1,
            topCandidates: candidateSummary([candidate], settings.maxCandidatesLogged),
            failureReason: null,
            cacheUsed: true,
            cacheValid: true,
            elapsedMs: Date.now() - startedAt
          }
        });
        return result;
      }
    } else if (!selectorProfileLifecycle.cacheEnabled) {
      diagnostics.cacheUsed = false;
      diagnostics.cacheSkipped = true;
      diagnostics.cacheSkipReason = selectorProfileLifecycle.reason || 'selector_profile_blocked';
    }

    if (!hasBudget()) return timeoutResult('resolver_timeout_before_scan', diagnostics);
    const semanticCandidates = collectCandidates({
      role,
      selectors: semanticSelectors,
      root,
      composerEl,
      hasBudget
    });
    if (!hasBudget()) return timeoutResult('resolver_timeout_before_snapshot', diagnostics);
    semanticCandidates.forEach((candidate) => {
      if (role === 'composer') scoreComposerCandidate(candidate);
      if (role === 'sendButton') scoreSendButtonCandidate(candidate, composerEl);
      if (role === 'answer') scoreAnswerCandidate(candidate);
    });
    if (!hasBudget()) return timeoutResult('resolver_timeout_before_scoring', diagnostics);
    const topSemantic = bestCandidate(semanticCandidates, role, minScore);
    if (topSemantic && topSemantic.score >= minScore) {
      const result = buildResolverSuccess('semantic', role, topSemantic, diagnostics);
      await saveSuccessfulResolution({ modelName, role, candidate: topSemantic, source: 'semantic' });
      emitResolutionMetric({
        modelName,
        elementType: role,
        method: 'semantic',
        layer: 'semantic',
        ok: true,
        score: result.score,
        confidence: result.confidence,
        selector: result.selector,
        reason,
        traceId,
        diagnostics: {
          candidateCount: semanticCandidates.length,
          topCandidates: candidateSummary(semanticCandidates.sort((a, b) => b.score - a.score), settings.maxCandidatesLogged),
          failureReason: null,
          cacheUsed: diagnostics.cacheUsed,
          cacheValid: diagnostics.cacheValid,
          elapsedMs: Date.now() - startedAt
        }
      });
      return result;
    }

    if (settings.useSpatialHeuristics) {
      const spatialCandidates = semanticCandidates.map((candidate) => {
        const clone = Object.assign({}, candidate, {
          reasons: candidate.reasons.slice(),
          penalties: candidate.penalties.slice()
        });
        if (role === 'sendButton' && composerEl && nearComposerRect(clone.rect, getElementRect(composerEl), 180)) {
          clone.score += 8;
          addReason(clone, 'spatial_near_composer', true);
        }
        if (role === 'answer' && (clone.rect?.top || 0) >= (window.innerHeight || 800) * 0.7) {
          clone.score += 8;
          addReason(clone, 'spatial_latest_region', true);
        }
        if (role === 'composer' && (clone.rect?.top || 0) >= (window.innerHeight || 800) * 0.65) {
          clone.score += 8;
          addReason(clone, 'spatial_bottom_band', true);
        }
        return clone;
      });
      const topSpatial = bestCandidate(spatialCandidates, role, minScore);
      if (topSpatial && topSpatial.score >= minScore) {
        const result = buildResolverSuccess('spatial', role, topSpatial, diagnostics);
        await saveSuccessfulResolution({ modelName, role, candidate: topSpatial, source: 'spatial' });
        emitResolutionMetric({
          modelName,
          elementType: role,
          method: 'spatial',
          layer: 'spatial',
          ok: true,
          score: result.score,
          confidence: result.confidence,
          selector: result.selector,
          reason,
          traceId,
          diagnostics: {
            candidateCount: spatialCandidates.length,
            topCandidates: candidateSummary(spatialCandidates.sort((a, b) => b.score - a.score), settings.maxCandidatesLogged),
            failureReason: null,
            cacheUsed: diagnostics.cacheUsed,
            cacheValid: diagnostics.cacheValid,
            elapsedMs: Date.now() - startedAt
          }
        });
        return result;
      }
    }

    if (settings.useVisualResolver && hasBudget()) {
      try {
        chrome.runtime.sendMessage({
          type: 'VISUAL_RESOLVE_REQUEST',
          modelName,
          role,
          traceId
        });
      } catch (_) {}
    }

    if (!hasBudget()) return timeoutResult('resolver_timeout_before_telemetry', diagnostics);
    emitFailureMetric(modelName, role, reason, semanticCandidates.length, 'no_candidate_above_threshold');
    emitResolutionMetric({
      modelName,
      elementType: role,
      method: 'none',
      layer: 'none',
      ok: false,
      score: 0,
      confidence: 0,
      selector: null,
      reason,
      traceId,
      diagnostics: {
        candidateCount: semanticCandidates.length,
        topCandidates: candidateSummary(semanticCandidates.sort((a, b) => b.score - a.score), settings.maxCandidatesLogged),
        failureReason: 'no_candidate_above_threshold',
        cacheUsed: diagnostics.cacheUsed,
        cacheValid: diagnostics.cacheValid,
        elapsedMs: Date.now() - startedAt
      }
    });
    return {
      ok: false,
      element: null,
      method: 'none',
      selector: null,
      score: 0,
      confidence: 0,
      fingerprint: null,
      diagnostics: Object.assign({}, diagnostics, {
        failureReason: 'no_candidate_above_threshold',
        candidateCount: semanticCandidates.length
      })
    };
  }

  async function resolveComposer(options = {}) {
    return resolveByRole(Object.assign({
      role: 'composer',
      reason: 'dispatch'
    }, options || {}));
  }

  async function resolveSendButton(options = {}) {
    return resolveByRole(Object.assign({
      role: 'sendButton',
      reason: 'dispatch'
    }, options || {}));
  }

  async function resolveLatestAssistantAnswer(options = {}) {
    return resolveByRole(Object.assign({
      role: 'answer',
      reason: 'collect'
    }, options || {}));
  }

  async function resolveStopButton(options = {}) {
    return {
      ok: false,
      element: null,
      method: 'none',
      selector: null,
      score: 0,
      confidence: 0,
      fingerprint: null,
      diagnostics: {
        reason: 'resolveStopButton_not_specified_in_v2_0',
        options: sanitizeOptionsForDiagnostics(options)
      }
    };
  }

  async function resolveRegenerateButton(options = {}) {
    return {
      ok: false,
      element: null,
      method: 'none',
      selector: null,
      score: 0,
      confidence: 0,
      fingerprint: null,
      diagnostics: {
        reason: 'resolveRegenerateButton_not_specified_in_v2_0',
        options: sanitizeOptionsForDiagnostics(options)
      }
    };
  }

  function extractSafeVisibleText(el, maxChars = 10000) {
    if (!el || !isVisible(el)) return '';
    let text = '';
    try {
      text = el.innerText || el.textContent || '';
    } catch (_) {
      text = '';
    }
    return String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
  }

  async function runSelfTest() {
    const failures = [];
    try {
      const stable = buildStableSelector(document.createElement('div'));
      if (!stable || typeof stable !== 'object') failures.push('buildStableSelector_not_object');
    } catch (err) {
      failures.push(`buildStableSelector_throw:${err?.message || err}`);
    }
    try {
      const stub = await resolveStopButton({});
      if (stub.ok !== false) failures.push('stop_stub_invalid');
    } catch (err) {
      failures.push(`stop_stub_throw:${err?.message || err}`);
    }
    return {
      ok: failures.length === 0,
      passed: failures.length ? 0 : 2,
      failed: failures.length,
      failures
    };
  }

  const SelectorResolverV2 = {
    resolveComposer,
    resolveSendButton,
    resolveLatestAssistantAnswer,
    resolveStopButton,
    resolveRegenerateButton,
    collectCandidates,
    scoreComposerCandidate,
    scoreSendButtonCandidate,
    scoreAnswerCandidate,
    buildElementFingerprint,
    calculateFingerprintSimilarity,
    buildStableSelector,
    validateCachedResolution,
    saveSuccessfulResolution,
    loadCachedResolution,
    getSelectorHealthProfile,
    selectorHealthElementType,
    emitResolutionMetric,
    queryAllDeep,
    sanitizeOptionsForDiagnostics,
    detectUiRevision,
    extractSafeVisibleText,
    MIN_EXTRACTED_ANSWER_LENGTH_FOR_NO_FALLBACK,
    SELECTOR_RESOLVER_V2_DEFAULTS,
    version: VERSION,
    runSelfTest
  };

  window.LLMExtension = window.LLMExtension || {};
  window.LLMExtension.SelectorResolverV2 = SelectorResolverV2;
  window.SelectorResolverV2 = SelectorResolverV2;
})();
