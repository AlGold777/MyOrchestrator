const Core = require('../automation/automation-core.js');

describe('Automation Layer independent smoke core', () => {
  test('maps existing UI model values to canonical runtime names', () => {
    expect(Core.selectedModelsFromValues(['chatgpt', 'claude'])).toEqual(['GPT', 'Claude']);
    expect(Core.selectedModelsFromValues(['perplex', 'zai'])).toEqual(['Perplexity', 'Z.ai']);
  });

  test('deterministic fan-in follows selected model order, not completion order', () => {
    const combined = Core.deterministicCombine(['GPT', 'Claude'], {
      Claude: { text: 'Claude was first' },
      GPT: { text: 'GPT was second' }
    });
    expect(combined.indexOf('SOURCE 1: GPT')).toBeLessThan(combined.indexOf('SOURCE 2: Claude'));
    expect(combined).toContain('GPT was second');
    expect(combined).toContain('Claude was first');
  });

  test('round two prompt contains original request and both independent answers', () => {
    const prompt = Core.buildRoundTwoPrompt({
      originalPrompt: 'Original question',
      modelOrder: ['GPT', 'Claude'],
      answers: {
        GPT: { text: 'Answer G' },
        Claude: { text: 'Answer C' }
      }
    });
    expect(prompt).toContain('Original question');
    expect(prompt).toContain('Answer G');
    expect(prompt).toContain('Answer C');
    expect(prompt).toContain('TASK:');
  });

  test('job-state correlation rejects another automation run', () => {
    const jobState = {
      session: {
        pipelineContext: {
          sourceView: 'automation',
          automationRunId: 'RUN-B',
          automationRound: 1
        }
      }
    };
    expect(Core.matchingJobState(jobState, 'RUN-A', 1)).toBe(false);
    expect(Core.matchingJobState(jobState, 'RUN-B', 1)).toBe(true);
  });

  test('terminal events use finalizedAt chronology even when model object order differs', () => {
    const jobState = {
      session: {
        pipelineContext: {
          sourceView: 'automation',
          automationRunId: 'RUN-A',
          automationRound: 1
        }
      },
      llms: {
        GPT: {
          finalStatusRecorded: true,
          finalStatus: 'SUCCESS',
          finalizedAt: 200,
          answer: 'GPT answer',
          lastDispatchMeta: { dispatchId: 'd-gpt' }
        },
        Claude: {
          finalStatusRecorded: true,
          finalStatus: 'SUCCESS',
          finalizedAt: 100,
          answer: 'Claude answer',
          lastDispatchMeta: { dispatchId: 'd-claude' }
        }
      }
    };

    const events = Core.collectNewTerminalEvents({
      jobState,
      runId: 'RUN-A',
      round: 1,
      models: ['GPT', 'Claude'],
      seenKeys: new Set()
    });

    expect(events.map((event) => event.model)).toEqual(['Claude', 'GPT']);
  });

  test('seen terminal keys prevent duplicate feed messages after reload/reconciliation', () => {
    const jobState = {
      session: {
        pipelineContext: {
          sourceView: 'automation',
          automationRunId: 'RUN-A',
          automationRound: 2
        }
      },
      llms: {
        GPT: {
          finalStatusRecorded: true,
          finalStatus: 'SUCCESS',
          finalizedAt: 100,
          answer: 'Final GPT',
          lastDispatchMeta: { dispatchId: 'd1' }
        }
      }
    };

    const first = Core.collectNewTerminalEvents({
      jobState,
      runId: 'RUN-A',
      round: 2,
      models: ['GPT'],
      seenKeys: new Set()
    });
    const second = Core.collectNewTerminalEvents({
      jobState,
      runId: 'RUN-A',
      round: 2,
      models: ['GPT'],
      seenKeys: new Set([first[0].key])
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  test('result artifact contains both rounds and original request', () => {
    const text = Core.buildResultText({
      runId: 'RUN-A',
      startedAt: 'start',
      completedAt: 'done',
      models: ['GPT', 'Claude'],
      originalPrompt: 'Question',
      synthesisInstruction: 'Synthesize',
      rounds: {
        '1': { answers: { GPT: { text: 'G1' }, Claude: { text: 'C1' } } },
        '2': { answers: { GPT: { text: 'G2' }, Claude: { text: 'C2' } } }
      }
    });

    for (const part of ['Question', 'G1', 'C1', 'G2', 'C2', 'Synthesize']) {
      expect(text).toContain(part);
    }
  });
});
