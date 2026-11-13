'use strict';

const { createApp } = require('./server/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  console.log(`Election Management & Voting System running at http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo account: admin / Admin1234! (administrator)');
  }
});
