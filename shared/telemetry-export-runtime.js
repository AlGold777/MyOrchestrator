// Testable client-side orchestration for the telemetry export worker.
(function initTelemetryExportRuntime(root) {
  'use strict';

  const errorWithCode = (message, code) => {
    const error = new Error(message);
    error.code = code;
    return error;
  };

  function createWorkerClient(options = {}) {
    const workerFactory = options.workerFactory;
    const now = options.now || (() => root.performance?.now?.() || Date.now());
    const setTimer = options.setTimer || root.setTimeout.bind(root);
    const clearTimer = options.clearTimer || root.clearTimeout.bind(root);
    const overallTimeoutMs = Number(options.overallTimeoutMs || 20000);
    const stageDeadlinesMs = options.stageDeadlinesMs || {};
    const reportStageTimeoutMs = Number(options.reportStageTimeoutMs || 5000);
    let activeJob = null;

    const stageLimit = (stageName) => Number(stageDeadlinesMs[stageName]
      || (String(stageName).startsWith('report:') ? reportStageTimeoutMs : overallTimeoutMs));

    function build(events, buildOptions, artifactType, onStage) {
      if (typeof workerFactory !== 'function') {
        return Promise.reject(errorWithCode('telemetry export worker is unavailable', 'TELEMETRY_EXPORT_WORKER_UNAVAILABLE'));
      }
      activeJob?.cancel('superseded by a newer telemetry export');
      return new Promise((resolve, reject) => {
        const requestId = `telemetry-export-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        let worker;
        try {
          worker = workerFactory();
        } catch (error) {
          reject(errorWithCode(error?.message || 'telemetry export worker failed to start', 'TELEMETRY_EXPORT_WORKER_START_FAILED'));
          return;
        }
        const requestedAt = now();
        const stageTimings = {};
        let currentStage = 'cloning';
        let currentStageStartedAt = requestedAt;
        let settled = false;
        let stageTimeoutId = null;
        let overallTimeoutId = null;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimer(overallTimeoutId);
          clearTimer(stageTimeoutId);
          try { worker.terminate(); } catch (_) {}
          if (activeJob?.requestId === requestId) activeJob = null;
          callback(value);
        };
        const armStageDeadline = (stageName) => {
          clearTimer(stageTimeoutId);
          const limit = stageLimit(stageName);
          stageTimeoutId = setTimer(() => finish(reject, errorWithCode(
            `telemetry export stage ${stageName} exceeded ${limit} ms`,
            'TELEMETRY_EXPORT_STAGE_TIMEOUT'
          )), limit);
        };
        overallTimeoutId = setTimer(() => finish(reject, errorWithCode(
          `telemetry export exceeded ${overallTimeoutMs} ms`,
          'TELEMETRY_EXPORT_TIMEOUT'
        )), overallTimeoutMs);
        activeJob = {
          requestId,
          cancel: (reason = 'telemetry export cancelled') => finish(
            reject,
            errorWithCode(reason, 'TELEMETRY_EXPORT_CANCELLED')
          )
        };
        armStageDeadline(currentStage);
        worker.onmessage = (event) => {
          const message = event?.data || {};
          if (message.requestId !== requestId) return;
          if (message.type === 'stage') {
            const observedAt = now();
            stageTimings[currentStage] = Math.max(0, observedAt - currentStageStartedAt);
            currentStage = String(message.stage || 'unknown');
            currentStageStartedAt = observedAt;
            armStageDeadline(currentStage);
            try {
              onStage?.(message);
            } catch (error) {
              finish(reject, errorWithCode(error?.message || 'telemetry progress handler failed', 'TELEMETRY_EXPORT_PROGRESS_FAILED'));
            }
            return;
          }
          if (message.type === 'complete') {
            const observedAt = now();
            stageTimings[currentStage] = Math.max(0, observedAt - currentStageStartedAt);
            finish(resolve, { ...message, stageTimings, totalClientMs: Math.max(0, observedAt - requestedAt) });
            return;
          }
          if (message.type === 'error') {
            finish(reject, errorWithCode(message.error || 'telemetry export worker failed', message.code || 'TELEMETRY_EXPORT_WORKER_FAILED'));
          }
        };
        worker.onerror = (event) => finish(reject, errorWithCode(
          event?.message || 'telemetry export worker crashed',
          'TELEMETRY_EXPORT_WORKER_CRASHED'
        ));
        try {
          worker.postMessage({
            type: artifactType === 'canonical-evidence' ? 'BUILD_CANONICAL_EVIDENCE_JSON' : 'BUILD_FULL_TELEMETRY_JSON',
            requestId,
            events,
            options: buildOptions
          });
        } catch (error) {
          finish(reject, errorWithCode(error?.message || 'telemetry request cloning failed', 'TELEMETRY_EXPORT_POST_MESSAGE_FAILED'));
        }
      });
    }

    return Object.freeze({
      build,
      cancelActive: (reason) => activeJob?.cancel(reason),
      hasActiveJob: () => activeJob !== null
    });
  }

  function downloadSerializedArtifact(json, filename, options = {}) {
    if (!json || json === '{}') return null;
    const BlobCtor = options.BlobCtor || root.Blob;
    const urlApi = options.urlApi || root.URL;
    const documentRef = options.documentRef || root.document;
    const setTimer = options.setTimer || root.setTimeout.bind(root);
    const now = options.now || (() => root.performance?.now?.() || Date.now());
    const startedAt = now();
    const blob = new BlobCtor([json], { type: 'application/json' });
    const url = urlApi.createObjectURL(blob);
    try {
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } finally {
      setTimer(() => urlApi.revokeObjectURL(url), Number(options.cleanupDelayMs ?? 1000));
    }
    return { blobBytes: blob.size, blobDownloadMs: Math.max(0, now() - startedAt) };
  }

  async function executeWithRecovery({ build, download, recover }) {
    try {
      const built = await build();
      return { status: 'completed', built, downloadResult: await download(built) };
    } catch (error) {
      if (error?.code === 'TELEMETRY_EXPORT_CANCELLED') return { status: 'cancelled', error };
      return { status: 'recovered', error, recoveryResult: await recover(error) };
    }
  }

  const api = Object.freeze({ createWorkerClient, downloadSerializedArtifact, executeWithRecovery });
  root.TelemetryExportRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
