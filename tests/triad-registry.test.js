const TriadRegistry = require('../disput/triad-registry');

const seed = (reg, turnId, text, model = 'GPT') =>
  TriadRegistry.appendEvent(reg, { turnId, waveKey: 'wave-1', model, text });

describe('TriadRegistry — pure artifact/trigger registry', () => {
  test('exposes a frozen API and catalog', () => {
    expect(Object.isFrozen(TriadRegistry)).toBe(true);
    expect(TriadRegistry.TRIGGER_CATALOG).toContain('UNSUPPORTED_CLAIM');
    expect(TriadRegistry.TRIGGER_CATALOG).toContain('RECURRING_WEAKNESS');
    expect(TriadRegistry.TRIGGER_CATALOG).toHaveLength(10);
  });

  test('createRegistry produces canonical empty shape', () => {
    const reg = TriadRegistry.createRegistry();
    expect(reg.wave).toBe(0);
    expect(reg.eventLog).toEqual([]);
    expect(reg.artifacts).toEqual({});
    expect(reg.pendingActions).toEqual([]);
    expect(reg.violations).toEqual([]);
    expect(reg.derived).toMatchObject({
      focusHistory: [],
      instructionBurdenLog: [],
      actionTargetHistory: [],
      routeHistory: [],
      logicalPatternLog: [],
      recurringWeaknessLog: []
    });
  });

  test('createRegistry accepts neutral duel mode', () => {
    const reg = TriadRegistry.createRegistry({ mode: 'duel' });
    expect(reg.mode).toBe('duel');
  });

  describe('event log', () => {
    test('append is idempotent per turnId', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'first');
      seed(reg, 't1', 'second');
      expect(reg.eventLog).toHaveLength(1);
      expect(TriadRegistry.getEvent(reg, 't1').text).toBe('second');
    });
  });

  describe('anchor validation', () => {
    test('accepts a verbatim quote and rejects a missing one', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'The sky is measurably blue today.');
      expect(TriadRegistry.anchorIsValid(reg, { turnId: 't1', quote: 'sky is measurably blue' })).toBe(true);
      expect(TriadRegistry.anchorIsValid(reg, { turnId: 't1', quote: 'sky is green' })).toBe(false);
      expect(TriadRegistry.anchorIsValid(reg, { turnId: 'nope', quote: 'sky is measurably blue' })).toBe(false);
    });

    test('rejects too-short quotes as unverifiable', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'a b c');
      expect(TriadRegistry.anchorIsValid(reg, { turnId: 't1', quote: 'a b' })).toBe(false);
    });
  });

  describe('applyDelta', () => {
    test('creates an artifact with a valid anchor', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'Models are strictly better than humans at logic.');
      const res = TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'claim', status: 'asserted', formulation: 'models beat humans',
        target: 'GPT', anchor: { turnId: 't1', quote: 'strictly better than humans' }
      });
      expect(res.ok).toBe(true);
      expect(reg.artifacts[res.id].type).toBe('claim');
      expect(reg.violations).toHaveLength(0);
    });

    test('rejects a create whose quote is not in the turn and logs a violation', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'Some real text here for anchoring.');
      const res = TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'claim', anchor: { turnId: 't1', quote: 'hallucinated evidence quote' }
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('anchor_not_found');
      expect(reg.violations).toHaveLength(1);
      expect(reg.violations[0].code).toBe('anchor_not_found');
    });

    test('rejects an update to a missing artifact', () => {
      const reg = TriadRegistry.createRegistry();
      const res = TriadRegistry.applyDelta(reg, { op: 'update', id: 'claim-9', status: 'supported' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('unknown_artifact');
    });

    test('rejects an illegal status for the type', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'A perfectly quotable sentence about definitions.');
      const created = TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'open_issue', anchor: { turnId: 't1', quote: 'perfectly quotable sentence' }
      });
      const res = TriadRegistry.applyDelta(reg, { op: 'update', id: created.id, status: 'supported' });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('illegal_status');
    });

    test('closing an issue requires a fresh valid anchor', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'An open point that both sides argue over here.');
      const created = TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'open_issue', anchor: { turnId: 't1', quote: 'both sides argue over' }
      });
      const noAnchor = TriadRegistry.applyDelta(reg, { op: 'update', id: created.id, status: 'closed' });
      expect(noAnchor.ok).toBe(false);
      expect(noAnchor.reason).toBe('unanchored_resolution');

      seed(reg, 't2', 'We now agree and concede this point fully.');
      const withAnchor = TriadRegistry.applyDelta(reg, {
        op: 'update', id: created.id, status: 'closed', anchor: { turnId: 't2', quote: 'agree and concede this point' }
      });
      expect(withAnchor.ok).toBe(true);
      expect(reg.artifacts[created.id].status).toBe('closed');
    });
  });

  describe('triggers, cooldown and primary selection', () => {
    test('valid trigger becomes a pending action; unknown trigger is a violation', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'An unsupported bold assertion without any evidence.');
      const ok = TriadRegistry.ingestTrigger(reg, {
        triggerId: 'UNSUPPORTED_CLAIM', target: 'GPT', severity: 'action_required',
        evidenceTurnId: 't1', evidenceQuote: 'bold assertion without any evidence', basis: 'no source'
      });
      expect(ok.ok).toBe(true);
      expect(reg.pendingActions).toHaveLength(1);

      const bad = TriadRegistry.ingestTrigger(reg, {
        triggerId: 'NOT_A_TRIGGER', target: 'GPT', evidenceTurnId: 't1', evidenceQuote: 'bold assertion'
      });
      expect(bad.ok).toBe(false);
      expect(bad.reason).toBe('unknown_trigger');
    });

    test('cooldown suppresses a duplicate trigger for the same target', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'The same weak point repeated without support again.');
      const trig = {
        triggerId: 'UNSUPPORTED_CLAIM', target: 'GPT', evidenceTurnId: 't1',
        evidenceQuote: 'weak point repeated without support'
      };
      expect(TriadRegistry.ingestTrigger(reg, trig).ok).toBe(true);
      const dup = TriadRegistry.ingestTrigger(reg, trig);
      expect(dup.ok).toBe(false);
      expect(dup.reason).toBe('cooldown');
      expect(reg.pendingActions).toHaveLength(1);
    });

    test('primary action picks highest severity then catalog priority', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'A strawman distortion plus a repeated point in one turn.');
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'REPEATED_POINT', target: 'GPT', severity: 'info',
        evidenceTurnId: 't1', evidenceQuote: 'repeated point in one turn'
      });
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'STRAWMAN', target: 'GPT', severity: 'action_required',
        evidenceTurnId: 't1', evidenceQuote: 'strawman distortion plus'
      });
      const primary = TriadRegistry.selectPrimaryAction(reg, 'GPT');
      expect(primary.triggerId).toBe('STRAWMAN');
    });
  });

  describe('serializeForPromptModel', () => {
    test('surfaces active artifacts and a rendered primary trigger', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'An unsupported claim about superiority stated boldly here.');
      TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'open_issue', formulation: 'superiority disputed',
        anchor: { turnId: 't1', quote: 'claim about superiority stated boldly' }
      });
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'UNSUPPORTED_CLAIM', target: 'GPT', severity: 'action_required',
        evidenceTurnId: 't1', evidenceQuote: 'claim about superiority stated boldly'
      });
      const out = TriadRegistry.serializeForPromptModel(reg, 'GPT');
      expect(out.context).toContain('Спор/open');
      expect(out.primaryTrigger).toContain('источник');
      expect(out.operationalSignals).toEqual(expect.any(String));
    });

    test('empty registry yields empty strings', () => {
      const reg = TriadRegistry.createRegistry();
      const out = TriadRegistry.serializeForPromptModel(reg, 'GPT');
      expect(out).toEqual({ context: '', primaryTrigger: '', operationalSignals: '' });
    });
  });

  describe('ingestCheckpoint and wave lifecycle', () => {
    test('applies mixed valid/invalid deltas and counts them', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'Claude asserts a controversial premise about cognition here.');
      const res = TriadRegistry.ingestCheckpoint(reg, {
        artifacts: [
          { op: 'create', type: 'claim', anchor: { turnId: 't1', quote: 'controversial premise about cognition' } },
          { op: 'create', type: 'claim', anchor: { turnId: 't1', quote: 'not present at all here friend' } }
        ],
        triggers: [
          { triggerId: 'CIRCULAR_ARGUMENT', target: 'Claude', evidenceTurnId: 't1', evidenceQuote: 'controversial premise about cognition' }
        ]
      });
      expect(res.applied).toBe(1);
      expect(res.actions).toBe(1);
      expect(res.rejected).toBe(1);
    });

    test('reconcile answers an UNSUPPORTED_CLAIM action once its claim is supported', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'GPT makes an assertion that lacks any citation whatsoever.');
      const created = TriadRegistry.applyDelta(reg, {
        op: 'create', type: 'claim', anchor: { turnId: 't1', quote: 'assertion that lacks any citation' }
      });
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'UNSUPPORTED_CLAIM', target: 'GPT', artifactId: created.id,
        evidenceTurnId: 't1', evidenceQuote: 'assertion that lacks any citation'
      });
      seed(reg, 't2', 'Here is a peer-reviewed source that fully supports the claim.');
      TriadRegistry.applyDelta(reg, {
        op: 'update', id: created.id, status: 'supported',
        anchor: { turnId: 't2', quote: 'peer-reviewed source that fully supports' }
      });
      expect(reg.pendingActions[0].status).toBe('answered');
    });

    test('advanceWave expires long-pending actions', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'A drifting tangent about something off topic entirely.');
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'TOPIC_DRIFT', target: 'GPT', evidenceTurnId: 't1', evidenceQuote: 'tangent about something off topic'
      });
      TriadRegistry.advanceWave(reg);
      TriadRegistry.advanceWave(reg);
      expect(reg.pendingActions[0].status).toBe('expired');
    });
  });

  describe('derived logs and lazy context', () => {
    test('recommendedFocus creates focusHistory entry without core artifact', () => {
      const reg = TriadRegistry.createRegistry();
      const res = TriadRegistry.ingestCheckpoint(reg, {
        recommendedFocus: {
          text: 'Focus on the evidence gap',
          targetArtifactIds: ['claim-1'],
          targetModels: ['GPT'],
          reason: 'unanswered'
        }
      }, { wave: 2 });
      expect(res.focus).toBe(1);
      expect(reg.derived.focusHistory).toHaveLength(1);
      expect(Object.values(reg.artifacts)).toHaveLength(0);
    });

    test('valid trigger creates actionTargetHistory, instructionBurden and logicalPatternLog', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'This is a strawman distortion of the opponent position.');
      TriadRegistry.ingestTrigger(reg, {
        triggerId: 'STRAWMAN',
        target: 'GPT',
        severity: 'action_required',
        evidenceTurnId: 't1',
        evidenceQuote: 'strawman distortion of the opponent'
      });
      expect(reg.pendingActions).toHaveLength(1);
      expect(reg.derived.actionTargetHistory).toHaveLength(1);
      expect(reg.derived.instructionBurdenLog[0]).toMatchObject({
        targetModel: 'GPT',
        instructionKind: 'clarify'
      });
      expect(reg.derived.logicalPatternLog[0]).toMatchObject({
        type: 'STRAWMAN',
        targetModel: 'GPT'
      });
    });

    test('three repeated logical triggers create recurringWeaknessLog entry', () => {
      const reg = TriadRegistry.createRegistry();
      for (let i = 1; i <= 3; i += 1) {
        reg.wave = i;
        seed(reg, `t${i}`, `Circular argument repeated in wave ${i} with the conclusion as premise.`);
        TriadRegistry.ingestTrigger(reg, {
          triggerId: 'CIRCULAR_ARGUMENT',
          target: 'Claude',
          evidenceTurnId: `t${i}`,
          evidenceQuote: `argument repeated in wave ${i} with the conclusion`
        });
      }
      expect(reg.derived.recurringWeaknessLog).toHaveLength(1);
      expect(reg.derived.recurringWeaknessLog[0]).toMatchObject({
        targetModel: 'Claude',
        weaknessType: 'CIRCULAR_ARGUMENT',
        count: 3,
        status: 'active'
      });
    });

    test('valid contextRequest can be consumed as full context once', () => {
      const reg = TriadRegistry.createRegistry();
      seed(reg, 't1', 'A long enough claim that needs full context for later inspection.');
      const created = TriadRegistry.applyDelta(reg, {
        op: 'create',
        type: 'open_issue',
        anchor: { turnId: 't1', quote: 'claim that needs full context' }
      });
      const res = TriadRegistry.ingestCheckpoint(reg, {
        contextRequests: [{ artifactId: created.id, reason: 'anchor too narrow' }]
      });
      expect(res.contextRequests).toBe(1);
      const contexts = TriadRegistry.consumePendingContextForCheckpoint(reg);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({ artifactId: created.id, turnId: 't1' });
      expect(TriadRegistry.consumePendingContextForCheckpoint(reg)).toHaveLength(0);
    });

    test('invalid contextRequest logs a violation', () => {
      const reg = TriadRegistry.createRegistry();
      const res = TriadRegistry.ingestCheckpoint(reg, {
        contextRequests: [{ artifactId: 'issue-missing', reason: 'need more' }]
      });
      expect(res.rejected).toBe(1);
      expect(reg.violations[0].code).toBe('unknown_context_artifact');
    });
  });

  test('computeRoundDelta is checkpoint-local and normalizes by participant count', () => {
    const reg = TriadRegistry.createRegistry();
    seed(reg, 't1', 'A sufficiently long first claim anchor appears here.');
    TriadRegistry.ingestCheckpoint(reg, { artifacts: [{ type: 'claim', anchor: { turnId: 't1', quote: 'long first claim anchor' } }] }, { wave: 1 });
    const baseline = reg.lastCheckpointId;
    seed(reg, 't2', 'A sufficiently long second claim anchor appears here.');
    TriadRegistry.ingestCheckpoint(reg, { artifacts: [{ type: 'claim', anchor: { turnId: 't2', quote: 'long second claim anchor' } }] }, { wave: 2 });
    const delta = TriadRegistry.computeRoundDelta(reg, { sinceCheckpointId: baseline, participantCount: 2 });
    expect(delta.newClaims).toHaveLength(1);
    expect(delta.participantCount).toBe(2);
    expect(delta.stagnation.newContentRatio).toBe(0.5);
  });

  describe('archival limit', () => {
    test('caps active open issues at MAX_ACTIVE_OPEN_ISSUES', () => {
      const reg = TriadRegistry.createRegistry();
      const limit = TriadRegistry.MAX_ACTIVE_OPEN_ISSUES;
      for (let i = 0; i < limit + 3; i += 1) {
        const tid = `t${i}`;
        seed(reg, tid, `Distinct open issue number ${i} that both sides dispute clearly.`);
        reg.artifacts[`x${i}`]; // no-op, readability
        TriadRegistry.applyDelta(reg, {
          op: 'create', type: 'open_issue',
          anchor: { turnId: tid, quote: `open issue number ${i} that both sides dispute` }
        });
      }
      const active = TriadRegistry.activeArtifacts(reg).filter((a) => a.type === 'open_issue');
      expect(active.length).toBeLessThanOrEqual(limit);
      expect(reg.archive.length).toBeGreaterThanOrEqual(3);
    });
  });
});
