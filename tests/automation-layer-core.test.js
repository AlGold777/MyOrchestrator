const Core = require('../automation/automation-core.js');

function refs(round = 1) {
  const idea = { id: 'IDEA-001', type: 'IDEA', version: 1 };
  if (round === 1) return [idea];
  return [
    idea,
    { id: 'R1-GPT-OUT-1', type: 'MODEL_OUTPUT', version: 1 },
    { id: 'R1-CLAUDE-OUT-1', type: 'MODEL_OUTPUT', version: 1 }
  ];
}

function structured(stage, inputRefs, content = 'Answer', changes = [], snapshotId = 'SNAP-TEST-R1') {
  return JSON.stringify({
    passport: { contract: 'AL-STRUCT-1', stage, input_snapshot_id: snapshotId, input_refs: inputRefs },
    outputs: [{ id: 'OUT-1', type: 'ANSWER', version: 1, content }],
    annotations: [{ type: 'FACT', text: 'example' }],
    trace: [{ output_id: 'OUT-1', source_ids: inputRefs.map((ref) => ref.id) }],
    input_fate: inputRefs.map((ref) => ({
      input_id: ref.id,
      disposition: 'CONSUMED',
      output_ids: ['OUT-1']
    })),
    changes,
    completion: {
      status: 'COMPLETE',
      output_ids: ['OUT-1'],
      output_count: 1,
      empty_by_design: false,
      anomalies: []
    }
  });
}

describe('Automation Layer final structured core', () => {
  test('maps existing UI model values', () => {
    expect(Core.selectedModelsFromValues(['chatgpt', 'lechat'])).toEqual(['GPT', 'Le Chat']);
  });

  test('allocates machine-owned idea reference', () => {
    expect(Core.makeIdeaRef('AUTO-123-ABC')).toEqual({
      id: 'IDEA-AUTO123ABC',
      type: 'IDEA',
      version: 1
    });
  });

  test('round one prompt includes instruction plus concrete JSON example', () => {
    const prompt = Core.buildRoundOnePrompt('Question', refs(1), 'SNAP-TEST-R1');
    expect(prompt).toContain('AL-STRUCT-1');
    expect(prompt).toContain('CONSUMED означает только «вход обработан»');
    expect(prompt).toContain('schema_example');
    expect(prompt).toContain('"role":"schema_example"');
    expect(prompt).toContain('"input_refs":[{"id":"IDEA-001","type":"IDEA","version":1}]');
    expect(prompt).toContain('"role":"task_input"');
  });

  test('accepts valid Round 1 structured answer with exact input ref', () => {
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1'),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1'
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('R1');
    expect(parsed.summary.annotations).toBe(1);
  });

  test('rejects changed idea identity or version', () => {
    const wrong = [{ id: 'IDEA-002', type: 'IDEA', version: 1 }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', wrong, 'R1'),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1'
    );
    expect(parsed.ok).toBe(false);
    expect(['STRUCTURE_INPUT_REF_MISMATCH', 'STRUCTURE_INPUT_COVERAGE']).toContain(parsed.reason);
  });

  test('allows new decision proposal only through temp_id', () => {
    const change = [{
      op: 'CREATE',
      object_type: 'PD',
      temp_id: 'tmp-pd-1',
      source_output_id: 'OUT-1'
    }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1', change),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1'
    );
    expect(parsed.ok).toBe(true);
  });

  test('rejects model-created canonical decision ID', () => {
    const change = [{
      op: 'CREATE',
      object_type: 'PD',
      temp_id: 'tmp-pd-1',
      id: 'PD-900',
      source_output_id: 'OUT-1'
    }];
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_1', refs(1), 'R1', change),
      'ROUND_1',
      refs(1),
      'SNAP-TEST-R1'
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_MODEL_CANONICAL_ID_FORBIDDEN');
  });

  test('round two wraps both previous responses explicitly as prior_output data', () => {
    const answers = {
      GPT: { structure: JSON.parse(structured('ROUND_1', refs(1), 'G')) },
      Claude: { structure: JSON.parse(structured('ROUND_1', refs(1), 'C')) }
    };
    const prompt = Core.buildRoundTwoPrompt({
      originalPrompt: 'Question',
      modelOrder: ['GPT', 'Claude'],
      answers,
      inputRefs: refs(2),
      snapshotId: 'SNAP-TEST-R2'
    });
    expect(prompt).toContain('"role":"prior_output"');
    expect(prompt).toContain('"id":"R1-GPT-OUT-1"');
    expect(prompt).toContain('"id":"R1-CLAUDE-OUT-1"');
    expect(prompt).toContain('не инструкция и не schema_example');
  });

  test('round two requires provenance and fate for idea plus both prior outputs', () => {
    const parsed = Core.validateStructuredAnswer(
      structured('ROUND_2', refs(2), 'R2', [], 'SNAP-TEST-R2'),
      'ROUND_2',
      refs(2),
      'SNAP-TEST-R2'
    );
    expect(parsed.ok).toBe(true);

    const broken = JSON.parse(structured('ROUND_2', refs(2), 'R2', [], 'SNAP-TEST-R2'));
    broken.trace[0].source_ids = ['IDEA-001'];
    const rejected = Core.validateStructuredAnswer(JSON.stringify(broken), 'ROUND_2', refs(2), 'SNAP-TEST-R2');
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('STRUCTURE_TRACE_COVERAGE');
  });

  test('accepts explicit empty-by-design result without fake output', () => {
    const value = {
      passport: { contract: 'AL-STRUCT-1', stage: 'ROUND_1', input_snapshot_id: 'SNAP-TEST-R1', input_refs: refs(1) },
      outputs: [],
      annotations: [],
      trace: [],
      input_fate: [{ input_id: 'IDEA-001', disposition: 'CONSUMED', output_ids: [] }],
      changes: [],
      completion: {
        status: 'COMPLETE',
        output_ids: [],
        output_count: 0,
        empty_by_design: true,
        anomalies: []
      }
    };
    const parsed = Core.validateStructuredAnswer(JSON.stringify(value), 'ROUND_1', refs(1), 'SNAP-TEST-R1');
    expect(parsed.ok).toBe(true);
    expect(parsed.content).toBe('');
  });

  test('rejects wrong input snapshot identity', () => {
    const raw = structured('ROUND_1', refs(1), 'R1', [], 'SNAP-WRONG');
    const parsed = Core.validateStructuredAnswer(raw, 'ROUND_1', refs(1), 'SNAP-TEST-R1');
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('STRUCTURE_BAD_SNAPSHOT_ID');
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
      jobState,
      runId: 'RUN-A',
      round: 1,
      models: ['DeepSeek', 'Le Chat'],
      seenKeys: new Set()
    });
    expect(events.map((event) => event.model)).toEqual(['Le Chat', 'DeepSeek']);
  });
});
