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
process.env.EMAIL_MODE = 'test';
process.env.NODE_ENV = 'test';

const { createApp } = require('../server/app');
const { closeDb, getDb } = require('../server/db');
const { testCodeFor } = require('../server/mailer');

const app = createApp();
let server;
let base;
let adminCookie = '';
let studentCookie = '';
let notOnRollCookie = '';
let voter1Cookie = '';

function cookiesFrom(response) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return raw.map((value) => value.split(';')[0]).join('; ');
}

async function request(urlPath, options = {}) {
  const headers = { ...(options.headers || {}) };
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
  return { status: response.status, data, cookie: cookiesFrom(response), headers: response.headers };
}

function iso(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
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
    voterGroup: 'All registered voters',
    voterMode: 'open',
    entryMode: 'admin',
    candidateCount: 2,
    votingRules: 'One vote per voter.',
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
  const email = `${username}@school.example`;
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username,
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Test ' + username,
      email
    }
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.data));
  assert.equal(registration.data.requiresVerification, true);
  const code = testCodeFor(email, 'email-verification');
  assert.ok(code, 'verification code should be available in test email mode');
  const verification = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { email, code }
  });
  assert.equal(verification.status, 200, JSON.stringify(verification.data));
  return verification.cookie;
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

  studentCookie = await registerAndLogin('student');
  notOnRollCookie = await registerAndLogin('notonroll');
  getDb().prepare("UPDATE users SET is_eligible = 0 WHERE username = 'notonroll'").run();

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
      full_name: 'Duplicate',
      email: 'duplicate@school.example'
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
  assert.equal(found.votingRules[0], 'One vote per voter.');
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
      voterGroup: 'All registered voters',
      voterMode: 'open',
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
    assert.equal(late.data.code, 'NOMINATION_LOCKED');
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

  const blocked = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: notOnRollCookie,
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

test('7. two-round elections advance eight finalists and restrict round voting', async () => {
  const election = await createElection({
    electionTitle: 'Two Round Election',
    stage: 'Nominations open',
    voteOpen: iso(-0.5),
    voteClose: iso(0.5)
  });
  const created = [];
  for (let i = 0; i < 9; i += 1) {
    created.push(await addCandidate(election.slug, `Finalist ${i + 1}`));
  }
  const firstRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'First round' }
  });
  assert.equal(firstRound.status, 200, JSON.stringify(firstRound.data));

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

  const firstStatus = await request(`/api/status?election=${election.slug}`, { cookie: voter1Cookie });
  assert.equal(firstStatus.status, 200);
  assert.equal(firstStatus.data.reason, 'ALREADY_VOTED');

  const advanced = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Second round' }
  });
  assert.equal(advanced.status, 200, JSON.stringify(advanced.data));

  const secondRound = await request(`/api/elections/${election.slug}/candidates?round=2`);
  assert.equal(secondRound.status, 200);
  assert.equal(secondRound.data.candidates.length, 8);

  const secondStatus = await request(`/api/status?election=${election.slug}`, { cookie: voter1Cookie });
  assert.equal(secondStatus.status, 200);
  assert.notEqual(secondStatus.data.reason, 'ALREADY_VOTED');
  assert.equal(secondStatus.data.myVote, null);

  const wrongRound = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: secondRound.data.candidates[0].id, round: 1 }
  });
  assert.equal(wrongRound.status, 403);
  assert.equal(wrongRound.data.code, 'WRONG_ROUND');
});

