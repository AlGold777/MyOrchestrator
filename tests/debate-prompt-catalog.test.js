const Catalog = require('../disput/debate-prompt-catalog');

describe('DebatePromptCatalog', () => {
  test('builds topology-neutral round filters', () => {
    const prompt = Catalog.buildRoundFilter({
      topic: 'T', topology: 'triad', round: 2, outputs: ['claim_ledger'],
      turns: [{ model: 'GPT', text: 'answer' }]
    });
    expect(prompt).toContain('режим triad');
    expect(prompt).toContain('claim_ledger');
    expect(prompt).toContain('### GPT\nanswer');
  });

  test('builds Duel final synthesis from state only', () => {
    const prompt = Catalog.buildDuelFinalSynthesis({
      topic: 'T', modelA: 'GPT', modelB: 'Claude', finalWordA: 'A', finalWordB: 'B',
      eventLog: [{ phase: 'public', model: 'GPT', text: 'turn' }], roundFilters: []
    });
    expect(prompt).toContain('Финальное слово — GPT:\nA');
    expect(prompt).toContain('### GPT\nturn');
  });

  test('builds Multi wave and synthesis without UI dependencies', () => {
    expect(Catalog.buildMultiWave({ topic: 'T', wave: 1, maxWaves: 3, modelName: 'GPT' })).toContain('Раунд 1 из 3');
    expect(Catalog.buildMultiFinalSynthesis({ topic: 'T', turns: [{ model: 'GPT', text: 'x' }] })).toContain('## GPT\nx');
  });

  test('resolves protocol missions and readable participant roles', () => {
    expect(Catalog.resolveProtocolMission({ reasoningBudget: { comparableSuffix: 'Red Team' } })).toBe(Catalog.PROTOCOL_MISSIONS.red_team);
    expect(Catalog.resolveProtocolMission({ reasoningBudget: { class: 'infinite' } })).toBe(Catalog.PROTOCOL_MISSIONS.long);
    expect(Catalog.resolveParticipantRoleText('interaction_critical_audit')).toBe(Catalog.PARTICIPANT_ROLES.critical);
    expect(Catalog.resolveParticipantRoleText('Meta-Синтез')).toBe(Catalog.PARTICIPANT_ROLES.meta);
    expect(Catalog.resolveParticipantRoleText('expert')).toBe(Catalog.PARTICIPANT_ROLES.expert);
    expect(Catalog.resolveParticipantRoleText('provocateur')).toBe(Catalog.PARTICIPANT_ROLES.provocateur);
    expect(Catalog.resolveParticipantRoleText('Скептик-экономист')).toBe('Скептик-экономист');
  });
});
