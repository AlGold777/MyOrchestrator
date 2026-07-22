const PipelinePresets = require('../disput/pipeline-presets');
const ArtifactDefinitions = require('../disput/debate-artifact-definitions');

describe('PipelinePresets — config-driven debate presets', () => {
  test('defines every built-in round artifact, including independent retest', () => {
    const ids = PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS
      .flatMap((definition) => definition.roundPlan || [])
      .flatMap((outputs) => outputs || []);
    expect(ArtifactDefinitions.listUndefined(ids)).toEqual([]);
    expect(ArtifactDefinitions.getDefinition('independent_retest')).toMatchObject({ title: 'Независимый ретест' });
  });

  test('exports frozen preset registry helpers', () => {
    expect(Object.isFrozen(PipelinePresets)).toBe(true);
    expect(PipelinePresets.DEFAULT_PRESET_ID).toBe('DUEL_STANDARD');
    expect(PipelinePresets.PIPELINE_PRESETS.map((preset) => preset.id)).toEqual([
      'DUEL_STANDARD',
      'DUEL_LONG',
      'TRIAD_STANDARD',
      'TRIAD_LONG',
      'MULTI_STANDARD',
      'MULTI_RED_TEAM',
      'MULTI_LONG',
      'FREE_TALK_MVP'
    ]);
  });

  test('owns complete built-in UI definitions without a results.js catalog', () => {
    expect(PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS.map((item) => item.name)).toEqual([
      'Duel Verdict', 'Duel Red Team', 'Duel Long',
      'Triad Verdict', 'Triad Red Team', 'Triad Long',
      'Multi Verdict', 'Multi Red Team', 'Multi Long — later',
      'FreeTalk'
    ]);
    expect(PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.name === 'Multi Verdict').roundPlan).toHaveLength(4);
    expect(PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.name === 'FreeTalk')).toMatchObject({
      presetId: 'FREE_TALK_MVP', roundLimit: 'infinite', defaultModelCount: 1
    });
  });

  test('standard presets keep runtime-owned finite limits from current UI', () => {
    expect(PipelinePresets.normalizePipelinePreset('DUEL_STANDARD', {
      currentUiLimits: { turnLimit: 6, waveLimit: 3 }
    })).toMatchObject({
      presetId: 'DUEL_STANDARD',
      topology: 'duel',
      duration: 'fixed',
      terminationOwner: 'runtime',
      finalizationPolicy: 'auto_after_limit',
      turnLimit: 6,
      waveLimit: null
    });

    expect(PipelinePresets.normalizePipelinePreset('TRIAD_STANDARD', {
      currentUiLimits: { turnLimit: 6, waveLimit: 3 }
    })).toMatchObject({
      presetId: 'TRIAD_STANDARD',
      topology: 'triad',
      duration: 'fixed',
      terminationOwner: 'runtime',
      finalizationPolicy: 'auto_after_limit',
      turnLimit: null,
      waveLimit: 3
    });

    expect(PipelinePresets.normalizePipelinePreset('MULTI_STANDARD', {
      currentUiLimits: { turnLimit: 6, waveLimit: 4 }
    })).toMatchObject({
      presetId: 'MULTI_STANDARD',
      topology: 'multi',
      duration: 'fixed',
      terminationOwner: 'runtime',
      finalizationPolicy: 'auto_after_limit',
      turnLimit: null,
      waveLimit: 4
    });
  });

  test('Verdict presets share the same standard reasoning budget class', () => {
    const duel = PipelinePresets.normalizePipelinePreset('DUEL_STANDARD');
    const triad = PipelinePresets.normalizePipelinePreset('TRIAD_STANDARD');
    const multi = PipelinePresets.normalizePipelinePreset('MULTI_STANDARD');

    expect(duel.reasoningBudget).toMatchObject({
      class: 'standard',
      critiqueDepth: 1,
      synthesisPasses: 1,
      finalVerdictPasses: 1,
      comparableSuffix: 'Verdict'
    });
    expect(triad.reasoningBudget).toEqual(duel.reasoningBudget);
    expect(multi.reasoningBudget).toEqual(duel.reasoningBudget);
  });

  test('long presets are moderator-owned and open-ended', () => {
    expect(PipelinePresets.normalizePipelinePreset('DUEL_LONG', {
      currentUiLimits: { turnLimit: 6, waveLimit: 3 }
    })).toMatchObject({
      presetId: 'DUEL_LONG',
      topology: 'duel',
      duration: 'open_ended',
      terminationOwner: 'moderator',
      finalizationPolicy: 'manual_only',
      turnLimit: null,
      waveLimit: null
    });

    const triadLong = PipelinePresets.normalizePipelinePreset('TRIAD_LONG', {
      currentUiLimits: { turnLimit: 6, waveLimit: 3 }
    });
    expect(triadLong).toMatchObject({
      presetId: 'TRIAD_LONG',
      topology: 'triad',
      duration: 'open_ended',
      terminationOwner: 'moderator',
      finalizationPolicy: 'manual_only',
      turnLimit: null,
      waveLimit: null
    });
    expect(triadLong.checkpointPolicy.everyWaves).toBe(2);
  });

  test('Multi Long is visible but disabled experimental', () => {
    expect(PipelinePresets.getPipelinePreset('MULTI_LONG')).toMatchObject({
      label: 'Multi Long',
      status: 'disabled_experimental',
      topology: 'multi'
    });
    expect(PipelinePresets.isPresetEnabled('MULTI_LONG')).toBe(false);
  });

  test('all fixed built-in presets run the complete flow automatically', () => {
    const byName = (name) => PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.name === name);
    ['Duel Verdict', 'Duel Red Team', 'Triad Verdict', 'Triad Red Team', 'Multi Verdict', 'Multi Red Team']
      .forEach((name) => expect(byName(name)?.runPolicy).toBe('auto'));
  });

  describe('resolveRuntimeRoundLimits', () => {
    test('fixed presets ignore stale hidden UI values and use the canonical plan', () => {
      expect(PipelinePresets.resolveRuntimeRoundLimits('TRIAD_STANDARD', {
        roundPlan: [['a'], ['b'], ['c'], ['d']], storedRoundLimit: '4', uiRoundLimit: 3
      })).toMatchObject({ roundLimit: 4, waveLimit: 4 });
      expect(PipelinePresets.resolveRuntimeRoundLimits('DUEL_STANDARD', {
        roundPlan: [['a'], ['b'], ['c']], storedRoundLimit: '3', uiRoundLimit: 1
      })).toMatchObject({ roundLimit: 3, turnLimit: 4 });
      expect(PipelinePresets.resolveRuntimeRoundLimits('MULTI_STANDARD', {
        roundPlan: [], storedRoundLimit: '4', uiRoundLimit: 2
      }).waveLimit).toBe(4);
    });

    test('open-ended presets keep the live finite/infinite control', () => {
      expect(PipelinePresets.resolveRuntimeRoundLimits('DUEL_LONG', {
        roundPlan: [], storedRoundLimit: 'infinite', uiRoundLimit: 'infinite'
      })).toMatchObject({ roundLimit: 'infinite', turnLimit: null });
      expect(PipelinePresets.resolveRuntimeRoundLimits('DUEL_LONG', {
        roundPlan: [], storedRoundLimit: '', uiRoundLimit: 5
      }).roundLimit).toBe(5);
    });
  });
});
