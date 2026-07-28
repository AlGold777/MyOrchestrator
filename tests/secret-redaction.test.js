const SecretRedaction = require('../shared/secret-redaction');

// Realistic-looking fake keys (never real). The test asserts none of these
// survive a redaction pass anywhere in the output.
const FAKE = {
  openai: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX1234567890abcdef',
  openaiClassic: 'sk-ABCDEFGHIJKLMNOP1234567890QRSTUVWX',
  anthropic: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX1234567890',
  xai: 'xai-ABCDEFGHIJKLMNOPQRSTUVWX1234567890',
  google: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWX1234567890',
  perplexity: 'pplx-ABCDEFGHIJKLMNOPQRSTUVWX1234567890',
  jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabcdef',
  bearer: 'Bearer abc123DEF456ghi789JKL012'
};

// List which fake keys leaked into a serialized blob.
const leakedKeys = (text) => Object.entries(FAKE)
  .filter(([, v]) => text.includes(v))
  .map(([name]) => name);

describe('SecretRedaction', () => {
  test('exposes a frozen pure API', () => {
    expect(typeof SecretRedaction.redactDeep).toBe('function');
    expect(typeof SecretRedaction.stringifySafe).toBe('function');
    expect(Object.isFrozen(SecretRedaction)).toBe(true);
  });

  test('masks values under secret-looking field names entirely', () => {
    const input = {
      apiKey: FAKE.openai,
      authorization: FAKE.bearer,
      'x-api-key': FAKE.anthropic,
      cookie: 'session=abc; token=xyz',
      passphrase: 'hunter2',
      nested: { client_secret: FAKE.xai }
    };
    const out = SecretRedaction.redactDeep(input);
    expect(out.apiKey).toBe(SecretRedaction.MASK);
    expect(out.authorization).toBe(SecretRedaction.MASK);
    expect(out['x-api-key']).toBe(SecretRedaction.MASK);
    expect(out.cookie).toBe(SecretRedaction.MASK);
    expect(out.passphrase).toBe(SecretRedaction.MASK);
    expect(out.nested.client_secret).toBe(SecretRedaction.MASK);
  });

  test('masks key/token shapes embedded in free-text values', () => {
    const input = {
      details: `Dispatch failed using key ${FAKE.openaiClassic} on retry`,
      meta: { message: `Auth header was "${FAKE.bearer}" and google=${FAKE.google}` },
      logLine: `JWT ${FAKE.jwt} rejected`
    };
    const out = SecretRedaction.stringifySafe(input);
    expect(leakedKeys(out)).toEqual([]);
    expect(out).toContain(SecretRedaction.MASK);
  });

  test('does not leak keys placed in EVERY field of a telemetry-shaped payload', () => {
    // Mirror the export shape: groups of diagnostic events + run summary.
    const event = (label) => ({
      ts: Date.now(),
      type: 'TELEMETRY',
      label,
      details: `something ${FAKE.openai} happened`,
      platform: FAKE.anthropic,
      meta: {
        llmName: 'GPT',
        message: FAKE.xai,
        apiKey: FAKE.google,
        finalStatus: 'SUCCESS',
        headers: { authorization: FAKE.bearer, 'x-api-key': FAKE.perplexity }
      }
    });
    const payload = {
      exportMeta: { runSessionId: 's1', token: FAKE.jwt },
      '<GPT>': [event('MODEL_FINAL'), event('Status: SUCCESS')],
      '<CLAUDE>': [event('FINALIZATION_DECISION')]
    };
    const serialized = SecretRedaction.stringifySafe(payload, 2);
    expect(leakedKeys(serialized)).toEqual([]);
  });

  test('preserves non-secret data and structure', () => {
    const input = {
      runSessionId: 'run-123',
      models: ['GPT', 'CLAUDE'],
      timing: { hardMax: 450, checks: 3 },
      finalStatus: 'SUCCESS',
      flag: true,
      count: 42
    };
    const out = SecretRedaction.redactDeep(input);
    expect(out).toEqual(input);
  });

  test('handles cycles, depth, and non-plain objects without throwing', () => {
    const cyclic = { name: 'x' };
    cyclic.self = cyclic;
    expect(() => SecretRedaction.redactDeep(cyclic)).not.toThrow();
    const out = SecretRedaction.redactDeep(cyclic);
    expect(out.self).toBe('[CIRCULAR]');

    const withDate = { when: new Date(0), ok: 1 };
    expect(() => SecretRedaction.redactDeep(withDate)).not.toThrow();

    expect(SecretRedaction.redactDeep(null)).toBeNull();
    expect(SecretRedaction.redactDeep('plain')).toBe('plain');
    expect(SecretRedaction.redactDeep(7)).toBe(7);
  });

  test('regression guard: an unredacted export WOULD leak (proves the test bites)', () => {
    const payload = { meta: { apiKey: FAKE.openai } };
    const naive = JSON.stringify(payload);
    expect(leakedKeys(naive).length).toBeGreaterThan(0); // naive leaks
    const safe = SecretRedaction.stringifySafe(payload);
    expect(leakedKeys(safe)).toEqual([]);                // redacted does not
  });
});
