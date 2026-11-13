'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDb, closeDb } = require('../server/db');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.resolve(
  process.argv[2] || path.join(__dirname, '..', 'data', `election-backup-${stamp}.db`)
);

if (fs.existsSync(target)) {
  console.error(`Refusing to overwrite an existing file: ${target}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });

try {
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const size = fs.statSync(target).size;
  console.log(`Database snapshot written to ${target} (${size} bytes).`);
} finally {
  closeDb();
}