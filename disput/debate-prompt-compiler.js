// Compiles TaskContract + StageContract + ContextView into a reproducible prompt.
(function initDebatePromptCompiler(root) {
  'use strict';
  const VERSION = 1;
  const Contracts = root.DebateContracts || (typeof require === 'function' ? require('./debate-contracts') : null);
  const Broker = root.DebateContextBroker || (typeof require === 'function' ? require('./debate-context-broker') : null);
  const Pack = root.DebatePromptPack || (typeof require === 'function' ? require('./debate-prompt-pack') : null);
  const text = (value) => String(value == null ? '' : value).trim();

  function resolvePack(input = {}) {
    const pack = input.promptPack || Pack;
    if (!pack?.render || !pack?.VERSION || !pack?.PACK_ID) throw new Error('Debate prompt pack is unavailable');
    const expected = input.profile?.promptPack;
    if (expected && (expected.id !== pack.PACK_ID || expected.version !== pack.VERSION)) {
      throw new Error(`Prompt pack mismatch: expected ${expected.id}@${expected.version}, received ${pack.PACK_ID}@${pack.VERSION}`);
    }
    return pack;
  }

  function targetText(map = {}, targetId = '') {
    if (!targetId) return '';
    const parts = Broker?.artifactParts?.(map) || [];
    const target = parts.find((part) => part.id === targetId);
    return target ? `[${target.type} ${target.id}] ${target.text}` : targetId;
  }

  function compile(input = {}) {
    if (!Contracts || !Broker) throw new Error('Debate prompt compiler dependencies are unavailable');
    const task = Contracts.createTaskContract(input.task || input);
    const action = input.action ? Contracts.createActionContract(input.action) : null;
    const stage = Contracts.createStageContract({
      ...(input.stage || {}),
      operation: input.stage?.operation || action?.operation || 'opening',
      role: input.stage?.role || action?.role || 'participant',
      targetId: input.stage?.targetId || action?.targetId || '',
      expectedArtifactTypes: input.stage?.expectedArtifactTypes || action?.expectedArtifactTypes || [],
      independence: input.stage?.independence || action?.independence || 'none',
      maxWords: input.stage?.outputContract?.maxWords || input.stage?.maxWords || task.maxWords,
      outputContract: {
        ...(input.stage?.outputContract || {}),
        maxWords: input.stage?.outputContract?.maxWords || input.stage?.maxWords || task.maxWords,
        completion: input.stage?.outputContract?.completion || action?.completion || input.stage?.purpose || ''
      }
    });
    const taskVerdict = Contracts.validateTaskContract(task);
    const stageVerdict = Contracts.validateStageContract(stage);
    if (!taskVerdict.ok || !stageVerdict.ok) throw new Error(`Invalid prompt contracts: ${[...taskVerdict.errors, ...stageVerdict.errors].join(', ')}`);
    const pack = resolvePack(input);
    const baseEstimate = 1200 + task.objective.length + (action?.instruction?.length || 0);
    const context = Broker.select({
      stage, task, map: input.map || {}, parts: input.contextParts || [], turns: input.turns || [],
      limits: input.limits, baseChars: baseEstimate
    });
    const contextText = Broker.render(context);
    const prompt = pack.render({ task, stage, action, contextText, targetText: targetText(input.map, stage.targetId), model: input.model });
    const template = pack.definition(stage.operation, stage.role);
    const fingerprint = Contracts.hash({
      compilerVersion: VERSION, promptPack: `${pack.PACK_ID}@${pack.VERSION}`,
      task: task.fingerprint, stage: stage.fingerprint, action: action?.fingerprint || '',
      context: context.parts.map((part) => ({ id: part.id, text: part.text, provenance: part.provenance })),
      model: text(input.model), generation: input.generation || {}
    });
    return Object.freeze({
      compilerVersion: VERSION, promptPack: Object.freeze({ id: pack.PACK_ID, version: pack.VERSION }),
      template, task, stage, action, context, prompt, fingerprint,
      validator: Object.freeze({
        taskClass: task.taskClass,
        outputKind: stage.outputContract.kind,
        maxWords: stage.outputContract.maxWords,
        requiredSections: stage.outputContract.requiredSections,
        allowShort: stage.outputContract.allowShort || task.taskClass === 'direct_answer',
        schemaId: stage.outputContract.schemaId,
        kind: stage.operation === 'synthesis' ? 'synthesis' : stage.service ? 'service' : 'participant'
      })
    });
  }

  function repairPrompt(compiled, violations = []) {
    const errors = (Array.isArray(violations) ? violations : [violations]).map(text).filter(Boolean);
    return [
      compiled?.prompt || '',
      'Предыдущий ответ нарушил контракт результата.',
      `Исправь только эти нарушения: ${errors.join('; ') || 'не выполнен формат'}.`,
      'Верни полный исправленный ответ. Не обсуждай процесс исправления.'
    ].filter(Boolean).join('\n\n');
  }

  const api = Object.freeze({ VERSION, compile, repairPrompt, resolvePack });
  root.DebatePromptCompiler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
