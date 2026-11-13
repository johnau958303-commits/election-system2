'use strict';

const { getDb, now, nowIso } = require('./db');

const ROUND_THRESHOLD = 8;

const STAGES = [
  'Draft',
  'Nominations open',
  'Candidate review',
  'First round',
  'Second round',
  'Voting open',
  'Voting closed',
  'Results published'
];

function parseManifesto(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (!value) return [];
  const text = String(value).trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch (_) {
      /* fall through to newline parsing */
    }
  }
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseContacts(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function validatePicture(picture) {
  if (!picture) return { value: null };
  const value = String(picture).trim();
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    const base64 = value.slice(value.indexOf(',') + 1);
    if (base64.length * 0.75 > 2 * 1024 * 1024) {
      return { error: 'The profile picture must be 2 MB or smaller.' };
    }
    return { value };
  }
  if (!/^https?:\/\//i.test(value) || value.length > 500) {
    return { error: 'Enter an http(s) image URL or choose a PNG, JPEG or WebP image.' };
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { error: 'Enter an http(s) image URL or choose a PNG, JPEG or WebP image.' };
    }
  } catch (_) {
    return { error: 'Enter an http(s) image URL or choose a PNG, JPEG or WebP image.' };
  }
  return { value };
}

function serializeCandidate(row, options = {}) {
  if (!row) return null;
  const serialized = {
    id: row.id,
    electionId: row.election_id,
    userId: row.user_id,
    name: row.name,
    initials: row.initials,
    tag: row.tag,
    bio: row.bio,
    manifesto: parseManifesto(row.manifesto),
    portfolio: String(row.portfolio || ''),
    picture: row.picture || null,
    contacts: parseContacts(row.contacts),
    status: row.status,
    advanced: Boolean(row.advanced),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at
  };
  if (options.includeReview) {
    serialized.memberId = row.member_id || null;
    serialized.reviewNote = row.review_note || null;
    serialized.reviewedAt = row.reviewed_at || null;
    serialized.reviewedBy = row.reviewed_by || null;
  }
  if (options.includeVotes) {
    serialized.votes = Number(row.votes || 0);
  }
  return serialized;
}

function roundModeForCount(count) {
  return Number(count) > ROUND_THRESHOLD ? 'two' : 'single';
}

function approvedCandidateCount(electionId) {
  return Number(
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM candidates WHERE election_id = ? AND status = 'approved'")
      .get(Number(electionId)).c
  );
}

function roundModeLocked(election) {
  if (!election) return true;
  if (election.published) return true;
  if (
    ['First round', 'Second round', 'Voting open', 'Voting closed', 'Results published'].includes(
      election.stage
    )
  ) {
    return true;
  }
  const votes = Number(
    getDb().prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ?').get(election.id).c
  );
  return votes > 0;
}

function syncRoundMode(electionId) {
  const db = getDb();
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(electionId));
  if (!election) return null;
  if (roundModeLocked(election)) return election.round_mode;
  const mode = roundModeForCount(approvedCandidateCount(election.id));
  if (mode !== election.round_mode) {
    db.prepare('UPDATE elections SET round_mode = ? WHERE id = ?').run(mode, election.id);
  }
  return mode;
}

function recordAudit(actorId, action, options = {}) {
  getDb()
    .prepare(
      `INSERT INTO audit_log (actor_id, action, election_id, candidate_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      actorId || null,
      String(action),
      options.electionId || null,
      options.candidateId || null,
      String(options.detail || ''),
      nowIso()
    );
}

function approvedCandidates(electionId, round) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM candidates
        WHERE election_id = ? AND status = 'approved'
        ORDER BY id`
    )
    .all(electionId);
  if (round === 2) return rows.filter((row) => row.advanced);
  return rows;
}

function allCandidates(electionId) {
  return getDb()
    .prepare('SELECT * FROM candidates WHERE election_id = ? ORDER BY id')
    .all(electionId);
}

function eligibleVoterCount() {
  return Number(
    getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND is_eligible = 1 AND email_verified = 1"
      )
      .get().c
  );
}

