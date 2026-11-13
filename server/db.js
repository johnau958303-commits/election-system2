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
  email_verified INTEGER NOT NULL DEFAULT 1 CHECK (email_verified IN (0, 1)),
  auth_provider TEXT NOT NULL DEFAULT 'local' CHECK (auth_provider IN ('local', 'google')),
  google_sub TEXT,
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

CREATE TABLE IF NOT EXISTS email_verifications (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

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
  voter_mode TEXT NOT NULL DEFAULT 'open' CHECK (voter_mode IN ('open', 'roll')),
  eligible_group TEXT NOT NULL DEFAULT 'All registered voters',
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
  member_id TEXT,
  portfolio TEXT NOT NULL DEFAULT '',
  review_note TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  advanced INTEGER NOT NULL DEFAULT 0 CHECK (advanced IN (0, 1)),
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id, status);
CREATE INDEX IF NOT EXISTS idx_candidates_user ON candidates(user_id);

CREATE TABLE IF NOT EXISTS voter_roll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  bound_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  bound_at TEXT,
  round1_used_at TEXT,
  round2_used_at TEXT,
  revoked_at TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'revoked')),
  last_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voter_roll_election_external
  ON voter_roll(election_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voter_roll_election_email
  ON voter_roll(election_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_voter_roll_election_code
  ON voter_roll(election_id, code_hash);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  round INTEGER NOT NULL DEFAULT 1,
  voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  voter_roll_id INTEGER REFERENCES voter_roll(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  election_id INTEGER,
  candidate_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_election ON audit_log(election_id, created_at);
`;

function addColumns(database, table, additions) {
  const columns = new Set(
    database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
  );
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateSchema(database) {
  addColumns(database, 'users', [
    ['email_verified', 'INTEGER NOT NULL DEFAULT 1'],
    ['auth_provider', "TEXT NOT NULL DEFAULT 'local'"],
    ['google_sub', 'TEXT']
  ]);
  addColumns(database, 'candidates', [
    ['member_id', 'TEXT'],
    ['portfolio', "TEXT NOT NULL DEFAULT ''"],
    ['review_note', 'TEXT'],
    ['reviewed_at', 'TEXT'],
    ['reviewed_by', 'INTEGER']
  ]);
  addColumns(database, 'elections', [['voter_mode', "TEXT NOT NULL DEFAULT 'open'"]]);
  addColumns(database, 'votes', [['voter_roll_id', 'INTEGER']]);
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_election_user_unique
       ON candidates(election_id, user_id) WHERE user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_election_member_unique
       ON candidates(election_id, member_id) WHERE member_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
       ON users(lower(email)) WHERE email IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub_unique
       ON users(google_sub) WHERE google_sub IS NOT NULL`
  ];
  for (const statement of indexes) {
    try {
      database.exec(statement);
    } catch (error) {
      console.warn(`Could not create database index: ${error.message}`);
    }
  }
}

function initDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrateSchema(db);
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
  let raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = options.endOfDay ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
    const date = new Date(raw + suffix);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw)) {
    raw += '+08:00';
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
