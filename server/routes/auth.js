'use strict';

const express = require('express');
const { getDb, nowIso } = require('../db');
const {
  DEMO_MODE,
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  requireAuth,
  throttleLogin,
  resetLoginThrottle,
  validatePassword,
  validateUsername
} = require('../auth');

const router = express.Router();

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

router.get('/session', (req, res) => {
  res.json({ user: req.user || null });
});

router.post('/register', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const username = clean(body.username, 30);
  const password = String(body.password ?? '');
  const confirmPassword = String(body.confirm_password ?? body.confirmPassword ?? '');
  const fullName = clean(body.full_name ?? body.fullName, 80);
  const studentId = clean(body.student_id ?? body.studentId ?? body.hkid, 30);
  const email = clean(body.email, 120);

  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'The two passwords do not match.' });
  }
  if (fullName.length < 2) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'That username is already registered.' });
  }

  const { salt, hash } = hashPassword(password);
  try {
    const info = db
      .prepare(
        `INSERT INTO users
          (username, password_hash, salt, full_name, student_id, email, role, is_eligible, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'student', 1, ?)`
      )
      .run(username, hash, salt, fullName, studentId || null, email || null, nowIso());
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    return res.status(201).json({
      user: publicUser(row),
      message: 'Your account has been created. You can now log in.'
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username is already registered.' });
    }
    throw error;
  }
});

router.post('/login', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const username = clean(body.username, 30);
  const password = String(body.password ?? '');
  const key = `${req.ip}:${username.toLowerCase()}`;

  if (!username || !password) {
    return res.status(400).json({ error: 'Enter your username and password.' });
  }
  if (!throttleLogin(key)) {
    return res
      .status(429)
      .json({ error: 'Too many login attempts. Please wait a few minutes and try again.' });
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  resetLoginThrottle(key);
  const session = createSession(row.id);
  setSessionCookie(res, session);
  return res.json({ user: publicUser(row) });
});

router.post('/logout', (req, res) => {
  const sid = req.headers.cookie
    ? (req.headers.cookie.match(/emvs_sid=([^;]+)/) || [])[1]
    : null;
  if (sid) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(decodeURIComponent(sid));
    } catch (_) {
      /* ignore malformed session ids */
    }
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/demo-admin', (req, res) => {
  if (!DEMO_MODE) {
    return res.status(403).json({ error: 'The administrator demo is disabled.' });
  }
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!row) {
    return res.status(404).json({ error: 'No administrator account is available.' });
  }
  const session = createSession(row.id);
  setSessionCookie(res, session);
  res.json({ user: publicUser(row) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
