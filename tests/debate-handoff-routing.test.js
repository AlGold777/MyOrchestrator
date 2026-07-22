const fs = require('fs');
const path = require('path');
const DebateUi = require('../results/debate-ui');

describe('main-page Send routing boundary', () => {
  test('ordinary Send cannot navigate to or auto-start Debate', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const start = source.indexOf("startButton?.addEventListener('click'");
    const end = source.indexOf("getItButton?.addEventListener('click'", start);
    const handler = source.slice(start, end > start ? end : start + 12000);

    expect(start).toBeGreaterThan(-1);
    expect(handler).not.toContain('pipeline_panel.html');
    expect(handler).not.toContain('runPipeline');
    expect(source).not.toContain('llmComparatorDebateAutoRunIntent');
    expect(source).not.toContain('__autoRunDebateWithTopic');
    expect(source).not.toContain('handOffDebateRunToPipelinePage');
  });
});

describe('Debate synthesis-stage projection', () => {
  test('Duel, Triad, Multi, and FreeTalk expose a synthesis stage', () => {
    ['2', '3', 'many', 'free'].forEach((scheme) => {
      expect(DebateUi.usesSynthesisStage({ scheme, presetMeta: { duration: 'fixed' } })).toBe(true);
    });
  });

  test('Duel uses the shared non-Multi synthesizer setting', () => {
    expect(DebateUi.getProtocolSynthesizer({ scheme: '2', triadSynthesizer: 'Claude' })).toBe('Claude');
  });

  test('all topologies prefer the canonical synthesizer setting', () => {
    ['2', '3', 'many', 'free'].forEach((scheme) => {
      expect(DebateUi.getProtocolSynthesizer({ scheme, synthesizer: 'Claude', triadSynthesizer: 'GPT', multiSynthesizer: 'GPT' })).toBe('Claude');
    });
  });

  test('FreeTalk uses the unlimited-model synthesizer setting', () => {
    expect(DebateUi.getProtocolSynthesizer({ scheme: 'free', multiSynthesizer: 'GPT' })).toBe('GPT');
  });
});
