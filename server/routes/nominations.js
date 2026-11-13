'use strict';

const express = require('express');
const { getDb, now, nowIso } = require('../db');
const { requireAuth } = require('../auth');
const {
  getElectionBySlug,
  getElectionById,
  serializeElection,
  serializeCandidate,
  syncRoundMode,
  recordAudit,
  parseManifesto,
  validatePicture
} = require('../helpers');

const router = express.Router();

const submissionAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

function pruneAttempts(limit = 5000) {
  if (submissionAttempts.size <= limit) return;
  const nowMs = Date.now();
  for (const [key, entry] of submissionAttempts) {
    if (entry.resetAt < nowMs) submissionAttempts.delete(key);
  }
  while (submissionAttempts.size > limit) {
    const oldest = submissionAttempts.keys().next();
    if (oldest.done) break;
    submissionAttempts.delete(oldest.value);
  }
}

function allowSubmission(key) {
  if (process.env.DISABLE_RATE_LIMIT === 'true' || process.env.NODE_ENV === 'test') return true;
  const nowMs = Date.now();
  pruneAttempts();
  const entry = submissionAttempts.get(key);
  if (!entry || entry.resetAt < nowMs) {
    submissionAttempts.set(key, { count: 1, resetAt: nowMs + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
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

function contactsFrom(body) {
  const contacts = {};
  for (const platform of ['Instagram', 'Facebook']) {
    const key = platform.toLowerCase();
    const show =
      body[`show${platform}`] === true ||
      body[`show${platform}`] === 'on' ||
      body[`show${platform}`] === 'true';
    const value = clean(body[`${key}Contact`], 200);
    if (show && value) contacts[key] = { show: true, value };
  }
  return contacts;
}

function nominationPayload(body) {
  const name = clean(body.candidateName ?? body.name, 80);
  if (name.length < 2) return { error: 'Enter the candidate name.' };
  const introduction = clean(body.introduction ?? body.bio, 2000);
  if (!introduction) return { error: 'Enter a personal introduction.' };
  const manifesto = parseManifesto(body.manifesto ?? body.statement);
  const portfolio = clean(body.portfolio, 2000);
  const campaign = clean(body.campaign ?? body.tag, 160);
  const studentId = clean(body.candidateMember ?? body.memberId ?? body.studentId, 30);
  if (!studentId) return { error: 'Enter your membership or student ID.' };
  const declaration =
    body.declaration === true || body.declaration === 'on' || body.declaration === 'true';
  if (!declaration) {
    return { error: 'Please confirm that you have reviewed your candidate introduction.' };
  }
  const picture = validatePicture(body.picture);
  if (picture.error) return { error: picture.error };
  return {
    data: {
      name,
      initials: initialsFor(name),
      introduction,
      manifesto,
      portfolio,
      campaign,
      studentId,
      contacts: contactsFrom(body),
      picture: picture.value
    }
  };
}

function nominationWindowOpen(election) {
  if (election.stage === 'Draft' || election.stage === 'Results published') return false;
  if (election.stage !== 'Nominations open' && election.stage !== 'Candidate review') return false;
  const open = election.nomination_open ? new Date(election.nomination_open) : null;
  const close = election.nomination_close ? new Date(election.nomination_close) : null;
  const current = now();
  if (open && current < open) return false;
  if (close && current > close) return false;
  return true;
}

router.post('/elections/:slug/nominations', requireAuth, (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  if (req.user.role === 'admin') {
    return res
      .status(403)
      .json({ error: 'Administrator accounts cannot apply as candidates.', code: 'ADMIN_CANNOT_APPLY' });
  }
  if (!allowSubmission(`${req.ip}:${req.user.id}`)) {
    return res
      .status(429)
      .json({ error: 'Too many nomination attempts. Please wait a few minutes and try again.' });
  }
  if (election.entry_mode !== 'students') {
    return res
      .status(403)
      .json({ error: 'This election only accepts candidate descriptions entered by the administrator.' });
  }
  if (!req.user.isEligible) {
    return res.status(403).json({ error: 'Your account is not on the school election roll.', code: 'NOT_ELIGIBLE' });
  }
  if (!nominationWindowOpen(election)) {
    return res
      .status(403)
      .json({ error: 'The nomination period is not open for this election.', code: 'NOMINATION_CLOSED' });
  }
  const existing = db
    .prepare('SELECT * FROM candidates WHERE election_id = ? AND user_id = ?')
    .get(election.id, req.user.id);
  if (existing) {
    return res.status(409).json({
      error: 'You have already submitted a nomination for this election. Edit your existing nomination instead.',
      code: 'ALREADY_NOMINATED',
      candidate: serializeCandidate(existing, { includeReview: true })
    });
  }

  const payload = nominationPayload(req.body || {});
  if (payload.error) return res.status(400).json({ error: payload.error });
  const data = payload.data;
  const memberTaken = db
    .prepare(
      'SELECT id FROM candidates WHERE election_id = ? AND member_id = ? AND (user_id IS NULL OR user_id != ?)'
    )
    .get(election.id, data.studentId, req.user.id);
  if (memberTaken) {
    return res
      .status(409)
      .json({ error: 'That membership or student ID is already used in this election.', code: 'MEMBER_ID_TAKEN' });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO candidates
          (election_id, user_id, name, initials, tag, bio, manifesto, portfolio, picture, contacts,
           member_id, status, advanced, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
      )
      .run(
        election.id,
        req.user.id,
        data.name,
        data.initials,
        data.campaign,
        data.introduction,
        JSON.stringify(data.manifesto),
        data.portfolio,
        data.picture,
        JSON.stringify(data.contacts),
        data.studentId,
        nowIso(),
        nowIso()
      );

    const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(info.lastInsertRowid));
    recordAudit(req.user.id, 'nomination.submitted', {
      electionId: election.id,
      candidateId: row.id
    });
    syncRoundMode(election.id);
    res.status(201).json({
      candidate: serializeCandidate(row, { includeReview: true }),
      election: serializeElection(getElectionById(election.id)),
      message: 'Nomination submitted for review.'
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) {
      return res.status(409).json({
        error: 'You have already submitted a nomination for this election. Edit your existing nomination instead.',
        code: 'ALREADY_NOMINATED'
      });
    }
    throw error;
  }
});

router.put('/nominations/:id', requireAuth, (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Nomination not found.' });
  if (candidate.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own nomination.' });
  }
  if (req.user.role === 'admin') {
    return res
      .status(403)
      .json({ error: 'Administrator accounts cannot edit candidate applications.', code: 'ADMIN_CANNOT_APPLY' });
  }
  if (candidate.status !== 'pending') {
    return res.status(403).json({
      error:
        candidate.status === 'approved'
          ? 'Your nomination has been approved and can no longer be edited. Ask the administrator to return it for changes.'
          : 'This nomination has been rejected and can no longer be edited.',
      code: 'NOMINATION_LOCKED'
    });
  }
  const election = getElectionById(candidate.election_id);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const close = election.nomination_close ? new Date(election.nomination_close) : null;
  if (close && now() > close) {
    return res.status(403).json({
      error: 'The nomination deadline has passed. Your nomination can no longer be edited.',
      code: 'NOMINATION_CLOSED'
    });
  }
  if (election.stage === 'Results published') {
    return res.status(403).json({ error: 'This election has finished.' });
  }
  if (!allowSubmission(`${req.ip}:${req.user.id}`)) {
    return res
      .status(429)
      .json({ error: 'Too many nomination attempts. Please wait a few minutes and try again.' });
  }

  const payload = nominationPayload(req.body || {});
  if (payload.error) return res.status(400).json({ error: payload.error });
  const data = payload.data;
  const memberTaken = db
    .prepare(
      'SELECT id FROM candidates WHERE election_id = ? AND member_id = ? AND id != ?'
    )
    .get(election.id, data.studentId, candidate.id);
  if (memberTaken) {
    return res
      .status(409)
      .json({ error: 'That membership or student ID is already used in this election.', code: 'MEMBER_ID_TAKEN' });
  }

  db.prepare(
    `UPDATE candidates
        SET name = ?, initials = ?, tag = ?, bio = ?, manifesto = ?, portfolio = ?, picture = ?,
            contacts = ?, member_id = ?, status = 'pending', review_note = NULL,
            reviewed_at = NULL, reviewed_by = NULL, updated_at = ?
      WHERE id = ? AND status = 'pending'`
  ).run(
    data.name,
    data.initials,
    data.campaign,
    data.introduction,
    JSON.stringify(data.manifesto),
    data.portfolio,
    data.picture,
    JSON.stringify(data.contacts),
    data.studentId,
    nowIso(),
    candidate.id
  );

  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  if (!row || row.status !== 'pending') {
    return res.status(409).json({
      error: 'Your nomination was updated by the administrator. Please reload and try again.',
      code: 'REVIEW_CONFLICT'
    });
  }
  recordAudit(req.user.id, 'nomination.updated', {
    electionId: election.id,
    candidateId: row.id
  });
  syncRoundMode(election.id);
  res.json({
    candidate: serializeCandidate(row, { includeReview: true }),
    election: serializeElection(getElectionById(election.id)),
    message: 'Nomination updated and sent for review.'
  });
});

module.exports = router;
