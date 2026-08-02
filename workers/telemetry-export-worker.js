// Build and serialize large telemetry artifacts away from the results-page UI.
'use strict';

importScripts(
  '../shared/proof-telemetry-contracts.js',
  '../shared/proof-telemetry-inventory.js',
  '../shared/proof-telemetry-clock.js',
  '../shared/proof-telemetry-incidents.js',
  '../shared/proof-oriented-telemetry.js',
  '../shared/proof-telemetry-policy.js',
  '../shared/proof-telemetry-audit.js',
  '../shared/secret-redaction.js'
);

const stage = (requestId, name, startedAt) => {
  self.postMessage({ type: 'stage', requestId, stage: name, elapsedMs: Date.now() - startedAt });
};

self.onmessage = async (event) => {
  const request = event?.data || {};
  if (request.type !== 'BUILD_FULL_TELEMETRY_JSON') return;
  const requestId = String(request.requestId || 'telemetry-export');
  const startedAt = Date.now();
  try {
    stage(requestId, 'building', startedAt);
    const payload = await self.ProofOrientedTelemetry.buildAllPresets(
      Array.isArray(request.events) ? request.events : [],
      request.options || {}
    );
    stage(requestId, 'serializing', startedAt);
    const json = self.SecretRedaction.stringifySafe(payload);
    if (!json || json === '{}') throw new Error('telemetry serialization returned an empty document');
    self.postMessage({
      type: 'complete',
      requestId,
      json,
      elapsedMs: Date.now() - startedAt,
      characterCount: json.length
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: String(error?.message || error || 'telemetry worker failed'),
      elapsedMs: Date.now() - startedAt
    });
  }
};
