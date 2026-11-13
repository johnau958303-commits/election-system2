'use strict';

const crypto = require('node:crypto');

const EMAIL_MODE = String(process.env.EMAIL_MODE || '').toLowerCase();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '');
const MAIL_FROM = String(process.env.MAIL_FROM || '');
const EMAIL_TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS) || 10000;
const testOutbox = [];

function deliveryMode() {
  if (EMAIL_MODE === 'test' || process.env.NODE_ENV === 'test') return 'test';
  if (EMAIL_MODE === 'console') return 'console';
  if (EMAIL_MODE === 'resend' || RESEND_API_KEY) return 'resend';
  return 'console';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function numericCode(length = 6) {
  let value = '';
  while (value.length < length) {
    value += String(crypto.randomInt(0, 10));
  }
  return value;
}

function recordTestMessage(message) {
  testOutbox.push({ ...message, createdAt: new Date().toISOString() });
  if (testOutbox.length > 200) testOutbox.shift();
}

function testCodeFor(email, purpose) {
  const message = [...testOutbox]
    .reverse()
    .find(
      (item) =>
        item.to.toLowerCase() === String(email || '').toLowerCase() &&
        (!purpose || item.purpose === purpose)
    );
  return message?.code || null;
}

async function deliver({ to, subject, text, html, code, purpose }) {
  const mode = deliveryMode();
  if (mode === 'test') {
    recordTestMessage({ to, subject, code, purpose });
    return { delivered: true, mode };
  }
  if (mode === 'console') {
    console.log(`[email:${purpose || 'message'}] to=${to} subject="${subject}" code=${code || ''}`);
    return { delivered: true, mode };
  }
  if (!RESEND_API_KEY || !MAIL_FROM) {
    throw new Error('Email delivery is not configured. Set RESEND_API_KEY and MAIL_FROM.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Email delivery failed (${response.status}). ${detail}`.trim());
  }
  return { delivered: true, mode };
}

async function sendVerificationEmail({ to, code, fullName, expiresMinutes = 15 }) {
  const name = fullName || 'there';
  return deliver({
    to,
    code,
    purpose: 'email-verification',
    subject: 'Verify your election account',
    text: `Hello ${name},\n\nYour verification code is ${code}. It expires in ${expiresMinutes} minutes.\n\nIf you did not create this account, you can ignore this email.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Your verification code is <strong>${escapeHtml(code)}</strong>. It expires in ${escapeHtml(expiresMinutes)} minutes.</p><p>If you did not create this account, you can ignore this email.</p>`
  });
}

async function sendVoterCodeEmail({ to, code, fullName, electionTitle }) {
  const name = fullName || 'there';
  return deliver({
    to,
    code,
    purpose: 'voter-code',
    subject: `Your voting code for ${electionTitle}`,
    text: `Hello ${name},\n\nYour one-time voting code for ${electionTitle} is ${code}.\n\nUse this code while logged in with this email address. The code can be used once in each voting round.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>Your one-time voting code for <strong>${escapeHtml(electionTitle)}</strong> is <strong>${escapeHtml(code)}</strong>.</p><p>Use this code while logged in with this email address. The code can be used once in each voting round.</p>`
  });
}

module.exports = {
  deliveryMode,
  numericCode,
  sendVerificationEmail,
  sendVoterCodeEmail,
  testCodeFor
};
