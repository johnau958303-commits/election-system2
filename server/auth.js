'use strict';

const crypto = require('node:crypto');
const { getDb, now } = require('./db');

const COOKIE_NAME = 'emvs_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const DEMO_MODE = process.env.DEMO_MODE !== 'false';

const loginAttempts = new Map();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHex) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(String(expectedHex), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    studentId: row.student_id,
    email: row.email,
    role: row.role,
    isEligible: Boolean(row.is_eligible)
  };
}

function findUserBySession(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(sessionId);
  if (!row) return null;
  if (Number(row.expires_at) <= now().getTime()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row;
}

function createSession(userId) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = now().getTime() + SESSION_MS;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expiresAt
  );
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now().getTime());
  return { id, expiresAt };
}

function setSessionCookie(res, session) {
  res.cookie(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

function attachUser(req, res, next) {
  const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.userRow = findUserBySession(sid);
  req.user = publicUser(req.userRow);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please log in to continue.', code: 'AUTH_REQUIRED' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Please log in to continue.', code: 'AUTH_REQUIRED' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access is required.', code: 'ADMIN_ONLY' });
  }
  next();
}

function originCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    const forwardedHost = String(req.get('x-forwarded-host') || '')
      .split(',')[0]
      .trim();
    if (host !== req.get('host') && host !== forwardedHost) {
      return res.status(403).json({ error: 'Request origin was rejected.', code: 'BAD_ORIGIN' });
    }
  } catch (_) {
    return res.status(403).json({ error: 'Request origin was rejected.', code: 'BAD_ORIGIN' });
  }
  next();
}

function throttleLogin(key) {
  const nowMs = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < nowMs) {
    loginAttempts.set(key, { count: 1, resetAt: nowMs + 10 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}

function resetLoginThrottle(key) {
  loginAttempts.delete(key);
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (value.length > 128) return 'Password is too long.';
  return null;
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(value)) {
    return 'Username must be 3-30 characters using letters, numbers, dots, underscores or hyphens.';
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  DEMO_MODE,
  hashPassword,
  verifyPassword,
  parseCookies,
  publicUser,
  findUserBySession,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
  originCheck,
  throttleLogin,
  resetLoginThrottle,
  validatePassword,
  validateUsername
};
