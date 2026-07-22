const Catalog = require('../disput/debate-prompt-catalog');

test('UI prompt helpers validate the universal synthesis contract', () => {
  expect(Catalog.normalizeMaxWords('700')).toBe(700);
  expect(Catalog.resolveDiscussionTopic({ moderatorMessage: 'Question' })).toBe('Question');
  expect(Catalog.validateSynthesisSections('## Вердикт\nA')).toContain('Что устояло');
});
