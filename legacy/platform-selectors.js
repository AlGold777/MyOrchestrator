(function initPlatformSelectors() {
  if (window.AnswerPipelineSelectors) return;

  const COPY_BUTTON_SELECTORS = [
    'button[aria-label*="Copy" i]',
    'button[title*="Copy" i]',
    'button[data-testid*="copy" i]',
    '[role="button"][aria-label*="Copy" i]',
    '[role="button"][title*="Copy" i]',
    '[data-testid*="copy" i]',
    '[aria-label*="Copy response" i]',
    '[aria-label*="Copy answer" i]',
    '[aria-label*="Копировать" i]',
    'button[class*="copy" i]'
  ];

  const PLATFORM_SELECTORS = {
    claude: {
      streamStart: [
        '[data-testid*="conversation"] > div:last-child',
        '[class*="font-claude-message"]',
        'div[data-testid="user-message"] + div'
      ],
      streaming: [
        '[data-test-render-count]',
        '[class*="streaming"]',
        '[class*="loading"]'
      ],
      spinner: [
        '.animate-spin',
        '[aria-busy="true"]',
        'svg[class*="animate-spin"]'
      ],
      stopButton: 'button[aria-label*="Stop"], button:has-text("Stop generating")',
      regenerateButton: 'button:has-text("Regenerate")',
      lastMessage: '[data-testid*="conversation"] > div:last-child',
      answerContainer: '[data-testid*="conversation"], [class*="conversation"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    gpt: {
      streamStart: [
        '[data-message-author-role="assistant"]:last-child',
        'div[class*="agent-turn"]:last-child'
      ],
      streaming: [
        '[data-message-author-role="assistant"]:last-child [class*="result-streaming"]',
        '.result-streaming',
        '[data-streaming="true"]'
      ],
      generatingIndicators: [
        '[data-streaming="true"]',
        '.result-streaming'
      ],
      completionIndicators: [
        '[data-streaming="false"]'
      ],
      spinner: [
        '[class*="loading"]',
        '[aria-busy="true"]',
        'svg[class*="animate-spin"]'
      ],
      stopButton: 'button[data-testid="stop-button"], button[aria-label*="Stop"]',
      regenerateButton: 'button[data-testid="regenerate-button"]',
      lastMessage: '[data-message-author-role="assistant"]:last-child',
      answerContainer: '[data-testid="conversation-turn"], main[class*="conversation"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    grok: {
      streamStart: [
        '[data-testid="message"]:last-child',
        '[role="article"]:last-child'
      ],
      streaming: [
        '[data-streaming="true"]',
        '[class*="typing"]',
        '.message-streaming'
      ],
      spinner: [
        '.spinner',
        '[aria-busy="true"]',
        'svg[class*="animate"]'
      ],
      stopButton: 'button[aria-label*="Stop"]',
      lastMessage: '[role="article"]:last-child, [data-testid="message"]:last-child',
      answerContainer: '[role="log"], [data-testid="conversation"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    perplexity: {
      streamStart: [
        '[class*="answer-container"] > div:last-child',
        'div[class*="prose"]:last-child'
      ],
      streaming: [
        '[class*="streaming"]',
        '.answer-streaming',
        '[data-generating="true"]'
      ],
      spinner: [
        'svg.fa-spinner',
        '.loading-indicator',
        '[aria-busy="true"]',
        '.animate-spin'
      ],
      stopButton: 'button[aria-label*="Stop"]',
      lastMessage: '[class*="answer-container"] > div:last-child',
      answerContainer: '[class*="answer-container"], main',
      copyButton: COPY_BUTTON_SELECTORS
    },
    gemini: {
      streamStart: [
        '[data-test-id*="model-response"]:last-child',
        '.model-response:last-child'
      ],
      streaming: [
        '[class*="streaming"]',
        '[data-streaming="true"]'
      ],
      generatingIndicators: [
        '[data-streaming="true"]'
      ],
      completionIndicators: [
        '[data-streaming="false"]'
      ],
      spinner: [
        '.spinner',
        '[aria-busy="true"]'
      ],
      stopButton: 'button[aria-label*="Stop"]',
      lastMessage: '[data-test-id*="model-response"]:last-child',
      answerContainer: '[role="main"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    deepseek: {
      streamStart: [
        '.message-item:last-child[data-role="assistant"]',
        'div[class*="assistant"]:last-child'
      ],
      streaming: [
        '[class*="streaming"]',
        '[data-generating="true"]'
      ],
      spinner: [
        '.loading',
        '[aria-busy="true"]'
      ],
      stopButton: 'button:has-text("Stop")',
      lastMessage: '.message-item:last-child[data-role="assistant"]',
      answerContainer: '.chat-content, [class*="conversation"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    qwen: {
      streamStart: [
        'div[class*="message-bot"]:last-child',
        '.message-bot:last-child'
      ],
      streaming: [
        '[class*="typing"]',
        '[data-status="generating"]'
      ],
      generatingIndicators: [
        '[data-status="generating"]'
      ],
      completionIndicators: [
        '[data-status="finished"]'
      ],
      spinner: [
        '.loading-icon',
        '[aria-busy="true"]'
      ],
      stopButton: 'button[class*="stop"]',
      lastMessage: 'div[class*="message-bot"]:last-child',
      answerContainer: '.chat-messages, [class*="conversation"]',
      copyButton: COPY_BUTTON_SELECTORS
    },
    lechat: {
      streamStart: [
        '[data-role="assistant"]:last-child',
        '.assistant-message:last-child'
      ],
      streaming: [
        '[class*="generating"]',
        '[data-streaming="true"]'
      ],
      generatingIndicators: [
        '[data-streaming="true"]',
        '[class*="generating"]'
      ],
      completionIndicators: [
        '[data-streaming="false"]'
      ],
      spinner: [
        '.spinner',
        '[aria-busy="true"]'
      ],
      stopButton: 'button:has-text("Stop")',
      lastMessage: '[data-role="assistant"]:last-child',
      answerContainer: '.messages-container',
      copyButton: COPY_BUTTON_SELECTORS
    },
    zai: {
      streamStart: ['.chat-assistant.markdown-prose', '[id^="message-"] .chat-assistant.markdown-prose', '[data-message-author-role="assistant"]', '[data-role="assistant"]', '[class*="assistant-message"]'],
      streaming: ['[data-streaming="true"]', '[data-generating="true"]', '.animate-pulse'],
      generatingIndicators: ['[data-streaming="true"]', '[data-generating="true"]'],
      completionIndicators: ['#send-message-button:not([disabled])'],
      spinner: ['[aria-busy="true"]', '.animate-pulse'],
      stopButton: 'button[aria-label*="Stop" i], button[class*="stop" i]',
      lastMessage: '.chat-assistant.markdown-prose, [id^="message-"] .chat-assistant.markdown-prose, [data-message-author-role="assistant"], [data-role="assistant"], [class*="assistant-message"]',
      answerContainer: '#chat-messages, [role="log"], body',
      copyButton: COPY_BUTTON_SELECTORS
    },
    generic: {
      streamStart: [
        '[role="article"]:last-child',
        '.message:last-child',
        'div[class*="message"]:last-child'
      ],
      streaming: [
        '[data-streaming]',
        '[class*="streaming"]',
        '[class*="generating"]',
        '[class*="typing"]'
      ],
      generatingIndicators: [],
      completionIndicators: [],
      spinner: [
        '[class*="spin"]',
        '[class*="loading"]',
        '[class*="loader"]',
        '[aria-busy="true"]',
        '[aria-live="polite"]'
      ],
      stopButton: 'button[aria-label*="Stop"], button[aria-label*="stop"]',
      lastMessage: null,
      answerContainer: '[role="log"], [role="main"], main',
      copyButton: COPY_BUTTON_SELECTORS
    }
  };

  function detectPlatform() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('claude.ai')) return 'claude';
    if (hostname.includes('openai.com') || hostname.includes('chatgpt.com')) return 'gpt';
    if (hostname.includes('x.ai')) return 'grok';
    if (hostname.includes('perplexity.ai')) return 'perplexity';
    if (hostname.includes('gemini.google.com')) return 'gemini';
    if (hostname.includes('deepseek.com')) return 'deepseek';
    if (hostname.includes('qwen.ai')) return 'qwen';
    if (hostname.includes('mistral.ai')) return 'lechat';
    if (hostname === 'chat.z.ai') return 'zai';
    return 'generic';
  }

  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS,
    detectPlatform
  };
})();
