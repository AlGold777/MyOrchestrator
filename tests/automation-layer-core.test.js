const Core = require('../automation/automation-core.js');

function structured(stage, inputIds, content = 'Answer') {
  return JSON.stringify({
    passport: { contract: 'AL-STRUCT-1', stage, input_ids: inputIds },
    outputs: [{ id: 'OUT-1', type: 'ANSWER', version: 1, content }],
    annotations: [{ type: 'FACT', text: 'example' }],
    trace: [{ output_id: 'OUT-1', source_ids: inputIds }],
    input_fate: inputIds.map((id) => ({ input_id: id, disposition: 'CONSUMED', output_ids: ['OUT-1'] })),
    changes: stage === 'ROUND_2' ? [{ kind: 'SYNTHESIZED', target: 'OUT-1' }] : [],
    completion: { status: 'COMPLETE', output_ids: ['OUT-1'], output_count: 1, empty_by_design: false, anomalies: [] }
  });
}

describe('Automation Layer structured core', () => {
  test('maps existing UI model values', () => {
    expect(Core.selectedModelsFromValues(['chatgpt', 'lechat'])).toEqual(['GPT', 'Le Chat']);
  });

  test('round one prompt requires compact structural contract', () => {
    const prompt = Core.buildRoundOnePrompt('Question');
    expect(prompt).toContain('AL-STRUCT-1');
    expect(prompt).toContain('passport, outputs, annotations, trace, input_fate, changes, completion');
    expect(prompt).toContain('Question');
  });

  test('accepts valid Round 1 structured answer', () => {
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', ['ORIGINAL_REQUEST'], 'R1'),
      'ROUND_1',
      ['ORIGINAL_REQUEST']
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('R1');
    expect(parsed.summary.annotations).toBe(1);
  });

  test('rejects missing provenance coverage', () => {
    const raw = JSON.parse(structured('ROUND_2', ['ORIGINAL_REQUEST'], 'R2'));
    const parsed = Core.validateStructuredAnswer(
      JSON.stringify(raw),
      'ROUND_2',
      ['ORIGINAL_REQUEST', 'ROUND1_GPT', 'ROUND1_CLAUDE']
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_INPUT_COVERAGE');
  });

  test('round two includes both structured sources', () => {
    const answers = {
      GPT: { structure: JSON.parse(structured('ROUND_1', ['ORIGINAL_REQUEST'], 'G')) },
      Claude: { structure: JSON.parse(structured('ROUND_1', ['ORIGINAL_REQUEST'], 'C')) }
    };
    const prompt = Core.buildRoundTwoPrompt({
      originalPrompt: 'Question',
      modelOrder: ['GPT', 'Claude'],
      answers
    });
    expect(prompt).toContain('ROUND1_GPT');
    expect(prompt).toContain('ROUND1_CLAUDE');
    expect(prompt).toContain('"content":"G"');
    expect(prompt).toContain('"content":"C"');
  });

  test('persisted stage correlation survives compaction', () => {
    const jobState = { session: { pipelineRunId: Core.stageRunId('RUN-A', 2) } };
    expect(Core.matchingJobState(jobState, 'RUN-A', 2)).toBe(true);
    expect(Core.matchingJobState(jobState, 'RUN-A', 1)).toBe(false);
  });

  test('terminal events keep finalized chronology', () => {
    const jobState = {
      session: { pipelineRunId: Core.stageRunId('RUN-A', 1) },
      llms: {
        DeepSeek: { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 200, answer: 'D' },
        'Le Chat': { finalStatusRecorded: true, finalStatus: 'SUCCESS', finalizedAt: 100, answer: 'L' }
      }
    };
    const events = Core.collectNewTerminalEvents({
      jobState, runId: 'RUN-A', round: 1, models: ['DeepSeek', 'Le Chat'], seenKeys: new Set()
    });
    expect(events.map((event) => event.model)).toEqual(['Le Chat', 'DeepSeek']);
  });
});
