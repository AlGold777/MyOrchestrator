// background/api-fallback.js
// API fallback configuration + execution.

'use strict';

// --- V2.0 START: API Fallback Config ---
const API_CONNECTION_TIMEOUT_MS = 2000;
const API_RESPONSE_TIMEOUT_MS = 5000;

const apiFallbackConfig = {
  'GPT': {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4-turbo-preview',
    storageKey: 'apiKey_openai',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096
  },
  'Claude': {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-opus-20240229',
    storageKey: 'apiKey_anthropic',
    maxTokens: 4096,
    buildRequest: buildAnthropicRequest,
    parseResponse: parseAnthropicResponse
  },
  'Gemini': {
    endpoints: [
      {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
        model: 'gemini-1.5-flash-latest'
      },
      {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent',
        model: 'gemini-1.5-pro-latest'
      },
      {
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
        model: 'gemini-pro'
      }
    ],
    model: 'gemini-1.5-flash-latest',
    storageKey: 'apiKey_google',
    buildRequest: buildGeminiRequest,
    parseResponse: parseGeminiResponse
  },
  'Grok': {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-beta',
    storageKey: 'apiKey_grok',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096
  },
  'Le Chat': {
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-large-latest',
    storageKey: 'apiKey_lechat',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096,
    extraHeaders: { 'Accept': 'application/json' }
  },
  'Qwen': {
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-turbo',
    storageKey: 'apiKey_qwen',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096
  },
  'DeepSeek': {
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    storageKey: 'apiKey_deepseek',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096
  },
  'Perplexity': {
    endpoint: 'https://api.perplexity.ai/chat/completions',
    model: 'sonar-small-online',
    storageKey: 'apiKey_perplexity',
    buildRequest: buildOpenAICompatibleRequest,
    parseResponse: parseOpenAICompatibleResponse,
    maxTokens: 4096
  }
};

function getApiEndpointMeta(config) {
  if (!config) return null;
  if (Array.isArray(config.endpoints) && config.endpoints.length) {
    const idx = Math.min(config._activeEndpointIndex || 0, config.endpoints.length - 1);
    const entry = config.endpoints[idx] || config.endpoints[0];
    return {
      endpoint: entry?.url || config.endpoint,
      model: entry?.model || config.model,
      index: idx,
      hasNext: idx < config.endpoints.length - 1
    };
  }
  return {
    endpoint: config.endpoint,
    model: config.model,
    index: null,
    hasNext: false
  };
}

function advanceApiEndpoint(config) {
  if (!config || !Array.isArray(config.endpoints) || !config.endpoints.length) return false;
  const idx = config._activeEndpointIndex || 0;
  if (idx >= config.endpoints.length - 1) {
    return false;
  }
  config._activeEndpointIndex = idx + 1;
  return true;
}

function buildOpenAICompatibleRequest(prompt, apiKey, config = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(config.extraHeaders || {})
  };
  const body = {
    model: config.model,
    messages: [{ role: 'user', content: prompt }],
    ...(config.extraBody || {})
  };
  if (config.maxTokens) {
    body.max_tokens = config.maxTokens;
  }
  return {
    url: config.endpoint,
    method: 'POST',
    headers,
    body
  };
}

function parseOpenAICompatibleResponse(data = {}) {
  if (!data) return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return '';
  if (choice.message?.content) {
    return choice.message.content;
  }
  if (typeof choice.text === 'string') {
    return choice.text;
  }
  return '';
}

function buildAnthropicRequest(prompt, apiKey, config = {}) {
  return {
    url: config.endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: {
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      messages: [{ role: 'user', content: prompt }]
    }
  };
}

