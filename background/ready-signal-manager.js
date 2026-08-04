// background/ready-signal-manager.js
// Event-driven readiness tracking for content scripts.

'use strict';

const ReadySignalManager = {
  _readyTabs: new Map(), // tabId -> info
  _pendingWaiters: new Map(), // tabId -> [{ resolve, reject, timeoutId, startedAt }]
  _ackTabs: new Map(), // tabId -> ack info
  _pendingAckWaiters: new Map(), // tabId -> [{ resolve, reject, timeoutId, expectedSessionId }]

  waitForReady(tabId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!Number.isInteger(tabId) || tabId <= 0) {
        reject(new Error('invalid_tab_id'));
        return;
      }
      if (this._readyTabs.has(tabId)) {
        resolve(this._readyTabs.get(tabId));
        return;
      }
      const waiters = this._pendingWaiters.get(tabId) || [];
      this._pendingWaiters.set(tabId, waiters);
      const timeoutId = setTimeout(() => {
        this._removeWaiter(tabId, waiter);
        reject(new Error(`Script ready timeout for tab ${tabId} after ${timeoutMs}ms`));
      }, timeoutMs);
      const waiter = { resolve, reject, timeoutId, startedAt: Date.now() };
      waiters.push(waiter);
      globalThis.LLMLog?.debug?.(`[READY] Waiting for tab ${tabId} (${timeoutMs}ms)`);
    });
  },

  handleReadySignal(tabId, llmName, extra = {}) {
    if (!Number.isInteger(tabId) || tabId <= 0) return null;
    const info = {
      llmName: llmName || null,
      readyAt: Date.now(),
      version: extra.version,
      url: extra.url,
      tabSessionId: extra.tabSessionId || null
    };
    this._readyTabs.set(tabId, info);
    const waiters = this._pendingWaiters.get(tabId);
    if (waiters && waiters.length) {
      waiters.forEach((entry) => {
        clearTimeout(entry.timeoutId);
        entry.resolve(info);
      });
      this._pendingWaiters.delete(tabId);
    }
    globalThis.LLMLog?.debug?.(`[READY] Tab ${tabId} ready`, info);
    return info;
  },

  markAcked(tabId, payload = {}) {
    if (!Number.isInteger(tabId) || tabId <= 0) return;
    const ackInfo = {
      llmName: payload.llmName || null,
      tabSessionId: payload.tabSessionId || null,
      dispatchId: payload.dispatchId || null,
      ackAt: payload.ackAt || Date.now()
    };
    this._ackTabs.set(tabId, ackInfo);
    const waiters = this._pendingAckWaiters.get(tabId);
    if (waiters && waiters.length) {
      waiters.forEach((entry) => {
        if (entry.expectedSessionId && ackInfo.tabSessionId && entry.expectedSessionId !== ackInfo.tabSessionId) {
          return;
        }
        clearTimeout(entry.timeoutId);
        entry.resolve(ackInfo);
      });
      this._pendingAckWaiters.delete(tabId);
    }
  },

  waitForAck(tabId, expectedSessionId = null, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (!Number.isInteger(tabId) || tabId <= 0) {
        reject(new Error('invalid_tab_id'));
        return;
      }
      const existing = this._ackTabs.get(tabId);
      if (existing) {
        if (!expectedSessionId || !existing.tabSessionId || existing.tabSessionId === expectedSessionId) {
          resolve(existing);
          return;
        }
      }
      const waiters = this._pendingAckWaiters.get(tabId) || [];
      this._pendingAckWaiters.set(tabId, waiters);
      const timeoutId = setTimeout(() => {
        this._removeAckWaiter(tabId, waiter);
        reject(new Error(`Ack timeout for tab ${tabId} after ${timeoutMs}ms`));
      }, timeoutMs);
      const waiter = { resolve, reject, timeoutId, expectedSessionId };
      waiters.push(waiter);
    });
  },

  getReadyInfo(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) return null;
    return this._readyTabs.get(tabId) || null;
  },

  getAckInfo(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) return null;
    return this._ackTabs.get(tabId) || null;
  },

  hasCorrelatedHandshake(tabId) {
    const readyInfo = this.getReadyInfo(tabId);
    const ackInfo = this.getAckInfo(tabId);
    if (!readyInfo || !ackInfo) return false;
    return !readyInfo.tabSessionId
      || !ackInfo.tabSessionId
      || readyInfo.tabSessionId === ackInfo.tabSessionId;
  },

  handleTabClosed(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) return;
    this._readyTabs.delete(tabId);
    this._ackTabs.delete(tabId);
    const waiters = this._pendingWaiters.get(tabId);
    if (waiters && waiters.length) {
      waiters.forEach((entry) => {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error(`Tab ${tabId} closed before ready`));
      });
      this._pendingWaiters.delete(tabId);
    }
    const ackWaiters = this._pendingAckWaiters.get(tabId);
    if (ackWaiters && ackWaiters.length) {
      ackWaiters.forEach((entry) => {
        clearTimeout(entry.timeoutId);
        entry.reject(new Error(`Tab ${tabId} closed before ack`));
      });
      this._pendingAckWaiters.delete(tabId);
    }
  },

  markTabNotReady(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) return;
    this._readyTabs.delete(tabId);
    this._ackTabs.delete(tabId);
  },

  _removeWaiter(tabId, waiter) {
    const waiters = this._pendingWaiters.get(tabId);
    if (!waiters) return;
    const next = waiters.filter((entry) => entry !== waiter);
    if (next.length) {
      this._pendingWaiters.set(tabId, next);
    } else {
      this._pendingWaiters.delete(tabId);
    }
  },

  _removeAckWaiter(tabId, waiter) {
    const waiters = this._pendingAckWaiters.get(tabId);
    if (!waiters) return;
    const next = waiters.filter((entry) => entry !== waiter);
    if (next.length) {
      this._pendingAckWaiters.set(tabId, next);
    } else {
      this._pendingAckWaiters.delete(tabId);
    }
  }
};

self.ReadySignalManager = ReadySignalManager;

globalThis.LLMLog?.debug?.('[ReadySignalManager] Module loaded');
