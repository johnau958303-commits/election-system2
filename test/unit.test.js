'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { toIso } = require('../server/db');
const {
  hashPassword,
  verifyPassword,
  hashEmailCode,
  validatePassword,
  validateUsername,
  validateEmail
} = require('../server/auth');
const {
  parseManifesto,
  parseContacts,
  validatePicture,
  serializeCandidate,
  electionStatus
} = require('../server/helpers');
const {
  normalizeCode,
  generateVoterCode,
  hashVoterCode
} = require('../server/voter-codes');

test('production refuses to start with DEMO_MODE enabled', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./server/app').createApp()"], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      VOTER_CODE_SECRET: 'test-only-secret',
      DB_PATH: path.join(__dirname, 'guard-test.db')
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /DEMO_MODE/);
});

test('parseManifesto normalizes arrays and newline text', () => {
  assert.deepEqual(parseManifesto('One\nTwo\r\n\r\nThree'), ['One', 'Two', 'Three']);
  assert.deepEqual(parseManifesto(['One', '', 'Two']), ['One', 'Two']);
  assert.deepEqual(parseManifesto(null), []);
});

test('parseContacts accepts objects and valid JSON only', () => {
  assert.deepEqual(parseContacts({ instagram: { show: true, value: '@test' } }), {
    instagram: { show: true, value: '@test' }
  });
  assert.deepEqual(parseContacts('{"email":"a@example.com"}'), { email: 'a@example.com' });
  assert.deepEqual(parseContacts('not-json'), {});
  assert.deepEqual(parseContacts(null), {});
});

test('validatePicture accepts safe images and rejects attribute injection', () => {
  const safe = validatePicture('https://example.com/photo.png');
  assert.equal(safe.value, 'https://example.com/photo.png');
  assert.equal(validatePicture('data:image/png;base64,AAAA').value, 'data:image/png;base64,AAAA');
  assert.ok(validatePicture('javascript:alert(1)').error);
  assert.ok(validatePicture('https://example.com/"><img src=x onerror=alert(1)>').error);
  assert.ok(validatePicture('https://user:pass@example.com/photo.png').error);
  assert.ok(validatePicture('data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024)).error);
});

test('verification code hashes are bound to the user and server secret', () => {
  const first = hashEmailCode('123456', 1);
  assert.equal(first, hashEmailCode('123456', 1));
  assert.notEqual(first, hashEmailCode('123456', 2));
  assert.notEqual(first, hashEmailCode('654321', 1));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('serializeCandidate maps database columns to API fields', () => {
  const candidate = serializeCandidate(
    {
      id: 7,
      election_id: 3,
      user_id: 9,
      name: 'Alex Chan',
      initials: 'AC',
      tag: 'Slogan',
      bio: 'Bio',
      manifesto: '["One","Two"]',
      picture: null,
      contacts: '{"instagram":{"show":true,"value":"@alex"}}',
      status: 'approved',
      advanced: 1,
      submitted_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      votes: 12
    },
    { includeVotes: true }
  );

  assert.equal(candidate.electionId, 3);
  assert.deepEqual(candidate.manifesto, ['One', 'Two']);
  assert.equal(candidate.advanced, true);
  assert.equal(candidate.votes, 12);
  assert.equal(candidate.picture, null);
});

test('electionStatus derives lifecycle states from stage and dates', () => {
  const previous = process.env.ELECTION_NOW;
  process.env.ELECTION_NOW = '2026-06-01T12:00:00.000Z';
  try {
    const base = {
      published: 0,
      stage: 'Voting open',
      voting_open: '2026-06-01T00:00:00.000Z',
      voting_close: '2026-06-02T00:00:00.000Z',
      round2_open: null,
      round2_close: null
    };
    assert.equal(electionStatus(base), 'voting_open');
    assert.equal(electionStatus({ ...base, voting_open: '2026-06-03T00:00:00.000Z' }), 'upcoming');
    assert.equal(electionStatus({ ...base, voting_close: '2026-05-31T00:00:00.000Z' }), 'closed');
    assert.equal(electionStatus({ ...base, published: 1 }), 'published');
    assert.equal(
      electionStatus({ ...base, stage: 'Second round', round2_open: base.voting_open, round2_close: base.voting_close }),
      'voting_open'
    );
    assert.equal(electionStatus({ ...base, stage: 'First round' }), 'voting_open');
    assert.equal(
      electionStatus({ ...base, stage: 'First round', voting_open: '2026-06-03T00:00:00.000Z' }),
      'upcoming'
    );
    assert.equal(
      electionStatus({ ...base, stage: 'First round', voting_close: '2026-05-31T00:00:00.000Z' }),
      'closed'
    );
  } finally {
    if (previous === undefined) delete process.env.ELECTION_NOW;
    else process.env.ELECTION_NOW = previous;
  }
});

test('toIso accepts date-only values, full dates and rejects invalid input', () => {
  assert.equal(toIso('2026-06-01'), '2026-05-31T16:00:00.000Z');
  assert.equal(toIso('2026-06-01', { endOfDay: true }), '2026-06-01T15:59:59.000Z');
  assert.equal(toIso('2026-06-01T12:00:00.000Z'), '2026-06-01T12:00:00.000Z');
  assert.equal(toIso(''), null);
  assert.equal(toIso('not-a-date'), null);
});

test('password and username validation enforce documented limits', () => {
  assert.equal(validatePassword('short'), 'Password must be at least 8 characters.');
  assert.equal(validatePassword('x'.repeat(129)), 'Password is too long.');
  assert.equal(validatePassword('Password123!'), null);

  assert.match(validateUsername('ab'), /3-30 characters/);
  assert.match(validateUsername('bad name'), /3-30 characters/);
  assert.equal(validateUsername('student.one'), null);
});

test('password hashes verify only the original password', () => {
  const { salt, hash } = hashPassword('Password123!');
  assert.equal(verifyPassword('Password123!', salt, hash), true);
  assert.equal(verifyPassword('WrongPassword!', salt, hash), false);
});

test('email validation requires a plausible address', () => {
  assert.ok(validateEmail(''));
  assert.ok(validateEmail('not-an-email'));
  assert.ok(validateEmail('a@b'));
  assert.equal(validateEmail('voter@example.com'), null);
});

test('voter codes are normalized, formatted and hashed consistently', () => {
  const code = generateVoterCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeCode(' abcd-ef23 '), 'ABCDEF23');
  assert.equal(hashVoterCode('abcd-ef23'), hashVoterCode('ABCD EF23'));
  assert.notEqual(hashVoterCode('abcd-ef23'), hashVoterCode('abcd-ef24'));
});
