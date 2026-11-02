'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(os.tmpdir(), `emvs-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
process.env.DB_PATH = dbPath;
process.env.DEMO_MODE = 'true';

const { createApp } = require('../server/app');
const { closeDb } = require('../server/db');

const app = createApp();
let server;
let base;
let adminCookie = '';
let studentCookie = '';
let voter1Cookie = '';

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return raw.map((value) => value.split(';')[0]).join('; ');
}

async function request(urlPath, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(base + urlPath, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }
  return { status: response.status, data, cookie: cookiesFrom(response) };
}

function iso(days, hour = 9) {
  const date = new Date(Date.now() + days * 86400000);
  date.setUTCHours(hour - 8, 0, 0, 0);
  return date.toISOString();
}

async function createElection(overrides = {}) {
  const body = {
    electionTitle: 'Test Election ' + Math.random().toString(16).slice(2, 8),
    description: 'Test election description',
    seats: 1,
    method: 'Single candidate selection',
    nomOpen: iso(-2),
    nomClose: iso(-1),
    voteOpen: iso(-0.5),
    voteClose: iso(0.5),
    publishAt: iso(1),
    voterGroup: 'All registered students',
    entryMode: 'admin',
    candidateCount: 2,
    votingRules: 'One vote per student.',
    stage: 'Voting open',
    ...overrides
  };
  const result = await request('/api/admin/elections', {
    method: 'POST',
    cookie: adminCookie,
    body
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.election;
}

async function addCandidate(slug, name = 'Test Candidate') {
  const result = await request(`/api/admin/elections/${slug}/candidates`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name,
      bio: 'Candidate introduction',
      manifesto: 'First point\nSecond point',
      tag: 'Test slogan'
    }
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.candidate;
}

async function registerAndLogin(username) {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Test ' + username,
      email: `${username}@school.example`
    }
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.data));
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username, password: 'Password123!' }
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  return login.cookie;
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin1234!' }
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  adminCookie = login.cookie;

  const student = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'student', password: 'Student1234!' }
  });
  studentCookie = student.cookie;

  voter1Cookie = await registerAndLogin('voterone');
  await registerAndLogin('votertwo');
});

test('1. registration, duplicate usernames, login and sessions', async () => {
  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'voterone',
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Duplicate'
    }
  });
  assert.equal(duplicate.status, 409);

  const wrong = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'student', password: 'wrong-password' }
  });
  assert.equal(wrong.status, 401);

  const session = await request('/api/auth/session', { cookie: studentCookie });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.username, 'student');
  assert.equal(session.data.user.role, 'student');
  assert.equal(session.data.user.isEligible, true);
});

test('2. election information is stored and returned', async () => {
  const election = await createElection({ electionTitle: 'Information Election' });
  const list = await request('/api/elections');
  assert.equal(list.status, 200);
  const found = list.data.elections.find((item) => item.slug === election.slug);
  assert.ok(found);
  assert.equal(found.title, 'Information Election');
  assert.equal(found.votingRules[0], 'One vote per student.');
  assert.ok(found.votingOpen);
  assert.ok(found.votingClose);
});

test('3. administrators create and edit elections; students cannot', async () => {
  const denied = await request('/api/admin/elections', {
    method: 'POST',
    cookie: studentCookie,
    body: { electionTitle: 'Not allowed' }
  });
  assert.equal(denied.status, 403);

  const election = await createElection({ electionTitle: 'Editable Election' });
  const updated = await request('/api/admin/elections/' + election.slug, {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      electionTitle: 'Edited Election',
      description: 'Edited description',
      seats: 1,
      nomOpen: iso(-3),
      nomClose: iso(-2),
      voteOpen: iso(-1),
      voteClose: iso(1),
      publishAt: iso(2),
      voterGroup: 'All registered students',
      entryMode: 'admin',
      candidateCount: 2,
      votingRules: 'Edited rule.'
    }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.election.title, 'Edited Election');

  const studentView = await request('/api/admin/overview', { cookie: studentCookie });
  assert.equal(studentView.status, 403);
});

