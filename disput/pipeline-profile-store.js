(function initPipelineProfileStore(root) {
  'use strict';
  const Schema = root.DebateProfileSchema || (typeof require === 'function' ? require('./debate-profile-schema') : null);
  const STORAGE_KEY = 'disputPipelineProfilesV1';
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function createStore(options = {}) {
    const storage = options.storage;
    let custom = {};
    const listeners = new Set();
    const readStorage = async () => storage?.get ? (await storage.get(STORAGE_KEY))?.[STORAGE_KEY] : null;
    const writeStorage = async () => { if (storage?.set) await storage.set({ [STORAGE_KEY]: custom }); };
    const emit = () => listeners.forEach((listener) => listener(api.list()));
    const api = Object.freeze({
      async restore() { const stored = clone(await readStorage() || {}); custom = Object.fromEntries(Object.entries(stored).map(([id, profile]) => [id, Schema.migrate?.(profile) || profile])); await writeStorage(); emit(); return api.list(); },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      list() { return [...Object.values(Schema.BUILTIN_PROFILES), ...Object.values(custom)].map(clone); },
      get(id) { return clone(custom[id] || Schema.BUILTIN_PROFILES[id] || null); },
      async save(profile) {
        const migrated = Schema.migrate?.(profile) || profile;
        const verdict = Schema.validate(migrated);
        if (!verdict.ok) throw new Error(`Invalid pipeline profile: ${verdict.errors.join(', ')}`);
        if (Schema.BUILTIN_PROFILES[migrated.id]) throw new Error('Built-in profile is read-only; copy it first');
        custom[migrated.id] = clone(migrated); await writeStorage(); emit(); return api.get(migrated.id);
      },
      async copy(sourceId, nextId) {
        const source = api.get(sourceId); if (!source) throw new Error('Profile not found');
        const id = String(nextId || `${source.id}_COPY`).trim();
        const copy = { ...source, id, version: '0.1.0', status: 'draft', parentProfileId: `${source.id}@${source.version}`, title: `${source.title} copy` };
        return api.save(copy);
      },
      async remove(id) { delete custom[id]; await writeStorage(); emit(); },
      exportAll() { return JSON.stringify({ schemaVersion: Schema.VERSION, profiles: api.list() }, null, 2); },
      async importAll(serialized) {
        const payload = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
        const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
        for (const profile of profiles) {
          if (Schema.BUILTIN_PROFILES[profile.id]) continue;
          const migrated = Schema.migrate?.(profile) || profile;
          const verdict = Schema.validate(migrated); if (!verdict.ok) throw new Error(`Invalid profile ${profile.id}: ${verdict.errors.join(', ')}`);
          custom[migrated.id] = clone(migrated);
        }
        await writeStorage(); emit(); return api.list();
      },
      compile(id, input) { const profile = api.get(id); if (!profile) throw new Error('Profile not found'); return Schema.compile(profile, input); }
    });
    return api;
  }
  const api = Object.freeze({ STORAGE_KEY, createStore });
  root.PipelineProfileStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
