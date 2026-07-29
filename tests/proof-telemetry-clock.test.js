const Clock = require('../shared/proof-telemetry-clock.js');

describe('proof telemetry clock contract', () => {
  test('same epoch comparison is exact and independent of wall time', () => {
    const left = { epochId: 'producer-a', monoMs: 10 };
    const right = { epochId: 'producer-a', monoMs: 35 };
    expect(Clock.compareClockPoints(left, right)).toEqual({ kind: 'exact', durationMs: 25 });
  });

  test('null monotonic values remain unavailable instead of becoming zero', () => {
    expect(Clock.point({ producerEpochId: 'producer-a', observedAtLocalMonoMs: null })).toBeNull();
    expect(Clock.point({ producerEpochId: 'producer-a' })).toBeNull();
  });

  test('cross epoch comparison requires a validated bridge', () => {
    const left = { epochId: 'producer-a', monoMs: 10 };
    const right = { epochId: 'producer-b', monoMs: 5 };
    expect(Clock.compareClockPoints(left, right)).toEqual({ kind: 'unavailable', reason: 'different_clock_epochs' });
    expect(Clock.compareClockPoints(left, right, {
      bridgeId: 'bridge-1', fromEpochId: 'producer-a', toEpochId: 'producer-b', lowerBoundMs: 20, upperBoundMs: 30
    })).toEqual({ kind: 'bounded', lowerBoundMs: 15, upperBoundMs: 25, bridgeId: 'bridge-1' });
  });

  test('threshold comparison is tri-state over bounds', () => {
    expect(Clock.thresholdAtLeast({ kind: 'exact', durationMs: 100 }, 100)).toBe(true);
    expect(Clock.thresholdAtLeast({ kind: 'bounded', lowerBoundMs: 100, upperBoundMs: 130 }, 100)).toBe(true);
    expect(Clock.thresholdAtLeast({ kind: 'bounded', lowerBoundMs: 20, upperBoundMs: 99 }, 100)).toBe(false);
    expect(Clock.thresholdAtLeast({ kind: 'bounded', lowerBoundMs: 90, upperBoundMs: 110 }, 100)).toBe('unknown');
    expect(Clock.thresholdAtLeast({ kind: 'unavailable' }, 100)).toBe('unknown');
  });

  test('signal coverage uses individual check times', () => {
    expect(Clock.signalCoverage({ generation: 100, candidate: 220, text: 300 }, 250))
      .toEqual({ status: 'reliable', maximumSignalSkewMs: 200, checkedSignalCount: 3 });
    expect(Clock.signalCoverage({ generation: 100, candidate: 500 }, 250).status).toBe('degraded');
    expect(Clock.signalCoverage({}, 250).status).toBe('unknown');
  });
});
