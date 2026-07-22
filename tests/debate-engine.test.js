const DebateEngine = require('../disput/debate-engine');

// After the disput consolidation, DebateEngine is a transcript/persistence/
// template utility for the results UI — not a parallel debate runtime. These
// tests cover only that retained surface.
describe('DebateEngine transcript utility', () => {
  test('creates transcript sessions and appends structured turns', () => {
    const store = DebateEngine.createStore({
      session: {
        sessionId: 's1',
        title: 'Release debate',
        participants: [{ name: 'GPT', role: 'advocate' }, { name: 'Claude', role: 'critic' }],
        settings: { runPolicy: 'auto', maxTurns: 7 }
      }
    });

    const turn = store.appendTurn('s1', {
      author: 'Moderator',
      authorType: 'moderator',
      targets: ['GPT'],
      text: 'Challenge the release assumptions.',
      status: 'pending'
    });

    expect(turn).toEqual(expect.objectContaining({
      sessionId: 's1',
      index: 1,
      author: 'Moderator',
      targets: ['GPT'],
      status: 'pending'
    }));
    expect(store.getSession('s1').settings).toEqual(expect.objectContaining({
      runPolicy: 'auto',
      maxTurns: 7
    }));
  });

  test('serializes sessions with bounded old turns and rule-based summary', () => {
    const store = DebateEngine.createStore({ session: { sessionId: 's2' } });
    for (let i = 0; i < 5; i += 1) {
      store.appendTurn('s2', { author: `M${i}`, targets: ['GPT'], text: `Turn ${i}`, status: 'approved' });
    }

    const payload = DebateEngine.serializeStore(store, { maxFullTurns: 2 });

    expect(payload.sessions[0].turns).toHaveLength(2);
    expect(payload.sessions[0].turns[0].index).toBe(4);
    expect(payload.sessions[0].summaries[payload.sessions[0].summaries.length - 1]).toEqual(expect.objectContaining({
      upToTurnIndex: 3
    }));
  });

  test('persists and restores through storage adapter', async () => {
    const storageData = {};
    const storage = {
      set: jest.fn(async (value) => Object.assign(storageData, value)),
      get: jest.fn(async (key) => ({ [key]: storageData[key] }))
    };
    const store = DebateEngine.createStore({ session: { sessionId: 'persisted' } });
    store.appendTurn('persisted', { author: 'Moderator', targets: ['Claude'], text: 'Persist me' });

    await DebateEngine.persistStore(store, { storage });
    const restored = await DebateEngine.loadStore({ storage });

    expect(restored.getSession('persisted').turns[0].text).toBe('Persist me');
  });

  test('exports and replays structured artifacts plus markdown', () => {
    const store = DebateEngine.createStore({ session: { sessionId: 'export-s1', participants: ['GPT'] } });
    store.appendTurn('export-s1', { author: 'Moderator', targets: ['GPT'], text: 'Hello', terminalStatus: 'SUCCESS' });

    const artifact = DebateEngine.exportArtifact(store);
    const replayed = DebateEngine.replayArtifact(artifact);
    const markdown = DebateEngine.exportMarkdown(replayed.getSession('export-s1'));

    expect(artifact.sessions[0].turns[0].text).toBe('Hello');
    expect(replayed.getSession('export-s1').turns).toHaveLength(1);
    expect(markdown).toContain('## Turn 1 — Moderator -> GPT');
  });

  test('builds debate envelope/template prompts that delegate to DisputMessageTemplates', () => {
    const regular = DebateEngine.buildSerialDebateEnvelope({
      topic: 'Architecture',
      role: 'Critic',
      opponentText: 'The current plan is stable.',
      moderatorMessage: 'Challenge the assumption.'
    });
    const final = DebateEngine.buildSerialDebateEnvelope({
      topic: 'Architecture',
      role: 'Advocate',
      opponentText: 'The plan is too risky.',
      moderatorMessage: 'Give final answer.',
      isFinalRound: true
    });

    expect(regular).toContain('[DEBATE CONTEXT]');
    expect(regular).toContain('[ОТВЕТ ОППОНЕНТА]');
    expect(regular).toContain('The current plan is stable.');
    expect(regular).not.toContain('[ФИНАЛЬНЫЙ РАУНД]');
    expect(final).toContain('[ФИНАЛЬНЫЙ РАУНД]');
    expect(DebateEngine.DEFAULT_SERIAL_FORMAT).toContain('Ясный');

    // Init/standard prompt builders delegate to the single template source.
    expect(DebateEngine.buildInitAPrompt({ pipelineName: 'T', modelB: 'Claude', roleA: 'A' })).toContain('Тема дискуссии');
    expect(DebateEngine.buildStandardTurnPrompt({ pipelineName: 'T', roleY: 'B', modelX: 'GPT', previousModelText: 'prev' })).toContain('prev');
  });
});