function parseAnthropicResponse(data = {}) {
  if (Array.isArray(data.content)) {
    return data.content
      .map(part => part?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  if (typeof data?.content?.text === 'string') {
    return data.content.text;
  }
  return data?.content?.[0]?.text || '';
}

function buildGeminiRequest(prompt, apiKey, config = {}) {
  return {
    url: `${config.endpoint}?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      contents: [{ parts: [{ text: prompt }] }]
    }
  };
}

function parseGeminiResponse(data = {}) {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  if (!candidate) return '';
  const parts = candidate.content?.parts || candidate.parts || [];
  if (Array.isArray(parts)) {
    return parts.map(part => part?.text || '').filter(Boolean).join('\n');
  }
  return '';
}

function formatApiDetails(config, meta = null) {
  const endpoint = meta?.endpoint || config?.endpoint || '';
  if (!endpoint) return '';
  return `Endpoint: ${endpoint} | Timeouts ${API_CONNECTION_TIMEOUT_MS}ms/${API_RESPONSE_TIMEOUT_MS}ms`;
}

function buildApiStatusData(config, overrides = {}, meta = null) {
  return {
    endpoint: meta?.endpoint || config?.endpoint || '',
    connectionTimeout: API_CONNECTION_TIMEOUT_MS,
    responseTimeout: API_RESPONSE_TIMEOUT_MS,
    ...overrides
  };
}

function logApiEvent(llmName, label, level, config, extraDetails = '', meta = null) {
  const baseDetails = formatApiDetails(config, meta);
  const details = extraDetails ? `${baseDetails} – ${extraDetails}` : baseDetails;
  broadcastDiagnostic(llmName, {
    type: 'API',
    label,
    details,
    level: level || 'info'
  });
}

function handleApiFailureNotice(llmName, config, reason, silentOnFailure, meta = null) {
  logApiEvent(llmName, 'API error, switching to web UI', 'api-error', config, reason || '', meta);
  updateModelState(llmName, 'API_FAILED', buildApiStatusData(config, {
    apiStatus: 'idle',
    message: 'API error, switching to web UI',
    details: reason || ''
  }, meta));
  if (!silentOnFailure) {
    handleLLMResponse(
      llmName,
      '',
      self.RunError.makeRunError(self.RunError.CODES.FALLBACK_FAILED, reason || 'API failure')
    );
  }
}
// --- V2.0 END: API Fallback Config ---

// --- V2.0 START: API Fallback Execution Logic ---
async function executeApiFallback(llmName, prompt, options = {}) {
  const { silentOnFailure = false, apiKeyOverride = null } = options;
  const config = apiFallbackConfig[llmName];
  if (!config || typeof config.buildRequest !== 'function' || typeof config.parseResponse !== 'function') {
    console.warn(`[API] No API configuration for ${llmName}`);
    return false;
  }

  let apiKey = apiKeyOverride;
  if (!apiKey) {
    const storedData = await chrome.storage.local.get(config.storageKey);
    apiKey = storedData?.[config.storageKey];
  }
  if (!apiKey) {
    console.warn(`[API] API key for ${llmName} not found.`);
    return false;
  }

  const endpointMeta = getApiEndpointMeta(config);
  if (!endpointMeta || !endpointMeta.endpoint) {
    console.warn(`[API] No endpoint metadata for ${llmName}`);
    return false;
  }

  globalThis.LLMLog?.debug?.(`[API] Executing direct API request for ${llmName}`);
  updateModelState(llmName, 'API_PENDING', buildApiStatusData(config, {
    apiStatus: 'pending',
    message: 'Connecting via API…'
  }, endpointMeta));
  logApiEvent(llmName, 'API request pending', 'info', config, '', endpointMeta);

  const requestConfig = config.buildRequest(prompt, apiKey, {
    ...config,
    endpoint: endpointMeta.endpoint,
    model: endpointMeta.model
  });
  if (!requestConfig || !requestConfig.url) {
    handleApiFailureNotice(llmName, config, 'Invalid request configuration', silentOnFailure, endpointMeta);
    return false;
  }

  const controller = new AbortController();
  let connectionTimedOut = false;
  const connectionTimer = setTimeout(() => {
    connectionTimedOut = true;
    controller.abort();
  }, API_CONNECTION_TIMEOUT_MS);

  const fetchInit = {
    method: requestConfig.method || 'POST',
    headers: requestConfig.headers || { 'Content-Type': 'application/json' },
    signal: controller.signal
  };

  if (typeof requestConfig.body !== 'undefined') {
    fetchInit.body = (typeof requestConfig.body === 'string' || requestConfig.skipStringify)
      ? requestConfig.body
      : JSON.stringify(requestConfig.body);
  }

  let response;
  try {
    response = await fetch(requestConfig.url, fetchInit);
  } catch (error) {
    clearTimeout(connectionTimer);
    const reason = connectionTimedOut
      ? `Connection timeout (${API_CONNECTION_TIMEOUT_MS}ms)`
      : (error?.message || 'Request failed');
    handleApiFailureNotice(llmName, config, reason, silentOnFailure, endpointMeta);
    return false;
  }
  clearTimeout(connectionTimer);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const message = `Status ${response.status}${errorBody ? ` – ${errorBody.slice(0, 120)}` : ''}`;
    if (response.status === 404 && advanceApiEndpoint(config)) {
      logApiEvent(llmName, 'Switching Gemini endpoint', 'warning', config, message, endpointMeta);
      return executeApiFallback(llmName, prompt, options);
    }
    handleApiFailureNotice(llmName, config, message, silentOnFailure, endpointMeta);
    return false;
  }

  const data = await new Promise((resolve, reject) => {
    let settled = false;
    const responseTimer = setTimeout(() => {
      if (!settled) {
        reject(new Error(`Response timeout (${API_RESPONSE_TIMEOUT_MS}ms)`));
      }
    }, API_RESPONSE_TIMEOUT_MS);
    response.json().then((payload) => {
      settled = true;
      clearTimeout(responseTimer);
      resolve(payload);
    }).catch((err) => {
      settled = true;
      clearTimeout(responseTimer);
      reject(err);
    });
  }).catch((error) => {
    handleApiFailureNotice(llmName, config, error?.message || 'Response parsing failed', silentOnFailure, endpointMeta);
    return null;
  });

  if (!data) {
    return false;
  }

  let answer = '';
  try {
    answer = config.parseResponse(data, prompt) || '';
  } catch (parseError) {
    handleApiFailureNotice(llmName, config, parseError?.message || 'API parse error', silentOnFailure, endpointMeta);
    return false;
  }

  if (!answer) {
    handleApiFailureNotice(llmName, config, 'Empty response payload', silentOnFailure, endpointMeta);
    return false;
  }

  logApiEvent(llmName, 'API success', 'api', config, '', endpointMeta);
  updateModelState(llmName, 'API_MODE', buildApiStatusData(config, {
    apiStatus: 'active',
    message: 'API success'
  }, endpointMeta));
  const entry = jobState?.llms?.[llmName] || null;
  handleLLMResponse(llmName, answer, null, {
    dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
    responseMeta: {
      source: 'api',
      answerSource: 'api',
      completionReason: 'api_response',
      apiProvider: llmName,
      apiModel: endpointMeta.model || config.model || null,
      apiEndpoint: endpointMeta.endpoint || config.endpoint || null
    }
  });
  return true;
}
// --- V2.0 END: API Fallback Execution Logic ---

self.API_CONNECTION_TIMEOUT_MS = API_CONNECTION_TIMEOUT_MS;
self.API_RESPONSE_TIMEOUT_MS = API_RESPONSE_TIMEOUT_MS;
self.apiFallbackConfig = apiFallbackConfig;
self.getApiEndpointMeta = getApiEndpointMeta;
self.advanceApiEndpoint = advanceApiEndpoint;
self.buildOpenAICompatibleRequest = buildOpenAICompatibleRequest;
self.parseOpenAICompatibleResponse = parseOpenAICompatibleResponse;
self.buildAnthropicRequest = buildAnthropicRequest;
self.parseAnthropicResponse = parseAnthropicResponse;
self.buildGeminiRequest = buildGeminiRequest;
self.parseGeminiResponse = parseGeminiResponse;
self.formatApiDetails = formatApiDetails;
self.buildApiStatusData = buildApiStatusData;
self.logApiEvent = logApiEvent;
self.handleApiFailureNotice = handleApiFailureNotice;
self.executeApiFallback = executeApiFallback;
