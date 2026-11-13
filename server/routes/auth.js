'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { getDb, nowIso } = require('../db');
const {
  DEMO_MODE,
  EMAIL_CODE_TTL_MS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_COOLDOWN_MS,
  hashPassword,
  hashEmailCode,
  verifyPassword,
  parseCookies,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  publicUser,
  requireAuth,
  throttleLogin,
  resetLoginThrottle,
  validatePassword,
  validateUsername,
  validateEmail
} = require('../auth');
const { numericCode, sendVerificationEmail, deliveryMode } = require('../mailer');
const {
  googleConfigured,
  oauthClient,
  pkcePair,
  findOrCreateGoogleUser
} = require('../google');

const router = express.Router();
const GOOGLE_STATE_COOKIE = 'emvs_google_state';
const GOOGLE_VERIFIER_COOKIE = 'emvs_google_verifier';
const GOOGLE_COOKIE_PATH = '/api/auth/google';

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return clean(value, 120).toLowerCase();
}

function sameHash(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function secureCookie(req) {
  return Boolean(
    req.secure ||
      req.get('x-forwarded-proto') === 'https' ||
      process.env.NODE_ENV === 'production'
  );
}

function setGoogleCookie(req, res, name, value) {
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(req),
    maxAge: 10 * 60 * 1000,
    path: GOOGLE_COOKIE_PATH
  });
}

function clearGoogleCookie(req, res, name) {
  res.clearCookie(name, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(req),
    path: GOOGLE_COOKIE_PATH
  });
}

function issueEmailCode(db, userId) {
  const code = numericCode(6);
  const now = Date.now();
  db.prepare(
    `INSERT INTO email_verifications (user_id, code_hash, expires_at, attempts, sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       sent_at = excluded.sent_at`
  ).run(userId, hashEmailCode(code, userId), now + EMAIL_CODE_TTL_MS, now);
  return code;
}

router.get('/session', (req, res) => {
  res.json({
    user: req.user || null,
    demoMode: DEMO_MODE,
    googleEnabled: googleConfigured(),
    emailMode: deliveryMode()
  });
});

router.post('/register', async (req, res, next) => {
  const db = getDb();
  const body = req.body || {};
  const username = clean(body.username, 30);
  const password = String(body.password ?? '');
  const confirmPassword = String(body.confirm_password ?? body.confirmPassword ?? '');
  const fullName = clean(body.full_name ?? body.fullName, 80);
  const email = normalizeEmail(body.email);

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
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });

  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'That username is already registered.' });
  }
  if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
    return res.status(409).json({ error: 'That email address is already registered.' });
  }

  const { salt, hash } = hashPassword(password);
  let row;
  try {
    const info = db
      .prepare(
        `INSERT INTO users
          (username, password_hash, salt, full_name, email, email_verified, auth_provider,
           role, is_eligible, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 'local', 'student', 1, ?)`
      )
      .run(username, hash, salt, fullName, email, nowIso());
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    throw error;
  }

  const code = issueEmailCode(db, row.id);
  try {
    await sendVerificationEmail({ to: email, code, fullName });
  } catch (error) {
    console.error('Could not send verification email:', error.message);
    return res.status(503).json({
      error:
        'Your account was created, but the verification email could not be sent. Please try resending it.',
      code: 'EMAIL_DELIVERY_FAILED',
      email
    });
  }
  return res.status(201).json({
    user: publicUser(row),
    requiresVerification: true,
    email,
    message: 'We sent a 6-digit verification code to your email address.'
  });
});

