const Confirmation = require('../shared/provider-submit-confirmation');

describe('provider submission confirmation', () => {
  const oldBusy = {};
  const baseline = () => Confirmation.capture({
    userTurnCount: 4,
    responseCount: 4,
    composerTextLength: 120,
    generationElements: [oldBusy]
  });

  test('composer clearing without a new turn remains unconfirmed', () => {
    const result = Confirmation.evaluate(baseline(), {
      userTurnCount: 4,
      responseCount: 4,
      composerTextLength: 0,
      generationElements: [oldBusy]
    });
    expect(result.composerCleared).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.directSignals).toEqual([]);
  });

  test('composer shrinking below ten percent remains unconfirmed', () => {
    const result = Confirmation.evaluate(baseline(), {
      userTurnCount: 4,
      responseCount: 4,
      composerTextLength: 10,
      generationElements: [oldBusy]
    });
    expect(result.composerShrank).toBe(true);
    expect(result.confirmed).toBe(false);
  });

  test('a busy element that existed before Send remains unconfirmed', () => {
    const result = Confirmation.evaluate(baseline(), {
      userTurnCount: 4,
      responseCount: 4,
      composerTextLength: 120,
      generationElements: [oldBusy]
    });
    expect(result.freshGenerationElement).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  test.each([
    ['new user turn', { userTurnCount: 5, responseCount: 4, composerTextLength: 0, generationElements: [oldBusy] }, 'new_user_turn'],
    ['fresh generation element', { userTurnCount: 4, responseCount: 4, composerTextLength: 120, generationElements: [oldBusy, {}] }, 'fresh_generation_element'],
    ['new response node', { userTurnCount: 4, responseCount: 5, composerTextLength: 120, generationElements: [oldBusy] }, 'new_response_node']
  ])('%s confirms submission', (_name, snapshot, signal) => {
    const result = Confirmation.evaluate(baseline(), snapshot);
    expect(result.confirmed).toBe(true);
    expect(result.directSignals).toContain(signal);
  });
});
