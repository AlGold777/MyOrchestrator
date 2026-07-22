// Purpose: shared retry/circuit breaker helpers for dispatch logic.
(function(global) {
  class TimeoutError extends Error {}
  class QueueFullError extends Error {}

  class RetryStrategy {
    constructor(options = {}) {
      this.maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : 5;
      this.baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 1000;
      this.maxDelayMs = Number.isFinite(options.maxDelayMs) ? options.maxDelayMs : 30000;
      this.jitterFactor = Number.isFinite(options.jitterFactor) ? options.jitterFactor : 0.3;
    }

    classifyError(error = {}) {
      const code = (error?.code || error?.type || error?.message || '').toString().toUpperCase();
      if (/AUTH|FORBIDDEN|INVALID_KEY|BANNED/.test(code)) {
        return 'PERMANENT';
      }
      if (/RATE_LIMIT|429|TOO_MANY/.test(code)) {
        return 'RATE_LIMITED';
      }
      if (/TIMEOUT|NETWORK|CONNECTION/.test(code)) {
        return 'TRANSIENT';
      }
      return 'UNKNOWN';
    }

    shouldRetry(attempt, error) {
      if (attempt >= this.maxAttempts) return false;
      return this.classifyError(error) !== 'PERMANENT';
    }

    getDelay(attempt, error) {
      const classification = this.classifyError(error);
      let delay = this.baseDelayMs * Math.pow(2, Math.max(attempt - 1, 0));
      if (classification === 'RATE_LIMITED') {
        delay = Math.min(delay * 2, this.maxDelayMs * 2);
      }
      const jitter = delay * this.jitterFactor * (Math.random() * 2 - 1);
      return Math.min(Math.max(Math.round(delay + jitter), this.baseDelayMs), this.maxDelayMs);
    }
  }

  const STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  class CircuitBreaker {
    constructor(options = {}) {
      this.failureThreshold = Number.isFinite(options.failureThreshold) ? options.failureThreshold : 5;
      this.recoveryTimeMs = Number.isFinite(options.recoveryTimeMs) ? options.recoveryTimeMs : 60000;
      this.state = STATES.CLOSED;
      this.failures = 0;
      this.lastFailureTime = 0;
      this.reopensAt = null;
    }

    canExecute() {
      if (this.state === STATES.CLOSED) return true;
      if (this.state === STATES.OPEN) {
        if (Date.now() >= (this.reopensAt || 0)) {
          this.state = STATES.HALF_OPEN;
          return true;
        }
        return false;
      }
      return true; // HALF_OPEN
    }

    recordSuccess() {
      this.state = STATES.CLOSED;
      this.failures = 0;
      this.reopensAt = null;
    }

    recordFailure() {
      this.failures += 1;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.failureThreshold) {
        this.state = STATES.OPEN;
        this.reopensAt = Date.now() + this.recoveryTimeMs;
      }
    }

    toJSON() {
      return {
        failures: this.failures,
        state: this.state,
        lastFailureTime: this.lastFailureTime,
        reopensAt: this.reopensAt,
        failureThreshold: this.failureThreshold,
        recoveryTimeMs: this.recoveryTimeMs
      };
    }

    static from(raw = {}) {
      const cb = new CircuitBreaker({
        failureThreshold: raw.failureThreshold,
        recoveryTimeMs: raw.recoveryTimeMs
      });
      cb.failures = Number.isFinite(raw.failures) ? raw.failures : 0;
      cb.state = raw.state || STATES.CLOSED;
      cb.lastFailureTime = Number.isFinite(raw.lastFailureTime) ? raw.lastFailureTime : 0;
      cb.reopensAt = Number.isFinite(raw.reopensAt) ? raw.reopensAt : null;
      return cb;
    }
  }

  global.RetryStrategy = RetryStrategy;
  global.CircuitBreaker = CircuitBreaker;
  global.TimeoutError = TimeoutError;
  global.QueueFullError = QueueFullError;
})(typeof self !== 'undefined' ? self : this);