test('4. nominations can be submitted, edited before the deadline, and approved', async () => {
  const election = await createElection({
    electionTitle: 'Nomination Election',
    entryMode: 'students',
    stage: 'Nominations open',
    nomOpen: iso(-1),
    nomClose: iso(2),
    voteOpen: iso(3),
    voteClose: iso(4)
  });
  const payload = {
    candidateName: 'Nomination Tester',
    candidateMember: 'S200',
    introduction: 'I would like to represent students.',
    manifesto: 'Point one\nPoint two',
    campaign: 'Together',
    declaration: true,
    showInstagram: true,
    instagramContact: '@tester'
  };
  const created = await request(`/api/elections/${election.slug}/nominations`, {
    method: 'POST',
    cookie: studentCookie,
    body: payload
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.candidate.status, 'pending');
  const candidateId = created.data.candidate.id;

  const duplicate = await request(`/api/elections/${election.slug}/nominations`, {
    method: 'POST',
    cookie: studentCookie,
    body: payload
  });
  assert.equal(duplicate.status, 409);

  const edited = await request('/api/nominations/' + candidateId, {
    method: 'PUT',
    cookie: studentCookie,
    body: { ...payload, campaign: 'Updated slogan' }
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.candidate.tag, 'Updated slogan');

  const approved = await request('/api/admin/candidates/' + candidateId + '/status', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'approved' }
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.candidate.status, 'approved');

  const adminDetail = await request('/api/admin/candidates/' + candidateId, {
    cookie: adminCookie
  });
  assert.equal(adminDetail.status, 200, JSON.stringify(adminDetail.data));
  assert.equal(adminDetail.data.candidate.name, 'Nomination Tester');
  assert.equal(adminDetail.data.election.slug, election.slug);

  const studentDetail = await request('/api/admin/candidates/' + candidateId, {
    cookie: studentCookie
  });
  assert.equal(studentDetail.status, 403);

  const candidates = await request(`/api/elections/${election.slug}/candidates`);
  assert.ok(candidates.data.candidates.some((candidate) => candidate.id === candidateId));

  process.env.ELECTION_NOW = iso(3);
  try {
    const late = await request('/api/nominations/' + candidateId, {
      method: 'PUT',
      cookie: studentCookie,
      body: { ...payload, campaign: 'Too late' }
    });
    assert.equal(late.status, 403);
    assert.equal(late.data.code, 'NOMINATION_CLOSED');
  } finally {
    delete process.env.ELECTION_NOW;
  }
});

test('5. voting works once per voter and blocks duplicates, ineligible voters and closed periods', async () => {
  const election = await createElection({ electionTitle: 'Voting Election' });
  const first = await addCandidate(election.slug, 'Candidate One');
  const second = await addCandidate(election.slug, 'Candidate Two');

  const vote = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id }
  });
  assert.equal(vote.status, 201, JSON.stringify(vote.data));
  assert.equal(vote.data.vote.candidateName, 'Candidate One');
  assert.match(vote.data.vote.reference, /^VOTE-\d{6}$/);

  const duplicate = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: second.id }
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.code, 'ALREADY_VOTED');

  const ineligible = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'notonroll', password: 'Student1234!' }
  });
  const blocked = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: ineligible.cookie,
    body: { candidateId: first.id }
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'NOT_ELIGIBLE');

  const closedElection = await createElection({
    electionTitle: 'Closed Election',
    voteOpen: iso(-3),
    voteClose: iso(-2)
  });
  const closedCandidate = await addCandidate(closedElection.slug, 'Closed Candidate');
  const closedVote = await request(`/api/elections/${closedElection.slug}/votes`, {
    method: 'POST',
    cookie: studentCookie,
    body: { candidateId: closedCandidate.id }
  });
  assert.equal(closedVote.status, 403);
  assert.equal(closedVote.data.code, 'VOTING_CLOSED');

  const myVotes = await request('/api/my-votes', { cookie: voter1Cookie });
  assert.equal(myVotes.status, 200);
  assert.equal(myVotes.data.votes.length, 1);
});

