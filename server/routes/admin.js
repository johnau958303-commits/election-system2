'use strict';

const express = require('express');
const { getDb, now, nowIso, toIso, transaction } = require('../db');
const { requireAdmin, validateEmail } = require('../auth');
const {
  generateVoterCode,
  hashVoterCode
} = require('../voter-codes');
const { sendVoterCodeEmail } = require('../mailer');
const {
  STAGES,
  ROUND_THRESHOLD,
  serializeElection,
  serializeCandidate,
  allCandidates,
  countVotes,
  resultSummary,
  resultEntries,
  electionStatus,
  currentRoundForElection,
  getElectionBySlug,
  getElectionById,
  eligibleVoterCount,
  approvedCandidateCount,
  syncRoundMode,
  recordAudit,
  parseManifesto,
  validatePicture
} = require('../helpers');

const FINALIST_LIMIT = ROUND_THRESHOLD;

const router = express.Router();
router.use(requireAdmin);

const STAGE_TRANSITIONS = {
  Draft: ['Nominations open', 'Candidate review', 'First round', 'Voting open'],
  'Nominations open': ['Draft', 'Candidate review', 'First round', 'Voting open'],
  'Candidate review': ['Nominations open', 'First round', 'Voting open'],
  'First round': ['Second round', 'Voting open', 'Voting closed', 'Results published'],
  'Second round': ['First round', 'Voting closed', 'Results published'],
  'Voting open': ['First round', 'Second round', 'Voting closed', 'Results published'],
  'Voting closed': ['First round', 'Second round', 'Voting open', 'Results published'],
  'Results published': ['First round', 'Second round', 'Voting open', 'Voting closed']
};

function canTransition(from, to) {
  return from === to || (STAGE_TRANSITIONS[from] || []).includes(to);
}

function stageRoundError(election, stage) {
  const approved = approvedCandidateCount(election.id);
  if (stage === 'First round' && approved <= ROUND_THRESHOLD) {
    return `Only ${approved} approved candidate${approved === 1 ? '' : 's'}. Use "Voting open" for a single-round election.`;
  }
  if (stage === 'Voting open' && approved > ROUND_THRESHOLD) {
    return `${approved} approved candidates require a first round before the final vote.`;
  }
  if (stage === 'Second round' && approved <= ROUND_THRESHOLD) {
    return 'A second round requires more than eight approved candidates.';
  }
  return null;
}

function applyStageRoundMode(election, stage) {
  const db = getDb();
  if (stage === 'First round' || stage === 'Second round') {
    db.prepare("UPDATE elections SET round_mode = 'two' WHERE id = ?").run(election.id);
  } else if (stage === 'Voting open') {
    db.prepare("UPDATE elections SET round_mode = 'single' WHERE id = ?").run(election.id);
  }
}

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

const LOCKED_STAGES = ['First round', 'Second round', 'Voting open', 'Voting closed', 'Results published'];

function candidateChangesLocked(election) {
  if (!election) return false;
  return Boolean(election.published) || LOCKED_STAGES.includes(election.stage);
}

function candidateBallotLocked(election) {
  if (!election) return false;
  if (election.published) return true;
  const votes = getDb()
    .prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ?')
    .get(election.id);
  return Number(votes?.c) > 0;
}

function slugify(value) {
  return String(value || 'election')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'election';
}

function uniqueSlug(base) {
  const db = getDb();
  let slug = base;
  let index = 2;
  while (db.prepare('SELECT id FROM elections WHERE slug = ?').get(slug)) {
    slug = `${base}-${index++}`;
  }
  return slug;
}

