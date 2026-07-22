// SafeMutex ensures serialized access with queue limits and timeouts.
(function(global) {
  class QueueFullError extends Error {
    constructor(message = 'Mutex queue limit exceeded.') {
      super(message);
      this.name = 'QueueFullError';
    }
  }

  class TimeoutError extends Error {
    constructor(message = 'Mutex task timed out.') {
      super(message);
      this.name = 'TimeoutError';
    }
  }

  class SafeMutex {
    constructor(options = {}) {
      this._locked = false;
      this._queue = [];
      this._defaultTimeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
      this._defaultQueueLimit = Number.isFinite(options.queueLimit) ? options.queueLimit : 10;
    }

    runExclusive(fn, options = {}) {
      const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this._defaultTimeoutMs;
      const queueLimit = Number.isFinite(options.queueLimit) ? options.queueLimit : this._defaultQueueLimit;
      if (this._locked && this._queue.length >= queueLimit) {
        return Promise.reject(new QueueFullError(`Mutex queue limit exceeded (${queueLimit}).`));
      }
      return new Promise((resolve, reject) => {
        const entry = { fn, resolve, reject, timeoutMs };
        if (this._locked) {
          this._queue.push(entry);
          return;
        }
        this._locked = true;
        this._execute(entry);
      });
    }

    acquire(fn, options = {}) {
      return this.runExclusive(fn, options);
    }

    _execute(entry) {
      let settled = false;
      let timeoutId = null;
      const clearTimer = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };
      const resolveOnce = (value) => {
        if (settled) return;
        settled = true;
        clearTimer();
        entry.resolve(value);
      };
      const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        clearTimer();
        entry.reject(err);
      };
      if (Number.isFinite(entry.timeoutMs) && entry.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          rejectOnce(new TimeoutError(`Mutex task timed out after ${entry.timeoutMs}ms.`));
        }, entry.timeoutMs);
      }
      let result;
      try {
        result = entry.fn();
      } catch (err) {
        rejectOnce(err);
        this._release();
        return;
      }
      Promise.resolve(result)
        .then(resolveOnce, rejectOnce)
        .finally(() => this._release());
    }

    _release() {
      this._locked = false;
      if (!this._queue.length) return;
      const next = this._queue.shift();
      this._locked = true;
      this._execute(next);
    }
  }

  class MutexManager {
    constructor() {
      this._mutexes = new Map();
    }

    async withLock(key, fn, options = {}) {
      if (!this._mutexes.has(key)) {
        this._mutexes.set(key, new SafeMutex());
      }
      return this._mutexes.get(key).runExclusive(fn, options);
    }

    clear(key) {
      this._mutexes.delete(key);
    }
  }

  global.SafeMutex = SafeMutex;
  global.MutexManager = MutexManager;
  global.QueueFullError = QueueFullError;
  global.TimeoutError = TimeoutError;
})(typeof self !== 'undefined' ? self : this);
