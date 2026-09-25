# Automation Layer — final structural protocol

Contract: `AL-STRUCT-1`  
Controller/Core version: `1.2.0`

## 1. Final response envelope

Every accepted model response is one JSON object with seven mandatory blocks:

```text
passport
outputs
annotations
trace
input_fate
changes
completion
```

This is the semantic protocol. Transport identity remains owned by MyOrchestrator runtime.

## 2. Mandatory instruction + example

Every model dispatch contains both:

1. a compact normative instruction with required fields, enums and invariants;
2. one concrete valid JSON example generated for the exact stage and exact input refs.

A contract name by itself is never considered sufficient.

## 3. Closed vocabularies

The controller owns the allowed values:

- `output.type`: `ANSWER | QUESTION | REJECT`
- `annotations[].type`: `FACT | ASSUMPTION | CONSTRAINT | DECISION | RISK | EVIDENCE | FINDING | CONFLICT | OPEN | DEFERRED | CHANGE | BASELINE | VERIFIED | REJECTED | SUPERSEDED`
- `input_fate.disposition`: `CONSUMED | PRESERVED | TRANSFORMED | REJECTED | SUPERSEDED | NOT_USED`
- `completion.status`: `COMPLETE | PARTIAL | FAILED`
- `changes[].op`: `CREATE | UPDATE | SUPERSEDE | MERGE`

Unknown values fail validation.

## 4. CONSUMED semantics

`CONSUMED` means only:

> the input was processed by this response.

It does **not** mean:

- resolved;
- verified;
- accepted;
- closed.

This distinction is stated in every dispatched structural instruction.

## 5. IDs, versions and object references

Canonical IDs are machine-owned.

`passport.input_refs` contains authoritative references:

```json
{"id":"IDEA-...","type":"IDEA","version":1}
```

The same mechanism supports existing `PD`, `REQ`, `CON`, `FCT`, `ASM`, `UNK`, `RSK`, `EVD`, `AD`, `FND`, `CHG` and other registry objects.

The model must copy existing IDs and versions exactly from `passport.input_refs`.

For a new domain object the model may use only a response-local `temp_id`, for example:

```json
{"op":"CREATE","object_type":"PD","temp_id":"tmp-pd-1","source_output_id":"OUT-1"}
```

A model-generated canonical `PD-...`, `REQ-...` or other canonical ID is rejected.

## 6. Role of inserted JSON blocks

Round 2 prior results are wrapped explicitly as data:

```json
{
  "role": "prior_output",
  "source_ref": {"id":"R1-GPT-OUT-1","type":"MODEL_OUTPUT","version":1},
  "model": "GPT",
  "contract": "AL-STRUCT-1",
  "response": {}
}
```

They are not instructions and are not schema examples.

The schema example is separately introduced as the contract example inside the structural instruction.

## 7. Provenance

`trace` is provenance only.

It is **not** chain-of-thought or model reasoning.

Every output must reference real IDs from `passport.input_refs`. Round 2 must cover:

- the original `IDEA` ref;
- model A Round 1 output ref;
- model B Round 1 output ref.

Unknown source IDs fail validation.

## 8. Input fate

Every accountable input ref must appear exactly once in `input_fate`.

Each fate entry must:

- reference a real input ref;
- use a closed disposition;
- point only to real response output IDs.

## 9. Completion

`completion` must agree with the actual response:

- status must be allowed;
- accepted automation results require `COMPLETE`;
- `output_count` must equal the real number of outputs;
- `output_ids` must match those outputs;
- `empty_by_design` is explicit;
- anomalies are explicit.

## 10. Runtime-owned metadata

The controller adds independently:

- `run_id`
- model
- round
- prompt hash
- payload hash

The model never generates these fields.

## 11. Validation rule

A response is accepted only if all structural checks pass.

Malformed or semantically inconsistent envelopes become `STRUCTURE_INVALID` and cannot advance the workflow.

## 12. UI projection

The full JSON remains in state/audit.

The normal UI shows:

- readable answer content;
- compact projection of Output / Annotations / Trace / Input fate / Completion.

The wire format is not dumped into the primary reading flow.
