const ProblemSpec = require('../disput/debate-problem-spec');
const Dropout = require('../disput/debate-dropout-revalidation');
const Outcome = require('../disput/debate-epistemic-outcome');
const Assembly = require('../disput/debate-context-assembly');
const Roles = require('../disput/debate-service-roles');
const Stop = require('../disput/debate-stagnation-warning');
const Anonymization = require('../disput/debate-anonymization');
const Registry = require('../disput/triad-registry');
const Routing = require('../disput/debate-capability-registry');

describe('Disput sections II–III contracts', () => {
  test('ProblemSpec extracts type, constraints and evidence mode', () => {
    const spec = ProblemSpec.extract({ topic: 'Сравни подходы. Не используй внешние API. Только факты.' });
    expect(spec.taskType).toBe('analysis'); expect(spec.constraints).toHaveLength(2); expect(spec.evidenceMode).toBe('preferred');
  });
  test('dropout revalidation marks low diversity degraded', () => {
    expect(Dropout.revalidate({ topology: 'multi', failedModels: ['C'], remainingModels: ['A','B'] }).verdict).toBe('continue_degraded');
  });
  test('epistemic outcome distinguishes insufficient evidence', () => {
    expect(Outcome.derive({ synthesisText: '## Вердикт\nНет\n## Нерешённые вопросы\nНедостаточно данных' }).outcome).toBe('insufficient_evidence');
  });
  test('context assembly omits old history by policy', () => {
    const result = Assembly.assemble({ stageKind: 'participant_wave', policy: 'filtered', state: { topic: 'T', responsesByWave: [[{ text: 'old' }],[{ text: 'new' }]], roundFilters: [{ text: 'filter' }] } });
    expect(result.parts.map((part) => part.id)).toEqual(expect.arrayContaining(['topic','last_filter','last_wave_peers']));
  });
  test('service auditor is never inferred from participants', () => {
    expect(Roles.resolveServiceRoles({ participants: ['A','B'], synthesizer: 'A' })).toEqual({ synthesizer: 'A', auditor: '' });
  });
  test('literal auto never resolves to a synthesizer model', () => {
    expect(Roles.resolveServiceRoles({ participants: ['A', 'B'], synthesizer: 'auto' }))
      .toEqual({ synthesizer: '', auditor: '' });
  });
  test('legacy extractor config cannot create a second service model', () => {
    expect(Roles.resolveServiceRoles({
      preset: { serviceRoles: { extractor: 'B', auditor: 'auto' } },
      participants: ['A', 'B'],
      synthesizer: 'A'
    })).toEqual({ synthesizer: 'A', auditor: '' });
    expect(Roles.resolveServiceRoles({
      preset: { serviceRoles: { extractor: 'B' } },
      participants: ['A', 'B']
    })).toEqual({ synthesizer: '', auditor: '' });
  });
  test('stagnation warning never auto-stops', () => {
    expect(Stop.assess({ roundDeltas: [{},{ }] }).recommendation).toBe('suggest_finalize');
    expect(Stop.assess({ roundDeltas: [
      { wave: 1, delta: { newClaims: [{}], newObjections: [], revisions: [], stagnation: { newContentRatio: 1 } } },
      { wave: 2, delta: { newClaims: [{}], newObjections: [], revisions: [], stagnation: { newContentRatio: 1 } } }
    ] }).recommendation).toBe('continue');
  });
  test('research requirements are explicit and block unsupported model sets', () => {
    expect(Routing.validateRequirements({ models: ['GPT', 'Claude'], tools: ['web_research'] }))
      .toEqual({ ok: false, missingTools: ['web_research'] });
    expect(Routing.validateRequirements({ models: ['Perplexity'], tools: ['web_research'] }).ok).toBe(true);
  });
  test('anonymization round trips and prefers longer names', () => {
    const map = Anonymization.createAliasMap(['Model','Model Pro']); const hidden = Anonymization.anonymizeText('Model Pro uses Model', map);
    expect(Anonymization.deanonymizeText(hidden, map)).toBe('Model Pro uses Model');
  });
  test('registry rejects objection without target', () => {
    const reg = Registry.createRegistry(); Registry.appendEvent(reg, { turnId: 't1', text: 'quoted text' });
    expect(Registry.applyDelta(reg, { type: 'objection', anchor: { turnId: 't1', quote: 'quoted text' } }).reason).toBe('objection_without_target');
  });
});
