# Perplexity and Le Chat donor dispatch port

Donor: `/Users/restart/Downloads/LLM_Fable 2.81.75 !!!!!!!` (read-only).

## Confirmed regressions

### Perplexity

The donor submits the prepared prompt through a browser-level trusted Enter.
If the exact prompt remains in the live composer, it tries a browser-level
trusted Send control. The current implementation had replaced both actions with
`element.click()`, `form.requestSubmit()` and synthetic keyboard events. Those
page-level actions can be ignored by Perplexity's controlled React editor while
the prompt remains visibly inserted.

### Le Chat

The donor tries the sender-gated browser-level Send control first. The current
implementation removed that path and relied on a page click, form submission and
synthetic Enter/Ctrl+Enter. On existing conversations Le Chat can keep those
untrusted operations pending long enough for background recovery rounds to run
after the useful session window.

### Existing-tab reuse

The donor retries the persisted model-to-tab binding after general global reuse
fails. The current implementation immediately clears the binding and creates a
new tab. For Perplexity and Le Chat, their controlled draft surface can make the
generic safety probe reject the same old conversation that should receive the
next request.

## Ported behavior

- Le Chat: trusted provider Send is first; current page-level methods remain as
  bounded fallbacks.
- Perplexity: trusted Enter, then trusted provider Send; current page-level
  methods remain as bounded fallbacks.
- Only `Le Chat` and `Perplexity` retry their persisted mapped tab before fresh
  tab creation. Readiness, session identity, sender URL, prompt fingerprint and
  submit confirmation checks remain active.
- Other providers keep the current fail-closed global reuse policy.

The donor directory was not modified.