test('8. multi-seat publishing elects the requested number of candidates', async () => {
  const election = await createElection({ electionTitle: 'Multi Seat Election', seats: 2 });
  const first = await addCandidate(election.slug, 'Seat Candidate One');
  const second = await addCandidate(election.slug, 'Seat Candidate Two');
  const third = await addCandidate(election.slug, 'Seat Candidate Three');
  const thirdVoter = await registerAndLogin('seatvoter');

  const voteOne = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id }
  });
  const secondVoterLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'votertwo', password: 'Password123!' }
  });
  assert.equal(secondVoterLogin.status, 200, JSON.stringify(secondVoterLogin.data));
  const voteTwo = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: secondVoterLogin.cookie,
    body: { candidateId: first.id }
  });
  const voteThree = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: thirdVoter,
    body: { candidateId: second.id }
  });
  assert.equal(voteOne.status, 201, JSON.stringify(voteOne.data));
  assert.equal(voteTwo.status, 201, JSON.stringify(voteTwo.data));
  assert.equal(voteThree.status, 201, JSON.stringify(voteThree.data));

  const closed = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting closed' }
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));

  const published = await request(`/api/admin/elections/${election.slug}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.tie, false);

  const results = await request(`/api/elections/${election.slug}/results`);
  assert.equal(results.status, 200);
  const outcomes = Object.fromEntries(
    results.data.results.entries.map((entry) => [entry.candidateId, entry.outcome])
  );
  assert.equal(outcomes[first.id], 'elected');
  assert.equal(outcomes[second.id], 'elected');
  assert.equal(outcomes[third.id], 'not_elected');
});

test('9. invalid stage transitions are rejected', async () => {
  const election = await createElection({ electionTitle: 'Stage Guard Election', stage: 'Draft' });
  const rejected = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Results published' }
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.code, 'INVALID_STAGE_TRANSITION');
});

test('10. data is stored in SQLite on disk', async () => {
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

test('11. health endpoint is available for public hosting checks', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(typeof health.data.uptime, 'number');
});

test('12. candidate review notes, member IDs, conflicts and administrator restrictions', async () => {
  const election = await createElection({
    electionTitle: 'Review Workflow Election',
    entryMode: 'students',
    stage: 'Nominations open',
    nomOpen: iso(-1),
    nomClose: iso(2),
    voteOpen: iso(3),
    voteClose: iso(4)
  });
  const payload = {
    candidateName: 'Review Candidate',
    candidateMember: 'M100',
    introduction: 'Design philosophy',
    manifesto: 'First point\nSecond point',
    portfolio: 'Portfolio details',
    campaign: 'Review slogan',
    declaration: true
  };

  const adminApply = await request(`/api/elections/${election.slug}/nominations`, {
    method: 'POST',
    cookie: adminCookie,
    body: payload
  });
  assert.equal(adminApply.status, 403);
  assert.equal(adminApply.data.code, 'ADMIN_CANNOT_APPLY');

  const created = await request(`/api/elections/${election.slug}/nominations`, {
    method: 'POST',
    cookie: studentCookie,
    body: payload
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.candidate.memberId, 'M100');
  assert.equal(created.data.candidate.portfolio, 'Portfolio details');

  const otherStudent = await registerAndLogin('duplicatemember');
  const duplicateMember = await request(`/api/elections/${election.slug}/nominations`, {
    method: 'POST',
    cookie: otherStudent,
    body: { ...payload, candidateName: 'Duplicate Candidate' }
  });
  assert.equal(duplicateMember.status, 409);
  assert.equal(duplicateMember.data.code, 'MEMBER_ID_TAKEN');

  const candidateId = created.data.candidate.id;
  const detail = await request('/api/admin/candidates/' + candidateId, { cookie: adminCookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.applicant.username, 'student');

  const returned = await request('/api/admin/candidates/' + candidateId + '/status', {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      status: 'pending',
      note: 'Please add more portfolio detail.',
      expectedUpdatedAt: created.data.candidate.updatedAt
    }
  });
  assert.equal(returned.status, 200, JSON.stringify(returned.data));
  assert.equal(returned.data.candidate.reviewNote, 'Please add more portfolio detail.');

  const stale = await request('/api/admin/candidates/' + candidateId + '/status', {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'rejected', expectedUpdatedAt: created.data.candidate.updatedAt }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'REVIEW_CONFLICT');

  const edited = await request('/api/nominations/' + candidateId, {
    method: 'PUT',
    cookie: studentCookie,
    body: { ...payload, portfolio: 'Expanded portfolio', campaign: 'Updated review slogan' }
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.candidate.reviewNote, null);
  assert.equal(edited.data.candidate.status, 'pending');

  const approved = await request('/api/admin/candidates/' + candidateId + '/status', {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      status: 'approved',
      note: 'Approved after review.',
      expectedUpdatedAt: edited.data.candidate.updatedAt
    }
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.candidate.reviewNote, 'Approved after review.');

  const openVoting = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting open' }
  });
  assert.equal(openVoting.status, 200, JSON.stringify(openVoting.data));

  const adminVote = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: adminCookie,
    body: { candidateId }
  });
  assert.equal(adminVote.status, 403);
  assert.equal(adminVote.data.code, 'ADMIN_CANNOT_VOTE');
});

test('13. stage transitions enforce the approved-candidate round rule', async () => {
  const single = await createElection({
    electionTitle: 'Single Round Rule Election',
    stage: 'Nominations open',
    nomOpen: iso(-1),
    nomClose: iso(2)
  });
  await addCandidate(single.slug, 'Single Candidate');
  const invalidFirstRound = await request(`/api/admin/elections/${single.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'First round' }
  });
  assert.equal(invalidFirstRound.status, 409);
  assert.equal(invalidFirstRound.data.code, 'ROUND_RULE');

  const twoRound = await createElection({
    electionTitle: 'Two Round Rule Election',
    stage: 'Nominations open',
    nomOpen: iso(-1),
    nomClose: iso(2)
  });
  for (let i = 0; i < 9; i += 1) {
    await addCandidate(twoRound.slug, `Rule Candidate ${i + 1}`);
  }
  const invalidSingle = await request(`/api/admin/elections/${twoRound.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting open' }
  });
  assert.equal(invalidSingle.status, 409);
  assert.equal(invalidSingle.data.code, 'ROUND_RULE');
});

test('14. email verification is required before login and duplicate emails are blocked', async () => {
  const email = 'pendingverify@school.example';
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'pendingverify',
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Pending Verify',
      email
    }
  });
  assert.equal(registration.status, 201, JSON.stringify(registration.data));
  assert.equal(registration.data.requiresVerification, true);

  const blockedLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'pendingverify', password: 'Password123!' }
  });
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.data.code, 'EMAIL_NOT_VERIFIED');

  const duplicateEmail = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'pendingverify2',
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Pending Verify Two',
      email: email.toUpperCase()
    }
  });
  assert.equal(duplicateEmail.status, 409);

  const wrongCode = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { email, code: '000000' }
  });
  assert.equal(wrongCode.status, 400);

  const code = testCodeFor(email, 'email-verification');
  const verified = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { email, code }
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.user.emailVerified, true);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'pendingverify', password: 'Password123!' }
  });
  assert.equal(login.status, 200);

  const google = await request('/api/auth/google/start');
  assert.equal(google.status, 503);
  assert.equal(google.data.code, 'GOOGLE_NOT_CONFIGURED');
});

test('15. voter roll codes bind to the matching account and are single-use per round', async () => {
  const election = await createElection({
    electionTitle: 'Voter Roll Election',
    voterMode: 'roll'
  });
  const first = await addCandidate(election.slug, 'Roll Candidate One');
  await addCandidate(election.slug, 'Roll Candidate Two');
  const thirdVoter = await registerAndLogin('rollother');

  const imported = await request(`/api/admin/elections/${election.slug}/voter-roll/import`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      voters: [
        {
          externalId: 'R001',
          fullName: 'Voter One',
          email: 'voterone@school.example'
        },
        {
          externalId: 'R002',
          fullName: 'Voter Two',
          email: 'votertwo@school.example'
        },
        {
          externalId: 'R003',
          fullName: 'Other Voter',
          email: 'rollother@school.example'
        }
      ]
    }
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.election.voterMode, 'roll');
  assert.equal(imported.data.summary.total, 3);
  assert.ok(imported.data.voters.every((voter) => !('codeHash' in voter) && !('code' in voter)));

  const codeOne = testCodeFor('voterone@school.example', 'voter-code');
  const codeTwo = testCodeFor('votertwo@school.example', 'voter-code');
  assert.ok(codeOne);
  assert.ok(codeTwo);

  const missing = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id }
  });
  assert.equal(missing.status, 403);
  assert.equal(missing.data.code, 'VOTER_CODE_REQUIRED');

  const accepted = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id, voterCode: codeOne }
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));

  const boundElsewhere = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: thirdVoter,
    body: { candidateId: first.id, voterCode: codeOne }
  });
  assert.equal(boundElsewhere.status, 403);
  assert.equal(boundElsewhere.data.code, 'VOTER_CODE_BOUND_TO_OTHER_ACCOUNT');

  const secondAccepted = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'votertwo', password: 'Password123!' }
    }).then((response) => response.cookie),
    body: { candidateId: first.id, voterCode: codeTwo }
  });
  assert.equal(secondAccepted.status, 201, JSON.stringify(secondAccepted.data));

  const roll = await request(`/api/admin/elections/${election.slug}/voter-roll`, {
    cookie: adminCookie
  });
  assert.equal(roll.status, 200);
  assert.equal(roll.data.summary.bound, 2);
  assert.equal(roll.data.summary.round1Used, 2);

  const rollVoter = roll.data.voters.find((voter) => voter.externalId === 'R001');
  const resend = await request(
    `/api/admin/elections/${election.slug}/voter-roll/${rollVoter.id}/resend`,
    { method: 'POST', cookie: adminCookie }
  );
  assert.equal(resend.status, 200, JSON.stringify(resend.data));
  const rotatedCode = testCodeFor('voterone@school.example', 'voter-code');
  assert.notEqual(rotatedCode, codeOne);

  const duplicate = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id, voterCode: rotatedCode }
  });
  assert.equal(duplicate.status, 409);

  const revoke = await request(
    `/api/admin/elections/${election.slug}/voter-roll/${rollVoter.id}/revoke`,
    { method: 'POST', cookie: adminCookie }
  );
  assert.equal(revoke.status, 200, JSON.stringify(revoke.data));
  assert.ok(revoke.data.voter.revokedAt);
});

test('16. second-round counts include only advanced finalists', async () => {
  const election = await createElection({
    electionTitle: 'Finalist Count Election',
    stage: 'Nominations open',
    roundMode: 'two',
    round2Open: iso(-0.5),
    round2Close: iso(0.5)
  });
  for (let i = 0; i < 9; i += 1) {
    await addCandidate(election.slug, `Count Finalist ${i + 1}`);
  }
  const firstRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'First round' }
  });
  assert.equal(firstRound.status, 200, JSON.stringify(firstRound.data));

  const secondRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Second round' }
  });
  assert.equal(secondRound.status, 200, JSON.stringify(secondRound.data));

  const count = await request(`/api/admin/elections/${election.slug}/count?round=2`, {
    cookie: adminCookie
  });
  assert.equal(count.status, 200);
  assert.equal(count.data.round, 2);
  assert.equal(count.data.count.candidates.length, 8);
});

test('17. zero-vote candidates are not elected when seats exceed votes', async () => {
  const election = await createElection({
    electionTitle: 'Zero Vote Election',
    seats: 3
  });
  const first = await addCandidate(election.slug, 'Only Voted Candidate');
  await addCandidate(election.slug, 'Zero Vote One');
  await addCandidate(election.slug, 'Zero Vote Two');

  const vote = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: voter1Cookie,
    body: { candidateId: first.id }
  });
  assert.equal(vote.status, 201, JSON.stringify(vote.data));

  const closed = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting closed' }
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));

  const published = await request(`/api/admin/elections/${election.slug}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(published.status, 200, JSON.stringify(published.data));

  const results = await request(`/api/elections/${election.slug}/results`);
  const outcomes = Object.fromEntries(
    results.data.results.entries.map((entry) => [entry.candidateId, entry.outcome])
  );
  assert.equal(outcomes[first.id], 'elected');
  assert.equal(Object.values(outcomes).filter((outcome) => outcome === 'elected').length, 1);
  assert.equal(Object.values(outcomes).filter((outcome) => outcome === 'not_elected').length, 2);
});

