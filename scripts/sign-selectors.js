#!/usr/bin/env node
// Usage:
//   node scripts/sign-selectors.js keygen
//   node scripts/sign-selectors.js sign <payload.json> <private.jwk.json>
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');

async function main() {
  const [, , cmd, payloadPath, keyPath] = process.argv;
  if (cmd === 'keygen') {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateKeyJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKeyJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
    console.log(JSON.stringify({ privateKeyJwk, publicKeyJwk }, null, 2));
    return;
  }
  if (cmd === 'sign') {
    const payloadBytes = fs.readFileSync(payloadPath);
    const jwk = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    const privateJwk = jwk.privateKeyJwk || jwk;
    const key = await webcrypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, payloadBytes);
    console.log(JSON.stringify({
      format: 'selectors-override.signed.v1',
      payloadB64: Buffer.from(payloadBytes).toString('base64'),
      signatureB64: Buffer.from(signature).toString('base64')
    }, null, 2));
    return;
  }
  console.error('Unknown command. Use: keygen | sign <payload.json> <private.jwk.json>');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
