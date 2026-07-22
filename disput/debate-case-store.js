(function initDebateCaseStore(root) {
  'use strict';
  const Schema = root.DebateCaseSchema || (typeof require === 'function' ? require('./debate-case-schema') : null);
  const INDEX_KEY = 'disputDebateCaseIndexV1';
  const keyFor = (caseId) => `disputDebateCaseV1:${String(caseId)}`;
  const memory = new Map();

  function storageAdapter(storage) {
    if (storage?.get && storage?.set) return {
      async get(key) { const result = await storage.get(key); return result?.[key]; },
      async set(key, value) { await storage.set({ [key]: value }); },
      async remove(key) { await storage.remove?.(key); }
    };
    return {
      async get(key) { return memory.get(key); },
      async set(key, value) { memory.set(key, value); },
      async remove(key) { memory.delete(key); }
    };
  }

  function createStore(options = {}) {
    const storage = storageAdapter(options.storage);
    let active = null;
    const listeners = new Set();
    const emit = (event) => listeners.forEach((listener) => listener(active, event));
    const save = async (state = active) => {
      if (!state) return null;
      const verdict = Schema.validateCase(state);
      if (!verdict.ok) throw new Error(`Invalid Debate case: ${verdict.errors.join(', ')}`);
      await storage.set(keyFor(state.caseId), state);
      const index = Array.from(new Set([...(await storage.get(INDEX_KEY) || []), state.caseId]));
      await storage.set(INDEX_KEY, index);
      active = state; emit({ type: 'CASE_SAVED', caseId: state.caseId });
      return state;
    };
    return Object.freeze({
      getState: () => active,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async create(input) { active = Schema.createCase(input); await save(active); emit({ type: 'CASE_CREATED', caseId: active.caseId }); return active; },
      async apply(change) {
        if (!active) throw new Error('No active Debate case');
        const result = Schema.applyChange(active, change);
        if (!result.ok || result.duplicate) return result;
        active = result.state; await save(active); emit({ type: 'CASE_CHANGED', change: active.changes.at(-1) }); return { ...result, state: active };
      },
      async save() { return save(active); },
      async load(caseId) {
        const stored = await storage.get(keyFor(caseId));
        if (!stored) return null;
        const migrated = Number(stored.schemaVersion) === Schema.VERSION ? stored : Schema.migrate(stored);
        const verdict = Schema.validateCase(migrated);
        if (!verdict.ok) throw new Error(`Cannot restore Debate case: ${verdict.errors.join(', ')}`);
        active = migrated; emit({ type: 'CASE_LOADED', caseId }); return active;
      },
      async list() { return (await storage.get(INDEX_KEY) || []).slice(); },
      async remove(caseId) { await storage.remove(keyFor(caseId)); const next = (await storage.get(INDEX_KEY) || []).filter((id) => id !== caseId); await storage.set(INDEX_KEY, next); if (active?.caseId === caseId) active = null; emit({ type: 'CASE_REMOVED', caseId }); },
      exportCase: () => active ? JSON.stringify(active, null, 2) : '',
      async importCase(serialized) { const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized; const migrated = Number(parsed?.schemaVersion) === Schema.VERSION ? parsed : Schema.migrate(parsed); const verdict = Schema.validateCase(migrated); if (!verdict.ok) throw new Error(`Invalid imported Debate case: ${verdict.errors.join(', ')}`); active = migrated; return save(active); }
    });
  }

  const api = Object.freeze({ INDEX_KEY, keyFor, createStore });
  root.DebateCaseStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