function initialsFor(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function plusDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function dateField(body, keys, existingValue, options) {
  const key = keys.find((name) => body[name] !== undefined);
  if (key !== undefined) return toIso(body[key], options);
  return existingValue || null;
}

function electionInput(body, existing) {
  const title = clean(body.electionTitle ?? body.title, 120);
  if (title.length < 3) return { error: 'Enter an election title.' };
  const description = clean(body.description, 1000);
  const seats = Math.max(1, Math.min(50, Number(body.seats) || existing?.seats || 1));
  const method = clean(body.method, 80) || 'Single candidate selection';
  const nominationOpen = dateField(
    body,
    ['nomOpen', 'nominationOpen'],
    existing?.nomination_open
  );
  const nominationClose = dateField(
    body,
    ['nomClose', 'nominationClose'],
    existing?.nomination_close,
    { endOfDay: true }
  );
  const votingOpen = dateField(body, ['voteOpen', 'votingOpen'], existing?.voting_open);
  const votingClose = dateField(body, ['voteClose', 'votingClose'], existing?.voting_close);
  const resultsAt = dateField(body, ['publishAt', 'resultsAt'], existing?.results_at);
  const candidateCount = Math.max(
    1,
    Math.min(50, Number(body.candidateCount ?? body.candidate_count) || existing?.candidate_count || 4)
  );
  const roundMode = ['single', 'two'].includes(String(body.roundMode || ''))
    ? String(body.roundMode)
    : existing?.round_mode || 'single';
  const voterMode = ['open', 'roll'].includes(String(body.voterMode ?? body.voter_mode ?? ''))
    ? String(body.voterMode ?? body.voter_mode)
    : existing?.voter_mode || 'open';

  if (nominationOpen && nominationClose && new Date(nominationOpen) > new Date(nominationClose)) {
    return { error: 'The nomination deadline must be after the opening date.' };
  }
  if (votingOpen && votingClose && new Date(votingOpen) > new Date(votingClose)) {
    return { error: 'Voting must close after it opens.' };
  }

  let round2Open = dateField(body, ['round2Open'], existing?.round2_open);
  let round2Close = dateField(body, ['round2Close'], existing?.round2_close);
  if (round2Open && round2Close && new Date(round2Open) > new Date(round2Close)) {
    return { error: 'The second round must close after it opens.' };
  }
  if (roundMode === 'two') {
    if (!round2Open && votingClose) round2Open = votingClose;
    if (!round2Close) {
      round2Close = resultsAt || (round2Open ? plusDays(round2Open, 3) : null);
    }
  }

  const entryMode = String(body.entryMode ?? existing?.entry_mode ?? 'students');
  if (!['students', 'admin'].includes(entryMode)) {
    return { error: 'Invalid candidate entry method.' };
  }
  const eligibleGroup =
    clean(body.voterGroup ?? body.eligibleGroup, 80) ||
    existing?.eligible_group ||
    'All registered voters';
  const votingRules =
    body.votingRules !== undefined
      ? String(body.votingRules || '')
      : existing?.voting_rules ||
        [
          'Each eligible voter may cast one vote for one candidate.',
          'Review your selected candidate before confirming your vote.',
          'Voting is available during the stated voting period.',
          'The candidate with the highest number of accepted votes is elected.',
          'A tied result will be identified in the published results.'
        ].join('\n');

  return {
    data: {
      title,
      description,
      seats,
      method,
      nomination_open: nominationOpen,
      nomination_close: nominationClose,
      voting_open: votingOpen,
      voting_close: votingClose,
      round2_open: round2Open,
      round2_close: round2Close,
      results_at: resultsAt,
      candidate_count: candidateCount,
      round_mode: roundMode,
      voter_mode: voterMode,
      entry_mode: entryMode,
      eligible_group: eligibleGroup,
      voting_rules: votingRules
    }
  };
}

function adminElectionPayload(row) {
  const election = serializeElection(row);
  if (row.published) {
    const summary = resultSummary(row.id);
    election.winner = summary.winner;
    election.tie = summary.tie;
    election.results = summary;
  }
  return election;
}

router.get('/overview', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM elections ORDER BY id').all();
  const elections = rows.map(adminElectionPayload);
  const pending = db
    .prepare(
      `SELECT c.*, e.title AS election_title, e.slug AS election_slug
         FROM candidates c JOIN elections e ON e.id = c.election_id
        WHERE c.status = 'pending'
        ORDER BY c.submitted_at DESC`
    )
    .all();
  res.json({
    elections,
    pendingNominations: pending.map((row) => ({
      ...serializeCandidate(row, { includeReview: true }),
      electionTitle: row.election_title,
      electionSlug: row.election_slug
    })),
    stats: {
      openElections: elections.filter((e) => e.status === 'voting_open').length,
      nominations: Number(db.prepare('SELECT COUNT(*) AS c FROM candidates').get().c),
      published: elections.filter((e) => e.published).length,
      pending: pending.length,
      eligibleVoters: eligibleVoterCount()
    }
  });
});

