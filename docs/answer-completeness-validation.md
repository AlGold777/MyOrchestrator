# Answer completeness validation

The extension treats command placement, prompt submission, generation, extraction, verification, and application as separate stages. A web answer is green only after the selected text, the candidate-node set, and the assistant-message root remain stable while no generation control is active.

## Automated structural matrix

Run `npm run test:answer-matrix`. The fixtures cover stable complete answers, late sibling blocks, stale answers from another dispatch, and an answer that looks stable while generation is still active. Add provider-specific DOM shapes to `tests/fixtures/answer-structure-cases.json` whenever selectors change.

## Authenticated real-run matrix

B1 skeletons validate selectors and the structure visible at capture time. They do
not reconstruct the DOM that existed when an earlier finalization decision was made.
For B2 calibration, use a unique `B2-...-END-...` marker as the final requested line;
the finalization event records marker presence together with its decision-time
structural and generation-signal snapshot.

For every supported provider, exercise these cases in Standard and Long timing profiles:

1. Normal long response with paragraphs, lists, code, and citations.
2. Very short legitimate response.
3. Delayed prompt submission after focus activation.
4. Generation continuing while the visible text pauses.
5. A final block or citation appearing after the main prose.
6. Service-worker suspension between submission and collection.
7. Status double-click after failure and after success.
8. Export during generation and after all answers are verified.

Pass criteria: no green empty card; no red `NO_SEND` after confirmed submission; incomplete structural snapshots remain orange; automatic late revisions only append within the same dispatch and generation epoch; manual replacement explains whether it applied, found nothing newer, or was rejected.
