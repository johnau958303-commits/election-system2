'use strict';

const { createApp } = require('./server/app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const app = createApp();

app.listen(port, host, () => {
  console.log(`Election Management & Voting System running at http://localhost:${port}`);
  console.log('Demo accounts: admin / Admin1234! (administrator)');
  console.log('               student / Student1234! (eligible student)');
  console.log('               notonroll / Student1234! (not on the election roll)');
  console.log('               alex / Student1234! (candidate account)');
});
