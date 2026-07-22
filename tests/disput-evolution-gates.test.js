// Repository gates (Extraction Contract §23, Roadmap Slice M — scoped to the new
// execution path while legacy modules still exist behind their removal gate).
const fs = require('fs');
const path = require('path');

const NEW_PATH_MODULES = [
  'debate-policies.js',
  'debate-plan-revision.js',
  'debate-planner.js',
  'debate-stage-executor.js',
  'debate-orchestrator.js'
];

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'disput', file), 'utf8');

describe('Repository gates — new execution path', () => {
  test.each(NEW_PATH_MODULES)('%s contains no topology terminology', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\b(duel|triad|free_talk|freetalk)\b/i);
    expect(source).not.toMatch(/\btopology\b/i);
  });

  test.each(NEW_PATH_MODULES)('%s contains no hidden participant limits', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/maxModels\s*=\s*\d/);
    expect(source).not.toMatch(/participants\.slice\(0,\s*2\)/);
    expect(source).not.toMatch(/selectedModels\.length\s*>\s*2/);
  });

  test('participant cardinality has exactly one validation source', () => {
    // Only debate-policies.js may define cardinality rules; other new modules must not.
    for (const file of NEW_PATH_MODULES.filter((f) => f !== 'debate-policies.js')) {
      expect(read(file)).not.toMatch(/cardinality/i);
    }
    expect(read('debate-policies.js')).toMatch(/ParticipantCardinality|cardinality/i);
  });

  test('new modules do not import legacy runners', () => {
    for (const file of NEW_PATH_MODULES) {
      expect(read(file)).not.toMatch(/require\(['"]\.\/(duel|triad|multi|free-talk)-runner['"]\)/);
    }
  });

  test('every slice feature flag exists and defaults to off (legacy remains primary)', () => {
    const Flags = require('../disput/disput-evolution-flags');
    const sliceFlags = ['caseFirstRuntime', 'stageExecutorDynamic', 'rulePlanner', 'persistedPause',
      'humanParticipant', 'planRevisions', 'canvasCommands', 'parallelExecutor', 'sequentialExecutor', 'universalEngine'];
    for (const flag of sliceFlags) {
      expect(Flags.DEFAULTS).toHaveProperty(flag, false);
    }
  });
});
