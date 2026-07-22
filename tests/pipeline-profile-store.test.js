const Profiles = require('../disput/debate-profile-schema');
const ProfileStore = require('../disput/pipeline-profile-store');

describe('Pipeline profile store', () => {
  test('lists built-ins and copies one into an editable versioned profile', async () => {
    const store = ProfileStore.createStore();
    expect(store.list().map((profile) => profile.id)).toContain('FREE_TALK_MVP');
    const copy = await store.copy('FREE_TALK_MVP', 'FREE_TALK_RESEARCH');
    expect(copy).toMatchObject({ id: 'FREE_TALK_RESEARCH', version: '0.1.0', status: 'draft', parentProfileId: 'FREE_TALK_MVP@0.2.0' });
    expect(Profiles.validate(copy)).toEqual({ ok: true, errors: [] });
  });

  test('imports valid custom profiles and ignores built-in replacements', async () => {
    const store = ProfileStore.createStore();
    const custom = { ...Profiles.BUILTIN_PROFILES.TRIAD_STANDARD, id: 'DEEP_RESEARCH', title: 'Deep Research', version: '0.1.0', status: 'draft', parentProfileId: 'TRIAD_STANDARD@1.0.0' };
    await store.importAll({ profiles: [{ ...Profiles.BUILTIN_PROFILES.DUEL_STANDARD, title: 'Tampered' }, custom] });
    expect(store.get('DUEL_STANDARD').title).toBe('Duel');
    expect(store.get('DEEP_RESEARCH').title).toBe('Deep Research');
    expect(store.compile('DEEP_RESEARCH', { problemSpec: { goal: 'Research' } }).profileId).toBe('DEEP_RESEARCH');
  });

  test('ships a thematic Deep Research extension without changing the base runtime contract', () => {
    const profile = Profiles.BUILTIN_PROFILES.DEEP_RESEARCH_ALPHA;
    expect(Profiles.validate(profile)).toEqual({ ok: true, errors: [] });
    expect(profile.parentProfileId).toBe('FREE_TALK_MVP@0.2.0');
    expect(profile.extensionContract).toMatchObject({
      artifactTypes: ['source', 'finding'], axes: ['source_quality', 'coverage'], tools: ['web_research']
    });
    expect(Profiles.compile(profile).extensionContract.mapSections).toEqual(['sources', 'findings']);
  });
});
