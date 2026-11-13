'use strict';

const { createApp } = require('./server/app');
const { closeDb } = require('./server/db');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

const server = app.listen(port, host, () => {
  console.log(`Election Management & Voting System running at http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo account: admin / Admin1234! (administrator)');
  }
});

let shuttingDown = false;

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${reason})...`);
  const timer = setTimeout(() => {
    console.error('Timed out waiting for connections to close.');
    process.exit(1);
  }, 10000);
  timer.unref();
  server.close(() => {
    try {
      closeDb();
    } catch (error) {
      console.error('Could not close the database cleanly:', error.message);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});