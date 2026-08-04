(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  globalObject.SelectorConfigRegistry['Kimi'] = {
    versions: [
      {
        version: 'kimi-2026-q3',
        uiRevision: '2026.3',
        expiresAt: '2026-12-31T00:00:00Z',
        dateCreated: '2026-08-04T00:00:00Z',
        // Composer and send button audited live on kimi.com (Vue app, Lexical
        // contenteditable composer, send control is a <div>, not a <button>).
        // The answer selectors below are unverified: the chat surface is behind
        // a login wall, so they lead with the Kimi-specific class names and fall
        // back to the generic assistant/markdown heuristics.
        description: 'Kimi (Moonshot) chat UI audited on kimi.com.',
        markers: [
          { selector: '.chat-input-editor' },
          { selector: '.send-button-container' }
        ],
        selectors: {
          composer: [
            '.chat-input-editor[contenteditable="true"]',
            '.chat-input-editor',
            '.chat-editor [contenteditable="true"]',
            '.chat-box [contenteditable="true"]',
            'div[contenteditable="true"][data-lexical-editor="true"]'
          ],
          sendButton: [
            '.send-button-container:not(.disabled)',
            '.chat-box .send-button-container',
            '.send-button-container',
            'button[class*="send" i]:not([disabled])',
            '[aria-label*="send" i]:not([disabled])'
          ],
          response: {
            primary: [
              '.segment-assistant .markdown-container',
              '.segment-assistant',
              '.chat-content-item-assistant .markdown-container',
              '[class*="segment-assistant" i]',
              '[data-message-author-role="assistant"]',
              '[data-role="assistant"]',
              '[class*="assistant-message" i]',
              '[class*="assistant" i] [class*="markdown" i]'
            ],
            fallback: [
              '.markdown-container',
              '[class*="markdown" i][class*="body" i]'
            ],
            extraction: { method: 'innerText', cleanup: 'full' }
          }
        },
        constraints: {
          composer: { exclude: ['input[type="search"]', '[role="search"] [contenteditable="true"]'] },
          sendButton: { exclude: ['.send-button-container.disabled', '[role="search"] button'] }
        },
        observation: {
          rootSelector: 'body',
          targetSelectors: [
            '.chat-content-list',
            '.segment-assistant',
            '.markdown-container',
            '[data-message-author-role="assistant"]',
            '[data-role="assistant"]',
            '[class*="assistant" i] [class*="markdown" i]'
          ],
          stabilizationDelayMs: 1800,
          endGenerationMarkers: [
            {
              selector: '.send-button-container.stop, [class*="stop" i][class*="button" i], [data-generating="true"], [data-streaming="true"], [aria-busy="true"]',
              type: 'disappear'
            }
          ]
        },
        anchors: {
          composer: ['Спросить Kimi', 'Ask Kimi', 'Kimi'],
          sendButton: ['Send', 'Отправить'],
          response: ['Kimi', 'K3']
        }
      }
    ],
    emergencyFallbacks: {
      composer: ['.chat-input-editor', '.chat-editor [contenteditable="true"]', 'div[contenteditable="true"]'],
      sendButton: ['.send-button-container:not(.disabled)', '.send-button-container', 'button[class*="send" i]'],
      response: ['.segment-assistant', '.markdown-container', '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[class*="assistant" i] [class*="markdown" i]']
    },
    observationDefaults: {
      rootSelector: 'body',
      targetSelectors: ['.chat-content-list', '.segment-assistant', '.markdown-container', '[data-message-author-role="assistant"]', '[data-role="assistant"]'],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: [
        { selector: '.send-button-container.stop, [class*="stop" i][class*="button" i], [data-generating="true"], [data-streaming="true"], [aria-busy="true"]', type: 'disappear' }
      ]
    }
  };
})();
