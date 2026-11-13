'use strict';

const crypto = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { getDb, nowIso } = require('./db');
const { hashPassword, validateUsername } = require('./auth');

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  if (process.env.PUBLIC_BASE_URL) {
    return `${String(process.env.PUBLIC_BASE_URL).replace(/\/+$/, '')}/api/auth/google/callback`;
  }
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

function oauthClient(req) {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri(req)
  );
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function usernameForEmail(email) {
  const db = getDb();
  const local = normalizeEmail(email).split('@')[0] || 'voter';
  const base = local.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 24) || 'voter';
  const stem = base.length >= 3 ? base : `voter-${base}`.slice(0, 24);
  let candidate = stem;
  if (validateUsername(candidate)) candidate = 'google-voter';
  let suffix = 2;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(candidate)) {
    candidate = `${stem.slice(0, 24)}-${suffix++}`;
  }
  return candidate;
}

function findOrCreateGoogleUser(payload) {
  if (!payload?.sub) throw new Error('Google account identifier is missing.');
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Google did not confirm a verified email address.');
  }
  const db = getDb();
  const email = normalizeEmail(payload.email);
  const existingBySub = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub);
  if (existingBySub) return existingBySub;

  const existingByEmail = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (existingByEmail) {
    if (existingByEmail.google_sub && existingByEmail.google_sub !== payload.sub) {
      const error = new Error('This email is linked to a different Google account.');
      error.code = 'GOOGLE_ACCOUNT_CONFLICT';
      throw error;
    }
    const updates = [
      'google_sub = ?',
      'email_verified = 1',
      'full_name = COALESCE(NULLIF(full_name, \'\'), ?)'
    ];
    const values = [payload.sub, payload.name || existingByEmail.full_name || email];
    if (!existingByEmail.email_verified) {
      const { salt, hash } = hashPassword(crypto.randomBytes(32).toString('hex'));
      updates.push('password_hash = ?', 'salt = ?');
      values.push(hash, salt);
      db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(existingByEmail.id);
    }
    values.push(existingByEmail.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existingByEmail.id);
  }

  const { salt, hash } = hashPassword(crypto.randomBytes(32).toString('hex'));
  const info = db
    .prepare(
      `INSERT INTO users
        (username, password_hash, salt, full_name, email, email_verified, auth_provider, google_sub,
         role, is_eligible, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 'google', ?, 'student', 1, ?)`
    )
    .run(
      usernameForEmail(email),
      hash,
      salt,
      String(payload.name || email).slice(0, 80),
      email,
      payload.sub,
      nowIso()
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
}

module.exports = {
  googleConfigured,
  redirectUri,
  oauthClient,
  pkcePair,
  findOrCreateGoogleUser
};
