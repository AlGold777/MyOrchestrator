const ProcessAudit = require('../disput/debate-process-audit');

describe('DebateProcessAudit', () => {
  test('fails critique coverage when registry extracted zero claims', () => {
    const result = ProcessAudit.audit({ registry: { artifacts: {} }, plan: { stages: [] }, traceEvents: [] });
    expect(result.checks.find((item) => item.id === 'claims_received_critique')).toMatchObject({ verdict: 'fail' });
  });

  test('does not treat provider-level terminal skips as completed protocol stages', () => {
    const plan = { stages: [{ stageId: 'r1:wave' }] };
    const result = ProcessAudit.audit({
      plan, traceEvents: [{ type: 'STAGE_SKIPPED', payload: { stageId: 'r1:wave', reasonCode: 'PARTICIPANT_ALREADY_TERMINAL' } }]
    });
    expect(result.checks.find((item) => item.id === 'plan_executed')).toMatchObject({ verdict: 'fail' });
  });
});
