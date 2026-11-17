'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createQrToken,
  hashQrToken,
  verifyQrToken,
  makeSessionQrPayload,
  parseSessionQrPayload,
} = require('../lib/qr');

test('creates URL-safe random tokens and verifies their SHA-256 hash', () => {
  const token = createQrToken();
  const hash = hashQrToken(token);
  assert.match(token, /^[A-Za-z0-9_-]{40,60}$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(verifyQrToken(token, hash), true);
  assert.equal(verifyQrToken('different-token-value-123456', hash), false);
});

test('formats and parses session QR payloads', () => {
  const sessionId = '9c9a6c22-8d75-4ee4-9c7b-18d4d5d2cc66';
  const token = createQrToken();
  const payload = makeSessionQrPayload(sessionId, token);
  assert.deepEqual(parseSessionQrPayload(payload), { sessionId, token });
});

test('rejects malformed QR payloads and invalid token values', () => {
  assert.equal(parseSessionQrPayload('MACHECK|not-a-session|bad'), null);
  assert.equal(parseSessionQrPayload(null), null);
  assert.equal(verifyQrToken('short', 'not-a-hash'), false);
  assert.throws(() => hashQrToken('short'), TypeError);
  assert.throws(() => makeSessionQrPayload('bad', createQrToken()), TypeError);
});