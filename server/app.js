'use strict';

const path = require('node:path');
const express = require('express');
const { initDb, getDb } = require('./db');
const { seedIfEmpty } = require('./seed');
const { attachUser, originCheck } = require('./auth');

function createApp() {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE === 'true') {
    throw new Error('DEMO_MODE must not be enabled when NODE_ENV is production.');
  }
  initDb();
  if (process.env.NODE_ENV !== 'production' && process.env.AUTO_SEED !== 'false') {
    seedIfEmpty(getDb());
  }

  const app = express();
  const root = path.join(__dirname, '..');

  const trustProxy = String(process.env.TRUST_PROXY || '').trim();
  if (trustProxy === 'true') app.set('trust proxy', true);
  else if (/^\d+$/.test(trustProxy)) app.set('trust proxy', Number(trustProxy));
  else if (trustProxy) app.set('trust proxy', trustProxy);

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "object-src 'none'"
      ].join('; ')
    );
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.use(attachUser);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', originCheck);

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      getDb().prepare('SELECT 1 AS ok').get();
    } catch (error) {
      console.error('Health check database failure:', error);
      return res.status(503).json({ ok: false, database: 'unavailable' });
    }
    res.json({ ok: true, database: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api', require('./routes/elections'));
  app.use('/api', require('./routes/nominations'));
  app.use('/api', require('./routes/votes'));
  app.use('/api/admin', require('./routes/admin'));

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(root, 'index.html'));
  });
  app.get('/app.js', (req, res) => {
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(root, 'app.js'));
  });
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ error: 'An unexpected server error occurred.' });
    }
    res.status(500).type('text').send('An unexpected server error occurred.');
  });

  return app;
}

module.exports = { createApp };
