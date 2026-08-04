(function initProviderSubmitConfirmation(root) {
  'use strict';

  function finiteCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function capture(snapshot = {}) {
    return {
      userTurnCount: finiteCount(snapshot.userTurnCount),
      responseCount: finiteCount(snapshot.responseCount),
      composerTextLength: finiteCount(snapshot.composerTextLength),
      generationElements: new Set(Array.from(snapshot.generationElements || []))
    };
  }

  function evaluate(baseline = {}, snapshot = {}) {
    const currentGeneration = Array.from(snapshot.generationElements || []);
    const baselineGeneration = baseline.generationElements instanceof Set
      ? baseline.generationElements
      : new Set(Array.from(baseline.generationElements || []));
    const newUserTurn = finiteCount(snapshot.userTurnCount) > finiteCount(baseline.userTurnCount);
    const newResponseNode = finiteCount(snapshot.responseCount) > finiteCount(baseline.responseCount);
    const freshGenerationElement = currentGeneration.some((element) => !baselineGeneration.has(element));
    const trustedBrowserDispatch = snapshot.trustedBrowserDispatch === true;
    const beforeLength = finiteCount(baseline.composerTextLength);
    const currentLength = finiteCount(snapshot.composerTextLength);
    const composerCleared = beforeLength > 0 && currentLength === 0;
    const composerShrank = beforeLength > 10
      && currentLength <= Math.max(1, Math.floor(beforeLength * 0.1));
    const directSignals = [];
    if (newUserTurn) directSignals.push('new_user_turn');
    if (freshGenerationElement) directSignals.push('fresh_generation_element');
    if (newResponseNode) directSignals.push('new_response_node');
    // A successful CDP command proves only that an input event was delivered to
    // the page. It does not prove that the provider accepted the prompt.
    return {
      confirmed: directSignals.length > 0,
      directSignals,
      newUserTurn,
      freshGenerationElement,
      newResponseNode,
      trustedBrowserDispatch,
      composerCleared,
      composerShrank,
      currentComposerTextLength: currentLength
    };
  }

  const api = Object.freeze({ capture, evaluate });
  root.ProviderSubmitConfirmation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
