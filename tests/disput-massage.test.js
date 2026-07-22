const DisputMessageTemplates = require('../disput/disput-massage');
const DebateEngine = require('../disput/debate-engine');

describe('DisputMessageTemplates', () => {
  test('builds Init A with the exact start task', () => {
    const prompt = DisputMessageTemplates.buildInitAPrompt({
      pipelineName: 'Pipeline topic',
      modelB: 'Claude',
      roleA: 'Critic',
      moderatorMessage: 'Moderator start message'
    });

    expect(prompt).toContain('Тема дискуссии: Moderator start message');
    expect(prompt).not.toContain('Pipeline topic');
    expect(prompt).toContain('1. Сформулируй свою позицию.');
    expect(prompt).toContain('3. Приведи аргументы к каждому тезису.');
  });

  test('uses the moderator task as topic and adds the selected word limit', () => {
    const prompt = DisputMessageTemplates.buildInitAPrompt({
      pipelineName: 'Triad Long', moderatorMessage: '2+2=', maxWords: 500,
      mission: 'must not leak', problemSpec: 'ProblemSpec:\nmust not leak'
    });
    expect(prompt).toContain('Тема дискуссии: 2+2=');
    expect(prompt).toContain('не более 500 слов');
    expect(prompt).not.toContain('Triad Long');
    expect(prompt).not.toContain('ProblemSpec');
    expect(prompt).not.toContain('must not leak');
  });

  test('builds Init B without a question to the opponent', () => {
    const prompt = DisputMessageTemplates.buildInitBPrompt({
      pipelineName: 'Pipeline topic',
      modelA: 'GPT',
      roleB: '',
      moderatorMessage: 'Moderator start message'
    });

    expect(prompt).toContain('Тема дискуссии: Moderator start message');
    expect(prompt).toContain('2. Выдели 2–4 ключевых тезиса.');
    expect(prompt).not.toContain('вопрос, который продвинет обсуждение');
    expect(prompt).not.toContain('Начинай дебаты.');
  });

  test('builds standard X to Y turn without injecting private opening context', () => {
    const prompt = DebateEngine.buildStandardTurnPrompt({
      pipelineName: 'Architecture',
      roleY: 'Advocate',
      modelX: 'Claude',
      previousModelText: 'Previous answer',
      moderatorText: '[MODERATOR CHALLENGE]\nQuestion'
    });

    expect(prompt).not.toContain('# Твоя исходная позиция:');
    expect(prompt).toContain('Предыдущая позиция (Claude):\nPrevious answer');
    expect(prompt).toContain('Новое указание модератора:\n[MODERATOR CHALLENGE]\nQuestion');
    expect(prompt).toContain('1. Атакуй самое слабое место в аргументах оппонента: логическую уязвимость, подмену понятий или недостающий факт. Цитируй атакуемый фрагмент.');
  });

  test('standard turn can include compact registry feedback', () => {
    const prompt = DisputMessageTemplates.buildStandardTurnPrompt({
      pipelineName: 'Architecture',
      roleY: 'Advocate',
      modelX: 'Claude',
      previousModelText: 'Previous answer',
      registryContext: '- [claim-1] Тезис/contested: X',
      primaryTrigger: 'Приведи источник для X.'
    });

    expect(prompt).toContain('# Состояние диспута, отслеженное системой:');
    expect(prompt).toContain('- [claim-1] Тезис/contested: X');
    expect(prompt).toContain('# Приоритетное системное указание:');
    expect(prompt).toContain('Приведи источник для X.');
  });
});