test('18. publishing after the first round of a two-round election is rejected', async () => {
  const election = await createElection({
    electionTitle: 'First Round Publish Election',
    stage: 'Nominations open',
    voteOpen: iso(-2),
    voteClose: iso(-1)
  });
  for (let i = 0; i < 9; i += 1) {
    await addCandidate(election.slug, `Early Publish ${i + 1}`);
  }
  const firstRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'First round' }
  });
  assert.equal(firstRound.status, 200, JSON.stringify(firstRound.data));

  const premature = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Results published' }
  });
  assert.equal(premature.status, 409, JSON.stringify(premature.data));
  assert.equal(premature.data.code, 'SECOND_ROUND_REQUIRED');
});

test('19. publishing a two-round election selects the second round everywhere', async () => {
  const election = await createElection({
    electionTitle: 'Second Round Publish Election',
    stage: 'Nominations open',
    roundMode: 'two',
    round2Open: iso(-0.5),
    round2Close: iso(0.5)
  });
  const candidates = [];
  for (let i = 0; i < 9; i += 1) {
    candidates.push(await addCandidate(election.slug, `Publish Finalist ${i + 1}`));
  }
  const firstRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'First round' }
  });
  assert.equal(firstRound.status, 200, JSON.stringify(firstRound.data));
  const secondRound = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Second round' }
  });
  assert.equal(secondRound.status, 200, JSON.stringify(secondRound.data));

  const roundTwo = await request(`/api/elections/${election.slug}/candidates?round=2`);
  const vote = await request(`/api/elections/${election.slug}/votes`, {
    method: 'POST',
    cookie: (await request('/api/auth/login', {
      method: 'POST',
      body: { username: 'votertwo', password: 'Password123!' }
    })).cookie,
    body: { candidateId: roundTwo.data.candidates[0].id, round: 2 }
  });
  assert.equal(vote.status, 201, JSON.stringify(vote.data));

  const closed = await request(`/api/admin/elections/${election.slug}/stage`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { stage: 'Voting closed' }
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  const published = await request(`/api/admin/elections/${election.slug}/publish`, {
    method: 'POST',
    cookie: adminCookie,
    body: {}
  });
  assert.equal(published.status, 200, JSON.stringify(published.data));

  const detail = await request(`/api/elections/${election.slug}`);
  assert.equal(detail.data.round, 2);
  assert.equal(detail.data.election.results.round, 2);
});

