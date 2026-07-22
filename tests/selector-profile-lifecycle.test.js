const SelectorProfileLifecycle = require('../shared/selector-profile-lifecycle');

describe('SelectorProfileLifecycle', () => {
  test('keeps healthy profile on current selectors', () => {
    expect(SelectorProfileLifecycle.decide({
      profileStatus: 'healthy',
      activeUiVersion: 'v3'
    })).toEqual(expect.objectContaining({
      status: 'healthy',
      action: 'use_current',
      exactEnabled: true,
      cacheEnabled: true,
      selectedVersion: 'v3'
    }));
  });

  test('routes broken profile with last known good to rollback decision', () => {
    expect(SelectorProfileLifecycle.decide({
      profileStatus: 'broken',
      activeUiVersion: 'v4',
      lastKnownGoodVersion: 'v3'
    })).toEqual(expect.objectContaining({
      status: 'broken',
      action: 'rollback_to_last_known_good',
      exactEnabled: false,
      cacheEnabled: false,
      rollbackRequired: true,
      selectedVersion: 'v3'
    }));
  });

  test('routes broken profile without last known good to fallback only', () => {
    expect(SelectorProfileLifecycle.decide({
      profileStatus: 'broken'
    })).toEqual(expect.objectContaining({
      status: 'broken',
      action: 'fallback_only',
      exactEnabled: false,
      cacheEnabled: false,
      fallbackOnly: true,
      selectedVersion: null
    }));
  });
});
