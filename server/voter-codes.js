'use strict';

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONFIGURED_SECRET = process.env.VOTER_CODE_SECRET || process.env.SESSION_SECRET || '';
const SECRET = String(CONFIGURED_SECRET || 'development-voter-code-secret');

if (process.env.NODE_ENV === 'production' && !CONFIGURED_SECRET) {
  throw new Error(
    'VOTER_CODE_SECRET must be set to a long random value before running in production.'
  );
}

function normalizeCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function generateVoterCode() {
  let raw = '';
  for (let index = 0; index < 8; index += 1) {
    raw += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function hashVoterCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return '';
  return crypto.createHmac('sha256', SECRET).update(normalized).digest('hex');
}

function maskEmail(email) {
  const value = String(email || '');
  const [local, domain] = value.split('@');
  if (!local || !domain) return value;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

module.exports = {
  normalizeCode,
  generateVoterCode,
  hashVoterCode,
  maskEmail
};