test('20. candidate approvals are locked once voting is open', async () => {
  const election = await createElection({ electionTitle: 'Review Lock Election' });
  for (let i = 0; i < 8; i += 1) {
    await addCandidate(election.slug, `Locked Candidate ${i + 1}`);
  }
  const db = getDb();
  const row = db.prepare('SELECT id FROM elections WHERE slug = ?').get(election.slug);
  const info = db
    .prepare(
      `INSERT INTO candidates (election_id, user_id, name, initials, status, advanced, submitted_at, updated_at)
       VALUES (?, NULL, 'Ninth Candidate', 'NC', 'pending', 0, ?, ?)`
    )
    .run(row.id, new Date().toISOString(), new Date().toISOString());
  const approval = await request(`/api/admin/candidates/${Number(info.lastInsertRowid)}/status`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'approved' }
  });
  assert.equal(approval.status, 409, JSON.stringify(approval.data));
  assert.equal(approval.data.code, 'REVIEW_CLOSED');
});

test('21. editing an election cannot bypass stage transitions', async () => {
  const election = await createElection({ electionTitle: 'Stage Bypass Election', stage: 'Draft' });
  const updated = await request(`/api/admin/elections/${election.slug}`, {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      electionTitle: 'Stage Bypass Election Edited',
      seats: 1,
      stage: 'Results published'
    }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.election.stage, 'Draft');
});