router.post('/verify-email', (req, res) => {
  const db = getDb();
  const body = req.body || {};
  const email = normalizeEmail(body.email);
  const code = clean(body.code, 12);
  if (!email || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter your email address and the 6-digit code.' });
  }
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!row) {
    return res.status(400).json({ error: 'That verification code is invalid or has expired.' });
  }
  if (row.email_verified) {
    return res.status(409).json({ error: 'That email address is already verified. Please log in.' });
  }
  const verification = db.prepare('SELECT * FROM email_verifications WHERE user_id = ?').get(row.id);
  if (!verification || verification.expires_at <= Date.now()) {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.id);
    return res.status(400).json({ error: 'That verification code is invalid or has expired.' });
  }
  if (verification.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.id);
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }
  const expected = hashEmailCode(code, row.id);
  if (!sameHash(expected, verification.code_hash)) {
    db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?').run(row.id);
    const remaining = EMAIL_CODE_MAX_ATTEMPTS - (verification.attempts + 1);
    return res.status(400).json({
      error:
        remaining > 0
          ? `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.'
    });
  }
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.id);
  db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(row.id);
  const verified = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
  const session = createSession(verified.id);
  setSessionCookie(res, session);
  return res.json({ user: publicUser(verified), message: 'Your email address is verified.' });
});

router.post('/resend-verification', async (req, res, next) => {
  const db = getDb();
  const email = normalizeEmail((req.body || {}).email);
  if (!email) return res.status(400).json({ error: 'Enter your email address.' });
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!row) {
    return res.json({ ok: true, message: 'If that account exists, a new code has been sent.' });
  }
  if (row.email_verified) {
    return res.status(400).json({ error: 'That email address is already verified. Please log in.' });
  }
  const existing = db.prepare('SELECT * FROM email_verifications WHERE user_id = ?').get(row.id);
  if (existing && Date.now() - existing.sent_at < EMAIL_CODE_COOLDOWN_MS) {
    const seconds = Math.ceil((EMAIL_CODE_COOLDOWN_MS - (Date.now() - existing.sent_at)) / 1000);
    return res.status(429).json({
      error: `Please wait ${seconds} second${seconds === 1 ? '' : 's'} before requesting another code.`,
      retryAfter: seconds
    });
  }
  const code = issueEmailCode(db, row.id);
  try {
    await sendVerificationEmail({ to: row.email, code, fullName: row.full_name });
  } catch (error) {
    console.error('Could not resend verification email:', error.message);
    return res.status(503).json({
      error: 'The verification email could not be sent. Please try again later.',
      code: 'EMAIL_DELIVERY_FAILED'
    });
  }
  return res.json({ ok: true, message: 'A new verification code has been sent.' });
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
  if (!row.email_verified) {
    return res.status(403).json({
      error: 'Please verify your email address before logging in.',
      code: 'EMAIL_NOT_VERIFIED',
      email: row.email
    });
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

router.get('/google/start', (req, res) => {
  if (!googleConfigured()) {
    return res.status(503).json({
      error: 'Google login is not configured.',
      code: 'GOOGLE_NOT_CONFIGURED'
    });
  }
  const state = crypto.randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkcePair();
  setGoogleCookie(req, res, GOOGLE_STATE_COOKIE, state);
  setGoogleCookie(req, res, GOOGLE_VERIFIER_COOKIE, verifier);
  const url = oauthClient(req).generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const clearState = () => {
    clearGoogleCookie(req, res, GOOGLE_STATE_COOKIE);
    clearGoogleCookie(req, res, GOOGLE_VERIFIER_COOKIE);
  };
  const fail = (message) => {
    clearState();
    return res.redirect(`/?google_error=${encodeURIComponent(message)}`);
  };
  if (!googleConfigured()) {
    return fail('Google login is not configured.');
  }
  if ((req.query || {}).error) {
    return fail('Google login was cancelled.');
  }
  const cookies = parseCookies(req.headers.cookie || '');
  const state = String((req.query || {}).state || '');
  const code = String((req.query || {}).code || '');
  const expectedState = cookies[GOOGLE_STATE_COOKIE];
  const verifier = cookies[GOOGLE_VERIFIER_COOKIE];
  if (!state || !expectedState || state !== expectedState || !verifier || !code) {
    return fail('The Google login request expired. Please try again.');
  }
  try {
    const client = oauthClient(req);
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token) return fail('Google did not return an identity token.');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const row = findOrCreateGoogleUser(ticket.getPayload());
    const session = createSession(row.id);
    setSessionCookie(res, session);
    clearState();
    return res.redirect('/');
  } catch (error) {
    console.error('Google login failed:', error.message);
    const message =
      error.code === 'GOOGLE_ACCOUNT_CONFLICT'
        ? error.message
        : 'Google login failed. Please try again.';
    return fail(message);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
