'use strict';

const express = require('express');
const { getDb, now, nowIso } = require('../db');
const { requireAuth } = require('../auth');
const { normalizeCode, hashVoterCode } = require('../voter-codes');
const {
  getElectionBySlug,
  serializeElection,
  serializeCandidate,
  currentRoundForElection
} = require('../helpers');

const router = express.Router();

function roundFor(election, requested) {
  if (election.round_mode !== 'two') return 1;
  const value = Number(requested || currentRoundForElection(election));
  return value === 2 ? 2 : 1;
}

function windowFor(election, round) {
  if (election.round_mode === 'two' && round === 2) {
    return { open: election.round2_open, close: election.round2_close };
  }
  return { open: election.voting_open, close: election.voting_close };
}

function findVoterRollEntry(election, code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return getDb()
    .prepare('SELECT * FROM voter_roll WHERE election_id = ? AND code_hash = ?')
    .get(election.id, hashVoterCode(normalized));
}

function validateVoterRoll(req, election, round, rollEntry) {
  if (!rollEntry) {
    return {
      status: 403,
      body: { error: 'That voting code is not valid for this election.', code: 'INVALID_VOTER_CODE' }
    };
  }
  if (rollEntry.revoked_at) {
    return {
      status: 403,
      body: {
        error: 'That voting code has been revoked. Please contact the election administrator.',
        code: 'VOTER_CODE_REVOKED'
      }
    };
  }
  if (rollEntry.bound_user_id && Number(rollEntry.bound_user_id) !== Number(req.user.id)) {
    return {
      status: 403,
      body: {
        error: 'That voting code is already linked to another account.',
        code: 'VOTER_CODE_BOUND_TO_OTHER_ACCOUNT'
      }
    };
  }
  if (!rollEntry.bound_user_id) {
    const accountEmail = String(req.userRow?.email || req.user.email || '').trim().toLowerCase();
    if (!accountEmail || accountEmail !== String(rollEntry.email).trim().toLowerCase()) {
      return {
        status: 403,
        body: {
          error: 'Your account email does not match the email on the voter roll for this code.',
          code: 'VOTER_EMAIL_MISMATCH'
        }
      };
    }
  }
  const usedAt = round === 2 ? rollEntry.round2_used_at : rollEntry.round1_used_at;
  if (usedAt) {
    return {
      status: 409,
      body: {
        error: 'That voting code has already been used for this round.',
        code: 'VOTER_CODE_ALREADY_USED'
      }
    };
  }
  return null;
}

