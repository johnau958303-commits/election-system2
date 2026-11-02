'use strict';

const fs = require('node:fs');
const { initDb, getDb, closeDb, now, DB_PATH } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_CANDIDATES = [
  {
    name: 'Alex Chan',
    initials: 'AC',
    tag: 'A stronger, more connected school.',
    bio: 'Alex is a student who helps organise school events and volunteers in peer-support activities.',
    manifesto: [
      'Expand student-led activities and volunteering opportunities.',
      'Represent student feedback at regular council meetings.',
      'Make school activities more accessible to all students.'
    ]
  },
  {
    name: 'Samantha Lee',
    initials: 'SL',
    tag: 'Listening to students. Working for everyone.',
    bio: 'Samantha is a student representative who has helped coordinate class feedback and school activities.',
    manifesto: [
      'Introduce a regular student feedback forum.',
      'Publish clear updates on student council decisions.',
      'Support inclusive activities across all year groups.'
    ]
  },
  {
    name: 'Michael Wong',
    initials: 'MW',
    tag: 'Practical ideas. A better school experience.',
    bio: 'Michael is a student who supports school clubs and helps organise sports and activities.',
    manifesto: [
      'Develop peer mentoring and study-support programmes.',
      'Improve planning and use of school activity resources.',
      'Bring students together through collaborative projects.'
    ]
  },
  {
    name: 'Emily Lam',
    initials: 'EL',
    tag: 'Small ideas. A brighter school.',
    bio: 'Emily helps organise class activities and supports new students as a peer mentor.',
    manifesto: [
      'Make student suggestions easier to share.',
      'Support school clubs and student-led projects.',
      'Help new students feel welcome.'
    ]
  }
];

const EXTRA_CANDIDATES = [
  'Ryan Ho',
  'Chloe Yip',
  'Daniel Ng',
  'Tiffany Lau',
  'Jason Cheung',
  'Michelle Tang',
  'Chris Lo',
  'Natalie Cheng'
].map((name) => ({
  name,
  initials: name
    .split(' ')
    .map((part) => part[0])
    .join(''),
  tag: 'Student candidate',
  bio: '',
  manifesto: []
}));

const RULES = [
  'Each eligible student may cast one vote for one candidate.',
  'Review your selected candidate before confirming your vote.',
  'Voting is available during the stated voting period.',
  'The candidate with the highest number of accepted votes is elected.',
  'A tied result will be identified in the published results.'
];

function hktIso(daysFromNow, hour = 9, minute = 0) {
  const date = new Date(now().getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour - 8, minute, 0, 0);
  return date.toISOString();
}

