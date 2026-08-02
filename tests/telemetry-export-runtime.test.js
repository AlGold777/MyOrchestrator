const Runtime = require('../shared/telemetry-export-runtime.js');

class FakeWorker {
  constructor({ postMessageError = null } = {}) {
    this.postMessageError = postMessageError;
    this.terminated = false;
    this.request = null;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(request) {
    if (this.postMessageError) throw this.postMessageError;
    this.request = request;
  }

  terminate() {
    this.terminated = true;
  }

  message(value) {
    this.onmessage?.({ data: { requestId: this.request.requestId, ...value } });
  }

  crash(message = 'worker crashed') {
    this.onerror?.({ message });
  }
}

describe('telemetry export runtime', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function harness(options = {}) {
    const workers = [];
    const client = Runtime.createWorkerClient({
      workerFactory: () => {
        const worker = new FakeWorker(options.workerOptions);
        workers.push(worker);
        return worker;
      },
      now: () => Date.now(),
      overallTimeoutMs: options.overallTimeoutMs || 100,
      stageDeadlinesMs: options.stageDeadlinesMs || { cloning: 50, building: 50 },
      reportStageTimeoutMs: 50
    });
    return { client, workers };
  }

  test('completes, records stages, terminates the worker and clears active state', async () => {
    const { client, workers } = harness();
    const promise = client.build([{ seq: 1 }], {}, 'canonical-evidence');
    workers[0].message({ type: 'stage', stage: 'building' });
    jest.advanceTimersByTime(5);
    workers[0].message({ type: 'complete', json: '{"ok":true}', elapsedMs: 5 });
    await expect(promise).resolves.toEqual(expect.objectContaining({ json: '{"ok":true}' }));
    expect(workers[0].terminated).toBe(true);
    expect(client.hasActiveJob()).toBe(false);
  });

  test('a second export cancels and terminates the first one', async () => {
    const { client, workers } = harness();
    const first = client.build([], {}, 'full-forensic').catch((error) => error);
    const second = client.build([], {}, 'canonical-evidence');
    await expect(first).resolves.toEqual(expect.objectContaining({ code: 'TELEMETRY_EXPORT_CANCELLED' }));
    expect(workers[0].terminated).toBe(true);
    workers[1].message({ type: 'complete', json: '{"second":true}' });
    await expect(second).resolves.toEqual(expect.objectContaining({ json: '{"second":true}' }));
  });

  test('stage deadline terminates a hanging worker', async () => {
    const { client, workers } = harness({ stageDeadlinesMs: { cloning: 10 }, overallTimeoutMs: 100 });
    const promise = client.build([], {}, 'full-forensic');
    jest.advanceTimersByTime(10);
    await expect(promise).rejects.toEqual(expect.objectContaining({ code: 'TELEMETRY_EXPORT_STAGE_TIMEOUT' }));
    expect(workers[0].terminated).toBe(true);
  });

  test('overall deadline terminates a worker even when stage deadline is longer', async () => {
    const { client, workers } = harness({ stageDeadlinesMs: { cloning: 100 }, overallTimeoutMs: 20 });
    const promise = client.build([], {}, 'full-forensic');
    jest.advanceTimersByTime(20);
    await expect(promise).rejects.toEqual(expect.objectContaining({ code: 'TELEMETRY_EXPORT_TIMEOUT' }));
    expect(workers[0].terminated).toBe(true);
  });

  test('worker crash rejects and terminates immediately', async () => {
    const { client, workers } = harness();
    const promise = client.build([], {}, 'canonical-evidence');
    workers[0].crash('synthetic crash');
    await expect(promise).rejects.toEqual(expect.objectContaining({ code: 'TELEMETRY_EXPORT_WORKER_CRASHED' }));
    expect(workers[0].terminated).toBe(true);
  });

  test('synchronous postMessage failure cannot leak the worker or active job', async () => {
    const { client, workers } = harness({ workerOptions: { postMessageError: new Error('clone failed') } });
    await expect(client.build([], {}, 'canonical-evidence'))
      .rejects.toEqual(expect.objectContaining({ code: 'TELEMETRY_EXPORT_POST_MESSAGE_FAILED' }));
    expect(workers[0].terminated).toBe(true);
    expect(client.hasActiveJob()).toBe(false);
  });

  test('failure executes canonical recovery while cancellation does not', async () => {
    const recover = jest.fn(async () => ({ downloaded: 'canonical-recovery.json' }));
    const failed = Object.assign(new Error('boom'), { code: 'TELEMETRY_EXPORT_WORKER_CRASHED' });
    await expect(Runtime.executeWithRecovery({
      build: async () => { throw failed; },
      download: jest.fn(),
      recover
    })).resolves.toEqual(expect.objectContaining({ status: 'recovered' }));
    expect(recover).toHaveBeenCalledWith(failed);

    recover.mockClear();
    const cancelled = Object.assign(new Error('cancelled'), { code: 'TELEMETRY_EXPORT_CANCELLED' });
    await expect(Runtime.executeWithRecovery({
      build: async () => { throw cancelled; },
      download: jest.fn(),
      recover
    })).resolves.toEqual(expect.objectContaining({ status: 'cancelled' }));
    expect(recover).not.toHaveBeenCalled();
  });

  test('download clicks an anchor and revokes the Blob URL', () => {
    const anchor = { click: jest.fn() };
    const urlApi = { createObjectURL: jest.fn(() => 'blob:test'), revokeObjectURL: jest.fn() };
    class BlobStub {
      constructor(parts) { this.size = parts.join('').length; }
    }
    const result = Runtime.downloadSerializedArtifact('{"ok":true}', 'telemetry.json', {
      BlobCtor: BlobStub,
      urlApi,
      documentRef: { createElement: () => anchor },
      setTimer: setTimeout,
      now: () => 1,
      cleanupDelayMs: 10
    });
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('telemetry.json');
    expect(result.blobBytes).toBe(11);
    jest.advanceTimersByTime(10);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
