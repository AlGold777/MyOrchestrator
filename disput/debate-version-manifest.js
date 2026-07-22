(function initDebateVersionManifest(root) {
  'use strict';
  // Schema policy: increment runStoreSchema for persisted state/event shape;
  // increment protocol for phase semantics or mandatory prompt sections.
  function getVersions() {
    let implementation = 'dev';
    try { implementation = root.chrome?.runtime?.getManifest?.().version || 'dev'; } catch (_) {}
    const promptPackVersion = String(root.DebatePromptPack?.VERSION || '1.0.0');
    const promptPackMajor = Number.parseInt(promptPackVersion.split('.')[0], 10) || 1;
    return Object.freeze({
      implementation,
      // Protocol 5 adds typed moderator decisions, parameterized rule traces,
      // explicit progress windows and diagnostic-only model signals.
      protocol: 5,
      planSchema: 3,
      caseSchema: Number(root.DebateCaseSchema?.VERSION || 1),
      profileSchema: Number(root.DebateProfileSchema?.VERSION || 1),
      promptPack: promptPackMajor,
      promptPackVersion,
      stateMap: Number(root.DebateStateMap?.VERSION || 1),
      runStoreSchema: Number(root.DebateRunStore?.VERSION || 1),
      traceSchema: Number(root.DebateTraceSchema?.VERSION || 1)
      ,taskContractSchema: Number(root.DebateContracts?.VERSION || 1)
      ,stageContractSchema: Number(root.DebateContracts?.VERSION || 1)
      ,actionContractSchema: Number(root.DebateContracts?.VERSION || 1)
      ,promptCompiler: Number(root.DebatePromptCompiler?.VERSION || 1)
      ,contextBroker: Number(root.DebateContextBroker?.VERSION || 1)
      ,stateDeltaSchema: Number(root.DebateStateDelta?.VERSION || 1)
      ,capabilityRegistry: Number(root.DebateCapabilityRegistry?.VERSION || 1)
      ,decisionRequestSchema: Number(root.DebateDecisionRequest?.VERSION || 1)
      ,ruleEngine: Number(root.DebateRuleEngine?.VERSION || 1)
      ,ruleHistory: Number(root.DebateRuleHistory?.VERSION || 1)
      ,modelSignalSchema: Number(root.DebateModelSignal?.VERSION || 1)
    });
  }
  const api = Object.freeze({ getVersions });
  root.DebateVersionManifest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
