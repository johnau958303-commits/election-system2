'use strict';

const path = require('node:path');
const express = require('express');
const { initDb, getDb } = require('./db');
const { seedIfEmpty } = require('./seed');
const { attachUser, originCheck } = require('./auth');

function createApp() {
  initDb();
  if (process.env.NODE_ENV !== 'production' && process.env.AUTO_SEED !== 'false') {
    seedIfEmpty(getDb());
  }

  const app = express();
  const root = path.join(__dirname, '..');

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  app.use(attachUser);
  app.use('/api', originCheck);

  app.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
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
