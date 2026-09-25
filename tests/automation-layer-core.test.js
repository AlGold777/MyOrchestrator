const Core = require('../automation/automation-core.js');

describe('Automation Layer independent smoke core', () => {
  test('maps existing UI model values to canonical runtime names', () => {
    expect(Core.selectedModelsFromValues(['chatgpt', 'claude'])).toEqual(['GPT', 'Claude']);
    expect(Core.selectedModelsFromValues(['perplex', 'zai'])).toEqual(['Perplexity', 'Z.ai']);
  });

  test('deterministic fan-in follows selected model order, not completion order', () => {
    const combined = Core.deterministicCombine(['GPT', 'Claude'], {
      Claude: { text: 'Claude was first' }, GPT: { text: 'GPT was second' }
    });
    expect(combined.indexOf('SOURCE 1: GPT')).toBeLessThan(combined.indexOf('SOURCE 2: Claude'));
  });

  test('round two prompt contains original request and both independent answers', () => {
    const prompt = Core.buildRoundTwoPrompt({
      originalPrompt: 'Original question', modelOrder: ['GPT', 'Claude'],
      answers: { GPT: { text: 'Answer G' }, Claude: { text: 'Answer C' } }
    });
    expect(prompt).toContain('Original question');
    expect(prompt).toContain('Answer G');
    expect(prompt).toContain('Answer C');
  });

  test('job-state correlation rejects another automation run', () => {
    const jobState = { session: { pipelineContext: { sourceView: 'automation', automationRunId: 'RUN-B', automationRound: 1 } } };
    expect(Core.matchingJobState(jobState, 'RUN-A', 1)).toBe(false);
    expect(Core.matchingJobState(jobState, 'RUN-B', 1)).toBe(true);
  });

  test('persisted stage correlation survives compaction without pipelineContext', () => {
    const jobState = { session: { pipelineRunId: Core.stageRunId('RUN-A', 2) } };
    expect(Core.matchingJobState(jobState, 'RUN-A', 2)).toBe(true);
    expect(Core.matchingJobState(jobState, 'RUN-A', 1)).toBe(false);
  });

  test('terminal events use finalizedAt chronology even when model object order differs', () => {
    const jobState = {
      session: { pipelineRunId: Core.stageRunId('RUN-A', 1) },
      llms: {
        GPT: { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 200, answer: 'GPT answer' },
        Claude: { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 100, answer: 'Claude answer' }
      }
    };
    const events = Core.collectNewTerminalEvents({ jobState, runId: 'RUN-A', round: 1, models: ['GPT', 'Claude'], seenKeys: new Set() });
    expect(events.map((event) => event.model)).toEqual(['Claude', 'GPT']);
  });

  test('seen terminal keys prevent duplicate feed messages', () => {
    const jobState = {
      session: { pipelineRunId: Core.stageRunId('RUN-A', 2) },
      llms: { GPT: { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 100, answer: 'Final GPT' } }
    };
    const first = Core.collectNewTerminalEvents({ jobState, runId: 'RUN-A', round: 2, models: ['GPT'], seenKeys: new Set() });
    const second = Core.collectNewTerminalEvents({ jobState, runId: 'RUN-A', round: 2, models: ['GPT'], seenKeys: new Set([first[0].key]) });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
