const TriadMessageTemplates = require('../disput/triad-massage');

describe('TriadMessageTemplates', () => {
  test('init prompt preserves isolation from participant names and texts', () => {
    expect(TriadMessageTemplates.buildTriadInitPrompt.length).toBeLessThanOrEqual(1);

    const prompt = TriadMessageTemplates.buildTriadInitPrompt({
      topic: 'Topic',
      role: 'Analyst',
      format: 'Detailed',
      moderatorMessage: 'Start independently',
      opponents: [
        { model: 'GPT', text: 'GPT private text' },
        { model: 'CLAUDE', text: 'Claude private text' }
      ]
    });

    expect(prompt).toContain('Тема дискуссии: Start independently');
    expect(prompt).not.toContain('Topic');
    expect(prompt).not.toContain('Analyst');
    expect(prompt).not.toContain('GPT');
    expect(prompt).not.toContain('CLAUDE');
    expect(prompt).not.toContain('GPT private text');
    expect(prompt).not.toContain('Claude private text');
    expect(prompt).not.toContain('--- Позиция участника');
  });

  test('opening is task-first, bounded and free of protocol boilerplate', () => {
    const prompt = TriadMessageTemplates.buildTriadInitPrompt({
      topic: 'Triad Long', moderatorMessage: '2+2=', role: 'Long role text',
      mission: 'Long protocol mission', problemSpec: 'ProblemSpec:\nDuplicate', maxWords: 700
    });
    expect(prompt).toContain('Тема дискуссии: 2+2=');
    expect(prompt).toContain('не более 700 слов');
    expect(prompt).not.toContain('Triad Long');
    expect(prompt).not.toContain('ProblemSpec');
    expect(prompt).not.toContain('Long protocol mission');
  });

  test('wave prompt includes two opponents, round number, and optional moderator text', () => {
    const prompt = TriadMessageTemplates.buildTriadWavePrompt({
      topic: 'Architecture',
      role: 'Critic',
      format: 'Long',
      waveNumber: 2,
      opponents: [
        { model: 'GPT', text: 'Position A' },
        { model: 'Claude', text: 'Position B' }
      ],
      moderatorText: 'Focus on assumptions',
      roundOutputs: ['claim_ledger', 'challenge_map'],
      previousFilter: 'R1 positions map'
    });

    expect(prompt).toContain('Тема дискуссии: Architecture');
    expect(prompt).toContain('Твоя роль: Critic');
    expect(prompt).not.toContain('Формат ответов:');
    expect(prompt).toContain('Раунд 2');
    expect(prompt).toContain('--- Позиция участника GPT ---\nPosition A');
    expect(prompt).toContain('--- Позиция участника Claude ---\nPosition B');
    expect(prompt).toContain('Вмешательство модератора: Focus on assumptions');
    expect(prompt).toContain('claim_ledger, challenge_map');
    expect(prompt).toContain('R1 positions map');

    const withoutModerator = TriadMessageTemplates.buildTriadWavePrompt({ opponents: [] });
    expect(withoutModerator).not.toContain('Вмешательство модератора:');
  });

  test('final word and synthesis prompts include topic, finals, and synthesis guardrail', () => {
    const finalPrompt = TriadMessageTemplates.buildTriadFinalWordPrompt({
      topic: 'Architecture',
      position: 'Latest position',
      filteredState: 'R1/R2 filter state'
    });
    expect(finalPrompt).toContain('Architecture');
    expect(finalPrompt).toContain('Сформулируй финальное слово');
    expect(finalPrompt).toContain('Новых вопросов не задавай');
    expect(finalPrompt).toContain('Latest position');
    expect(finalPrompt).toContain('R1/R2 filter state');

    const synthesis = TriadMessageTemplates.buildTriadSynthesisPrompt({
      topic: 'Architecture',
      finals: [
        { model: 'GPT', text: 'Final A' },
        { model: 'Claude', text: 'Final B' },
        { model: 'Gemini', text: 'Final C' }
      ],
      roundFilters: [{ round: 2, outputs: ['claim_ledger'], text: 'Filtered claims' }]
    });
    expect(synthesis).toContain('Architecture');
    expect(synthesis).toContain('--- GPT ---\nFinal A');
    expect(synthesis).toContain('--- Claude ---\nFinal B');
    expect(synthesis).toContain('--- Gemini ---\nFinal C');
    expect(synthesis).toContain('не добавляй собственную позицию');
    expect(synthesis).toContain('R2: claim_ledger');
    expect(synthesis).toContain('Filtered claims');
  });

  test('does not inject role and format boilerplate into an opening', () => {
    const prompt = TriadMessageTemplates.buildTriadInitPrompt({
      topic: 'Topic',
      role: '',
      format: ''
    });

    expect(prompt).not.toContain('Твоя роль:');
    expect(prompt).not.toContain('Формат ответов:');
  });
});

