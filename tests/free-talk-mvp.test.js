const Profiles = require('../disput/debate-profile-schema');
const StateMap = require('../disput/debate-state-map');
const FreeTalk = require('../disput/free-talk-runtime');

describe('FreeTalk MVP profile', () => {
  test('compiles an open-ended profile without fixed model or round limits', () => {
    const profile = Profiles.BUILTIN_PROFILES.FREE_TALK_MVP;
    expect(Profiles.validate(profile)).toEqual({ ok: true, errors: [] });
    const plan = Profiles.compile(profile, {
      problemSpec: { goal: 'Find a robust answer' },
      assignments: { participant: ['GPT', 'Claude', 'Gemini'] },
      budget: { limit: 100 }
    });
    expect(plan.profileId).toBe('FREE_TALK_MVP');
    expect(plan.policies.fixedRoundLimit).toBeNull();
    expect(plan.policies.fixedModelLimit).toBeNull();
    expect(plan.triggers).toContain('BLOCKING_OBJECTION');
    expect(Object.isFrozen(plan)).toBe(true);
  });

  test('rejects profiles that let model self-report control execution', () => {
    const bad = {
      ...Profiles.BUILTIN_PROFILES.FREE_TALK_MVP,
      id: 'BAD',
      policies: { ...Profiles.BUILTIN_PROFILES.FREE_TALK_MVP.policies, modelSelfReportControlsFlow: true }
    };
    expect(Profiles.validate(bad).errors).toContain('profile_self_report_flow_forbidden');
  });
});

describe('Debate state map projection', () => {
  const aggregate = {
    runId: 'run-1', sessionId: 's1', status: 'running', config: { topic: 'Remote work' },
    executionPlan: { profileId: 'FREE_TALK_MVP' },
    protocolState: {
      registry: {
        artifacts: {
          c1: { id: 'c1', type: 'claim', status: 'contested', formulation: 'Remote helps focus', wave: 1 },
          o1: { id: 'o1', type: 'objection', status: 'raised', formulation: 'Selection bias', targetId: 'c1', severity: 'blocking', wave: 2 },
          r1: { id: 'r1', type: 'revision', status: 'recorded', formulation: 'Narrowed claim', claimId: 'c1', wave: 3 }
        }
      }
    },
    events: [{ id: 'e1', type: 'START_REQUESTED', at: 1, payload: {} }]
  };

  test('projects links, blockers, readiness and timeline from the canonical state', () => {
    const map = StateMap.project(aggregate);
    expect(map.title).toBe('Remote work');
    expect(map.links).toContainEqual({ from: 'o1', to: 'c1', type: 'objection', blocking: true });
    expect(map.stats.blockers).toBe(1);
    expect(map.readiness.id).toBe('not_ready');
    expect(map.timeline).toHaveLength(1);
  });

  test('does not claim readiness without an active run', () => {
    expect(StateMap.project({}).readiness.id).toBe('idle');
  });
});

describe('FreeTalk trigger planning', () => {
  test('prioritizes a blocker and deduplicates repeated trigger evaluation', () => {
    const map = StateMap.project({
      runId: 'run-1',
      protocolState: { registry: { artifacts: {
        c1: { id: 'c1', type: 'claim', status: 'contested', formulation: 'Claim' },
        o1: { id: 'o1', type: 'objection', status: 'raised', targetId: 'c1', formulation: 'Blocker', severity: 'blocking' }
      } } }
    });
    const first = FreeTalk.plan(map, FreeTalk.createState({ budget: { limit: 10, reserved: 1 } }));
    expect(first.next.triggerId).toBe('BLOCKING_OBJECTION');
    const second = FreeTalk.plan(map, first.state);
    expect(second.state.queue.filter((task) => task.triggerId === 'BLOCKING_OBJECTION')).toHaveLength(1);
  });

  test('does not dispatch when only reserved budget remains', () => {
    const state = FreeTalk.createState({ budget: { used: 9, limit: 10, reserved: 1 } });
    const result = FreeTalk.plan({ claims: [{ id: 'c1' }], objections: [], evidence: [], revisions: [], dissent: [], blockers: [], readiness: { id: 'not_ready' } }, state);
    expect(result.next).toBeNull();
    expect(result.blockedByBudget).toBe(true);
  });

  test('holds expensive fact verification for a human decision', () => {
    const state = FreeTalk.createState();
    const result = FreeTalk.plan({
      runId: 'run-1', claims: [], objections: [], blockers: [], revisions: [], dissent: [], evidence: [{ id: 'e1', status: 'disputed', tier: 'external_source' }], readiness: { id: 'not_ready' }
    }, state);
    expect(result.awaitingHuman[0]).toMatchObject({ triggerId: 'FACT_DISPUTE', status: 'awaiting_confirmation' });
    expect(result.batch.some((task) => task.triggerId === 'FACT_DISPUTE')).toBe(false);
    const approved = FreeTalk.confirm(result.state, result.awaitingHuman[0].id, true);
    expect(FreeTalk.plan({ claims: [], objections: [], blockers: [], revisions: [], dissent: [], evidence: [] }, approved).next.triggerId).toBe('FACT_DISPUTE');
  });

  test('settles tasks with cooldown and accounts their declared cost', () => {
    const task = { id: 't1', triggerId: 'WEAK_EVIDENCE', targetId: 'e1', cost: 1, status: 'pending' };
    const state = FreeTalk.createState({ seq: 3, queue: [task], active: [task], budget: { used: 2, limit: 10, reserved: 1 } });
    const settled = FreeTalk.settle(state, task, 'completed');
    expect(settled.queue).toHaveLength(0);
    expect(settled.budget.used).toBe(3);
    expect(settled.cooldowns['WEAK_EVIDENCE:e1']).toBe(5);
  });
});
