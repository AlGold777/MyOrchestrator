const Profiles = require('../disput/debate-profile-schema');
const ProfileStore = require('../disput/pipeline-profile-store');

describe('universal pipeline profile store', () => {
  test('lists built-ins and copies one into an editable versioned profile', async () => {
    const store = ProfileStore.createStore();
    expect(store.list().map((profile) => profile.id)).toContain('UNIVERSAL_STANDARD');
    const copy = await store.copy('UNIVERSAL_RESEARCH', 'CUSTOM_RESEARCH');
    expect(copy).toMatchObject({ id: 'CUSTOM_RESEARCH', version: '0.1.0', status: 'draft', parentProfileId: 'UNIVERSAL_RESEARCH@1.0.0' });
    expect(Profiles.validate(copy).ok).toBe(true);
  });

  test('imports custom profiles but protects built-ins', async () => {
    const store = ProfileStore.createStore();
    const custom = { ...Profiles.BUILTIN_PROFILES.UNIVERSAL_RESEARCH, id: 'CUSTOM', title: 'Custom', version: '0.1.0', status: 'draft' };
    await store.importAll({ profiles: [{ ...Profiles.BUILTIN_PROFILES.UNIVERSAL_STANDARD, title: 'Tampered' }, custom] });
    expect(store.get('UNIVERSAL_STANDARD').title).toBe('Universal');
    expect(store.compile('CUSTOM', { problemSpec: { goal: 'Research' } }).profileId).toBe('CUSTOM');
  });

  test('ships a deep research extension on the same runtime contract', () => {
    const profile = Profiles.BUILTIN_PROFILES.DEEP_RESEARCH_ALPHA;
    expect(Profiles.validate(profile).ok).toBe(true);
    expect(profile.parentProfileId).toBe('UNIVERSAL_RESEARCH@1.0.0');
    expect(Profiles.compile(profile).extensionContract.mapSections).toEqual(['sources', 'findings']);
  });
});
