global.self = global;
global.chrome = {
  storage: {
    session: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}), remove: jest.fn(async () => {}) },
    local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}), remove: jest.fn(async () => {}) }
  }
};

require('../utils/retry-strategy');
require('../background/dispatch-retry');

describe('unified dispatch circuit breaker', () => {
  test('opens after three failures for five minutes', () => {
    const llm = `GPT-${Date.now()}`;
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    expect(self.DispatchCircuit.canDispatchWithCircuit(llm).ok).toBe(true);
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    const gate = self.DispatchCircuit.canDispatchWithCircuit(llm);
    expect(gate.ok).toBe(false);
    expect(gate.retryAfterMs).toBeGreaterThan(290000);
  });

  test('success closes circuit and resets failures', () => {
    const llm = `Claude-${Date.now()}`;
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    self.DispatchCircuit.recordDispatchSuccess(llm);
    const breaker = self.DispatchCircuit.getDispatchCircuitBreaker(llm);
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.failures).toBe(0);
  });

  test('new run can move open circuit to half-open', () => {
    const llm = `Gemini-${Date.now()}`;
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    self.DispatchCircuit.recordDispatchFailure(llm, {});
    self.allowCircuitHalfOpenForNewRun([llm]);
    const breaker = self.DispatchCircuit.getDispatchCircuitBreaker(llm);
    expect(breaker.state).toBe('HALF_OPEN');
  });
});
