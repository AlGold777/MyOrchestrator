/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const load = (file) => window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const AnswerEvidence = require('../shared/answer-evidence');

// The contract is only worth anything if it survives the trip from the
// pipeline, through the adapter's responseMeta, to the background gate that
// decides whether the answer is accepted. This walks that whole chain.
describe('run result delivery: pipeline -> responseMeta -> AnswerEvidence', () => {
  beforeEach(() => {
    delete window.ContentUtils;
    load('content-scripts/content-utils.js');
  });

  test('buildResponseMeta carries the run result out of the pipeline metadata', () => {
    const meta = window.ContentUtils.buildResponseMeta({
      finalization: {
        runResult: { type: 'SUSPECTED_COMPLETE', guarantee: 'HEURISTIC', strongestEvidenceClass: 'P3' },
        answerVerification: { verified: true }
      }
    }, { source: 'pipeline' });

    expect(meta.runResult).toEqual(expect.objectContaining({
      type: 'SUSPECTED_COMPLETE',
      guarantee: 'HEURISTIC'
    }));
  });

  test('a top-level run result on the metadata is carried too', () => {
    const meta = window.ContentUtils.buildResponseMeta({
      runResult: { type: 'COMMITTED', guarantee: 'STRICT' }
    }, { source: 'pipeline' });
    expect(meta.runResult.type).toBe('COMMITTED');
  });

  test('a fallback path with no pipeline result carries null, not an invented success', () => {
    const meta = window.ContentUtils.buildResponseMeta(null, { source: 'dom-fallback' });
    expect(meta.runResult).toBeNull();
    expect(meta.completionReason).toBe('pipeline_failed');
  });

  test('an unproven run reaching the background gate is not accepted as a plain success', () => {
    const responseMeta = window.ContentUtils.buildResponseMeta({
      finalization: {
        runResult: { type: 'UNKNOWN', guarantee: 'BLIND', strongestEvidenceClass: 'P4' }
      }
    }, { source: 'pipeline' });

    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'GPT',
      text: 'An answer nobody actually proved. '.repeat(10),
      responseMeta
    });

    expect(evidence.resultType).toBe('UNKNOWN');
    expect(evidence.partialAllowed).toBe(true);
    // Not merely downgraded to PARTIAL: an unproven run is not finalized from
    // this evidence path at all, and the refusal names the run result.
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual({
      ok: false,
      reason: 'unproven_run_result_unknown'
    });
  });

  test('a proven run keeps its strict guarantee all the way to the gate', () => {
    const responseMeta = window.ContentUtils.buildResponseMeta({
      finalization: {
        runResult: { type: 'COMMITTED', guarantee: 'STRICT', strongestEvidenceClass: 'P0' }
      }
    }, { source: 'pipeline' });

    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'GPT',
      text: 'A proven answer. '.repeat(10),
      responseMeta
    });

    expect(evidence.resultGuarantee).toBe('STRICT');
    expect(evidence.evidenceClass).toBe('P0');
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'SUCCESS'
    }));
  });
});
