'use strict';

const crypto = require('node:crypto');

function createQrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashQrToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 120) {
    throw new TypeError('Invalid QR token');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verifyQrToken(token, storedHash) {
  if (typeof token !== 'string' || typeof storedHash !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const candidate = crypto.createHash('sha256').update(token).digest();
  const stored = Buffer.from(storedHash, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
}

function makeSessionQrPayload(sessionId, token) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    throw new TypeError('Invalid session ID');
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,120}$/.test(token)) {
    throw new TypeError('Invalid QR token');
  }
  return `MACHECK|${sessionId}|${token}`;
}

function parseSessionQrPayload(payload) {
  if (typeof payload !== 'string') return null;
  const match = /^MACHECK\|([A-Za-z0-9_-]{8,80})\|([A-Za-z0-9_-]{20,120})$/.exec(payload.trim());
  return match ? { sessionId: match[1], token: match[2] } : null;
}

module.exports = { createQrToken, hashQrToken, verifyQrToken, makeSessionQrPayload, parseSessionQrPayload };