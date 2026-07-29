describe('Humanoid lifecycle error evidence', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    delete window.HumanoidEvents;
    delete window.HumanoidLifecycle;
    delete window.withHumanoidActivity;
    require('../utils/humanoid-lifecycle.js');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('preserves insertion error type and privacy-safe activity context', () => {
    const observed = [];
    window.HumanoidEvents.addEventListener('activity:error', (event) => observed.push(event.detail));
    const traceId = window.HumanoidEvents.start('gpt:inject', {
      promptLength: 321,
      mode: 'interactive'
    });

    window.HumanoidEvents.error(traceId, {
      type: 'prompt_injection_failed',
      message: 'composer rejected prepared prompt'
    }, true);

    expect(observed).toEqual([expect.objectContaining({
      traceId,
      errorType: 'prompt_injection_failed',
      error: 'composer rejected prepared prompt',
      source: 'gpt:inject',
      promptLength: 321,
      fatal: true
    })]);
    expect(observed[0]).not.toHaveProperty('prompt');
  });
});
