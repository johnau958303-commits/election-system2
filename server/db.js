'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'election.db');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : DEFAULT_DB_PATH;

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  student_id TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  is_eligible INTEGER NOT NULL DEFAULT 1 CHECK (is_eligible IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  seats INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL DEFAULT 'Single candidate selection',
  nomination_open TEXT,
  nomination_close TEXT,
  voting_open TEXT,
  voting_close TEXT,
  round2_open TEXT,
  round2_close TEXT,
  results_at TEXT,
  stage TEXT NOT NULL DEFAULT 'Draft',
  entry_mode TEXT NOT NULL DEFAULT 'students' CHECK (entry_mode IN ('students', 'admin')),
  candidate_count INTEGER NOT NULL DEFAULT 4,
  round_mode TEXT NOT NULL DEFAULT 'single' CHECK (round_mode IN ('single', 'two')),
  eligible_group TEXT NOT NULL DEFAULT 'All registered students',
  voting_rules TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  manifesto TEXT NOT NULL DEFAULT '[]',
  picture TEXT,
  contacts TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  advanced INTEGER NOT NULL DEFAULT 0 CHECK (advanced IN (0, 1)),
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id, status);
CREATE INDEX IF NOT EXISTS idx_candidates_user ON candidates(user_id);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1,
  voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (election_id, round, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id);

CREATE TABLE IF NOT EXISTS result_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  votes INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'not_elected' CHECK (outcome IN ('elected', 'tied', 'not_elected')),
  eligible_voters INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  UNIQUE (election_id, round, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_results_election ON result_entries(election_id, round);
`;

function initDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

function getDb() {
  return db || initDb();
}

function closeDb() {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
  }
}

function now() {
  const override = process.env.ELECTION_NOW;
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function nowIso() {
  return now().toISOString();
}

function toIso(value, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = options.endOfDay ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
    const date = new Date(raw + suffix);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (_) {
      /* ignore rollback errors */
    }
    throw error;
  }
}

module.exports = {
  DB_PATH,
  initDb,
  getDb,
  closeDb,
  now,
  nowIso,
  toIso,
  transaction
};
