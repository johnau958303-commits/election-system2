'use strict';

const express = require('express');
const { getDb, now } = require('../db');
const { requireAuth } = require('../auth');
const {
  serializeElection,
  serializeCandidate,
  approvedCandidates,
  resultSummary,
  getElectionBySlug,
  getElectionById,
  electionStatus,
  currentRoundForElection
} = require('../helpers');

const router = express.Router();

function withResult(row) {
  const election = serializeElection(row);
  if (election.published) {
    const summary = resultSummary(row.id);
    election.winner = summary.winner;
    election.tie = summary.tie;
    election.results = summary;
  }
  return election;
}

router.get('/elections', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM elections ORDER BY id').all();
  res.json({ elections: rows.map(withResult) });
});

router.get('/elections/:slug', (req, res) => {
  const row = getElectionBySlug(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Election not found.', code: 'NOT_FOUND' });
  const election = withResult(row);
  const round = currentRoundForElection(row);
  res.json({
    election,
    round,
    candidates: approvedCandidates(row.id, round).map((candidate) => serializeCandidate(candidate))
  });
});

router.get('/elections/:slug/candidates', (req, res) => {
  const row = getElectionBySlug(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Election not found.', code: 'NOT_FOUND' });
  let round = Number(req.query.round || 1);
  if (![1, 2].includes(round)) round = 1;
  if (round === 2 && row.round_mode !== 'two') {
    return res.status(400).json({ error: 'This election does not have a second round.' });
  }
  const candidates = approvedCandidates(row.id, round).map((candidate) =>
    serializeCandidate(candidate)
  );
  res.json({
    election: serializeElection(row),
    round,
    candidates
  });
});

router.get('/elections/:slug/results', (req, res) => {
  const row = getElectionBySlug(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Election not found.', code: 'NOT_FOUND' });
  if (!row.published) {
    return res
      .status(403)
      .json({ error: 'Results for this election have not been published yet.', code: 'RESULTS_NOT_PUBLISHED' });
  }
  res.json({ election: withResult(row), results: resultSummary(row.id) });
});

router.get('/results', (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM elections WHERE published = 1 ORDER BY results_at DESC, id DESC')
    .all();
  res.json({
    results: rows.map((row) => ({
      election: withResult(row),
      results: resultSummary(row.id)
    }))
  });
});

router.get('/my-votes', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT v.*, e.title, e.slug, e.round_mode, e.stage, c.name AS candidate_name, c.initials
         FROM votes v
         JOIN elections e ON e.id = v.election_id
         JOIN candidates c ON c.id = v.candidate_id
        WHERE v.voter_id = ?
        ORDER BY v.id DESC`
    )
    .all(req.user.id);
  res.json({
    votes: rows.map((row) => ({
      id: row.id,
      reference: `VOTE-${String(row.id).padStart(6, '0')}`,
      electionId: row.election_id,
      electionTitle: row.title,
      electionSlug: row.slug,
      round: Number(row.round),
      roundLabel:
        row.round_mode === 'two'
          ? Number(row.round) === 2
            ? 'Second round'
            : 'First round'
          : 'Single round',
      candidateId: row.candidate_id,
      candidateName: row.candidate_name,
      candidateInitials: row.initials,
      createdAt: row.created_at,
      status: 'Accepted'
    }))
  });
});

router.get('/nominations/mine', requireAuth, (req, res) => {
  const db = getDb();
  const slug = String(req.query.election || '');
  let row = null;
  let electionRow = null;
  if (slug) {
    electionRow = getElectionBySlug(slug);
    if (electionRow) {
      row = db
        .prepare('SELECT * FROM candidates WHERE election_id = ? AND user_id = ?')
        .get(electionRow.id, req.user.id);
    }
  } else {
    row = db
      .prepare(
        `SELECT c.*, e.slug AS election_slug, e.title AS election_title
           FROM candidates c JOIN elections e ON e.id = c.election_id
          WHERE c.user_id = ?
          ORDER BY c.updated_at DESC LIMIT 1`
      )
      .get(req.user.id);
    if (row) {
      electionRow = getElectionById(row.election_id);
    }
  }
  if (!row) return res.json({ candidate: null, election: electionRow ? serializeElection(electionRow) : null });

  const deadline = electionRow.nomination_close ? new Date(electionRow.nomination_close) : null;
  const canEdit =
    row.status === 'pending' &&
    electionRow.stage !== 'Results published' &&
    (!deadline || now() <= deadline);
  res.json({
    candidate: serializeCandidate(row, { includeReview: true }),
    election: serializeElection(electionRow),
    canEdit
  });
});

router.get('/status', requireAuth, (req, res) => {
  const db = getDb();
  const electionRow = getElectionBySlug(req.query.election || 'student-council');
  if (!electionRow) {
    return res.status(404).json({ error: 'Election not found.' });
  }
  const election = serializeElection(electionRow);
  const currentRound = currentRoundForElection(electionRow);
  const vote = db
    .prepare(
      `SELECT v.*, c.name, c.initials FROM votes v
         JOIN candidates c ON c.id = v.candidate_id
        WHERE v.election_id = ? AND v.voter_id = ? AND v.round = ?
        ORDER BY v.id DESC LIMIT 1`
    )
    .get(electionRow.id, req.user.id, currentRound);
  const status = electionStatus(electionRow);
  const rollEntry =
    electionRow.voter_mode === 'roll'
      ? db
          .prepare(
            `SELECT id FROM voter_roll
              WHERE election_id = ? AND lower(email) = lower(?) AND revoked_at IS NULL`
          )
          .get(electionRow.id, req.user.email || '')
      : null;
  const onRoll = electionRow.voter_mode !== 'roll' || Boolean(rollEntry);
  const reason =
    !req.user.isEligible || !onRoll
      ? 'NOT_ELIGIBLE'
      : vote
        ? 'ALREADY_VOTED'
        : status === 'closed' || status === 'published'
          ? 'VOTING_CLOSED'
          : status === 'upcoming' || status === 'nominations_open' || status === 'candidate_review' || status === 'draft'
            ? 'VOTING_NOT_OPEN'
            : 'ELIGIBLE';
  res.json({
    user: req.user,
    election,
    status,
    reason,
    requiresVoterCode: electionRow.voter_mode === 'roll',
    myVote: vote
      ? {
          reference: `VOTE-${String(vote.id).padStart(6, '0')}`,
          candidateId: vote.candidate_id,
          candidateName: vote.name,
          candidateInitials: vote.initials,
          round: Number(vote.round),
          createdAt: vote.created_at
        }
      : null
  });
});

module.exports = router;
