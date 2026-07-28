const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UNIVERSAL_MODULES = [
  'debate-policies.js', 'debate-plan-revision.js', 'debate-planner.js',
  'debate-stage-executor.js', 'debate-orchestrator.js', 'debate-application.js'
];
const read = (file) => fs.readFileSync(path.join(ROOT, 'disput', file), 'utf8');

describe('Repository gates — universal execution path', () => {
  test.each(UNIVERSAL_MODULES)('%s contains no named legacy execution mode', (file) => {
    const forbidden = new RegExp(`\\b(${['du' + 'el', 'tri' + 'ad', 'free_' + 'talk', 'free' + 'talk'].join('|')})\\b|['"]${'mul' + 'ti'}['"]`, 'i');
    expect(read(file)).not.toMatch(forbidden);
  });

  test.each(UNIVERSAL_MODULES)('%s contains no hidden participant limits', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/maxModels\s*=\s*\d/);
    expect(source).not.toMatch(/participants\.slice\(0,\s*2\)/);
    expect(source).not.toMatch(/selectedModels\.length\s*>\s*2/);
  });

  test('participant cardinality has exactly one validation source', () => {
    for (const file of UNIVERSAL_MODULES.filter((file) => file !== 'debate-policies.js')) {
      expect(read(file)).not.toMatch(/cardinality/i);
    }
    expect(read('debate-policies.js')).toMatch(/ParticipantCardinality|cardinality/i);
  });

  test('production HTML does not load removed execution switches or executors', () => {
    const removedLoaderPattern = new RegExp(`${'disput-evolution-flags'}|${'free-' + 'talk'}-(runner|runtime|protocol)`);
    for (const file of ['pipeline_panel.html', 'result_new.html']) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toMatch(removedLoaderPattern);
    }
  });
});