describe('TriadMessageTemplates — registry-aware wave prompt', () => {
  test('renders registry context and primary trigger sections when provided', () => {
    const prompt = TriadMessageTemplates.buildTriadWavePrompt({
      topic: 'T',
      role: 'R',
      waveNumber: 2,
      opponents: [{ model: 'GPT', text: 'gpt pos' }],
      registryContext: '- [issue-1] Спор/open: X',
      primaryTrigger: 'Приведи источник для "Y".',
      operationalSignals: '- Фокус: проверить claim-2'
    });
    expect(prompt).toContain('Уже зафиксировано системой (реестр диспута):');
    expect(prompt).toContain('- [issue-1] Спор/open: X');
    expect(prompt).toContain('ПРИОРИТЕТНОЕ УКАЗАНИЕ');
    expect(prompt).toContain('Приведи источник для "Y".');
    expect(prompt).toContain('Операционные сигналы системы:');
    expect(prompt).toContain('- Фокус: проверить claim-2');
  });

  test('omits registry sections when absent (backward compatible)', () => {
    const prompt = TriadMessageTemplates.buildTriadWavePrompt({
      topic: 'T', role: 'R', waveNumber: 1,
      opponents: [{ model: 'GPT', text: 'gpt pos' }]
    });
    expect(prompt).not.toContain('Уже зафиксировано системой');
    expect(prompt).not.toContain('ПРИОРИТЕТНОЕ УКАЗАНИЕ');
  });
});

describe('TriadMessageTemplates — checkpoint prompt and parser', () => {
  test('checkpoint prompt exposes the fixed catalog, turnIds and JSON-only rule', () => {
    const prompt = TriadMessageTemplates.buildTriadCheckpointPrompt({
      topic: 'T',
      waveNumber: 1,
      turns: [{ turnId: 'wave-1:GPT', model: 'GPT', text: 'some claim' }],
      registrySummary: '(пусто)',
      derivedSummary: '- focus/1: inspect issue',
      fullContexts: [{ artifactId: 'issue-1', turnId: 't1', model: 'GPT', text: 'full text' }]
    });
    expect(prompt).toContain('[turnId: wave-1:GPT] GPT:');
    expect(prompt).toContain('[artifactId: issue-1] [turnId: t1] GPT:');
    expect(prompt).toContain('UNSUPPORTED_CLAIM');
    expect(prompt).toContain('"recommendedFocus"');
    expect(prompt).toContain('"contextRequests"');
    expect(prompt).toContain('Верни ТОЛЬКО валидный JSON');
  });

  test('parser reads a clean JSON object', () => {
    const out = TriadMessageTemplates.parseTriadCheckpointOutput(
      JSON.stringify({
        artifacts: [{ op: 'create' }],
        triggers: [{ triggerId: 'STRAWMAN' }],
        recommendedFocus: { text: 'focus' },
        contextRequests: [{ artifactId: 'issue-1' }]
      })
    );
    expect(out.ok).toBe(true);
    expect(out.artifacts).toHaveLength(1);
    expect(out.triggers).toHaveLength(1);
    expect(out.recommendedFocus.text).toBe('focus');
    expect(out.contextRequests).toHaveLength(1);
  });

  test('parser extracts a JSON block wrapped in prose', () => {
    const out = TriadMessageTemplates.parseTriadCheckpointOutput(
      'Вот результат: {"artifacts":[],"triggers":[{"triggerId":"TERM_MISMATCH"}]} — конец.'
    );
    expect(out.ok).toBe(true);
    expect(out.triggers[0].triggerId).toBe('TERM_MISMATCH');
  });

  test('parser degrades safely on non-JSON', () => {
    const out = TriadMessageTemplates.parseTriadCheckpointOutput('no json here');
    expect(out.ok).toBe(false);
    expect(out.artifacts).toEqual([]);
    expect(out.triggers).toEqual([]);
  });

  test('parser tolerates null/undefined', () => {
    expect(TriadMessageTemplates.parseTriadCheckpointOutput(null).ok).toBe(false);
    expect(TriadMessageTemplates.parseTriadCheckpointOutput(undefined).artifacts).toEqual([]);
  });
});
