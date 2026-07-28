const Controller = require('../results/debate-controller');

test('run controls are a projection of canonical run status', () => {
  expect(Controller.deriveRunControls({ aggregate: { status: 'idle' } }).action).toBe('run');
  expect(Controller.deriveRunControls({ aggregate: { status: 'running' }, autoMode: true }).action).toBe('pause');
  expect(Controller.deriveRunControls({ aggregate: { status: 'running' }, autoMode: false }).action).toBe('next');
  expect(Controller.deriveRunControls({ aggregate: { status: 'technical_pause' } }).action).toBe('resume');
  expect(Controller.deriveRunControls({ aggregate: { status: 'awaiting_approval' }, approvalWaiting: true }).stepEnabled).toBe(true);
  expect(Controller.deriveRunControls({ aggregate: { status: 'idle' }, startPending: true }))
    .toMatchObject({ action: 'wait', enabled: false });
});
