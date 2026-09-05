const fs = require('fs');
const vm = require('vm');
const PipelineFSM = require('../shared/pipeline-fsm');
const router = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');

function worker(jobState) {
  const context = { jobState, Date, saveJobState: jest.fn(), completionAuthorityAttempts: new Map() };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(router.slice(router.indexOf('const completionAuthorityKey'),
    router.indexOf('const PERPLEXITY_TRANSIENT_BLOCKER_KIND')), context);
  return context.CompletionAuthorityRegistry;
}

test('Gemini accepted attempt survives actual storage compaction and worker restart', () => {
  const identity = { runSessionId: '1788605894935', dispatchId: 'Gemini:1788605894935:4', generationEpoch: 1 };
  const state = { session: { startTime: 1788605894935 }, llms: { Gemini: {
    lastDispatchMeta: identity, runIdentity: identity, pendingFinalAnswerDispatchId: identity.dispatchId
  } } };
  worker(state).recordAttempt('Gemini', { ...identity, rolloutMode: 'enforced' });
  const restored = JSON.parse(JSON.stringify(PipelineFSM.compactJobStateForStorage(state)));
  const restarted = worker(restored);
  expect(restarted.get('Gemini').dispatchId).toBe(identity.dispatchId);
  expect(restored.llms.Gemini.runIdentity).toEqual(identity);
  expect(restored.llms.Gemini.pendingFinalAnswerDispatchId).toBe(identity.dispatchId);
  expect(restarted.validateDelivery('Gemini', { answer: 'Answer'.repeat(651), meta: identity })).toMatchObject({
    ok: true, reason: 'attempt_authority_pending_terminal_verification'
  });
  expect(restarted.validateDelivery('Gemini', { answer: 'Old answer', meta: { ...identity, dispatchId: 'old' } }).ok).toBe(false);
});

test('restart does not invent authority for an unregistered attempt', () => {
  const restored = PipelineFSM.compactJobStateForStorage({ llms: { Gemini: { lastDispatchMeta: { dispatchId: 'new' } } } });
  expect(worker(restored).validateDelivery('Gemini', { answer: 'text', meta: { dispatchId: 'new' } })).toMatchObject({
    ok: false, reason: 'completion_attempt_unregistered'
  });
});