router.get('/elections/:slug', (req, res) => {
  const row = getElectionBySlug(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Election not found.' });
  const round = currentRoundForElection(row);
  res.json({
    election: adminElectionPayload(row),
    round,
    candidates: allCandidates(row.id).map((candidate) =>
      serializeCandidate(candidate, { includeReview: true })
    ),
    count: countVotes(row.id, round)
  });
});

router.post('/elections', (req, res) => {
  const body = req.body || {};
  const parsed = electionInput(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const data = parsed.data;
  const db = getDb();
  const slug = uniqueSlug(slugify(data.title));
  const requestedStage = STAGES.includes(body.stage) ? body.stage : 'Draft';
  if (['First round', 'Second round', 'Results published'].includes(requestedStage)) {
    return res.status(409).json({
      error: 'Create the election first, then move it through the stage controls.',
      code: 'INVALID_STAGE_TRANSITION'
    });
  }
  const stage = requestedStage;
  const info = db
    .prepare(
      `INSERT INTO elections
        (slug, title, description, seats, method, nomination_open, nomination_close,
         voting_open, voting_close, round2_open, round2_close, results_at, stage,
         entry_mode, candidate_count, round_mode, voter_mode, eligible_group, voting_rules,
         published, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      slug,
      data.title,
      data.description,
      data.seats,
      data.method,
      data.nomination_open,
      data.nomination_close,
      data.voting_open,
      data.voting_close,
      data.round2_open,
      data.round2_close,
      data.results_at,
      stage,
      data.entry_mode,
      data.candidate_count,
      data.round_mode,
      data.voter_mode,
      data.eligible_group,
      data.voting_rules,
      nowIso()
    );
  const row = getElectionById(Number(info.lastInsertRowid));
  syncRoundMode(row.id);
  recordAudit(req.user.id, 'election.created', {
    electionId: row.id,
    detail: `stage=${row.stage}`
  });
  res.status(201).json({ election: adminElectionPayload(getElectionById(row.id)) });
});

router.put('/elections/:slug', (req, res) => {
  const existing = getElectionBySlug(req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Election not found.' });
  const parsed = electionInput(req.body || {}, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const data = parsed.data;
  const stage = existing.stage;
  getDb()
    .prepare(
      `UPDATE elections SET
         title = ?, description = ?, seats = ?, method = ?,
         nomination_open = ?, nomination_close = ?, voting_open = ?, voting_close = ?,
         round2_open = ?, round2_close = ?, results_at = ?, stage = ?,
         entry_mode = ?, candidate_count = ?, round_mode = ?, voter_mode = ?,
         eligible_group = ?, voting_rules = ?
       WHERE id = ?`
    )
    .run(
      data.title,
      data.description,
      data.seats,
      data.method,
      data.nomination_open,
      data.nomination_close,
      data.voting_open,
      data.voting_close,
      data.round2_open,
      data.round2_close,
      data.results_at,
      stage,
      data.entry_mode,
      data.candidate_count,
      data.round_mode,
      data.voter_mode,
      data.eligible_group,
      data.voting_rules,
      existing.id
    );
  syncRoundMode(existing.id);
  const row = getElectionById(existing.id);
  recordAudit(req.user.id, 'election.updated', { electionId: row.id });
  res.json({ election: adminElectionPayload(row) });
});

function advanceFinalists(election) {
  const db = getDb();
  const candidates = countVotes(election.id, 1).candidates;
  if (!candidates.length) return { advanced: 0, tie: false };
  const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  let selected = [];
  if (totalVotes === 0) {
    selected = candidates.slice(0, FINALIST_LIMIT);
  } else {
    selected = candidates.slice(0, FINALIST_LIMIT);
    const cutoff = selected[selected.length - 1].votes;
    if (cutoff > 0) {
      const extra = candidates
        .slice(FINALIST_LIMIT)
        .filter((candidate) => candidate.votes === cutoff);
      selected = [...selected, ...extra];
    }
    if (selected.length < FINALIST_LIMIT) {
      for (const candidate of candidates) {
        if (selected.length >= FINALIST_LIMIT) break;
        if (!selected.some((item) => item.id === candidate.id)) selected.push(candidate);
      }
    }
  }
  const ids = new Set(selected.map((candidate) => candidate.id));
  transaction(() => {
    const update = db.prepare('UPDATE candidates SET advanced = ? WHERE id = ?');
    for (const candidate of candidates) {
      update.run(ids.has(candidate.id) ? 1 : 0, candidate.id);
    }
  });
  const tie =
    totalVotes > 0 &&
    candidates.filter((candidate) => candidate.votes === selected[0].votes).length > 1;
  return { advanced: selected.length, tie, finalists: selected.map((candidate) => candidate.name) };
}

function electOutcomes(candidates, seats) {
  const seatCount = Math.max(1, Number(seats) || 1);
  const ranked = [...candidates].sort(
    (a, b) => Number(b.votes) - Number(a.votes) || a.id - b.id
  );
  const winners = ranked.slice(0, seatCount);
  const cutoff = Number(winners[winners.length - 1].votes);
  const atCutoff = ranked.filter((candidate) => Number(candidate.votes) === cutoff);
  const winnersAtCutoff = winners.filter((candidate) => Number(candidate.votes) === cutoff);
  const boundaryTie = cutoff > 0 && atCutoff.length > winnersAtCutoff.length;
  const outcomes = new Map();
  const elected = [];

  for (const candidate of ranked) {
    const votes = Number(candidate.votes);
    if (votes > cutoff) {
      outcomes.set(candidate.id, 'elected');
      elected.push(candidate);
    } else if (votes === cutoff) {
      if (cutoff === 0) {
        outcomes.set(candidate.id, 'not_elected');
      } else {
        outcomes.set(candidate.id, boundaryTie ? 'tied' : 'elected');
        if (!boundaryTie) elected.push(candidate);
      }
    } else {
      outcomes.set(candidate.id, 'not_elected');
    }
  }

  return { outcomes, elected, tie: boundaryTie };
}

function publishElection(election, round) {
  const db = getDb();
  const count = countVotes(election.id, round);
  if (!count.candidates.length) {
    return { error: 'This election has no approved candidates.' };
  }
  const topVotes = count.candidates[0].votes;
  if (topVotes === 0) {
    return { error: 'There are no accepted votes to publish.' };
  }
  const elected = electOutcomes(count.candidates, election.seats);
  const publishedAt = nowIso();
  transaction(() => {
    db.prepare('DELETE FROM result_entries WHERE election_id = ? AND round = ?').run(
      election.id,
      round
    );
    const insert = db.prepare(
      `INSERT INTO result_entries
        (election_id, round, candidate_id, votes, outcome, eligible_voters, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const candidate of count.candidates) {
      insert.run(
        election.id,
        round,
        candidate.id,
        candidate.votes,
        elected.outcomes.get(candidate.id) || 'not_elected',
        count.eligibleVoters,
        publishedAt
      );
    }
    db.prepare("UPDATE elections SET published = 1, stage = 'Results published' WHERE id = ?").run(
      election.id
    );
  });
  return {
    count,
    winner: elected.elected.length ? elected.elected.map((candidate) => candidate.name).join(' & ') : null,
    tie: elected.tie
  };
}

router.patch('/elections/:slug/stage', (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const stage = String(req.body?.stage || '');
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid election stage.' });
  if (!canTransition(election.stage, stage)) {
    return res.status(409).json({
      error: `The election cannot move from ${election.stage} to ${stage}.`,
      code: 'INVALID_STAGE_TRANSITION'
    });
  }
  if (stage !== election.stage) {
    const roundError = stageRoundError(election, stage);
    if (roundError) {
      return res.status(409).json({ error: roundError, code: 'ROUND_RULE' });
    }
  }
  if (stage === 'Results published') {
    const status = electionStatus(election);
    if (status === 'voting_open') {
      return res.status(409).json({
        error: 'Voting is still open. Close voting before publishing results.',
        code: 'VOTING_OPEN'
      });
    }
    if (status === 'upcoming') {
      return res.status(409).json({
        error: 'Voting has not opened yet. Results cannot be published.',
        code: 'VOTING_NOT_CLOSED'
      });
    }
    if (election.round_mode === 'two' && election.stage === 'First round') {
      return res.status(409).json({
        error: 'Run the second round before publishing the final results.',
        code: 'SECOND_ROUND_REQUIRED'
      });
    }
  }

  const messages = [];
  if (stage === 'Second round' && approvedCandidateCount(election.id) > ROUND_THRESHOLD) {
    const advanced = advanceFinalists(election);
    messages.push(
      advanced.tie
        ? 'A tie was detected when selecting finalists; all tied candidates advanced.'
        : `Second-round finalists confirmed (${advanced.advanced}).`
    );
  }

  if (stage === 'Results published') {
    const round = election.round_mode === 'two' ? 2 : 1;
    const published = publishElection(election, round);
    if (published.error) return res.status(409).json({ error: published.error });
    recordAudit(req.user.id, 'results.published', {
      electionId: election.id,
      detail: `round=${round}`
    });
    return res.json({
      election: adminElectionPayload(getElectionById(election.id)),
      message: published.tie
        ? 'Results published with a tied result.'
        : `Results published. Elected: ${published.winner}.`
    });
  }

  if (election.published) {
    db.prepare('DELETE FROM result_entries WHERE election_id = ?').run(election.id);
    db.prepare('UPDATE elections SET published = 0 WHERE id = ?').run(election.id);
  }
  db.prepare('UPDATE elections SET stage = ? WHERE id = ?').run(stage, election.id);
  applyStageRoundMode(election, stage);
  if (!['First round', 'Second round', 'Voting open', 'Voting closed', 'Results published'].includes(stage)) {
    syncRoundMode(election.id);
  }
  recordAudit(req.user.id, 'election.stage', {
    electionId: election.id,
    detail: `${election.stage} -> ${stage}`
  });

  res.json({
    election: adminElectionPayload(getElectionById(election.id)),
    message: messages.length ? messages.join(' ') : `Election stage updated to ${stage}.`
  });
});

router.get('/elections/:slug/count', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  let round = Number(req.query.round || 0);
  if (![1, 2].includes(round)) {
    round = currentRoundForElection(election);
  }
  if (round === 2 && election.round_mode !== 'two') round = 1;
  res.json({
    election: adminElectionPayload(election),
    round,
    count: countVotes(election.id, round),
    publishedResults: election.published ? resultEntries(election.id, round) : []
  });
});

router.post('/elections/:slug/publish', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const status = electionStatus(election);
  if (status === 'voting_open') {
    return res.status(409).json({
      error: 'Voting is still open. Close voting before publishing results.',
      code: 'VOTING_OPEN'
    });
  }
  if (status === 'upcoming') {
    return res.status(409).json({
      error: 'Voting has not opened yet. Results cannot be published.',
      code: 'VOTING_NOT_CLOSED'
    });
  }
  if (election.round_mode === 'two' && election.stage === 'First round') {
    return res.status(409).json({
      error: 'Run the second round before publishing the final results.',
      code: 'SECOND_ROUND_REQUIRED'
    });
  }
  const round = election.round_mode === 'two' ? 2 : 1;
  const published = publishElection(election, round);
  if (published.error) return res.status(409).json({ error: published.error });
  recordAudit(req.user.id, 'results.published', {
    electionId: election.id,
    detail: `round=${round}`
  });
  res.json({
    election: adminElectionPayload(getElectionById(election.id)),
    count: published.count,
    winner: published.winner,
    tie: published.tie,
    message: published.tie
      ? 'Results published with a tied result.'
      : `Results published. Elected: ${published.winner}.`
  });
});