function eligibleVoterCountForElection(electionOrId) {
  const db = getDb();
  const election =
    typeof electionOrId === 'object' && electionOrId
      ? electionOrId
      : getElectionById(electionOrId);
  if (!election) return 0;
  if (election.voter_mode === 'roll') {
    return Number(
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM voter_roll WHERE election_id = ? AND revoked_at IS NULL'
        )
        .get(election.id).c
    );
  }
  return eligibleVoterCount();
}

function countVotes(electionId, round) {
  const db = getDb();
  const advancedFilter = Number(round) === 2 ? ' AND c.advanced = 1' : '';
  const rows = db
    .prepare(
      `SELECT c.*, COALESCE(v.votes, 0) AS votes
         FROM candidates c
         LEFT JOIN (
           SELECT candidate_id, COUNT(*) AS votes
             FROM votes
            WHERE election_id = ? AND round = ?
            GROUP BY candidate_id
         ) v ON v.candidate_id = c.id
        WHERE c.election_id = ? AND c.status = 'approved'${advancedFilter}
        ORDER BY votes DESC, c.id`
    )
    .all(electionId, round, electionId);
  const total = rows.reduce((sum, row) => sum + Number(row.votes), 0);
  const eligible = eligibleVoterCountForElection(electionId);
  const top = rows.length ? Number(rows[0].votes) : 0;
  const tiedLeaders = rows.filter((row) => Number(row.votes) === top && top > 0);
  return {
    candidates: rows.map((row) => ({
      ...serializeCandidate(row),
      votes: Number(row.votes),
      share: total > 0 ? (Number(row.votes) / total) * 100 : 0
    })),
    totalVotes: total,
    eligibleVoters: eligible,
    turnout: eligible > 0 ? (total / eligible) * 100 : 0,
    leader: tiedLeaders.length === 1 ? serializeCandidate(tiedLeaders[0]) : null,
    tiedLeaders: tiedLeaders.length > 1 ? tiedLeaders.map((row) => serializeCandidate(row)) : [],
    tie: tiedLeaders.length > 1
  };
}