function seedIfEmpty(db = getDb()) {
  const userCount = Number(db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  const electionCount = Number(db.prepare('SELECT COUNT(*) AS c FROM elections').get().c);
  if (userCount > 0 || electionCount > 0) return false;

  const created = now().toISOString();
  const insertUser = db.prepare(
    `INSERT INTO users
      (username, password_hash, salt, full_name, student_id, email, role, is_eligible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const addUser = (username, password, fullName, studentId, email, role, eligible) => {
    const { salt, hash } = hashPassword(password);
    const info = insertUser.run(
      username,
      hash,
      salt,
      fullName,
      studentId,
      email,
      role,
      eligible ? 1 : 0,
      created
    );
    return Number(info.lastInsertRowid);
  };

  const adminId = addUser(
    'admin',
    'Admin1234!',
    'Election Administrator',
    null,
    'admin@school.example',
    'admin',
    false
  );
  const studentId = addUser(
    'student',
    'Student1234!',
    'Demo Student',
    'S001',
    'student@school.example',
    'student',
    true
  );
  addUser(
    'notonroll',
    'Student1234!',
    'Not On Roll',
    'S999',
    'notonroll@school.example',
    'student',
    false
  );
  const alexUserId = addUser(
    'alex',
    'Student1234!',
    'Alex Chan',
    'S101',
    'alex@school.example',
    'student',
    true
  );

  const insertElection = db.prepare(
    `INSERT INTO elections
      (slug, title, description, seats, method, nomination_open, nomination_close,
       voting_open, voting_close, round2_open, round2_close, results_at, stage,
       entry_mode, candidate_count, round_mode, eligible_group, voting_rules,
       published, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const addElection = (data) => {
    const info = insertElection.run(
      data.slug,
      data.title,
      data.description,
      data.seats ?? 1,
      data.method || 'Single candidate selection',
      data.nomination_open || null,
      data.nomination_close || null,
      data.voting_open || null,
      data.voting_close || null,
      data.round2_open || null,
      data.round2_close || null,
      data.results_at || null,
      data.stage,
      data.entry_mode || 'students',
      data.candidate_count ?? 4,
      data.round_mode || 'single',
      data.eligible_group || 'All registered students',
      (data.voting_rules || RULES).join('\n'),
      data.published ? 1 : 0,
      created
    );
    return Number(info.lastInsertRowid);
  };

  const councilId = addElection({
    slug: 'student-council',
    title: 'Student Council Election 2026',
    description:
      'Elect a student representative to support school activities and student services.',
    nomination_open: hktIso(-20),
    nomination_close: hktIso(-10, 18),
    voting_open: hktIso(-1),
    voting_close: hktIso(6, 18),
    results_at: hktIso(7, 12),
    stage: 'Voting open',
    candidate_count: 4,
    round_mode: 'single',
    eligible_group: 'All registered students'
  });

  const artsId = addElection({
    slug: 'arts',
    title: 'Arts Club Representative Election 2026',
    description:
      'Choose a student representative for the Arts Club. The first round uses a names-only ballot; the top four candidates advance to the second round.',
    nomination_open: hktIso(-25),
    nomination_close: hktIso(-15, 18),
    voting_open: hktIso(-1),
    voting_close: hktIso(2, 18),
    round2_open: hktIso(3),
    round2_close: hktIso(6, 18),
    results_at: hktIso(7, 12),
    stage: 'First round',
    candidate_count: 12,
    round_mode: 'two',
    eligible_group: 'All registered students'
  });

  const houseId = addElection({
    slug: 'neighbourhood',
    title: 'School House Captain Election 2026',
    description:
      'Elect a student to represent the school house leadership team. Candidate nominations are open to students.',
    nomination_open: hktIso(-2),
    nomination_close: hktIso(5, 18),
    voting_open: hktIso(8),
    voting_close: hktIso(14, 18),
    results_at: hktIso(15, 12),
    stage: 'Nominations open',
    candidate_count: 4,
    round_mode: 'single',
    eligible_group: 'School House Captain members'
  });

  const sportsId = addElection({
    slug: 'sports',
    title: 'Sports Committee Election 2026',
    description:
      'Elect a student representative for the Sports Committee. Candidates are entered by the administrator.',
    nomination_open: hktIso(3),
    nomination_close: hktIso(10, 18),
    voting_open: hktIso(12),
    voting_close: hktIso(15, 18),
    results_at: hktIso(16, 12),
    stage: 'Draft',
    entry_mode: 'admin',
    candidate_count: 3,
    round_mode: 'single',
    eligible_group: 'All registered students'
  });

  const activitiesId = addElection({
    slug: 'activities',
    title: 'School Activities Committee Election 2026',
    description:
      'Students elected a representative to support school activities, events and student suggestions.',
    nomination_open: hktIso(-40),
    nomination_close: hktIso(-30, 18),
    voting_open: hktIso(-25),
    voting_close: hktIso(-10, 18),
    results_at: hktIso(-9, 12),
    stage: 'Results published',
    candidate_count: 4,
    round_mode: 'single',
    published: true
  });

  const libraryId = addElection({
    slug: 'library',
    title: 'Library Ambassador Election 2026',
    description:
      'Students elected a representative to support library activities, reading programmes and student suggestions.',
    nomination_open: hktIso(-50),
    nomination_close: hktIso(-40, 18),
    voting_open: hktIso(-35),
    voting_close: hktIso(-20, 18),
    results_at: hktIso(-19, 12),
    stage: 'Results published',
    candidate_count: 4,
    round_mode: 'single',
    published: true
  });

  const insertCandidate = db.prepare(
    `INSERT INTO candidates
      (election_id, user_id, name, initials, tag, bio, manifesto, picture, contacts,
       status, advanced, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const addCandidate = (electionId, candidate, options = {}) => {
    const info = insertCandidate.run(
      electionId,
      options.userId || null,
      candidate.name,
      candidate.initials ||
        candidate.name
          .split(' ')
          .map((part) => part[0])
          .join(''),
      candidate.tag || '',
      candidate.bio || '',
      JSON.stringify(candidate.manifesto || []),
      candidate.picture || null,
      JSON.stringify(candidate.contacts || {}),
      options.status || 'approved',
      options.advanced ? 1 : 0,
      options.submittedAt || created,
      options.updatedAt || created
    );
    return Number(info.lastInsertRowid);
  };

  const councilCandidateIds = DEMO_CANDIDATES.map((candidate, index) =>
    addCandidate(councilId, candidate, {
      userId: index === 0 ? alexUserId : null,
      advanced: true
    })
  );

  const artsCandidates = [...DEMO_CANDIDATES, ...EXTRA_CANDIDATES];
  const artsCandidateIds = artsCandidates.map((candidate, index) =>
    addCandidate(artsId, candidate, {
      userId: index === 0 ? alexUserId : null,
      advanced: index < 4
    })
  );

  const activitiesCandidateIds = DEMO_CANDIDATES.map((candidate) =>
    addCandidate(activitiesId, candidate, { advanced: true })
  );

  const libraryCandidateIds = DEMO_CANDIDATES.map((candidate) =>
    addCandidate(libraryId, candidate, { advanced: true })
  );

  ['Jordan Tsang', 'Jamie Wu', 'Casey Kwok'].forEach((name) =>
    addCandidate(sportsId, {
      name,
      initials: name
        .split(' ')
        .map((part) => part[0])
        .join(''),
      tag: 'Committee candidate',
      bio: '',
      manifesto: []
    })
  );

  const insertResult = db.prepare(
    `INSERT INTO result_entries
      (election_id, round, candidate_id, votes, outcome, eligible_voters, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const activityVotes = [100, 100, 30, 10];
  const activityOutcomes = ['tied', 'tied', 'not_elected', 'not_elected'];
  const activityPublished = hktIso(-9, 12);
  activitiesCandidateIds.forEach((candidateId, index) => {
    insertResult.run(
      activitiesId,
      1,
      candidateId,
      activityVotes[index],
      activityOutcomes[index],
      320,
      activityPublished
    );
  });

  const libraryVotes = [82, 60, 40, 18];
  const libraryPublished = hktIso(-19, 12);
  libraryCandidateIds.forEach((candidateId, index) => {
    insertResult.run(
      libraryId,
      1,
      candidateId,
      libraryVotes[index],
      index === 0 ? 'elected' : 'not_elected',
      260,
      libraryPublished
    );
  });

  return {
    adminId,
    studentId,
    alexUserId,
    elections: {
      councilId,
      artsId,
      houseId,
      activitiesId,
      libraryId
    },
    councilCandidateIds,
    artsCandidateIds
  };
}

function resetDatabase() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(DB_PATH + suffix, { force: true });
    } catch (_) {
      /* ignore */
    }
  }
  initDb();
  return seedIfEmpty();
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  initDb();
  const seeded = reset ? resetDatabase() : seedIfEmpty();
  if (seeded) {
    console.log('Seeded demo data into', DB_PATH);
    console.log('Accounts: admin / Admin1234!, student / Student1234!, alex / Student1234!, notonroll / Student1234!');
  } else {
    console.log('Database already contains data. Use "npm run reset" to rebuild demo data.');
  }
  closeDb();
}

module.exports = { seedIfEmpty, resetDatabase, DEMO_CANDIDATES, EXTRA_CANDIDATES };