router.get('/elections/:slug/nominations', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  res.json({
    election: adminElectionPayload(election),
    candidates: allCandidates(election.id).map((candidate) =>
      serializeCandidate(candidate, { includeReview: true })
    )
  });
});

router.get('/candidates/:id', (req, res) => {
  const candidate = getDb()
    .prepare('SELECT * FROM candidates WHERE id = ?')
    .get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
  const election = getElectionById(candidate.election_id);
  const applicant = candidate.user_id
    ? getDb()
        .prepare('SELECT id, username, full_name, email FROM users WHERE id = ?')
        .get(candidate.user_id)
    : null;
  res.json({
    candidate: serializeCandidate(candidate, { includeReview: true }),
    applicant: applicant
      ? {
          id: applicant.id,
          username: applicant.username,
          fullName: applicant.full_name,
          email: applicant.email
        }
      : null,
    election: adminElectionPayload(election)
  });
});

router.patch('/candidates/:id/status', (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Nomination not found.' });
  const election = getElectionById(candidate.election_id);
  if (candidateChangesLocked(election)) {
    return res.status(409).json({
      error: 'Candidate approvals are locked once voting has started.',
      code: 'REVIEW_CLOSED'
    });
  }
  const status = String(req.body?.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid nomination status.' });
  }
  const note = clean(req.body?.note, 1000) || null;
  const expectedUpdatedAt = req.body?.expectedUpdatedAt
    ? String(req.body.expectedUpdatedAt)
    : null;
  const reviewedAt = nowIso();
  const result = db
    .prepare(
      `UPDATE candidates
          SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
        WHERE id = ? AND status = ?${expectedUpdatedAt ? ' AND updated_at = ?' : ''}`
    )
    .run(
      status,
      note,
      reviewedAt,
      req.user.id,
      reviewedAt,
      candidate.id,
      candidate.status,
      ...(expectedUpdatedAt ? [expectedUpdatedAt] : [])
    );
  if (Number(result.changes) === 0) {
    return res.status(409).json({
      error: 'This application changed while you were reviewing it. Reload and review the latest version.',
      code: 'REVIEW_CONFLICT'
    });
  }
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  syncRoundMode(candidate.election_id);
  recordAudit(req.user.id, `nomination.${status}`, {
    electionId: candidate.election_id,
    candidateId: candidate.id,
    detail: note || ''
  });
  res.json({
    candidate: serializeCandidate(row, { includeReview: true }),
    message:
      status === 'approved'
        ? 'Nomination approved. The candidate is now on the ballot.'
        : status === 'rejected'
          ? 'Nomination rejected.'
          : 'Nomination returned for changes.'
  });
});