router.post('/elections/:slug/votes', requireAuth, (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (req.user.role === 'admin') {
    return res
      .status(403)
      .json({ error: 'Administrator accounts cannot vote.', code: 'ADMIN_CANNOT_VOTE' });
  }
  if (!req.user.isEligible) {
    return res.status(403).json({
      error: 'Your account is not eligible to vote in this election.',
      code: 'NOT_ELIGIBLE'
    });
  }

  const round = roundFor(election, req.body?.round);
  if (election.round_mode === 'two') {
    if ((round === 1 && election.stage !== 'First round') || (round === 2 && election.stage !== 'Second round')) {
      return res.status(403).json({
        error: 'Voting is not open for this round.',
        code: 'WRONG_ROUND'
      });
    }
  } else if (election.stage !== 'Voting open') {
    return res.status(403).json({
      error: 'Voting is not open for this election.',
      code: 'VOTING_NOT_OPEN'
    });
  }

  const period = windowFor(election, round);
  const current = now();
  if (period.open && current < new Date(period.open)) {
    return res.status(403).json({
      error: 'The voting period has not started yet.',
      code: 'VOTING_NOT_OPEN'
    });
  }
  if (period.close && current > new Date(period.close)) {
    return res.status(403).json({
      error: 'The voting period has ended.',
      code: 'VOTING_CLOSED'
    });
  }

  let rollEntry = null;
  if (election.voter_mode === 'roll') {
    const rawCode = String(req.body?.voterCode ?? req.body?.voter_code ?? '').trim();
    if (!rawCode) {
      return res.status(403).json({
        error: 'A one-time voting code is required for this election.',
        code: 'VOTER_CODE_REQUIRED'
      });
    }
    rollEntry = findVoterRollEntry(election, rawCode);
    const rollError = validateVoterRoll(req, election, round, rollEntry);
    if (rollError) return res.status(rollError.status).json(rollError.body);
  }

  const candidateId = Number(req.body?.candidateId);
  const candidate = db
    .prepare("SELECT * FROM candidates WHERE id = ? AND election_id = ? AND status = 'approved'")
    .get(candidateId, election.id);
  if (!candidate) {
    return res.status(400).json({ error: 'Choose a valid candidate for this election.' });
  }
  if (round === 2 && !candidate.advanced) {
    return res
      .status(400)
      .json({ error: 'That candidate did not advance to the second round.' });
  }

  const existing = db
    .prepare('SELECT id FROM votes WHERE election_id = ? AND voter_id = ? AND round = ?')
    .get(election.id, req.user.id, round);
  if (existing) {
    return res.status(409).json({
      error: 'You have already voted in this election. Each voter may vote once per round.',
      code: 'ALREADY_VOTED'
    });
  }

  try {
    db.exec('BEGIN IMMEDIATE');
    if (rollEntry) {
      const current = db
        .prepare('SELECT * FROM voter_roll WHERE id = ?')
        .get(rollEntry.id);
      const rollError = validateVoterRoll(req, election, round, current);
      if (rollError) {
        db.exec('ROLLBACK');
        return res.status(rollError.status).json(rollError.body);
      }
      const usedColumn = round === 2 ? 'round2_used_at' : 'round1_used_at';
      db.prepare(
        `UPDATE voter_roll
            SET bound_user_id = COALESCE(bound_user_id, ?),
                bound_at = COALESCE(bound_at, ?),
                ${usedColumn} = ?,
                updated_at = ?
          WHERE id = ?`
      ).run(req.user.id, nowIso(), nowIso(), nowIso(), rollEntry.id);
    }
    const info = db
      .prepare(
        `INSERT INTO votes
          (election_id, round, voter_id, candidate_id, voter_roll_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        election.id,
        round,
        req.user.id,
        candidate.id,
        rollEntry ? rollEntry.id : null,
        nowIso()
      );
    db.exec('COMMIT');
    const voteId = Number(info.lastInsertRowid);
    res.status(201).json({
      vote: {
        id: voteId,
        reference: `VOTE-${String(voteId).padStart(6, '0')}`,
        electionId: election.id,
        electionTitle: election.title,
        electionSlug: election.slug,
        round,
        roundLabel:
          election.round_mode === 'two'
            ? round === 2
              ? 'Second round'
              : 'First round'
            : 'Single round',
        candidateId: candidate.id,
        candidateName: candidate.name,
        candidateInitials: candidate.initials,
        status: 'Accepted',
        createdAt: nowIso()
      },
      election: serializeElection(election),
      candidate: serializeCandidate(candidate)
    });
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      /* no active transaction */
    }
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        error: 'You have already voted in this election. Each voter may vote once per round.',
        code: 'ALREADY_VOTED'
      });
    }
    throw error;
  }
});

router.get('/elections/:slug/my-vote', requireAuth, (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const round = roundFor(election, req.query.round);
  const row = db
    .prepare(
      `SELECT v.*, c.name, c.initials FROM votes v
         JOIN candidates c ON c.id = v.candidate_id
        WHERE v.election_id = ? AND v.voter_id = ? AND v.round = ?`
    )
    .get(election.id, req.user.id, round);
  res.json({
    vote: row
      ? {
          reference: `VOTE-${String(row.id).padStart(6, '0')}`,
          candidateId: row.candidate_id,
          candidateName: row.name,
          candidateInitials: row.initials,
          round,
          createdAt: row.created_at
        }
      : null
  });
});

module.exports = router;
