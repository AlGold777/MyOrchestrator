/** @jest-environment jsdom */
const fs=require('fs');
const source=fs.readFileSync(require.resolve('../content-scripts/content-perplexity'),'utf8');
const proof=require('../shared/provider-submit-confirmation');
test('current Perplexity user bubbles provide new-turn evidence without matching sidebar links',()=>{
  window.ProviderSubmitConfirmation=proof;
  const start=source.indexOf('const PERPLEXITY_USER_TURN_SELECTORS');
  const end=source.indexOf('const waitForVisiblePerplexityComposer',start);
  window.eval(source.slice(start,end)+'\nwindow.readSubmitCount=countPerplexityUserTurns;');
  document.body.innerHTML='<aside><a>8 / 4</a></aside><div class="group group/user-bubble"><span>old prompt</span></div>';
  const baseline=proof.capture({userTurnCount:window.readSubmitCount()});
  expect(baseline.userTurnCount).toBe(1);
  expect(proof.evaluate(baseline,{userTurnCount:window.readSubmitCount()}).confirmed).toBe(false);
  document.body.insertAdjacentHTML('beforeend','<div class="group group/user-bubble flex"><span>8 / 4</span></div>');
  expect(window.readSubmitCount()).toBe(2);
  expect(proof.evaluate(baseline,{userTurnCount:window.readSubmitCount()}).directSignals).toContain('new_user_turn');
  delete window.readSubmitCount;
  delete window.ProviderSubmitConfirmation;
});
