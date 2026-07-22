const StateMap = require('../disput/debate-state-map');

const markup = () => `<section id="disput-state-map-panel"><button data-map-collapse aria-expanded="false"><span><strong data-map-title></strong><small data-map-summary></small></span></button><div class="disput-state-map-workspace" hidden><header><span data-map-summary></span><button data-map-mode="structure"></button><button data-map-mode="graf"></button><button data-map-export></button><button data-map-close></button><select data-map-run><option value=""></option></select></header><div><button data-map-filter="all"></button><button data-map-filter="open"></button><button data-map-filter="blocking"></button><button data-map-filter="dissent"></button><input data-map-search><button data-map-zoom="out"></button><button data-map-zoom="reset"></button><button data-map-zoom="in"></button></div><div data-map-content></div><aside data-map-drawer hidden></aside></div></section>`;

describe('Disput state map view', () => {
  beforeEach(() => {
    jest.resetModules(); document.body.innerHTML = markup();
    window.DebateStateMap = StateMap;
    window.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.requestAnimationFrame = window.requestAnimationFrame;
    if (!window.CSS) window.CSS = {}; if (!window.CSS.escape) window.CSS.escape = (value) => String(value).replace(/"/g, '\\"');
    require('../results/disput-state-map-view');
  });

  const aggregate = {
    runId: 'run-ui', status: 'running', config: { topic: 'UI case' }, executionPlan: { profileId: 'FREE_TALK_MVP' },
    protocolState: { registry: { artifacts: {
      c1: { id: 'c1', type: 'claim', status: 'contested', formulation: 'Claim' },
      o1: { id: 'o1', type: 'objection', status: 'raised', formulation: 'Blocker', targetId: 'c1', severity: 'blocking', provenance: { turnId: 't2' } }
    } } }
  };

  test('keeps filters while switching Structure/Graf and opens provenance drawer', () => {
    const view = window.DisputStateMapView.init({ aggregate });
    document.querySelector('[data-map-collapse]').click();
    expect(document.querySelector('.disput-state-map-workspace').hidden).toBe(false);
    document.querySelector('[data-map-filter="blocking"]').click();
    expect(document.querySelector('[data-map-filter="blocking"]').classList.contains('is-active')).toBe(true);
    document.querySelector('[data-map-mode="graf"]').click();
    expect(document.querySelector('.disput-graf')).not.toBeNull();
    expect(document.querySelector('.disput-graf-links')).not.toBeNull();
    document.querySelector('[data-map-item="o1"]').click();
    expect(document.querySelector('[data-map-drawer]').hidden).toBe(false);
    expect(document.querySelector('[data-map-drawer]').textContent).toContain('Provenance');
    view.render({ ...aggregate, status: 'paused' });
    expect(document.querySelector('[data-map-filter="blocking"]').classList.contains('is-active')).toBe(true);
  });

  test('orders drawer controls and keeps System Information collapsed by default', () => {
    window.DisputStateMapView.init({ aggregate });
    document.querySelector('[data-map-collapse]').click();
    document.querySelector('[data-map-item="o1"]').click();
    const drawer = document.querySelector('[data-map-drawer]');
    const body = drawer.querySelector('.disput-map-drawer-body');
    const directChildren = [...body.children];
    expect(directChildren[0].className).toContain('disput-map-status-raised');
    expect(directChildren.map((element) => element.className)).toEqual(expect.arrayContaining([
      'disput-map-drawer-human-actions', 'disput-map-drawer-links', 'disput-map-drawer-source', 'disput-map-system-information'
    ]));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-human-actions')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-drawer-links')));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-links')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-drawer-source')));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-source')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-system-information')));
    expect(body.querySelector('.disput-map-system-information').open).toBe(false);
    expect(body.querySelector('[data-map-source]').textContent).toContain('Перейти к исходному ответу');
  });

  test('shows removable human links in the drawer and above the open badge on the card', () => {
    const onLinkRemove = jest.fn();
    const humanAggregate = {
      ...aggregate,
      protocolState: { registry: { artifacts: {
        c1: { id: 'c1', type: 'claim', status: 'asserted', formulation: 'Claim' },
        h1: { id: 'h1', type: 'human_decision', status: 'accepted', formulation: 'assign', targetId: 'c1', provenance: { source: 'state_map_drawer' } },
        g1: { id: 'g1', type: 'evidence_gap', status: 'open', formulation: 'Need evidence', targetId: 'c1', provenance: { source: 'state_map_drawer' } }
      } } }
    };
    window.DisputStateMapView.init({ aggregate: humanAggregate, onLinkRemove });
    document.querySelector('[data-map-collapse]').click();
    const gapCard = document.querySelector('[data-map-item="g1"]');
    expect(gapCard.querySelector('[data-map-link-remove]').nextElementSibling.className).toContain('disput-map-badge');
    gapCard.querySelector('[data-map-link-remove]').click();
    expect(onLinkRemove).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'g1' }));
    document.querySelector('[data-map-item="c1"]').click();
    const drawerRemove = document.querySelector('.disput-map-drawer-links [data-map-link-remove]');
    expect(drawerRemove).not.toBeNull();
    drawerRemove.click();
    expect(onLinkRemove).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'h1' }));
  });

  test('search reports hidden elements and empty states', () => {
    window.DisputStateMapView.init({ aggregate });
    const search = document.querySelector('[data-map-search]'); search.value = 'missing'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-map-content]').textContent).toContain('скрыто 2');
    expect(document.querySelector('[data-map-content]').textContent).toContain('Нет элементов');
  });

  test('collapses when clicking free page space but stays open inside the workspace', () => {
    window.DisputStateMapView.init({ aggregate });
    const toggle = document.querySelector('[data-map-collapse]');
    const workspace = document.querySelector('.disput-state-map-workspace');
    toggle.click();
    expect(workspace.hidden).toBe(false);
    document.querySelector('[data-map-content]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(workspace.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(workspace.hidden).toBe(true);
  });
});
