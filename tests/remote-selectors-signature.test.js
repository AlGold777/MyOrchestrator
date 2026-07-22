/** @jest-environment node */
const { webcrypto } = require('node:crypto');

function isValidEnvelope(envelope) {
  return envelope?.format === 'selectors-override.signed.v1' && !!envelope.payloadB64 && !!envelope.signatureB64;
}

async function verify(publicJwk, payloadB64, signatureB64) {
  const key = await webcrypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signatureB64, 'base64'),
    Buffer.from(payloadB64, 'base64')
  );
}

describe('remote selectors signed envelope', () => {
  test('valid signature verifies and tampered payload fails', async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
    const payload = Buffer.from(JSON.stringify({ GPT: { input: ['textarea'] } }));
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, payload);
    const envelope = {
      format: 'selectors-override.signed.v1',
      payloadB64: payload.toString('base64'),
      signatureB64: Buffer.from(signature).toString('base64')
    };
    expect(isValidEnvelope(envelope)).toBe(true);
    await expect(verify(publicJwk, envelope.payloadB64, envelope.signatureB64)).resolves.toBe(true);
    const tampered = Buffer.from(JSON.stringify({ GPT: { input: ['button'] } })).toString('base64');
    await expect(verify(publicJwk, tampered, envelope.signatureB64)).resolves.toBe(false);
  });

  test('rejects unsigned format', () => {
    expect(isValidEnvelope({ payloadB64: 'e30=', signatureB64: 'AA==' })).toBe(false);
  });
});
