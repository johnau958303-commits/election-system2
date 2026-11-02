'use strict';

const express = require('express');
const { getDb, now, nowIso } = require('../db');
const { requireAuth } = require('../auth');
const {
  getElectionBySlug,
  getElectionById,
  serializeElection,
  serializeCandidate,
  parseManifesto
} = require('../helpers');

const router = express.Router();

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

function validatePicture(picture) {
  if (!picture) return { value: null };
  const value = String(picture);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    return { error: 'Choose a PNG, JPEG or WebP image.' };
  }
  const base64 = value.slice(value.indexOf(',') + 1);
  if (base64.length * 0.75 > 2 * 1024 * 1024) {
    return { error: 'The profile picture must be 2 MB or smaller.' };
  }
  return { value };
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
  const campaign = clean(body.campaign ?? body.tag, 160);
  const studentId = clean(body.candidateMember ?? body.studentId, 30);
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
      candidate: serializeCandidate(existing)
    });
  }

  const payload = nominationPayload(req.body || {});
  if (payload.error) return res.status(400).json({ error: payload.error });
  const data = payload.data;

  const info = db
    .prepare(
      `INSERT INTO candidates
        (election_id, user_id, name, initials, tag, bio, manifesto, picture, contacts,
         status, advanced, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    )
    .run(
      election.id,
      req.user.id,
      data.name,
      data.initials,
      data.campaign,
      data.introduction,
      JSON.stringify(data.manifesto),
      data.picture,
      JSON.stringify(data.contacts),
      nowIso(),
      nowIso()
    );

  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({
    candidate: serializeCandidate(row),
    election: serializeElection(election),
    message: 'Nomination submitted for review.'
  });
});

router.put('/nominations/:id', requireAuth, (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Nomination not found.' });
  if (candidate.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own nomination.' });
  }
  if (candidate.status === 'rejected') {
    return res.status(403).json({ error: 'This nomination has been reviewed and cannot be edited.' });
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

  const payload = nominationPayload(req.body || {});
  if (payload.error) return res.status(400).json({ error: payload.error });
  const data = payload.data;

  db.prepare(
    `UPDATE candidates
        SET name = ?, initials = ?, tag = ?, bio = ?, manifesto = ?, picture = ?,
            contacts = ?, status = 'pending', updated_at = ?
      WHERE id = ?`
  ).run(
    data.name,
    data.initials,
    data.campaign,
    data.introduction,
    JSON.stringify(data.manifesto),
    data.picture,
    JSON.stringify(data.contacts),
    nowIso(),
    candidate.id
  );

  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  res.json({
    candidate: serializeCandidate(row),
    election: serializeElection(election),
    message: 'Nomination updated and sent for review.'
  });
});

module.exports = router;
