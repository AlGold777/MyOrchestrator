// Utility: bounded cache that evicts stale entries without background timers.
(function(global) {
  class TTLMap {
    constructor(options = {}) {
      this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 30 * 60 * 1000;
      this.maxSize = Number.isFinite(options.maxSize) ? options.maxSize : 500;
      this.touchOnGet = options.touchOnGet !== false;
      this.sweepPerOp = Number.isFinite(options.sweepPerOp) ? options.sweepPerOp : 10;
      this._map = new Map();
      this._timestamps = new Map();
    }

    set(key, value) {
      this._lazyCleanup(this.sweepPerOp);
      if (this._map.size >= this.maxSize && !this._map.has(key)) {
        this._evictOldest();
      }
      this._map.set(key, value);
      this._timestamps.set(key, Date.now());
      return this;
    }

    get(key) {
      if (!this._map.has(key)) return undefined;
      this._lazyCleanup(this.sweepPerOp);
      this._cleanupStaleKey(key);
      if (!this._map.has(key)) return undefined;
      const value = this._map.get(key);
      if (this.touchOnGet) {
        this._timestamps.set(key, Date.now());
      }
      return value;
    }

    has(key) {
      if (!this._map.has(key)) return false;
      this._lazyCleanup(this.sweepPerOp);
      this._cleanupStaleKey(key);
      return this._map.has(key);
    }

    delete(key) {
      this._map.delete(key);
      this._timestamps.delete(key);
    }

    clear() {
      this._map.clear();
      this._timestamps.clear();
    }

    get size() {
      return this._map.size;
    }

    keys() {
      return this._map.keys();
    }

    values() {
      return this._map.values();
    }

    entries() {
      return this._map.entries();
    }

    forEach(cb) {
      this._map.forEach(cb);
    }

    _cleanupStaleKey(key) {
      if (!this._map.has(key)) return;
      const ts = this._timestamps.get(key);
      if (ts && (Date.now() - ts) > this.ttlMs) {
        this.delete(key);
      }
    }

    _lazyCleanup(limit = 10) {
      if (!this._timestamps.size) return;
      const now = Date.now();
      const expired = [];
      for (const [key, ts] of this._timestamps) {
        if ((now - ts) > this.ttlMs) {
          expired.push([key, ts]);
        }
      }
      if (!expired.length) return;
      expired.sort((a, b) => a[1] - b[1]);
      const slice = expired.slice(0, Math.max(0, limit));
      slice.forEach(([key]) => this.delete(key));
    }

    _evictOldest() {
      let oldestKey = null;
      let oldestTs = Infinity;
      for (const [key, ts] of this._timestamps) {
        if (ts < oldestTs) {
          oldestTs = ts;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.delete(oldestKey);
      }
    }
  }

  global.TTLMap = TTLMap;
})(typeof self !== 'undefined' ? self : this);