test('22. clearing the voter roll returns the election to open voting', async () => {
  const election = await createElection({
    electionTitle: 'Roll Clear Election',
    voterMode: 'roll'
  });
  const imported = await request(`/api/admin/elections/${election.slug}/voter-roll/import`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      voters: [{ externalId: 'C001', fullName: 'Clear Voter', email: 'clearvoter@school.example' }]
    }
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));

  const cleared = await request(`/api/admin/elections/${election.slug}/voter-roll`, {
    method: 'DELETE',
    cookie: adminCookie
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));

  const list = await request('/api/elections');
  const found = list.data.elections.find((item) => item.slug === election.slug);
  assert.equal(found.voterMode, 'open');
});

test('23. a malformed cookie header does not break the session endpoint', async () => {
  const session = await request('/api/auth/session', { cookie: 'session=%E0%A4%A' });
  assert.equal(session.status, 200);
  assert.equal(session.data.user, null);
});

test('24. spoofed forwarded hosts do not pass the origin check', async () => {
  const blocked = await request('/api/auth/login', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'X-Forwarded-Host': base.replace('http://', '') },
    body: { username: 'admin', password: 'Admin1234!' }
  });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'BAD_ORIGIN');
});

test('25. unverified accounts are not counted as eligible voters', async () => {
  const before = await request('/api/admin/overview', { cookie: adminCookie });
  assert.equal(before.status, 200);
  const pending = await request('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'unverifiedcount',
      password: 'Password123!',
      confirm_password: 'Password123!',
      full_name: 'Unverified Count',
      email: 'unverifiedcount@school.example'
    }
  });
  assert.equal(pending.status, 201, JSON.stringify(pending.data));
  const after = await request('/api/admin/overview', { cookie: adminCookie });
  assert.equal(after.status, 200);
  assert.equal(after.data.eligibleVoters, before.data.eligibleVoters);
});