router.post('/elections/:slug/candidates', (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (candidateBallotLocked(election)) {
    return res.status(409).json({
      error: 'Candidates cannot be added once votes have been cast.',
      code: 'VOTING_STARTED'
    });
  }
  const body = req.body || {};
  const name = clean(body.name ?? body.adminCandidateName, 80);
  if (name.length < 2) return res.status(400).json({ error: 'Enter the candidate name.' });
  const bio = clean(body.bio ?? body.adminIntroduction, 2000);
  const tag = clean(body.tag ?? body.adminSlogan, 160);
  const portfolio = clean(body.portfolio, 2000);
  const memberId = clean(body.memberId ?? body.member_id, 30) || null;
  const manifesto = parseManifesto(body.manifesto ?? body.adminStatement);
  const picture = validatePicture(body.picture);
  if (picture.error) return res.status(400).json({ error: picture.error });
  if (memberId) {
    const taken = db
      .prepare('SELECT id FROM candidates WHERE election_id = ? AND member_id = ?')
      .get(election.id, memberId);
    if (taken) {
      return res.status(409).json({
        error: 'That membership or student ID is already used in this election.',
        code: 'MEMBER_ID_TAKEN'
      });
    }
  }
  const info = db
    .prepare(
      `INSERT INTO candidates
        (election_id, user_id, name, initials, tag, bio, manifesto, portfolio, picture, contacts,
         member_id, status, advanced, submitted_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'approved', 1, ?, ?)`
    )
    .run(
      election.id,
      name,
      initialsFor(name),
      tag,
      bio,
      JSON.stringify(manifesto),
      portfolio,
      picture.value,
      memberId,
      nowIso(),
      nowIso()
    );
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(info.lastInsertRowid));
  syncRoundMode(election.id);
  recordAudit(req.user.id, 'candidate.added', {
    electionId: election.id,
    candidateId: row.id
  });
  res.status(201).json({
    candidate: serializeCandidate(row, { includeReview: true }),
    message: 'Candidate added.'
  });
});

