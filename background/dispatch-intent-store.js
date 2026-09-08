// Small write-ahead records for the first pass. They survive MV3 worker restarts
// in chrome.storage.session without waiting for compressed job/telemetry writes.
(function initDispatchIntentStore(root) {
  'use strict';
  const keyFor = model => `llm_dispatch_intent_v1:${encodeURIComponent(model)}`;
  const bounded = async (operation, ms = 2000) => {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dispatch_intent_storage_timeout')), ms); })
      ]);
    } finally { clearTimeout(timer); }
  };

  async function persist(model, tabId, entry) {
    const meta = entry.lastDispatchMeta;
    if (!meta?.runSessionId || !meta?.dispatchId) return false;
    const record = {
      runSessionId: meta.runSessionId, tabId,
      lastDispatchMeta: {...meta},
      runIdentity: entry.runIdentity ? {...entry.runIdentity} : null,
      generationEpoch: entry.generationEpoch || 0,
      dispatchAttempts: entry.dispatchAttempts || 0,
      lastDispatchAt: entry.lastDispatchAt || Date.now(),
      dispatchCheckpoint: {dispatchId: meta.dispatchId, phase: 'command_intent'}
    };
    try {
      // This write overlaps foreground preparation. A two-second cutoff used
      // to discard live commands merely because Chrome delivered the ACK late.
      await bounded(() => chrome.storage.session.set({[keyFor(model)]: record}), 10000);
      return true;
    } catch (_) { return false; }
  }

  async function restore(state) {
    const models = Object.keys(state?.llms || {});
    if (!models.length || !state?.session?.startTime) return;
    // A failed read must not resume an older snapshot and repeat an uncertain
    // command. Let loadJobState fail closed and retry on its next wake.
    const records = await bounded(() => chrome.storage.session.get(models.map(keyFor)));
    for (const model of models) {
      const record = records?.[keyFor(model)];
      const entry = state.llms[model];
      if (!record || String(record.runSessionId) !== String(state.session.startTime)
        || !record.lastDispatchMeta?.dispatchId || !Number.isInteger(record.tabId)
        || !entry || entry.finalStatusRecorded || entry.finalizedAt || entry.promptSubmittedAt) continue;
      const storedEpoch = Number(entry.generationEpoch || 0);
      const journalEpoch = Number(record.generationEpoch || 0);
      if (storedEpoch > journalEpoch) continue;
      if (storedEpoch === journalEpoch && entry.lastDispatchMeta?.dispatchId
        && entry.lastDispatchMeta.dispatchId !== record.lastDispatchMeta.dispatchId) continue;
      const sameDispatch = entry.lastDispatchMeta?.dispatchId === record.lastDispatchMeta.dispatchId;
      if (!sameDispatch) {
        Object.assign(entry, {
          tabId: record.tabId, lastDispatchMeta: {...record.lastDispatchMeta},
          generationEpoch: journalEpoch, dispatchAttempts: record.dispatchAttempts,
          lastDispatchAt: record.lastDispatchAt,
          runIdentity: record.runIdentity, answerVerification: null,
          recentDispatchIds: [...new Set([...(entry.recentDispatchIds || []), record.lastDispatchMeta.dispatchId])].slice(-8)
        });
      }
      entry.dispatchCheckpoint = {...record.dispatchCheckpoint};
      entry.awaitingSubmitConfirmation = true;
      entry.awaitingSubmitConfirmationDispatchId = record.lastDispatchMeta.dispatchId;
    }
  }

  root.DispatchIntentStore = {persist, restore};
})(self);
