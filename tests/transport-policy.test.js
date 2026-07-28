const ModelPolicy = require('../shared/model-policy');
global.ModelPolicy = ModelPolicy;
const TransportPolicy = require('../shared/transport-policy');

describe('TransportPolicy Lite', () => {
  afterAll(() => {
    delete global.ModelPolicy;
  });

  test('selects API-first only when API mode, config and key are all available', () => {
    const decision = TransportPolicy.decideTransport({
      llmName: 'GPT',
      apiModeEnabled: true,
      hasApiConfig: true,
      hasApiKey: true,
      hasWebUi: true
    });

    expect(decision).toEqual(expect.objectContaining({
      schemaVersion: 1,
      llmName: 'GPT',
      mode: TransportPolicy.MODES.API_FIRST,
      reason: 'api_key_available',
      apiEligible: true,
      webUiEligible: true
    }));
  });

  test('falls back to Web UI when API key is missing but UI transport exists', () => {
    const decision = TransportPolicy.decideTransport({
      llmName: 'Gemini',
      apiModeEnabled: true,
      hasApiConfig: true,
      hasApiKey: false,
      hasWebUi: true
    });

    expect(decision).toEqual(expect.objectContaining({
      mode: TransportPolicy.MODES.WEB_UI,
      reason: 'api_key_missing_use_web_ui',
      apiEligible: false,
      webUiEligible: true
    }));
  });

  test('does not use API direct when attachments are present and policy lacks attachment support', () => {
    const decision = TransportPolicy.decideTransport({
      llmName: 'Claude',
      apiModeEnabled: true,
      hasApiConfig: true,
      hasApiKey: true,
      hasWebUi: true,
      attachmentsCount: 2
    });

    expect(decision).toEqual(expect.objectContaining({
      mode: TransportPolicy.MODES.WEB_UI,
      reason: 'api_attachments_unsupported',
      apiEligible: false,
      attachmentsCount: 2,
      apiSupportsAttachments: false
    }));
  });

  test('reports blocked when neither API nor Web UI can execute the request', () => {
    const decision = TransportPolicy.decideTransport({
      llmName: 'Qwen',
      apiModeEnabled: true,
      hasApiConfig: false,
      hasApiKey: false,
      hasWebUi: false
    });

    expect(decision).toEqual(expect.objectContaining({
      mode: TransportPolicy.MODES.BLOCKED,
      reason: 'no_transport_available',
      apiEligible: false,
      webUiEligible: false
    }));
  });

  test('enables API transport only when feature flag is exactly true', () => {
    expect(TransportPolicy.isApiTransportEnabled(true)).toBe(true);
    expect(TransportPolicy.isApiTransportEnabled(false)).toBe(false);
    expect(TransportPolicy.isApiTransportEnabled('true')).toBe(false);
    expect(TransportPolicy.isApiTransportEnabled(undefined)).toBe(false);
  });
});