test('6. counting, ties and publishing are calculated from accepted votes', async () => {
  const election = await createElection({ electionTitle: 'Tie Election' });
  const first = await addCandidate(election.slug, 'Tie One');
  const second = await addCandidate(election.slug, 'Tie Two');

  const secondVoter = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'votertwo', password: 'Password123!' }
  });
  assert.equal(secondVoter.status, 200);
  const voteA = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id }
  });
  const voteB = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: secondVoter.cookie,
    body: { candidateId: second.id }
  });
  assert.equal(voteA.status, 201);
  assert.equal(voteB.status, 201);

  const hidden = await request(`/api/elections/${election.slug}/results`);
  assert.equal(hidden.status, 403);

  const count = await request(`/api/admin/elections/${election.slug}/count`, {
    cookie: adminCookie
  });
  assert.equal(count.status, 200);
  assert.equal(count.data.count.totalVotes, 2);
  assert.equal(count.data.count.tie, true);

  const blockedPublish = await request(`/api/admin/elections/${election.slug}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(blockedPublish.status, 409);
  assert.equal(blockedPublish.data.code, 'VOTING_OPEN');

  const closed = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting closed' }
  });
  assert.equal(closed.status, 200);

  const published = await request(`/api/admin/elections/${election.slug}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.tie, true);

  const results = await request(`/api/elections/${election.slug}/results`);
  assert.equal(results.status, 200);
  assert.equal(results.data.results.tie, true);
  assert.equal(results.data.results.entries.length, 2);
  assert.ok(results.data.results.entries.every((entry) => entry.outcome === 'tied'));
});

test('7. two-round elections advance four finalists and restrict round voting', async () => {
  const election = await createElection({
    electionTitle: 'Two Round Election',
    candidateCount: 6,
    stage: 'First round',
    voteOpen: iso(-0.5),
    voteClose: iso(0.5)
  });
  const created = [];
  for (let i = 0; i < 6; i += 1) {
    created.push(await addCandidate(election.slug, `Finalist ${i + 1}`));
  }

  const sixVotes = [];
  const voters = [voter1Cookie];
  for (let i = 0; i < 5; i += 1) {
    voters.push(await registerAndLogin('roundvoter' + i));
  }
  for (let i = 0; i < 6; i += 1) {
    sixVotes.push(
      await request(`/api/elections/${election.slug}/votes`, {
        method: 'POST',
        cookie: voters[i],
        body: { candidateId: created[i < 3 ? 0 : 1].id, round: 1 }
      })
    );
  }
  assert.ok(sixVotes.every((response) => response.status === 201), JSON.stringify(sixVotes.map((v) => v.data)));

  const advanced = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Second round' }
  });
  assert.equal(advanced.status, 200, JSON.stringify(advanced.data));

  const secondRound = await request(`/api/elections/${election.slug}/candidates?round=2`);
  assert.equal(secondRound.status, 200);
  assert.equal(secondRound.data.candidates.length, 4);

  const wrongRound = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: secondRound.data.candidates[0].id, round: 1 }
  });
  assert.equal(wrongRound.status, 403);
  assert.equal(wrongRound.data.code, 'WRONG_ROUND');
});

test('8. data is stored in SQLite on disk', async () => {
  const disk = new DatabaseSync(dbPath);
  try {
    const users = Number(disk.prepare('SELECT COUNT(*) AS c FROM users').get().c);
    const elections = Number(disk.prepare('SELECT COUNT(*) AS c FROM elections').get().c);
    const votes = Number(disk.prepare('SELECT COUNT(*) AS c FROM votes').get().c);
    const results = Number(disk.prepare('SELECT COUNT(*) AS c FROM result_entries').get().c);
    assert.ok(users > 0);
    assert.ok(elections > 0);
    assert.ok(votes > 0);
    assert.ok(results > 0);
  } finally {
    disk.close();
  }
});

test('9. health endpoint is available for public hosting checks', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(typeof health.data.uptime, 'number');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch (_) {
      /* ignore cleanup errors */
    }
  }
});
