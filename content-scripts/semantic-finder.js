// semantic-finder.js
(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  if (globalObject.SemanticFinder) {
    console.warn('[SemanticFinder] Duplicate load prevented');
    return;
  }

  const cssEscape = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape
    : ((value) => String(value).replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '\\$1'));

  const SemanticFinder = {
    searchConfig: {
      sendButton: {
        ariaLabels: ['send', 'submit', 'message'],
        ariaRoles: ['button'],
        textPatterns: ['send', 'submit', 'go', 'enter'],
        svgPaths: [
          'M2.01 21L23 12 2.01 3',
          'M12 19V5M5 12l7-7 7 7'
        ],
        proximity: { near: 'input', position: 'after' }
      },
      input: {
        ariaLabels: ['message', 'prompt', 'chat', 'ask'],
        ariaRoles: ['textbox', 'combobox'],
        placeholders: ['message', 'ask', 'type'],
        tagNames: ['textarea', 'input[type="text"]', '[contenteditable="true"]'],
        minHeight: 40
      },
      response: {
        ariaLabels: ['response', 'answer', 'message', 'assistant'],
        ariaRoles: ['article', 'log'],
        classPatterns: ['markdown', 'prose', 'message', 'response', 'answer'],
        structure: { hasChild: 'p, pre, code, ul, ol' }
      },
      uploadButton: {
        ariaLabels: ['upload', 'attach', 'file', 'image'],
        inputTypes: ['file'],
        svgPaths: ['M21 15v4a2 2 0 01-2 2H5'],
        proximity: { near: 'textarea', position: 'before' }
      },
      copyButton: {
        ariaLabels: ['copy'],
        textPatterns: ['copy'],
        proximity: { near: 'response', position: 'inside' }
      }
    },

    find(elementType, root = document) {
      const config = this.searchConfig[elementType];
      if (!config) {
        console.warn(`[SEMANTIC] Unknown element type: ${elementType}`);
        return { element: null, confidence: 0, method: null };
      }

      const strategies = [
        () => this._findByAriaLabel(config, root),
        () => this._findByAriaRole(config, root),
        () => this._findByPlaceholder(config, root),
        () => this._findByText(config, root),
        () => this._findBySvgPath(config, root),
        () => this._findByTagName(config, root),
        () => this._findByClassPattern(config, root),
        () => this._findByStructure(config, root),
        () => this._findByProximity(config, root)
      ];

      for (const strategy of strategies) {
        const result = strategy();
        if (result.element && this._validateElement(result.element, config)) {
          console.log(`[SEMANTIC] Found ${elementType} via ${result.method} (confidence: ${result.confidence})`);
          return result;
        }
      }

      console.warn(`[SEMANTIC] Could not find ${elementType}`);
      return { element: null, confidence: 0, method: null };
    },

    _findByAriaLabel(config, root) {
      if (!config.ariaLabels?.length) {
        return { element: null, confidence: 0, method: 'aria-label' };
      }

      const elements = root.querySelectorAll('[aria-label]');
      for (const el of elements) {
        const label = String(el.getAttribute('aria-label') || '').toLowerCase();
        for (const pattern of config.ariaLabels) {
          if (label.includes(String(pattern).toLowerCase())) {
            return { element: el, confidence: 0.95, method: 'aria-label' };
          }
        }
      }

      return { element: null, confidence: 0, method: 'aria-label' };
    },

    _findByAriaRole(config, root) {
      if (!config.ariaRoles?.length) {
        return { element: null, confidence: 0, method: 'aria-role' };
      }

      for (const role of config.ariaRoles) {
        const elements = root.querySelectorAll(`[role="${role}"]`);
        for (const el of elements) {
          if (this._matchesAdditionalCriteria(el, config)) {
            return { element: el, confidence: 0.85, method: 'aria-role' };
          }
        }
      }

      return { element: null, confidence: 0, method: 'aria-role' };
    },

    _findByPlaceholder(config, root) {
      if (!config.placeholders?.length) {
        return { element: null, confidence: 0, method: 'placeholder' };
      }

      const elements = root.querySelectorAll('[placeholder]');
      for (const el of elements) {
        const placeholder = String(el.getAttribute('placeholder') || '').toLowerCase();
        for (const pattern of config.placeholders) {
          if (placeholder.includes(String(pattern).toLowerCase())) {
            return { element: el, confidence: 0.9, method: 'placeholder' };
          }
        }
      }

      return { element: null, confidence: 0, method: 'placeholder' };
    },

    _findByText(config, root) {
      if (!config.textPatterns?.length) {
        return { element: null, confidence: 0, method: 'text' };
      }

      const doc = root.ownerDocument || document;
      for (const pattern of config.textPatterns) {
        const needle = String(pattern).toLowerCase();
        const xpath = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${needle}')]`;
        try {
          const result = doc.evaluate(
            xpath,
            root,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          );
          if (result.singleNodeValue) {
            const el = result.singleNodeValue;
            if (this._isInteractive(el)) {
              return { element: el, confidence: 0.75, method: 'text' };
            }
          }
        } catch (err) {
          console.warn('[SEMANTIC] XPath error', err);
        }
      }

      return { element: null, confidence: 0, method: 'text' };
    },

    _findBySvgPath(config, root) {
      if (!config.svgPaths?.length) {
        return { element: null, confidence: 0, method: 'svg-path' };
      }

      const svgPaths = root.querySelectorAll('svg path[d]');
      for (const pathEl of svgPaths) {
        const d = pathEl.getAttribute('d') || '';
        for (const pattern of config.svgPaths) {
          const normalizedD = d.replace(/\s+/g, ' ').trim();
          const normalizedPattern = String(pattern).replace(/\s+/g, ' ').trim();
          if (normalizedD.startsWith(normalizedPattern) ||
              this._svgPathSimilarity(normalizedD, normalizedPattern) > 0.8) {
            const button = pathEl.closest('button, [role="button"], [tabindex="0"]');
            if (button) {
              return { element: button, confidence: 0.8, method: 'svg-path' };
            }
          }
        }
      }

      return { element: null, confidence: 0, method: 'svg-path' };
    },

    _findByTagName(config, root) {
      if (!config.tagNames?.length && !config.inputTypes?.length) {
        return { element: null, confidence: 0, method: 'tag' };
      }

      if (config.inputTypes) {
        for (const type of config.inputTypes) {
          const el = root.querySelector(`input[type="${type}"]`);
          if (el) {
            return { element: el, confidence: 0.7, method: 'tag' };
          }
        }
      }

      if (config.tagNames) {
        for (const selector of config.tagNames) {
          const elements = root.querySelectorAll(selector);
          for (const el of elements) {
            if (this._matchesAdditionalCriteria(el, config)) {
              return { element: el, confidence: 0.7, method: 'tag' };
            }
          }
        }
      }

      return { element: null, confidence: 0, method: 'tag' };
    },

    _findByClassPattern(config, root) {
      if (!config.classPatterns?.length) {
        return { element: null, confidence: 0, method: 'class-pattern' };
      }

      for (const pattern of config.classPatterns) {
        const elements = root.querySelectorAll(`[class*="${pattern}"]`);
        for (const el of elements) {
          if (this._matchesAdditionalCriteria(el, config)) {
            return { element: el, confidence: 0.6, method: 'class-pattern' };
          }
        }
      }

      return { element: null, confidence: 0, method: 'class-pattern' };
    },

    _findByStructure(config, root) {
      if (!config.structure) {
        return { element: null, confidence: 0, method: 'structure' };
      }

      const { hasChild } = config.structure;
      if (hasChild) {
        const candidates = root.querySelectorAll('*');
        for (const el of candidates) {
          if (el.querySelector(hasChild)) {
            if (el.tagName !== 'BODY' && el.tagName !== 'HTML' && el.children.length < 50) {
              return { element: el, confidence: 0.55, method: 'structure' };
            }
          }
        }
      }

      return { element: null, confidence: 0, method: 'structure' };
    },

    _findByProximity(config, root) {
      if (!config.proximity) {
        return { element: null, confidence: 0, method: 'proximity' };
      }

      const { near, position } = config.proximity;
      if (!near || near === 'unknown') {
        return { element: null, confidence: 0, method: 'proximity' };
      }
      const anchorResult = this.find(near, root);
      if (!anchorResult.element) {
        return { element: null, confidence: 0, method: 'proximity' };
      }

      const anchor = anchorResult.element;
      if (position === 'after' || position === 'before') {
        const parent = anchor.closest('form') || anchor.parentElement?.parentElement;
        if (parent) {
          const buttons = parent.querySelectorAll('button, [role="button"]');
          if (!buttons.length) {
            return { element: null, confidence: 0, method: 'proximity' };
          }
          const pick = position === 'after' ? buttons[buttons.length - 1] : buttons[0];
          if (pick) {
            return { element: pick, confidence: 0.5, method: 'proximity' };
          }
        }
      }

      if (position === 'inside') {
        const buttons = anchor.querySelectorAll('button, [role="button"]');
        if (buttons.length) {
          return { element: buttons[0], confidence: 0.5, method: 'proximity' };
        }
      }

      return { element: null, confidence: 0, method: 'proximity' };
    },

    _matchesAdditionalCriteria(element, config) {
      if (!this._isVisible(element)) {
        return false;
      }
      if (config.minHeight) {
        const rect = element.getBoundingClientRect();
        if (rect.height < config.minHeight) {
          return false;
        }
      }
      return true;
    },

    _isVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    _isInteractive(element) {
      if (!element) return false;
      const interactiveTags = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'];
      if (interactiveTags.includes(element.tagName)) return true;
      if (element.getAttribute('role') === 'button') return true;
      if (element.getAttribute('tabindex') !== null) return true;
      if (typeof element.onclick === 'function') return true;
      return false;
    },

    _validateElement(element, config) {
      if (!element || !this._isVisible(element)) {
        return false;
      }
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      return true;
    },

    _svgPathSimilarity(path1, path2) {
      const compareLength = Math.min(20, path1.length, path2.length);
      if (!compareLength) return 0;
      let matches = 0;
      for (let i = 0; i < compareLength; i += 1) {
        if (path1[i] === path2[i]) matches += 1;
      }
      return matches / compareLength;
    },

    generateSelector(element) {
      if (!element) return null;
      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }
      const testId = element.getAttribute('data-testid');
      if (testId) {
        return `[data-testid="${cssEscape(testId)}"]`;
      }
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        return `[aria-label="${cssEscape(ariaLabel)}"]`;
      }
      const uniqueClass = this._findUniqueClass(element);
      if (uniqueClass) {
        return `${element.tagName.toLowerCase()}.${cssEscape(uniqueClass)}`;
      }
      return this._generatePathSelector(element);
    },

    _findUniqueClass(element) {
      const classes = Array.from(element.classList || []);
      for (const cls of classes) {
        if (cls.length < 3 || /^[a-z]{1,2}\d+$/i.test(cls)) {
          continue;
        }
        const matches = document.querySelectorAll(`.${cssEscape(cls)}`);
        if (matches.length === 1) {
          return cls;
        }
      }
      return null;
    },

    _generatePathSelector(element, maxDepth = 4) {
      const path = [];
      let current = element;
      let depth = 0;
      while (current && depth < maxDepth && current.tagName) {
        const tag = current.tagName.toLowerCase();
        let selector = tag;
        if (current.id) {
          selector = `#${cssEscape(current.id)}`;
          path.unshift(selector);
          break;
        }
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
          : [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector = `${tag}:nth-of-type(${index})`;
        }
        path.unshift(selector);
        current = current.parentElement;
        depth += 1;
      }
      return path.join(' > ') || null;
    }
  };

  globalObject.SemanticFinder = SemanticFinder;

  if (typeof module !== 'undefined') {
    module.exports = { SemanticFinder };
  }
})();
