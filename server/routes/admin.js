'use strict';

const express = require('express');
const { getDb, now, nowIso, toIso, transaction } = require('../db');
const { requireAdmin } = require('../auth');
const {
  STAGES,
  serializeElection,
  serializeCandidate,
  allCandidates,
  countVotes,
  resultSummary,
  resultEntries,
  electionStatus,
  getElectionBySlug,
  getElectionById,
  eligibleVoterCount,
  parseManifesto
} = require('../helpers');

const router = express.Router();
router.use(requireAdmin);

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
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

function plusDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function electionInput(body, existing) {
  const title = clean(body.electionTitle ?? body.title, 120);
  if (title.length < 3) return { error: 'Enter an election title.' };
  const description = clean(body.description, 1000);
  const seats = Math.max(1, Math.min(50, Number(body.seats) || existing?.seats || 1));
  const method = clean(body.method, 80) || 'Single candidate selection';
  const nominationOpen =
    toIso(body.nomOpen ?? body.nominationOpen) || existing?.nomination_open || null;
  const nominationClose =
    toIso(body.nomClose ?? body.nominationClose, { endOfDay: true }) ||
    existing?.nomination_close ||
    null;
  const votingOpen = toIso(body.voteOpen ?? body.votingOpen) || existing?.voting_open || null;
  const votingClose =
    toIso(body.voteClose ?? body.votingClose) || existing?.voting_close || null;
  const resultsAt = toIso(body.publishAt ?? body.resultsAt) || existing?.results_at || null;
  const candidateCount = Math.max(
    1,
    Math.min(50, Number(body.candidateCount ?? body.candidate_count) || existing?.candidate_count || 4)
  );
  const roundMode = body.roundMode
    ? String(body.roundMode)
    : candidateCount > 4
      ? 'two'
      : 'single';
  if (!['single', 'two'].includes(roundMode)) {
    return { error: 'Invalid election method.' };
  }

  if (nominationOpen && nominationClose && new Date(nominationOpen) > new Date(nominationClose)) {
    return { error: 'The nomination deadline must be after the opening date.' };
  }
  if (votingOpen && votingClose && new Date(votingOpen) > new Date(votingClose)) {
    return { error: 'Voting must close after it opens.' };
  }

  let round2Open = toIso(body.round2Open) || existing?.round2_open || null;
  let round2Close = toIso(body.round2Close) || existing?.round2_close || null;
  if (roundMode === 'two') {
    if (!round2Open && votingClose) round2Open = votingClose;
    if (!round2Close) {
      round2Close = resultsAt || (round2Open ? plusDays(round2Open, 3) : null);
    }
  } else {
    round2Open = null;
    round2Close = null;
  }

  const entryMode = String(body.entryMode ?? existing?.entry_mode ?? 'students');
  if (!['students', 'admin'].includes(entryMode)) {
    return { error: 'Invalid candidate entry method.' };
  }
  const eligibleGroup =
    clean(body.voterGroup ?? body.eligibleGroup, 80) ||
    existing?.eligible_group ||
    'All registered students';
  const votingRules =
    body.votingRules !== undefined
      ? String(body.votingRules || '')
      : existing?.voting_rules ||
        [
          'Each eligible student may cast one vote for one candidate.',
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
      ...serializeCandidate(row),
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
  const round = row.round_mode === 'two' && row.stage === 'Second round' ? 2 : 1;
  res.json({
    election: adminElectionPayload(row),
    round,
    candidates: allCandidates(row.id).map((candidate) => serializeCandidate(candidate)),
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
  const stage = STAGES.includes(body.stage) ? body.stage : 'Draft';
  const info = db
    .prepare(
      `INSERT INTO elections
        (slug, title, description, seats, method, nomination_open, nomination_close,
         voting_open, voting_close, round2_open, round2_close, results_at, stage,
         entry_mode, candidate_count, round_mode, eligible_group, voting_rules,
         published, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
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
      data.eligible_group,
      data.voting_rules,
      nowIso()
    );
  const row = getElectionById(Number(info.lastInsertRowid));
  res.status(201).json({ election: adminElectionPayload(row) });
});

router.put('/elections/:slug', (req, res) => {
  const existing = getElectionBySlug(req.params.slug);
  if (!existing) return res.status(404).json({ error: 'Election not found.' });
  const parsed = electionInput(req.body || {}, existing);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const data = parsed.data;
  const stage = STAGES.includes(req.body?.stage) ? req.body.stage : existing.stage;
  getDb()
    .prepare(
      `UPDATE elections SET
         title = ?, description = ?, seats = ?, method = ?,
         nomination_open = ?, nomination_close = ?, voting_open = ?, voting_close = ?,
         round2_open = ?, round2_close = ?, results_at = ?, stage = ?,
         entry_mode = ?, candidate_count = ?, round_mode = ?, eligible_group = ?,
         voting_rules = ?
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
      data.eligible_group,
      data.voting_rules,
      existing.id
    );
  const row = getElectionById(existing.id);
  res.json({ election: adminElectionPayload(row) });
});

function advanceFinalists(election) {
  const db = getDb();
  const candidates = countVotes(election.id, 1).candidates;
  if (!candidates.length) return { advanced: 0, tie: false };
  const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  let selected = [];
  if (totalVotes === 0) {
    selected = candidates.slice(0, 4);
  } else {
    selected = candidates.slice(0, 4);
    const cutoff = selected[selected.length - 1].votes;
    if (cutoff > 0) {
      const extra = candidates
        .slice(4)
        .filter((candidate) => candidate.votes === cutoff);
      selected = [...selected, ...extra];
    }
    if (selected.length < 4) {
      for (const candidate of candidates) {
        if (selected.length >= 4) break;
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
  const winners = count.candidates.filter((candidate) => candidate.votes === topVotes);
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
      const outcome =
        candidate.votes === topVotes
          ? winners.length > 1
            ? 'tied'
            : 'elected'
          : 'not_elected';
      insert.run(
        election.id,
        round,
        candidate.id,
        candidate.votes,
        outcome,
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
    winner: winners.length === 1 ? winners[0].name : winners.map((w) => w.name).join(' & '),
    tie: winners.length > 1
  };
}

router.patch('/elections/:slug/stage', (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const stage = String(req.body?.stage || '');
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid election stage.' });

  const messages = [];
  if (stage === 'Second round' && election.round_mode === 'two') {
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
    round = election.round_mode === 'two' && election.stage === 'Second round' ? 2 : 1;
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
  const round =
    election.round_mode === 'two' && Number(req.body?.round) === 2
      ? 2
      : election.round_mode === 'two' && election.stage === 'Second round'
        ? 2
        : Number(req.body?.round) === 2
          ? 2
          : 1;
  const published = publishElection(election, round);
  if (published.error) return res.status(409).json({ error: published.error });
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
    candidates: allCandidates(election.id).map((candidate) => serializeCandidate(candidate))
  });
});

router.get('/candidates/:id', (req, res) => {
  const candidate = getDb()
    .prepare('SELECT * FROM candidates WHERE id = ?')
    .get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
  const election = getElectionById(candidate.election_id);
  res.json({
    candidate: serializeCandidate(candidate),
    election: adminElectionPayload(election)
  });
});

router.patch('/candidates/:id/status', (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Nomination not found.' });
  const status = String(req.body?.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid nomination status.' });
  }
  db.prepare('UPDATE candidates SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    nowIso(),
    candidate.id
  );
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  res.json({
    candidate: serializeCandidate(row),
    message:
      status === 'approved'
        ? 'Nomination approved. The candidate is now on the ballot.'
        : status === 'rejected'
          ? 'Nomination rejected.'
          : 'Nomination returned for review.'
  });
});

router.post('/elections/:slug/candidates', (req, res) => {
  const db = getDb();
  const election = getElectionBySlug(req.params.slug);
  if (!election) return res.status(404).json({ error: 'Election not found.' });
  const body = req.body || {};
  const name = clean(body.name ?? body.adminCandidateName, 80);
  if (name.length < 2) return res.status(400).json({ error: 'Enter the candidate name.' });
  const bio = clean(body.bio ?? body.adminIntroduction, 2000);
  const tag = clean(body.tag ?? body.adminSlogan, 160);
  const manifesto = parseManifesto(body.manifesto ?? body.adminStatement);
  const picture = validatePicture(body.picture);
  if (picture.error) return res.status(400).json({ error: picture.error });
  const info = db
    .prepare(
      `INSERT INTO candidates
        (election_id, user_id, name, initials, tag, bio, manifesto, picture, contacts,
         status, advanced, submitted_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, '[]', 'approved', 1, ?, ?)`
    )
    .run(
      election.id,
      name,
      initialsFor(name),
      tag,
      bio,
      JSON.stringify(manifesto),
      picture.value,
      nowIso(),
      nowIso()
    );
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ candidate: serializeCandidate(row), message: 'Candidate added.' });
});

router.put('/candidates/:id', (req, res) => {
  const db = getDb();
  const candidate = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
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

  db.prepare(
    `UPDATE candidates
        SET name = ?, initials = ?, tag = ?, bio = ?, manifesto = ?, picture = ?,
            status = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    name,
    initialsFor(name),
    tag,
    bio,
    JSON.stringify(manifesto),
    picture,
    status,
    nowIso(),
    candidate.id
  );
  const row = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidate.id);
  res.json({ candidate: serializeCandidate(row), message: 'Candidate description saved.' });
});

module.exports = router;
