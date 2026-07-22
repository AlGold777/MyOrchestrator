(function () {
  const globalObject = typeof window !== 'undefined' ? window : self;
  globalObject.SelectorConfigRegistry = globalObject.SelectorConfigRegistry || {};
  globalObject.SelectorConfigRegistry['Z.ai'] = {
    versions: [
      {
        version: 'zai-2026-q2',
        uiRevision: '2026.2',
        expiresAt: '2026-09-30T00:00:00Z',
        dateCreated: '2026-06-22T00:00:00Z',
        description: 'Z.ai GLM chat UI audited on chat.z.ai.',
        markers: [
          { selector: '#chat-input' },
          { selector: '#send-message-button' }
        ],
        selectors: {
          composer: [
            '#chat-input',
            'textarea[placeholder*="help you today" i]',
            'textarea.input-scroll',
            'form textarea:not([type="search"])'
          ],
          sendButton: [
            '#send-message-button',
            'button.sendMessageButton[type="submit"]',
            'form button[type="submit"]',
            'button[aria-label*="send" i]'
          ],
          response: {
            primary: [
              '[id^="message-"][id$="-start"].chat-assistant.markdown-prose',
              '[id^="message-"].chat-assistant.markdown-prose',
              '[id^="message-"] .chat-assistant.markdown-prose',
              '.chat-assistant.markdown-prose',
              '[data-message-author-role="assistant"]',
              '[data-role="assistant"]',
              '[data-testid*="assistant"]',
              '[class*="assistant-message"]',
              '[class*="assistant"] [class*="markdown"]'
            ],
            fallback: [
              '[id^="message-"] [class*="assistant-message"]',
              '[id^="message-"] [data-role="assistant"]'
            ],
            extraction: { method: 'innerText', cleanup: 'full' }
          }
        },
        constraints: {
          composer: { exclude: ['input[type="search"]', '[role="search"] textarea'] },
          sendButton: { exclude: ['button[aria-label*="search" i]', '[role="search"] button'] }
        },
        observation: {
          rootSelector: 'body',
          targetSelectors: [
            '#chat-messages',
            '.chat-assistant.markdown-prose',
            '[data-message-author-role="assistant"]',
            '[data-role="assistant"]',
            '[class*="assistant-message"]',
            '[class*="assistant"] [class*="markdown"]',
            '[class*="assistant"] [class*="markdown"]'
          ],
          stabilizationDelayMs: 1800,
          endGenerationMarkers: [
            {
              selector: 'button[aria-label*="stop" i], [data-generating="true"], [data-streaming="true"], [aria-busy="true"], .animate-pulse',
              type: 'disappear'
            }
          ]
        },
        anchors: {
          composer: ['How can I help you today?'],
          sendButton: ['Send Message', 'Send'],
          response: ['GLM', 'Z.ai']
        }
      }
    ],
    emergencyFallbacks: {
      composer: ['#chat-input', 'textarea[placeholder*="help you today" i]', 'textarea.input-scroll', 'textarea'],
      sendButton: ['#send-message-button', 'button.sendMessageButton', 'form button[type="submit"]', 'button[aria-label*="send" i]'],
      response: ['.chat-assistant.markdown-prose', '[id^="message-"] .chat-assistant.markdown-prose', '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[class*="assistant-message"]', '[class*="assistant"] [class*="markdown"]']
    },
    observationDefaults: {
      rootSelector: 'body',
      targetSelectors: ['#chat-messages', '.chat-assistant.markdown-prose', '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[class*="assistant-message"]'],
      stabilizationDelayMs: 1800,
      endGenerationMarkers: [
        { selector: 'button[aria-label*="stop" i], [data-generating="true"], [data-streaming="true"], [aria-busy="true"], .animate-pulse', type: 'disappear' }
      ]
    }
  };
})();