function resultEntries(electionId, round) {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*, c.name, c.initials, c.tag
         FROM result_entries r
         JOIN candidates c ON c.id = r.candidate_id
        WHERE r.election_id = ? AND r.round = ?
        ORDER BY r.votes DESC, r.candidate_id`
    )
    .all(electionId, round);
}

function resultSummary(electionId) {
  const db = getDb();
  const rounds = db
    .prepare(
      'SELECT DISTINCT round FROM result_entries WHERE election_id = ? ORDER BY round'
    )
    .all(electionId)
    .map((row) => Number(row.round));
  const lastRound = rounds.length ? rounds[rounds.length - 1] : 1;
  const entries = resultEntries(electionId, lastRound);
  if (!entries.length) return { rounds, round: lastRound, entries: [], winner: null, tie: false };
  const winners = entries.filter((entry) => entry.outcome === 'elected' || entry.outcome === 'tied');
  return {
    rounds,
    round: lastRound,
    entries: entries.map((entry) => ({
      candidateId: entry.candidate_id,
      name: entry.name,
      initials: entry.initials,
      votes: Number(entry.votes),
      outcome: entry.outcome,
      eligibleVoters: Number(entry.eligible_voters),
      publishedAt: entry.published_at,
      share: entries.reduce((sum, row) => sum + Number(row.votes), 0)
        ? (Number(entry.votes) / entries.reduce((sum, row) => sum + Number(row.votes), 0)) * 100
        : 0
    })),
    winner: winners.length ? winners.map((entry) => entry.name).join(' & ') : null,
    tie: entries.some((entry) => entry.outcome === 'tied')
  };
}

function electionStatus(election) {
  if (election.published) return 'published';
  const date = now();
  const open = election.voting_open ? new Date(election.voting_open) : null;
  const close = election.voting_close ? new Date(election.voting_close) : null;
  const round2Open = election.round2_open ? new Date(election.round2_open) : null;
  const round2Close = election.round2_close ? new Date(election.round2_close) : null;
  if (election.stage === 'Draft') return 'draft';
  if (election.stage === 'Nominations open') return 'nominations_open';
  if (election.stage === 'Candidate review') return 'candidate_review';
  if (election.stage === 'First round') {
    return roundWindowStatus(date, open, close);
  }
  if (election.stage === 'Second round') {
    return roundWindowStatus(date, round2Open, round2Close);
  }
  if (election.stage === 'Voting open') {
    if (open && date < open) return 'upcoming';
    if (close && date > close) return 'closed';
    return 'voting_open';
  }
  if (election.stage === 'Voting closed') return 'closed';
  if (election.stage === 'Results published') return 'published';
  if (close && date > close) return 'closed';
  if (open && date < open) return 'upcoming';
  return 'upcoming';
}

function roundWindowStatus(date, open, close) {
  if (!open || !close) return 'closed';
  if (date < open) return 'upcoming';
  if (date > close) return 'closed';
  return 'voting_open';
}

function currentRoundForElection(election) {
  if (!election) return 1;
  if (election.round_mode !== 'two') return 1;
  if (election.stage === 'Second round') return 2;
  if (election.stage === 'Voting closed') {
    const row = getDb()
      .prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ? AND round = 2')
      .get(Number(election.id));
    return Number(row?.c) > 0 ? 2 : 1;
  }
  if (election.published || election.stage === 'Results published') {
    const row = getDb()
      .prepare('SELECT MAX(round) AS round FROM result_entries WHERE election_id = ?')
      .get(Number(election.id));
    return Number(row?.round) === 2 ? 2 : 1;
  }
  return 1;
}

function serializeElection(row) {
  if (!row) return null;
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM candidates WHERE election_id = ?`
    )
    .get(row.id);
  const roll = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS active
       FROM voter_roll WHERE election_id = ?`
    )
    .get(row.id);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    seats: row.seats,
    method: row.method,
    nominationOpen: row.nomination_open,
    nominationClose: row.nomination_close,
    votingOpen: row.voting_open,
    votingClose: row.voting_close,
    round2Open: row.round2_open,
    round2Close: row.round2_close,
    resultsAt: row.results_at,
    stage: row.stage,
    entryMode: row.entry_mode,
    candidateCount: row.candidate_count,
    roundMode: row.round_mode,
    voterMode: row.voter_mode || 'open',
    eligibleGroup: row.eligible_group,
    votingRules: String(row.voting_rules || '')
      .split(/\r?\n/)
      .filter(Boolean),
    published: Boolean(row.published),
    createdAt: row.created_at,
    status: electionStatus(row),
    approvedCandidates: Number(counts.approved || 0),
    pendingCandidates: Number(counts.pending || 0),
    totalCandidates: Number(counts.total || 0),
    voterRollCount: Number(roll.active || 0)
  };
}

function getElectionBySlug(slug) {
  if (!slug) return null;
  return getDb().prepare('SELECT * FROM elections WHERE slug = ?').get(String(slug));
}

function getElectionById(id) {
  return getDb().prepare('SELECT * FROM elections WHERE id = ?').get(Number(id));
}

function publicElectionBySlug(slug) {
  const row = getElectionBySlug(slug);
  if (!row) return null;
  const election = serializeElection(row);
  const summary = row.published ? resultSummary(row.id) : null;
  return {
    ...election,
    results: summary,
    candidates: approvedCandidates(row.id, currentRoundForElection(row)).map((candidate) =>
      serializeCandidate(candidate)
    )
  };
}

function voterCountForElection(electionId) {
  const db = getDb();
  const election = getElectionById(electionId);
  if (!election) return 0;
  if (election.round_mode === 'two' && election.stage === 'Second round') {
    return Number(
      db.prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ? AND round = 2').get(electionId).c
    );
  }
  return Number(
    db.prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ? AND round = 1').get(electionId).c
  );
}

module.exports = {
  STAGES,
  ROUND_THRESHOLD,
  parseManifesto,
  parseContacts,
  validatePicture,
  serializeCandidate,
  roundModeForCount,
  approvedCandidateCount,
  roundModeLocked,
  syncRoundMode,
  recordAudit,
  approvedCandidates,
  allCandidates,
  eligibleVoterCount,
  eligibleVoterCountForElection,
  countVotes,
  resultEntries,
  resultSummary,
  electionStatus,
  currentRoundForElection,
  serializeElection,
  getElectionBySlug,
  getElectionById,
  publicElectionBySlug,
  voterCountForElection
};