router.put('/candidates/:id', (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
  const election = getElectionById(candidate.election_id);
  if (candidateBallotLocked(election)) {
    return res.status(409).json({
      error: 'Candidate details are locked once votes have been cast.',
      code: 'VOTING_STARTED'
    });
  }
  const body = req.body || {};
  const name = clean(body.name ?? body.adminCandidateName, 80) || candidate.name;
  if (name.length < 2) return res.status(400).json({ error: 'Enter the candidate name.' });
  const bio =
    body.bio !== undefined || body.adminIntroduction !== undefined
      ? clean(body.bio ?? body.adminIntroduction, 2000)
      : candidate.bio;
  const tag =
    body.tag !== undefined || body.adminSlogan !== undefined
      ? clean(body.tag ?? body.adminSlogan, 160)
      : candidate.tag;
  const portfolio =
    body.portfolio !== undefined ? clean(body.portfolio, 2000) : candidate.portfolio || '';
  const memberId =
    body.memberId !== undefined || body.member_id !== undefined
      ? clean(body.memberId ?? body.member_id, 30) || null
      : candidate.member_id || null;
  const manifesto =
    body.manifesto !== undefined || body.adminStatement !== undefined
      ? parseManifesto(body.manifesto ?? body.adminStatement)
      : parseManifesto(candidate.manifesto);
  let picture = candidate.picture;
  if (body.picture !== undefined) {
    const parsed = validatePicture(body.picture);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    picture = parsed.value;
  }
  const status = body.status && ['pending', 'approved', 'rejected'].includes(body.status)
    ? body.status
    : candidate.status;
  if (memberId) {
    const taken = db
      .prepare('SELECT id FROM candidates WHERE election_id = ? AND member_id = ? AND id != ?')
      .get(candidate.election_id, memberId, candidate.id);
    if (taken) {
      return res.status(409).json({
        error: 'That membership or student ID is already used in this election.',
        code: 'MEMBER_ID_TAKEN'
      });
    }
  }

  db.prepare(
    `UPDATE candidates
        SET name = ?, initials = ?, tag = ?, bio = ?, manifesto = ?, portfolio = ?,
            member_id = ?, picture = ?, status = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    name,
    initialsFor(name),
    tag,
    bio,
    JSON.stringify(manifesto),
    portfolio,
    memberId,
    picture,
    status,
    nowIso(),
    candidate.id
  );
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  syncRoundMode(candidate.election_id);
  recordAudit(req.user.id, 'candidate.updated', {
    electionId: candidate.election_id,
    candidateId: candidate.id
  });
  res.json({ candidate: serializeCandidate(row, { includeReview: true }), message: 'Candidate description saved.' });
});

function serializeVoterRollRow(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    fullName: row.full_name,
    email: row.email,
    boundUserId: row.bound_user_id,
    boundAt: row.bound_at,
    round1UsedAt: row.round1_used_at,
    round2UsedAt: row.round2_used_at,
    revokedAt: row.revoked_at,
    emailStatus: row.email_status,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function freshVoterCode(electionId) {
  const db = getDb();
  let code = generateVoterCode();
  for (let index = 0; index < 8; index += 1) {
    const hash = hashVoterCode(code);
    const exists = db
      .prepare('SELECT id FROM voter_roll WHERE election_id = ? AND code_hash = ?')
      .get(electionId, hash);
    if (!exists) return { code, hash };
    code = generateVoterCode();
  }
  throw new Error('Could not generate a unique voting code.');
}

async function deliverVoterCode(election, row, code) {
  const db = getDb();
  const sentAt = nowIso();
  db.prepare(
    `UPDATE voter_roll
        SET code_hash = ?, email_status = 'pending', last_sent_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(hashVoterCode(code), sentAt, sentAt, row.id);
  try {
    await sendVoterCodeEmail({
      to: row.email,
      code,
      fullName: row.full_name,
      electionTitle: election.title
    });
    db.prepare("UPDATE voter_roll SET email_status = 'sent', updated_at = ? WHERE id = ?").run(
      nowIso(),
      row.id
    );
    return { ok: true };
  } catch (error) {
    console.error('Could not send voter code:', error.message);
    db.prepare("UPDATE voter_roll SET email_status = 'failed', updated_at = ? WHERE id = ?").run(
      nowIso(),
      row.id
    );
    return { ok: false, error: error.message };
  }
}

function voterRollPayload(election) {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM voter_roll WHERE election_id = ? ORDER BY id')
    .all(election.id);
  const total = rows.length;
  const active = rows.filter((row) => !row.revoked_at).length;
  return {
    election: adminElectionPayload(election),
    voters: rows.map(serializeVoterRollRow),
    summary: {
      total,
      active,
      revoked: rows.filter((row) => row.revoked_at).length,
      bound: rows.filter((row) => row.bound_user_id).length,
      round1Used: rows.filter((row) => row.round1_used_at).length,
      round2Used: rows.filter((row) => row.round2_used_at).length,
      sent: rows.filter((row) => row.email_status === 'sent').length,
      pending: rows.filter((row) => row.email_status === 'pending').length,
      failed: rows.filter((row) => row.email_status === 'failed').length
    }
  };
}

router.get('/elections/:slug/voter-roll', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  res.json(voterRollPayload(election));
});

router.post('/elections/:slug/voter-roll/import', async (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (election.published) {
    return res.status(409).json({ error: 'The voter roll cannot change after results are published.' });
  }
  const voters = (req.body || {}).voters;
  if (!Array.isArray(voters) || voters.length === 0) {
    return res.status(400).json({ error: 'Import at least one voter.' });
  }
  if (voters.length > 1000) {
    return res.status(400).json({ error: 'Import at most 1,000 voters at a time.' });
  }

  const seenExternal = new Set();
  const seenEmail = new Set();
  const parsed = [];
  for (let index = 0; index < voters.length; index += 1) {
    const raw = voters[index] || {};
    const externalId = clean(raw.externalId ?? raw.external_id ?? raw.id, 80);
    const fullName = clean(raw.fullName ?? raw.full_name ?? raw.name, 80);
    const email = clean(raw.email, 120).toLowerCase();
    if (externalId.length < 1) {
      return res.status(400).json({ error: `Row ${index + 1}: external ID is required.` });
    }
    if (fullName.length < 2) {
      return res.status(400).json({ error: `Row ${index + 1}: full name is required.` });
    }
    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: `Row ${index + 1}: ${emailError}` });
    if (seenExternal.has(externalId.toLowerCase())) {
      return res.status(400).json({ error: `Row ${index + 1}: duplicate external ID.` });
    }
    if (seenEmail.has(email)) {
      return res.status(400).json({ error: `Row ${index + 1}: duplicate email address.` });
    }
    seenExternal.add(externalId.toLowerCase());
    seenEmail.add(email);
    parsed.push({ externalId, fullName, email });
  }

  const existingRows = db
    .prepare('SELECT * FROM voter_roll WHERE election_id = ?')
    .all(election.id);
  const byExternal = new Map(
    existingRows.map((row) => [String(row.external_id).toLowerCase(), row])
  );
  const byEmail = new Map(existingRows.map((row) => [String(row.email).toLowerCase(), row]));
  const desiredEmailById = new Map();
  for (const voter of parsed) {
    const existing = byExternal.get(voter.externalId.toLowerCase());
    if (existing) desiredEmailById.set(Number(existing.id), voter.email);
  }
  function emailConflict(owner, ownerId, email) {
    if (!owner || Number(owner.id) === Number(ownerId)) return null;
    const finalEmail = desiredEmailById.has(Number(owner.id))
      ? desiredEmailById.get(Number(owner.id))
      : String(owner.email).toLowerCase();
    return finalEmail === email ? owner : null;
  }
  const additions = [];
  const updates = [];
  const unchanged = [];
  const toSend = [];

  for (const voter of parsed) {
    const existing = byExternal.get(voter.externalId.toLowerCase());
    if (!existing) {
      const emailOwner = emailConflict(byEmail.get(voter.email), null, voter.email);
      if (emailOwner) {
        return res.status(409).json({
          error: `The email ${voter.email} is already used by external ID ${emailOwner.external_id}.`
        });
      }
      const { code, hash } = freshVoterCode(election.id);
      additions.push({ ...voter, code, hash });
      continue;
    }
    const emailOwner = emailConflict(byEmail.get(voter.email), existing.id, voter.email);
    if (emailOwner) {
      return res.status(409).json({
        error: `The email ${voter.email} is already used by external ID ${emailOwner.external_id}.`
      });
    }
    const emailChanged = String(existing.email).toLowerCase() !== voter.email;
    if (emailChanged && (existing.bound_user_id || existing.round1_used_at || existing.round2_used_at)) {
      return res.status(409).json({
        error: `External ID ${existing.external_id} has already been linked or used. Its email cannot be changed.`
      });
    }
    if (!emailChanged && existing.full_name === voter.fullName) {
      unchanged.push(existing);
      continue;
    }
    const code = emailChanged && !existing.revoked_at ? freshVoterCode(election.id) : null;
    updates.push({ existing, ...voter, code });
    if (code) {
      toSend.push({
        row: { ...existing, email: voter.email, full_name: voter.fullName },
        code: code.code
      });
    }
  }

  const addedRows = [];
  transaction(() => {
    db.prepare("UPDATE elections SET voter_mode = 'roll' WHERE id = ?").run(election.id);
    const parkEmail = db.prepare('UPDATE voter_roll SET email = ? WHERE id = ?');
    for (const item of updates) {
      if (String(item.existing.email).toLowerCase() === item.email) continue;
      parkEmail.run(
        `__import-${item.existing.id}-${Date.now()}-${Math.random().toString(36).slice(2)}@invalid.local`,
        item.existing.id
      );
    }
    const insert = db.prepare(
      `INSERT INTO voter_roll
        (election_id, external_id, full_name, email, code_hash, email_status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    );
    for (const voter of additions) {
      const stamp = nowIso();
      const info = insert.run(
        election.id,
        voter.externalId,
        voter.fullName,
        voter.email,
        voter.hash,
        stamp,
        stamp
      );
      const row = db
        .prepare('SELECT * FROM voter_roll WHERE id = ?')
        .get(Number(info.lastInsertRowid));
      addedRows.push(row);
      toSend.push({ row, code: voter.code });
    }
    const update = db.prepare(
      `UPDATE voter_roll
          SET full_name = ?, email = ?, code_hash = COALESCE(?, code_hash),
              email_status = CASE WHEN ? IS NULL THEN email_status ELSE 'pending' END,
              last_sent_at = CASE WHEN ? IS NULL THEN last_sent_at ELSE NULL END,
              updated_at = ?
        WHERE id = ?`
    );
    for (const item of updates) {
      const codeHash = item.code ? item.code.hash : null;
      update.run(
        item.fullName,
        item.email,
        codeHash,
        codeHash,
        codeHash,
        nowIso(),
        item.existing.id
      );
    }
  });

  let sent = 0;
  let failed = 0;
  for (const item of toSend) {
    const delivery = await deliverVoterCode(election, item.row, item.code);
    if (delivery.ok) sent += 1;
    else failed += 1;
  }
  const refreshed = getElectionById(election.id);
  recordAudit(req.user.id, 'voter_roll.imported', {
    electionId: election.id,
    detail: `added=${additions.length} updated=${updates.length} sent=${sent} failed=${failed}`
  });
  res.json({
    ...voterRollPayload(refreshed),
    message: `Voter roll imported. Added ${additions.length}, updated ${updates.length}, unchanged ${unchanged.length}. Emails sent ${sent}${failed ? `, failed ${failed}` : ''}.`
  });
});

router.post('/elections/:slug/voter-roll/:id/resend', async (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (election.published) {
    return res.status(409).json({ error: 'Voting codes cannot be resent after results are published.' });
  }
  const row = getDb()
    .prepare('SELECT * FROM voter_roll WHERE id = ? AND election_id = ?')
    .get(Number(req.params.id), election.id);
  if (!row) return res.status(404).json({ error: 'Voter roll entry not found.' });
  if (row.revoked_at) {
    return res.status(409).json({ error: 'This voter roll entry has been revoked.', code: 'VOTER_CODE_REVOKED' });
  }
  const { code } = freshVoterCode(election.id);
  const delivery = await deliverVoterCode(election, row, code);
  recordAudit(req.user.id, 'voter_roll.resent', {
    electionId: election.id,
    detail: `voter_roll_id=${row.id}`
  });
  if (!delivery.ok) {
    return res.status(503).json({
      error: 'A new code was generated, but the email could not be sent. Please try again.',
      code: 'EMAIL_DELIVERY_FAILED'
    });
  }
  const refreshed = getDb().prepare('SELECT * FROM voter_roll WHERE id = ?').get(row.id);
  res.json({
    voter: serializeVoterRollRow(refreshed),
    message: 'A new voting code has been emailed to the voter.'
  });
});

router.post('/elections/:slug/voter-roll/:id/revoke', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM voter_roll WHERE id = ? AND election_id = ?')
    .get(Number(req.params.id), election.id);
  if (!row) return res.status(404).json({ error: 'Voter roll entry not found.' });
  if (!row.revoked_at) {
    db.prepare(
      "UPDATE voter_roll SET revoked_at = ?, email_status = 'revoked', updated_at = ? WHERE id = ?"
    ).run(nowIso(), nowIso(), row.id);
    recordAudit(req.user.id, 'voter_roll.revoked', {
      electionId: election.id,
      detail: `voter_roll_id=${row.id}`
    });
  }
  const refreshed = db.prepare('SELECT * FROM voter_roll WHERE id = ?').get(row.id);
  res.json({
    voter: serializeVoterRollRow(refreshed),
    message: 'That voting code has been revoked.'
  });
});

router.delete('/elections/:slug/voter-roll', (req, res) => {
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const db = getDb();
  const votes = Number(
    db.prepare('SELECT COUNT(*) AS c FROM votes WHERE election_id = ?').get(election.id).c
  );
  if (votes > 0) {
    return res.status(409).json({
      error: 'The voter roll cannot be cleared after votes have been cast in this election.'
    });
  }
  db.prepare('DELETE FROM voter_roll WHERE election_id = ?').run(election.id);
  db.prepare("UPDATE elections SET voter_mode = 'open' WHERE id = ?").run(election.id);
  recordAudit(req.user.id, 'voter_roll.cleared', { electionId: election.id });
  res.json({ ok: true, message: 'Voter roll cleared.' });
});

module.exports = router;
