'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', '.git', 'data']);
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
}

walk(root);

for (const file of files) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);