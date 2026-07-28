const TransitionService = require('../disput/debate-protocol-transition-service');

describe('DebateProtocolTransitionService', () => {
  test('reduces a clone, synchronizes it, then commits into the live state', () => {
    const live = { status: 'idle', turn: 0, routedTurnIds: new Set(['t0']) };
    const protocol = {
      reduce(state, event) {
        state.status = event.payload.status;
        state.turn += 1;
        state.routedTurnIds.add('t1');
        return state;
      }
    };
    const syncState = jest.fn((state, reason, options) => ({ ...state, canonical: true, reason, revision: options.expectedProtocolRevision + 1 }));

    const returned = TransitionService.applyProtocolTransition({
      protocol,
      protocolState: live,
      event: { type: 'RUNNING', payload: { status: 'running' } },
      syncState,
      getProtocolRevision: () => 4
    });

    expect(returned).toBe(live);
    expect(live).toMatchObject({ status: 'running', turn: 1, canonical: true, reason: 'RUNNING', revision: 5 });
    expect(live.routedTurnIds).toBeInstanceOf(Set);
    expect([...live.routedTurnIds]).toEqual(['t0', 't1']);
    expect(syncState).toHaveBeenCalledWith(expect.not.objectContaining({ canonical: true }), 'RUNNING', { expectedProtocolRevision: 4 });
  });

  test('does not mutate live state when reducer throws', () => {
    const live = { status: 'idle', nested: { value: 1 } };
    const before = TransitionService.cloneProtocolState(live);
    expect(() => TransitionService.applyProtocolTransition({
      protocol: { reduce(state) { state.nested.value = 2; throw new Error('REDUCE_FAILED'); } },
      protocolState: live,
      event: { type: 'RUNNING' },
      syncState: jest.fn()
    })).toThrow('REDUCE_FAILED');
    expect(live).toEqual(before);
  });

  test('does not mutate live state when canonical synchronization throws', () => {
    const live = { status: 'idle', nested: { value: 1 }, tags: new Set(['original']) };
    const before = TransitionService.cloneProtocolState(live);
    expect(() => TransitionService.applyProtocolTransition({
      protocol: { reduce(state) { state.status = 'running'; state.nested.value = 2; state.tags.add('draft'); return state; } },
      protocolState: live,
      event: { type: 'RUNNING' },
      syncState: () => { throw new Error('PROTOCOL_REVISION_STALE'); }
    })).toThrow('PROTOCOL_REVISION_STALE');
    expect(live).toEqual(before);
    expect([...live.tags]).toEqual(['original']);
  });

  test('preserves Set, Map, Date and cyclic references while cloning', () => {
    const source = { set: new Set([{ id: 1 }]), map: new Map([['a', { value: 2 }]]), date: new Date('2026-07-23T00:00:00Z') };
    source.self = source;
    const cloned = TransitionService.cloneProtocolState(source);
    expect(cloned).not.toBe(source);
    expect(cloned.set).toBeInstanceOf(Set);
    expect(cloned.map).toBeInstanceOf(Map);
    expect(cloned.date).toBeInstanceOf(Date);
    expect(cloned.self).toBe(cloned);
  });

  test.each([
    [{ protocolState: {}, event: { type: 'X' }, syncState: jest.fn() }, 'PROTOCOL_TRANSITION_REDUCER_MISSING'],
    [{ protocol: { reduce: jest.fn() }, event: { type: 'X' }, syncState: jest.fn() }, 'PROTOCOL_TRANSITION_STATE_MISSING'],
    [{ protocol: { reduce: jest.fn() }, protocolState: {}, event: {}, syncState: jest.fn() }, 'PROTOCOL_TRANSITION_EVENT_TYPE_MISSING'],
    [{ protocol: { reduce: jest.fn() }, protocolState: {}, event: { type: 'X' } }, 'PROTOCOL_TRANSITION_SYNC_MISSING']
  ])('fails fast on an incomplete transition composition', (input, code) => {
    expect(() => TransitionService.applyProtocolTransition(input)).toThrow(code);
  });
});