test('26. voter roll imports support swapping email addresses', async () => {
  const election = await createElection({
    electionTitle: 'Email Swap Election',
    voterMode: 'roll'
  });
  const first = await request(`/api/admin/elections/${election.slug}/voter-roll/import`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      voters: [
        { externalId: 'S001', fullName: 'Swap One', email: 'swapone@school.example' },
        { externalId: 'S002', fullName: 'Swap Two', email: 'swaptwo@school.example' }
      ]
    }
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));

  const swapped = await request(`/api/admin/elections/${election.slug}/voter-roll/import`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      voters: [
        { externalId: 'S001', fullName: 'Swap One', email: 'swaptwo@school.example' },
        { externalId: 'S002', fullName: 'Swap Two', email: 'swapone@school.example' }
      ]
    }
  });
  assert.equal(swapped.status, 200, JSON.stringify(swapped.data));
  const emails = Object.fromEntries(
    swapped.data.voters.map((voter) => [voter.externalId, voter.email])
  );
  assert.equal(emails.S001, 'swaptwo@school.example');
  assert.equal(emails.S002, 'swapone@school.example');
});

test('27. health endpoint verifies the database and disables caching', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200, JSON.stringify(health.data));
  assert.equal(health.data.ok, true);
  assert.equal(health.data.database, 'ok');
  assert.match(health.headers.get('cache-control') || '', /no-store/);
});

test('28. API responses send hardening headers', async () => {
  const list = await request('/api/elections');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(list.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(list.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(list.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.match(list.headers.get('cache-control') || '', /no-store/);
});

test('29. candidate picture URLs cannot inject markup', async () => {
  const election = await createElection({ electionTitle: 'Picture Validation Election' });
  const bad = await request(`/api/admin/elections/${election.slug}/candidates`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Injected Candidate',
      picture: 'https://example.com/"><img src=x onerror=alert(1)>'
    }
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));

  const good = await request(`/api/admin/elections/${election.slug}/candidates`, {
    method: 'POST',
    cookie: adminCookie,
    body: { name: 'Safe Candidate', picture: 'https://EXAMPLE.com/photo.png' }
  });
  assert.equal(good.status, 201, JSON.stringify(good.data));
  assert.equal(good.data.candidate.picture, 'https://example.com/photo.png');
});

test('30. audit log is admin-only and records election changes', async () => {
  const election = await createElection({ electionTitle: 'Audit Log Election' });
  const denied = await request(`/api/admin/audit?election=${election.slug}`, {
    cookie: studentCookie
  });
  assert.equal(denied.status, 403);

  const audit = await request(`/api/admin/audit?election=${election.slug}&limit=10`, {
    cookie: adminCookie
  });
  assert.equal(audit.status, 200, JSON.stringify(audit.data));
  const created = audit.data.entries.find((entry) => entry.action === 'election.created');
  assert.ok(created);
  assert.equal(created.actorUsername, 'admin');
  assert.equal(created.electionTitle, election.title);
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
