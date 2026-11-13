'use strict';

const icons = {
  ballot: '<path d="M6 17h20v11H6zM10 13l9-10 7 6-9 10zM11 22h10"/>',
  user: '<circle cx="16" cy="10" r="5"/><path d="M6 28v-3a10 10 0 0 1 20 0v3"/>',
  file: '<path d="M9 4h12l5 5v20H6V4h3M20 4v7h6M11 17h10M11 22h8"/>',
  calendar: '<rect x="5" y="7" width="22" height="22" rx="2"/><path d="M10 3v8M22 3v8M5 15h22M11 20h3M19 20h3M11 25h3"/>',
  info: '<circle cx="16" cy="16" r="12"/><path d="M16 14v9M16 8v2"/>',
  chart: '<path d="M5 4v24h24M11 24V14h4v10M20 24V7h4v17"/>'
};

const icon = (name, size = 32) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.info}</svg>`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HKT_TIMEZONE = 'Asia/Hong_Kong';
const DEFAULT_RULES = [
  'Each eligible voter may cast one vote for one candidate.',
  'Review your selected candidate before confirming your vote.',
  'Voting is available during the stated voting period.',
  'The candidate with the highest number of accepted votes is elected.',
  'A tied result will be identified in the published results.'
];

const state = {
  user: null,
  demoMode: false,
  elections: [],
  election: null,
  electionCandidates: [],
  voteElection: null,
  voteCandidates: [],
  voteContext: 'single',
  voteRound: 1,
  myVotes: [],
  myNomination: null,
  nominationElection: null,
  nominationCanEdit: true,
  nominationCandidate: null,
  nominationPicture: null,
  selectedVote: null,
  lastVote: null,
  lastNomination: null,
  statusData: null,
  resultsList: [],
  resultDetail: null,
  publishedResult: null,
  adminOverview: null,
  adminElection: null,
  adminCandidates: [],
  adminReview: null,
  adminCount: null,
  adminCandidateIndex: 0,
  adminPicture: undefined,
  setupElection: null,
  setupSlug: null,
  registeredUsername: '',
  pendingEmail: '',
  googleEnabled: false,
  emailMode: 'console',
  adminVoterRoll: null
};

let candidates = [];
let upcomingElections = [];
let completedElections = [];
let stage = '';
let published = false;
let accountRole = 'Student';
let signedIn = false;
let selectedCandidate = -1;
let voteContext = 'single';
let lastVoteCandidate = null;
let nomination = {};
let nominationSubmitted = false;
let nominationDraft = false;
let adminDraft = {};
let adminSaved = false;
let renderToken = 0;

const isAdminUser = () => state.user?.role === 'admin';

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);

const link = (route, text, style = '') =>
  `<a href="#${route}"${style ? ` class="${style}"` : ''}>${text}</a>`;
const btn = (route, text, secondary = false) =>
  link(route, text, 'btn' + (secondary ? ' secondary' : ''));
const notice = (title, body) =>
  `<div class="notice">${icon('info', 23)}<p><strong>${title}</strong>${body}</p></div>`;
const badge = (text, color = '') => `<span class="badge ${color}">${escapeHtml(text)}</span>`;
const field = (label, name, type = 'text', value = '', full = false, help = '') =>
  `<div class="field ${full ? 'full' : ''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}">${help ? `<small>${help}</small>` : ''}</div>`;
const area = (label, name, value = '', help = '') =>
  `<div class="field full"><label for="${name}">${label}</label><textarea id="${name}" name="${name}">${escapeHtml(value)}</textarea>${help ? `<small>${help}</small>` : ''}</div>`;
const select = (label, name, opts, value = '') =>
  `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${opts
    .map((x) => `<option${x === value ? ' selected' : ''}>${escapeHtml(x)}</option>`)
    .join('')}</select></div>`;
const heading = (title, desc) =>
  `<div class="page-heading"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(desc)}</p></div>`;
const steps = (active, labels = ['Select candidate', 'Confirm choice', 'Confirmation']) =>
  `<ol class="steps">${labels
    .map((s, i) => `<li class="${i === active ? 'active' : ''}"><b>${i + 1}</b>${s}</li>`)
    .join('')}</ol>`;

const navItems = [
  ['home', 'Home'],
  ['elections', 'Election Information'],
  ['upcoming', 'Upcoming Elections'],
  ['candidates', 'Candidates'],
  ['vote', 'Online Voting'],
  ['results', 'Election Results'],
  ['admin', 'Administration']
];
const routeGroup = (r) =>
  ['profile', 'nomination', 'nomination-success'].includes(r)
    ? 'candidates'
    : ['ballot', 'confirm', 'vote-success', 'status'].includes(r)
      ? 'vote'
      : ['setup', 'manage', 'admin-nominations', 'admin-review', 'counting', 'candidate-entry', 'voter-roll'].includes(r)
        ? 'admin'
        : ['details', 'upcoming-detail'].includes(r)
          ? 'elections'
          : r === 'result-detail'
            ? 'results'
            : r;
const pageTitles = {
  upcoming: 'Upcoming elections',
  'upcoming-detail': 'Upcoming election details',
  'result-detail': 'Election result description',
  'candidate-entry': 'Candidate descriptions',
  home: 'Home',
  login: 'Login',
  register: 'Create an account',
  'register-success': 'Registration confirmation',
  'verify-email': 'Verify your email',
  dashboard: 'My dashboard',
  elections: 'Election information',
  details: 'Election details',
  candidates: 'Candidate profiles',
  profile: 'Candidate profile',
  nomination: 'Candidate nomination',
  'nomination-success': 'Nomination confirmation',
  vote: 'Voting candidates',
  ballot: 'Select your candidate',
  confirm: 'Confirm your vote',
  'vote-success': 'Voting confirmation',
  status: 'Voting status',
  results: 'Election results',
  admin: 'Administration',
  setup: 'Election setup',
  manage: 'Manage election',
  'admin-nominations': 'Review nominations',
  'admin-review': 'Review application',
  counting: 'Vote counting'
};

function shell(route, html) {
  return `<div class="wrap breadcrumbs">${link('home', 'Home')} &nbsp; / &nbsp; ${pageTitles[route]}</div><div class="wrap page-content"><section>${html}</section></div>`;
}

function hktParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HKT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return {
    year: values.year,
    month: Number(values.month),
    day: values.day,
    hour: values.hour === '24' ? '00' : values.hour,
    minute: values.minute
  };
}

function fmtDate(iso) {
  const parts = hktParts(iso);
  if (!parts) return 'Date to be confirmed';
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

function fmtDateTime(iso) {
  const parts = hktParts(iso);
  if (!parts) return 'Date to be confirmed';
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}, ${parts.hour}:${parts.minute} HKT`;
}

function fmtRange(openIso, closeIso) {
  const open = hktParts(openIso);
  const close = hktParts(closeIso);
  if (!open && !close) return 'Dates to be confirmed';
  if (!open) return fmtDate(closeIso);
  if (!close) return fmtDate(openIso);
  if (open.year === close.year && open.month === close.month) {
    return `${open.day}–${close.day} ${MONTHS[close.month - 1]} ${close.year}`;
  }
  return `${open.day} ${MONTHS[open.month - 1]} – ${close.day} ${MONTHS[close.month - 1]} ${close.year}`;
}

function durationDays(openIso, closeIso) {
  if (!openIso || !closeIso) return 'Dates to be confirmed';
  const days = Math.max(1, Math.round((new Date(closeIso) - new Date(openIso)) / 86400000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

function toInputDate(iso) {
  const parts = hktParts(iso);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${parts.day}` : '';
}

function toInputDateTime(iso) {
  const parts = hktParts(iso);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, '0')}-${parts.day}T${parts.hour}:${parts.minute}`
    : '';
}

function offsetDateInput(days) {
  return toInputDate(new Date(Date.now() + days * 86400000).toISOString());
}

function offsetDateTimeInput(days, hour = 9) {
  const date = new Date(Date.now() + days * 86400000);
  date.setUTCHours(hour - 8, 0, 0, 0);
  return toInputDateTime(date.toISOString());
}

const STATUS_META = {
  voting_open: ['Voting open', 'green'],
  nominations_open: ['Nominations open', 'gold'],
  candidate_review: ['Candidate review', 'gold'],
  upcoming: ['Upcoming', ''],
  closed: ['Voting closed', ''],
  published: ['Results published', ''],
  draft: ['Draft', '']
};

function statusBadge(election) {
  const meta = STATUS_META[election.status] || ['Upcoming', ''];
  return badge(meta[0], meta[1]);
}

function electionSlug(q, fallback = 'student-council') {
  return q.get('election') || q.get('id') || fallback;
}

function findElection(slug) {
  return state.elections.find((election) => election.slug === slug) || null;
}

function defaultRulesText() {
  return DEFAULT_RULES.join('\n');
}

function timelineFor(election) {
  const phases = [
    {
      label: 'Nominations open',
      date: election.nominationOpen,
      end: election.nominationClose,
      range: `${hktParts(election.nominationOpen)?.day || '—'} – ${fmtDate(election.nominationClose)}`
    },
    { label: 'Candidate review', date: election.nominationClose, end: election.votingOpen, range: fmtDate(election.nominationClose) },
    {
      label: 'Voting open',
      date: election.votingOpen,
      end: election.votingClose,
      range: `${hktParts(election.votingOpen)?.day || '—'} – ${fmtDate(election.votingClose)}`
    },
    { label: 'Results announced', date: election.resultsAt, end: null, range: fmtDate(election.resultsAt) }
  ];
  const now = Date.now();
  return `<ol class="timeline">${phases
    .map((phase) => {
      const start = phase.date ? new Date(phase.date).getTime() : null;
      const end = phase.end ? new Date(phase.end).getTime() : null;
      let cls = '';
      if (start && now >= start && (!end || now <= end)) cls = 'now';
      else if (end && now > end) cls = 'done';
      return `<li class="${cls}">${phase.label}<small>${phase.range}</small></li>`;
    })
    .join('')}</ol>`;
}

function deriveLists() {
  upcomingElections = state.elections
    .filter((election) =>
      ['nominations_open', 'candidate_review', 'upcoming', 'draft'].includes(election.status)
    )
    .filter((election) => election.status !== 'draft' || state.user?.role === 'admin')
    .map((election) => ({
      id: election.slug,
      slug: election.slug,
      title: election.title,
      start: fmtDateTime(election.votingOpen),
      duration: durationDays(election.votingOpen, election.votingClose),
      apply: election.entryMode === 'students',
      mode:
        election.entryMode === 'students'
          ? 'Student applications'
          : 'Administrator-entered candidates',
      deadline: election.nominationClose ? fmtDateTime(election.nominationClose) : '',
      election
    }));
  completedElections = state.elections
    .filter((election) => election.published)
    .map((election) => ({
      id: election.slug,
      title: election.title,
      close: fmtDateTime(election.votingClose),
      duration: durationDays(election.votingOpen, election.votingClose),
      winner: election.winner || 'Result pending',
      tie: Boolean(election.tie),
      election
    }));
}

function currentElection() {
  return (
    state.elections.find((election) => election.status === 'voting_open') ||
    state.elections.find((election) => election.status === 'nominations_open') ||
    null
  );
}

function electionNames(context) {
  return state.voteCandidates;
}

function votingTitle(context) {
  return state.voteElection ? state.voteElection.title : 'Election';
}

function roundLabel(context) {
  return context === 'first' ? 'First round' : context === 'second' ? 'Second round' : 'Single round';
}

function contextRoute(base, context) {
  return base + (context === 'first' ? '?round=1' : context === 'second' ? '?round=2' : '');
}

function activeRoundForElection(election) {
  if (!election || election.roundMode !== 'two') return 1;
  if (election.stage === 'Second round') return 2;
  if (election.published && Number(election.results?.round) === 2) return 2;
  return 1;
}

function voteRouteForElection(base, election) {
  const params = ['election=' + election.slug];
  if (election.roundMode === 'two') {
    params.push('round=' + activeRoundForElection(election));
  }
  return base + '?' + params.join('&');
}

function voteLink(base, context) {
  const params = [];
  if (state.voteElection) params.push('election=' + state.voteElection.slug);
  if (context === 'first') params.push('round=1');
  else if (context === 'second') params.push('round=2');
  return base + (params.length ? '?' + params.join('&') : '');
}

function profileLink(candidate, context) {
  let route = 'profile?id=' + candidate.id;
  if (state.voteElection) route += '&election=' + state.voteElection.slug;
  if (context === 'second') route += '&round=2';
  return link(route, 'View profile & manifesto →');
}

function roundFromHash(q) {
  const value = q ? q.get('round') : null;
  return value === '1' ? 'first' : value === '2' ? 'second' : 'single';
}

function roundNumber(context) {
  return context === 'first' ? 1 : context === 'second' ? 2 : 1;
}

function voteSlugForContext(context) {
  return context === 'single' ? 'student-council' : 'arts';
}

function roundTabs(context) {
  if (!['student-council', 'arts'].includes(state.voteElection?.slug)) return '';
  const council = findElection('student-council');
  const arts = findElection('arts');
  const singleCount = council ? council.approvedCandidates : 4;
  const firstCount = arts ? arts.approvedCandidates : 12;
  const secondCount = 8;
  return (
    '<div class="round-switch">' +
    link('vote', `${singleCount}-candidate election`, context === 'single' ? 'selected' : '') +
    link('vote?round=1', `First round · ${firstCount} candidates`, context === 'first' ? 'selected' : '') +
    link('vote?round=2', `Second round · ${secondCount} finalists`, context === 'second' ? 'selected' : '') +
    '</div>'
  );
}

function currentRoute() {
  const [raw, query = ''] = (location.hash.slice(1) || 'home').split('?');
  const route = pageTitles[raw] ? raw : 'home';
  return { route, q: new URLSearchParams(query) };
}

async function api(path, options = {}) {
  const config = {
    credentials: 'same-origin',
    headers: {},
    ...options
  };
  if (config.body && typeof config.body !== 'string') {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(path, config);
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    error.data = data;
    throw error;
  }
  return data;
}

function notify(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function selectionKey() {
  return 'emvs.selection';
}

function saveSelection(selection) {
  state.selectedVote = selection;
  try {
    sessionStorage.setItem(selectionKey(), JSON.stringify(selection));
  } catch (_) {
    /* ignore storage errors */
  }
}

function restoreSelection() {
  if (state.selectedVote) return state.selectedVote;
  try {
    const raw = sessionStorage.getItem(selectionKey());
    if (raw) state.selectedVote = JSON.parse(raw);
  } catch (_) {
    state.selectedVote = null;
  }
  return state.selectedVote;
}

function clearSelection() {
  state.selectedVote = null;
  try {
    sessionStorage.removeItem(selectionKey());
  } catch (_) {
    /* ignore storage errors */
  }
}

function accountHtml() {
  if (state.user) {
    return `${link('dashboard', 'My account')}<button class="btn secondary small" data-action="logout">Logout</button>`;
  }
  return `${link('register', 'Create account')}${btn('login', 'Login →')}`;
}

function login() {
  return `<section class="entry-screen"><div class="wrap entry-grid"><div class="entry-intro"><div class="eyebrow">Election services portal</div><h1>Your voice.<br><span>Your school.</span></h1><p>Take part in your school’s elections. Review candidates, find upcoming elections and cast your vote.</p><div class="entry-links">${btn('elections', 'Explore elections →', true)}</div><div class="entry-process"><span>01 / PARTICIPATE</span><span>02 / CHOOSE</span><span>03 / BE COUNTED</span></div></div><form class="entry-login" data-form="login" novalidate><div class="eyebrow">Your election account</div><h2>Login</h2><p class="compact-copy">Enter your account details. Your voter or administrator view opens automatically.</p><div class="formgrid">${field('Account Name', 'username', 'text', '', true)}${field('Password', 'password', 'password', '', true)}</div>${state.googleEnabled ? '<a class="btn secondary entry-admin-demo" href="/api/auth/google/start">Continue with Google</a>' : ''}<div class="formfoot"><button class="btn entry-submit">Login →</button></div>${state.demoMode ? '<button type="button" class="btn secondary entry-admin-demo" data-action="admin-demo">Admin demo</button>' : ''}<p class="entry-register">No account? ${link('register', 'Create an account →')}</p></form></div></section>`;
}

function register() {
  return (
    heading('Create an account', 'Enter your details. We will email you a code to verify your address.') +
    `<form class="panel" data-form="register" novalidate><h2 class="panel-title">Account details</h2><div class="formgrid">${field('Full name', 'fullname')}${field('Email address', 'email', 'email', '', true, 'We will send a 6-digit verification code to this address.')}${field('Account Name', 'newusername')}${field('Password', 'newpassword', 'password')}${field('Confirm password', 'repeatpassword', 'password')}</div><div class="formfoot"><button class="btn">Create account →</button> ${btn('login', 'Back to login', true)}</div></form>`
  );
}

function verifyEmailPage() {
  return (
    heading('Verify your email', 'Enter the 6-digit code we sent to your email address.') +
    `<form class="panel" data-form="verify-email" novalidate><h2 class="panel-title">Email verification</h2><div class="formgrid">${field('Email address', 'email', 'email', state.pendingEmail || '', true)}${field('6-digit code', 'code', 'text', '', true, 'The code expires after 15 minutes.')}</div><div class="formfoot"><button class="btn">Verify and continue</button><button class="btn secondary" type="button" data-action="resend-verification">Resend code</button></div><p class="compact-copy">Already verified? ${link('login', 'Return to login')}</p></form>`
  );
}

function success(type) {
  let content;
  let receipt = '';
  if (type === 'register') {
    content = [
      'Check your email',
      'Enter the verification code before logging in for the first time.',
      'verify-email',
      'Verify email'
    ];
  } else if (type === 'nomination') {
    const candidate = state.lastNomination || state.myNomination;
    const election = state.nominationElection;
    content = [
      'Nomination submitted',
      'Your nomination has been received for administrator review.',
      election ? 'nomination?election=' + election.slug : 'nomination',
      'View my nomination'
    ];
    receipt = `<div class="receipt"><dl class="facts"><div><dt>Election</dt><dd>${escapeHtml(election?.title || 'Election')}</dd></div><div><dt>Reference</dt><dd>NOM-${String(candidate?.id || 0).padStart(6, '0')}</dd></div><div><dt>Status</dt><dd>Pending review</dd></div></dl></div>`;
  } else {
    const vote = state.lastVote;
    content = [
      'Your vote has been submitted',
      'Thank you for taking part in the election.',
      'dashboard',
      'Return to my dashboard'
    ];
    receipt = `<div class="receipt"><dl class="facts"><div><dt>Election</dt><dd>${escapeHtml(vote?.electionTitle || 'Election')} · ${escapeHtml(vote?.roundLabel || 'Single round')}</dd></div><div><dt>Reference</dt><dd>${escapeHtml(vote?.reference || '—')}</dd></div><div><dt>Status</dt><dd>Accepted</dd></div></dl></div>`;
  }
  return (
    heading(
      type === 'vote'
        ? 'Voting confirmation'
        : type === 'nomination'
          ? 'Nomination confirmation'
          : 'Registration confirmation',
      ''
    ) +
    (type === 'vote' ? steps(2) : '') +
    `<div class="panel success"><div class="success-icon">✓</div><h2>${content[0]}</h2><p>${content[1]}</p>${receipt}<p class="compact-copy">Keep this reference for your records.</p><div class="actions" style="justify-content:center">${btn(content[2], content[3])}${type === 'vote' ? btn('elections', 'View elections', true) : ''}</div></div>`
  );
}

function dashboard() {
  const current = currentElection();
  const myNomination = state.myNomination;
  const publishedElections = state.elections.filter((election) => election.published);
  const notices = [];
  if (current) {
    notices.push({
      date: current.votingOpen,
      html: link('vote', `${escapeHtml(current.title)} voting is now open.`)
    });
  }
  const candidateElection = findElection('student-council');
  if (candidateElection) {
    notices.push({
      date: candidateElection.nominationClose,
      html: link('candidates', 'Final candidate profiles are available.')
    });
  }
  if (publishedElections.length) {
    notices.push({
      date: publishedElections[0].resultsAt,
      html: link('results', `${escapeHtml(publishedElections[0].title)} results published.`)
    });
  }

  const currentActions = !current
    ? ''
    : isAdminUser()
      ? `${link('details?election=' + current.slug, 'Election details')}${link('admin', 'Open administration →')}`
      : current.status === 'nominations_open'
        ? btn('nomination?election=' + current.slug, 'Submit a nomination →')
        : btn(voteRouteForElection('vote', current), 'Cast your vote →');
  const currentCard = current
    ? `${statusBadge(current)}<h3>${escapeHtml(current.title)}</h3><p class="compact-copy">${escapeHtml(current.description)}</p><dl class="box-facts"><div><dt>${current.status === 'nominations_open' ? 'Nomination period' : 'Voting period'}</dt><dd>${fmtRange(current.nominationOpen, current.nominationClose)}</dd></div><div><dt>${current.status === 'nominations_open' ? 'Nominations close' : 'Voting closes'}</dt><dd>${fmtDateTime(current.status === 'nominations_open' ? current.nominationClose : current.votingClose)}</dd></div><div><dt>Candidates</dt><dd>${current.approvedCandidates} candidates · ${current.seats} seat${current.seats === 1 ? '' : 's'}</dd></div></dl><div class="actions">${currentActions}${isAdminUser() ? '' : link('details?election=' + current.slug, 'Election details') + link('vote?round=1', 'Two-round election →')}</div>`
    : `${badge('No election open')}<h3>No election is currently open</h3><p class="compact-copy">Check the upcoming elections list for the next voting period.</p><div class="actions">${btn('upcoming', 'View upcoming elections →', true)}</div>`;

  const upcomingHtml = upcomingElections.length
    ? upcomingElections
        .slice(0, 3)
        .map(
          (e) =>
            '<div class="dashboard-row"><h3>' +
            escapeHtml(e.title) +
            '</h3><p>' +
            escapeHtml(e.start) +
            ' · ' +
            escapeHtml(e.duration) +
            '</p>' +
            badge(e.apply ? 'Students may apply' : 'Administrator entries', e.apply ? 'green' : '') +
            '</div>'
        )
        .join('')
    : '<div class="dashboard-row"><p>No upcoming elections at present.</p></div>';

  const completedHtml = completedElections.length
    ? completedElections
        .slice(0, 3)
        .map(
          (e) =>
            '<div class="dashboard-row"><h3>' +
            escapeHtml(e.title) +
            '</h3><p>' +
            escapeHtml(e.close) +
            '</p><strong>' +
            escapeHtml(e.winner) +
            '</strong>' +
            (e.tie ? '<br>' + badge('Tied result', 'red') : '') +
            '</div>'
        )
        .join('')
    : '<div class="dashboard-row"><p>No published results yet.</p></div>';

  const nominationStatus = myNomination
    ? myNomination.status === 'pending'
      ? 'Your nomination is pending review.'
      : myNomination.status === 'approved'
        ? 'Your nomination has been approved.'
        : 'Your nomination was not approved.'
    : 'Prepare a nomination for the upcoming election.';
  const nominationBox = isAdminUser()
    ? `<section class="dashboard-box"><div class="box-title">${icon('file', 23)}<h2>Nomination review</h2></div><div class="box-body"><div class="dashboard-row"><div><h3>Administrator access</h3><p>Administrator accounts cannot apply as candidates. Review student applications instead.</p></div>${btn('admin-nominations', 'Review nominations →', true)}</div></div></section>`
    : `<section class="dashboard-box"><div class="box-title">${icon('user', 23)}<h2>Become a candidate</h2></div><div class="box-body"><div class="dashboard-row"><div><h3>Join the election</h3><p>Create your candidate introduction, add a picture and share your plans.</p></div>${btn('nomination', 'Become a candidate →', true)}</div><div class="dashboard-row"><div><h3>My nomination</h3><p>${nominationStatus}</p></div>${link('nomination', myNomination ? 'Edit introduction →' : 'Create introduction →')}</div></div></section>`;

  return `<section class="dashboard-screen"><div class="wrap"><div class="dashboard-heading"><div><div class="eyebrow">Your election services</div><h1>My dashboard</h1><p class="muted">Follow your elections and access all services in one place.</p></div>${badge((state.user?.role === 'admin' ? 'Administrator' : 'Student') + ' account', 'green')}</div><div class="dashboard-grid"><section class="dashboard-box"><div class="box-title">${icon('ballot', 23)}<h2>Current elections</h2></div><div class="box-body">${currentCard}</div></section><section class="dashboard-box"><div class="box-title">${icon('calendar', 23)}<h2>Upcoming elections</h2></div><div class="box-body">${upcomingHtml}<div class="actions">${btn('upcoming', 'View upcoming elections →', true)}</div></div></section><section class="dashboard-box"><div class="box-title">${icon('chart', 23)}<h2>Completed election results</h2></div><div class="box-body">${completedHtml}<div class="actions">${btn('results', 'View results list →', true)}</div></div></section>${nominationBox}<section class="dashboard-box"><div class="box-title">${icon('info', 23)}<h2>Election notices</h2></div><div class="box-body">${notices
    .slice(0, 3)
    .map(
      (item) =>
        `<div class="dashboard-row"><time>${fmtDate(item.date)}</time><p>${item.html}</p></div>`
    )
    .join('')}</div></section><section class="dashboard-box"><div class="box-title">${icon('file', 23)}<h2>Account & administration</h2></div><div class="box-body"><div class="dashboard-row"><div><h3>Voting status</h3><p>View eligibility and voting confirmation screens.</p></div>${link('status', 'Check status →')}</div><div class="dashboard-row"><div><h3>Election administration</h3><p>Election setup, nomination review and counting.</p></div>${state.user?.role === 'admin' ? link('admin', 'Open administration →') : link('login', 'Administrator login →')}</div></div></section></div></div></section>`;
}

function elections() {
  const list = state.elections.filter(
    (election) => election.status !== 'draft' || state.user?.role === 'admin'
  );
  const articles = list
    .map((election) => {
      const actions = [];
      if (isAdminUser()) {
        actions.push(btn('details?election=' + election.slug, 'Election details →', true));
        actions.push(link('admin?election=' + election.slug, 'Open administration →'));
      } else if (election.status === 'nominations_open') {
        actions.push(btn('nomination?election=' + election.slug, 'Submit a nomination →'));
        actions.push(link('details?election=' + election.slug, 'View dates and rules'));
      } else if (election.status === 'voting_open') {
        actions.push(btn('details?election=' + election.slug, 'Election details →'));
        actions.push(btn(voteRouteForElection('vote', election), 'Cast your vote', true));
      } else if (election.status === 'published') {
        actions.push(btn('results', 'View results →', true));
      } else {
        actions.push(btn('details?election=' + election.slug, 'Election details →'));
      }
      return `<article class="election">${statusBadge(election)}<h3>${escapeHtml(election.title)}</h3><div class="meta"><span>Voting: ${fmtRange(election.votingOpen, election.votingClose)}</span><span>${election.seats} seat${election.seats === 1 ? '' : 's'}</span><span>${election.approvedCandidates} candidate${election.approvedCandidates === 1 ? '' : 's'}</span></div><p>${escapeHtml(election.description)}</p><div class="actions">${actions.join('')}</div></article>`;
    })
    .join('');
  return (
    '<div class="actions election-list-links">' +
    btn('upcoming', 'Upcoming elections list', true) +
    btn('vote?round=1', 'Two-round election', true) +
    '</div>' +
    heading(
      'Election information',
      'Browse current and completed elections, rules and important dates.'
    ) +
    (articles || '<div class="panel"><p>No elections are available.</p></div>')
  );
}

function details(neighbourhood) {
  const election = state.election;
  if (!election) {
    return heading('Election details', 'Election information is unavailable.') + notice('Election not found', 'Return to the election information page to choose another election.');
  }
  const rules = election.votingRules.length
    ? election.votingRules
    : DEFAULT_RULES;
  const actions = [];
  if (isAdminUser()) {
    actions.push(link('admin?election=' + election.slug, 'Open administration →'));
    actions.push(btn('elections', 'Back to elections', true));
  } else if (election.status === 'nominations_open') {
    actions.push(btn('nomination?election=' + election.slug, 'Prepare a nomination →'));
    actions.push(btn('elections', 'Back to elections', true));
  } else if (election.status === 'published') {
    actions.push(btn('results', 'View published results →'));
    actions.push(btn('elections', 'Back to elections', true));
  } else if (election.status === 'voting_open') {
    actions.push(btn(voteRouteForElection('vote', election), 'Cast your vote →'));
    actions.push(btn('candidates', 'View candidates', true));
  } else {
    actions.push(btn('nomination?election=' + election.slug, 'Prepare a nomination →'));
    actions.push(btn('upcoming', 'Back to upcoming elections', true));
  }
  return (
    heading(election.title, 'Election overview, timetable and voting rules.') +
    statusBadge(election) +
    timelineFor(election) +
    `<div class="panel"><h2 class="panel-title">Election particulars</h2><dl class="facts"><div><dt>Election title</dt><dd>${escapeHtml(election.title)}</dd></div><div><dt>Number of seats</dt><dd>${election.seats} representative${election.seats === 1 ? '' : 's'}</dd></div><div><dt>Nomination period</dt><dd>${fmtRange(election.nominationOpen, election.nominationClose)}</dd></div><div><dt>Voting period</dt><dd>${fmtDateTime(election.votingOpen)} – ${fmtDateTime(election.votingClose)}</dd></div><div><dt>Eligible voters</dt><dd>${escapeHtml(election.eligibleGroup)}</dd></div><div><dt>Results announcement</dt><dd>${fmtDateTime(election.resultsAt)}</dd></div></dl></div><div class="panel"><h2 class="panel-title">Voting rules</h2><ol class="rules">${rules
      .map((rule) => `<li>${escapeHtml(rule)}</li>`)
      .join('')}</ol></div><div class="actions">${actions.join('')}</div>`
  );
}

function candidateList() {
  const election = findElection('student-council') || state.election;
  const list = state.candidates;
  const cards = list.length
    ? list
        .map(
          (c, i) =>
            `<article class="candidate-card"><span class="number">No. 0${i + 1}</span>${c.picture ? `<img class="candidate-portrait" src="${escapeHtml(c.picture)}" alt="${escapeHtml(c.name)}">` : `<div class="avatar">${escapeHtml(c.initials)}</div>`}<h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.tag)}</p>${link('profile?id=' + c.id, 'View profile & manifesto →')}</article>`
        )
        .join('')
    : '<div class="panel"><p>No approved candidates are available yet.</p></div>';
  return (
    heading(
      'Candidate profiles',
      (election?.title || 'Election') + ' · Get to know the nominated candidates.'
    ) +
    `<div class="meta"><span>${list.length} valid nomination${list.length === 1 ? '' : 's'}</span><span>Voting: ${fmtRange(election?.votingOpen, election?.votingClose)}</span></div><div class="candidate-grid">${cards}</div><div class="actions">${isAdminUser() ? link('admin', 'Open administration →') : btn('vote', 'Proceed to voting →') + btn('nomination', 'Candidate nomination', true)}</div>`
  );
}

function profile(id) {
  const candidate = state.candidates.find((item) => item.id === id) || state.candidates[0];
  if (!candidate) {
    return heading('Candidate profile', 'Candidate information is unavailable.');
  }
  const context = state.voteContext;
  const index = Math.max(0, state.candidates.findIndex((item) => item.id === candidate.id));
  const manifesto = candidate.manifesto.length ? candidate.manifesto : ['Manifesto to be confirmed.'];
  return (
    heading('Candidate profile', votingTitle(context)) +
    `<div class="panel"><div class="profile-head">${candidate.picture ? `<img class="intro-picture" src="${escapeHtml(candidate.picture)}" alt="${escapeHtml(candidate.name)}">` : `<div class="avatar">${escapeHtml(candidate.initials)}</div>`}<div><div class="eyebrow" style="margin-bottom:3px">Candidate 0${index + 1}</div><h2>${escapeHtml(candidate.name)}</h2><p>${escapeHtml(candidate.tag)}</p></div></div></div><div class="panel"><h2 class="panel-title">Personal introduction</h2><p class="compact-copy">${escapeHtml(candidate.bio)}</p>${candidate.portfolio ? `<h2 class="panel-title mt">Portfolio</h2><p class="compact-copy">${escapeHtml(candidate.portfolio)}</p>` : ''}<h2 class="panel-title mt">Election manifesto</h2><ol class="rules">${manifesto
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('')}</ol></div><div class="actions">${isAdminUser() ? link('admin-nominations', 'Back to nominations →') + btn('candidates', 'Back to candidates', true) : btn(voteLink('vote', context), 'Back to voting candidates →') + btn('candidates', 'Back to candidates', true)}</div>`
  );
}

function introPreview(d) {
  const picture = d.pictureUrl || state.nominationPicture;
  const platforms = ['Instagram', 'Facebook'].filter((platform) => d['show' + platform]);
  return `<article class="intro-profile"><div class="intro-profile-top"><h2>${escapeHtml(d.candidateName || 'Your name')}</h2>${picture ? `<img class="intro-picture" src="${escapeHtml(picture)}" alt="Candidate profile picture">` : `<div class="intro-picture intro-placeholder">${icon('user', 42)}</div>`}</div><p class="intro-personal"><em>${escapeHtml(d.introduction || 'Your personal introduction will appear here.')}</em></p><div class="intro-statement">${escapeHtml(d.manifesto || 'Your election statement and plans for the school will appear here.')}</div>${d.portfolio ? `<p class="compact-copy"><strong>Portfolio:</strong> ${escapeHtml(d.portfolio)}</p>` : ''}<p class="intro-slogan">${escapeHtml(d.campaign || 'Your campaign slogan')}</p><div class="intro-contacts">${platforms
    .map(
      (platform) =>
        `<p><strong>${platform}</strong><span>${escapeHtml(d[platform.toLowerCase() + 'Contact'] || 'Your contact')}</span></p>`
    )
    .join('')}</div></article>`;
}

function refreshIntroPreview(form) {
  const preview = document.getElementById('candidate-intro-preview');
  if (preview) preview.innerHTML = introPreview(Object.fromEntries(new FormData(form)));
}

function nominationPage() {
  const election = state.nominationElection;
  const candidate = state.nominationCandidate;
  if (isAdminUser()) {
    return (
      heading('Become a candidate', 'Administrator accounts cannot apply as candidates.') +
      notice(
        'Administrator access is read-only here',
        'Use the administration area to review student applications and manage elections.'
      ) +
      `<div class="actions">${btn('admin-nominations', 'Review nominations →')}${btn('dashboard', 'Back to dashboard', true)}</div>`
    );
  }
  if (!election) {
    return heading('Become a candidate', 'Nomination information is unavailable.');
  }
  const isOpen = (() => {
    const status = election.status;
    if (!['nominations_open', 'candidate_review'].includes(status)) return false;
    const close = election.nominationClose ? new Date(election.nominationClose).getTime() : null;
    return !close || Date.now() <= close;
  })();
  const canEdit =
    isOpen && state.nominationCanEdit && (!candidate || candidate.status === 'pending');
  const deadline = election.nominationClose ? fmtDateTime(election.nominationClose) : 'the deadline';
  const contacts = candidate?.contacts || {};
  const instagram = contacts.instagram || {};
  const facebook = contacts.facebook || {};
  const values = {
    candidateName: nomination.candidateName || '',
    candidateMember: nomination.candidateMember || '',
    introduction: nomination.introduction || '',
    manifesto: nomination.manifesto || '',
    portfolio: nomination.portfolio || '',
    campaign: nomination.campaign || '',
    pictureUrl:
      nomination.pictureUrl || (candidate?.picture && /^https?:/i.test(candidate.picture)
        ? candidate.picture
        : ''),
    showInstagram: Boolean(nomination.showInstagram),
    instagramContact: nomination.instagramContact || '',
    showFacebook: Boolean(nomination.showFacebook),
    facebookContact: nomination.facebookContact || '',
    declaration: Boolean(nomination.declaration || candidate)
  };
  const statusNote = candidate
    ? candidate.status === 'approved'
      ? notice(
          'Application approved',
          'Your application has been approved and you appear on the ballot. Your details are now read-only.'
        )
      : candidate.status === 'rejected'
        ? notice(
            'Application rejected',
            (candidate.reviewNote ? escapeHtml(candidate.reviewNote) + ' ' : '') +
              'Contact the election administrator if you need more information.'
          )
        : candidate.reviewNote
          ? notice(
              'Changes requested',
              escapeHtml(candidate.reviewNote) +
                ' Update your application and submit it again for review.'
            )
          : notice(
              'Application under review',
              'Your application has been submitted and is waiting for administrator review.'
            )
    : '';
  const lockedNote = candidate && !canEdit
    ? !isOpen
      ? notice(
          'Nominations closed',
          'The nomination deadline has passed. Your details can no longer be edited.'
        )
      : ''
    : !candidate && !isOpen
      ? notice('Nominations closed', 'The nomination period for this election is not open.')
      : '';
  const formFoot = canEdit
    ? `<div class="formfoot"><label class="check"><input type="checkbox" name="declaration" ${values.declaration ? 'checked' : ''}>I have reviewed my candidate introduction.</label><div class="actions"><button class="btn">${candidate ? 'Update introduction' : 'Submit nomination'} →</button><button class="btn secondary" type="button" data-action="save-nomination">Save draft</button></div></div>`
    : `<div class="formfoot"><p class="compact-copy">Nominations are closed for this election.</p></div>`;
  return (
    heading(
      'Become a candidate',
      election.title + ' · Nominations close on ' + deadline + '.'
    ) +
    statusNote +
    lockedNote +
    `<div class="candidate-intro-layout"><form class="panel" data-form="nomination" novalidate><input type="hidden" name="electionId" value="${election.slug}"><input type="hidden" name="nominationId" value="${candidate?.id || ''}"><h2 class="panel-title">${candidate ? 'Edit your candidate introduction' : 'Create your candidate introduction'}</h2><div class="formgrid">${field('Name', 'candidateName', 'text', values.candidateName)}${field('Member ID', 'candidateMember', 'text', values.candidateMember, true, 'Your unique membership number for this election.')}${field('Photo URL', 'pictureUrl', 'url', values.pictureUrl, true, 'Optional. You can also upload a file below.')}${area('Introduction / design philosophy', 'introduction', values.introduction, 'A short personal introduction, displayed in italic text.')}${area('Election statement', 'manifesto', values.manifesto, 'Describe what you hope to achieve for the school.')}${area('Portfolio', 'portfolio', values.portfolio, 'Summarise relevant experience, activities or work.')}${field('Slogan', 'campaign', 'text', values.campaign, true, 'Your slogan will appear in blue.')}<div class="field full"><label for="candidatePicture">Profile picture or logo</label><input id="candidatePicture" type="file" accept="image/png,image/jpeg,image/webp"><small>Choose your own picture or logo, or provide a photo URL above.</small></div><fieldset class="social-fields field full"><legend>Contacts to show on your profile</legend>${['Instagram', 'Facebook']
      .map((platform) => {
        const key = platform.toLowerCase();
        const contact = key === 'instagram' ? instagram : facebook;
        const show = values['show' + platform];
        return `<div class="social-choice"><label class="check"><input type="checkbox" name="show${platform}" ${show ? 'checked' : ''}>${platform}</label><label class="sr-only" for="${key}Contact">${platform} contact</label><input id="${key}Contact" name="${key}Contact" type="text" placeholder="Username or profile link" value="${escapeHtml(values[key + 'Contact'] || contact.value || '')}"></div>`;
      })
      .join('')}</fieldset></div>${formFoot}</form><aside class="candidate-preview-panel"><div class="eyebrow">Profile preview</div><div id="candidate-intro-preview">${introPreview(values)}</div></aside></div>`
  );
}

function candidatePortrait(c, i) {
  const backgrounds = ['#e5eef8', '#e8edf6', '#e4eff0'];
  const shirts = ['#365e8c', '#49668b', '#466c78'];
  return `<svg class="candidate-portrait" viewBox="0 0 240 220" role="img" aria-label="Illustrated profile image of ${escapeHtml(c.name)}"><rect width="240" height="220" fill="${backgrounds[i % backgrounds.length]}"/><circle cx="120" cy="85" r="60" fill="white" opacity=".45"/><path d="M38 220v-12c0-49 36-77 82-77s82 28 82 77v12" fill="${shirts[i % shirts.length]}"/><path d="M101 120h38v31l-19 20-19-20z" fill="#dfbda5"/><ellipse cx="120" cy="84" rx="38" ry="47" fill="#eacbb5"/>${i % 2 === 1 ? '<path d="M77 117V79c0-37 19-55 43-55 33 0 47 27 43 57l-8 57-12-16 3-53c-19-2-28-12-33-19-6 17-16 26-26 30v47z" fill="#374352"/>' : '<path d="M81 81c-6-35 14-57 43-57 32 0 46 28 35 61l-8-23c-28 6-45-6-45-6L89 86z" fill="#374352"/>'}<path d="M99 80h6m30 0h6" stroke="#51545b" stroke-width="3" stroke-linecap="round"/><path d="M111 106q9 6 18 0" fill="none" stroke="#a57865" stroke-width="2" stroke-linecap="round"/><path d="M101 146l19 25-15 16-18-37M139 146l-19 25 15 16 18-37" fill="#fafcfe"/></svg>`;
}

function voting() {
  const context = state.voteContext;
  const list = state.voteCandidates;
  const election = state.voteElection;
  if (isAdminUser()) {
    return (
      heading('Voting candidates', 'Administrator accounts cannot cast votes.') +
      notice(
        'Administrator access is read-only here',
        'You can review candidate profiles and monitor the election from the administration area.'
      ) +
      `<div class="actions">${btn('candidates', 'View candidates', true)}${btn('admin', 'Administration →')}</div>`
    );
  }
  if (!election) {
    return heading('Voting candidates', 'Voting information is unavailable.');
  }
  const myVote = state.myVotes.find(
    (vote) => vote.electionSlug === election.slug && vote.round === roundNumber(context)
  );
  const roundNotice =
    context === 'first'
      ? notice(
          `First round · ${list.length} candidates`,
          'Choose one candidate from the names-only ballot. The top eight advance to the second round.'
        )
      : '';
  const codeNotice =
    election.voterMode === 'roll'
      ? notice(
          'One-time voting code required',
          'Use the code emailed to the address on the voter roll. Log in with that same email address. The code can be used once per round.'
        )
      : '';
  const listHtml =
    context === 'first'
      ? '<div class="round-name-overview">' +
        list
          .map(
            (c, i) =>
              '<div><span>' +
              String(i + 1).padStart(2, '0') +
              '</span>' +
              escapeHtml(c.name) +
              '</div>'
          )
          .join('') +
        '</div>'
      : list.length
        ? '<div class="vote-profile-grid">' +
          list
            .map(
              (c, i) =>
                '<article class="vote-profile-card">' +
                (c.picture
                  ? '<img class="candidate-portrait" src="' + c.picture + '" alt="' + escapeHtml(c.name) + '">'
                  : candidatePortrait(c, i)) +
                '<div class="vote-profile-description"><span class="eyebrow">Candidate ' +
                String(i + 1).padStart(2, '0') +
                '</span><h2>' +
                escapeHtml(c.name) +
                '</h2><p>' +
                escapeHtml(c.tag) +
                '</p><p class="candidate-bio">' +
                escapeHtml(c.bio) +
                '</p>' +
                profileLink(c, context) +
                '</div></article>'
            )
            .join('') +
          '</div>'
        : notice('Finalists not confirmed', 'The second-round finalists have not been confirmed yet.');
  return (
    heading(votingTitle(context), 'Meet the candidates before voting.') +
    roundTabs(context) +
    badge(roundLabel(context), 'red') +
    roundNotice +
    codeNotice +
    `<div class="meta mt"><span>${list.length} candidates · ${election.seats} seat${election.seats === 1 ? '' : 's'}</span></div>` +
    listHtml +
    (myVote
      ? notice('Vote already accepted', `You have already voted in this round. Reference ${escapeHtml(myVote.reference)}.`) + '<div class="actions">' + btn('status', 'View voting status →') + '</div>'
      : `<div class="vote-start"><p>Ready to make your choice?</p>${btn(voteLink('ballot', context), 'Vote now →')}</div>`)
  );
}

function ballotPage() {
  const context = state.voteContext;
  const list = state.voteCandidates;
  const election = state.voteElection;
  if (isAdminUser()) {
    return heading('Vote now', 'Administrator accounts cannot cast votes.');
  }
  const myVote = state.myVotes.find(
    (vote) => vote.electionSlug === election?.slug && vote.round === roundNumber(context)
  );
  if (!election) return heading('Vote now', 'Voting information is unavailable.');
  if (myVote) {
    return (
      heading('Vote now', votingTitle(context) + ' · ' + roundLabel(context)) +
      notice(
        'You have already voted',
        `Your vote was accepted with reference ${escapeHtml(myVote.reference)}. Each voter may vote once per round.`
      ) +
      '<div class="actions">' + btn('status', 'View voting status →') + btn(voteLink('vote', context), 'Back to candidates', true) + '</div>'
    );
  }
  return (
    heading('Vote now', votingTitle(context) + ' · ' + roundLabel(context)) +
    steps(0) +
    `<form data-form="vote" data-round="${roundNumber(context)}" data-election="${election.slug}"><div class="panel simple-ballot"><h2>Select one candidate</h2><p class="compact-copy">Choose a name, then review your choice before submitting.</p><fieldset class="candidate-name-list ${list.length > 4 ? 'many-candidates' : ''}"><legend class="sr-only">Candidates</legend>${list
      .map(
        (c, i) =>
          `<label class="candidate-name-row"><input type="radio" name="candidate" value="${c.id}" required ${state.selectedVote?.candidateId === c.id ? 'checked' : ''}><span><small>${String(i + 1).padStart(2, '0')}</small><strong>${escapeHtml(c.name)}</strong></span></label>`
      )
      .join('')}</fieldset>${election.voterMode === 'roll' ? `<div class="formgrid">${field('One-time voting code', 'voterCode', 'text', state.selectedVote?.voterCode || '', true, 'Enter the code emailed to the address on the voter roll.')}</div>` : ''}<div class="formfoot"><button class="btn">Continue to confirmation →</button> ${btn(voteLink('vote', context), 'Back to candidates', true)}</div></div></form>`
  );
}

function confirm() {
  if (isAdminUser()) {
    return heading('Confirm your vote', 'Administrator accounts cannot cast votes.');
  }
  const selection = state.selectedVote;
  const candidate = state.voteCandidates.find((item) => item.id === selection?.candidateId);
  if (!candidate) return ballotPage();
  const index = Math.max(0, state.voteCandidates.findIndex((item) => item.id === candidate.id));
  return (
    heading('Confirm your vote', votingTitle(state.voteContext) + ' · ' + roundLabel(state.voteContext)) +
    steps(1) +
    notice('Please review your selection', 'Check the candidate below before submitting.') +
    (state.voteElection?.voterMode === 'roll'
      ? `<div class="panel"><h2 class="panel-title">One-time voting code</h2><p class="compact-copy">Code: <b>${escapeHtml(selection?.voterCode || '')}</b></p>${btn(voteLink('ballot', state.voteContext), 'Change code', true)}</div>`
      : '') +
    '<div class="panel"><h2 class="panel-title">Your selected candidate</h2><div class="profile-head"><div class="avatar">' +
    escapeHtml(candidate.initials) +
    '</div><div><span class="eyebrow">Candidate ' +
    String(index + 1).padStart(2, '0') +
    '</span><h2>' +
    escapeHtml(candidate.name) +
    '</h2><p>' +
    escapeHtml(candidate.tag) +
    '</p></div></div><div class="actions"><button class="btn" type="button" data-action="submit-vote">Submit vote →</button>' +
    btn(voteLink('ballot', state.voteContext), 'Change selection', true) +
    '</div></div>'
  );
}

function status() {
  const data = state.statusData;
  if (!data) return heading('Voting status', 'Voting information is unavailable.');
  const election = data.election;
  const blocks = [];
  if (!data.user.isEligible) {
    blocks.push(
      `<div class="status-example error-state">${badge('Not eligible', 'red')}<h3>Voting is unavailable for this account</h3><p>Your account is not eligible to vote in this election. Review the eligibility criteria in the election information.</p>${link('details?election=' + election.slug, 'View eligibility information →')}</div>`
    );
  } else if (data.myVote) {
    blocks.push(
      `<div class="status-example warning-state">${badge('Vote already accepted', 'gold')}<h3>You have already voted in this election</h3><p>Your vote was accepted with reference ${escapeHtml(data.myVote.reference)}. Results will be announced after voting closes.</p>${btn('vote-success', 'View confirmation', true)}</div>`
    );
  } else if (data.reason === 'ELIGIBLE') {
    blocks.push(
      `<div class="status-example success-state">${badge('Eligible to vote', 'green')}<h3>Your ballot is available</h3><p>You are on the voter roll and voting is currently open.${data.requiresVoterCode ? ' Enter the one-time code emailed to this address when you vote.' : ''}</p>${btn(voteRouteForElection('vote', election), 'Proceed to voting →')}</div>`
    );
  } else if (data.reason === 'VOTING_CLOSED') {
    blocks.push(
      `<div class="status-example warning-state">${badge('Voting closed')}<h3>The voting period has ended</h3><p>${escapeHtml(election.title)} closed on ${fmtDateTime(election.votingClose)}. ${election.published ? 'Its published results are available.' : 'Results will be published after the count is confirmed.'}</p>${link(election.published ? 'results' : 'elections', election.published ? 'View results →' : 'View election information →')}</div>`
    );
  } else {
    blocks.push(
      `<div class="status-example">${badge('Voting not yet open')}<h3>Voting opens on ${fmtDate(election.votingOpen)}</h3><p>${escapeHtml(election.title)} is currently in its ${escapeHtml(election.stage.toLowerCase())} stage.</p>${link('details?election=' + election.slug, 'View the election timetable →')}</div>`
    );
  }
  if (!data.myVote && data.user.isEligible) {
    blocks.push(
      `<div class="status-example">${badge('Voting period')}<h3>${escapeHtml(election.title)}</h3><p>Voting is open from ${fmtDateTime(election.votingOpen)} to ${fmtDateTime(election.votingClose)}. Each eligible voter may vote once per round.</p>${link('details?election=' + election.slug, 'View election information →')}</div>`
    );
  }
  if (election.published) {
    blocks.push(
      `<div class="status-example success-state">${badge('Results published', 'green')}<h3>Published results are available</h3><p>The accepted vote count and any tied result are shown in the election results.</p>${link('result-detail?id=' + election.slug, 'View results →')}</div>`
    );
  }
  return (
    heading('Voting status', 'Your eligibility and voting state for this election.') +
    blocks.join('')
  );
}

function resultStats(entries, eligibleVoters) {
  const total = entries.reduce((sum, entry) => sum + entry.votes, 0);
  const turnout = eligibleVoters > 0 ? (total / eligibleVoters) * 100 : 0;
  return { total, eligibleVoters, turnout };
}

function publishedResult(election, results) {
  const entries = results?.entries || [];
  const stats = resultStats(entries, entries[0]?.eligibleVoters || 0);
  const winners = entries.filter((entry) => entry.outcome === 'elected' || entry.outcome === 'tied');
  const tie = results?.tie;
  const maxVotes = entries.length ? Math.max(...entries.map((entry) => entry.votes)) : 0;
  const rows = entries
    .map((entry) => {
      const share = stats.total ? (entry.votes / stats.total) * 100 : 0;
      return `<div class="resultrow"><div class="resulttop"><span><b>${escapeHtml(entry.name)}</b> ${entry.outcome === 'tied' ? badge('Tied lead', 'red') : entry.outcome === 'elected' ? badge('Elected', 'green') : ''}</span><span>${entry.votes} · ${share.toFixed(1)}%</span></div><div class="bar ${entry.votes === maxVotes ? '' : 'silver'}"><span style="width:${share.toFixed(1)}%"></span></div></div>`;
    })
    .join('');
  const table = `<div class="table-scroll mt"><table><thead><tr><th>Candidate</th><th>Accepted votes</th><th>Result</th></tr></thead><tbody>${entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.votes}</td><td>${entry.outcome === 'tied' ? 'Tied leading position' : entry.outcome === 'elected' ? 'Elected' : 'Not elected'}</td></tr>`
    )
    .join('')}</tbody></table></div>`;
  return `<div class="panel"><div class="section-head"><h2>${escapeHtml(election.title)}</h2>${badge(tie ? 'Tied result' : 'Final result', tie ? 'red' : '')}</div><div class="meta"><span>Voting closed: ${fmtDateTime(election.votingClose)}</span><span>Published: ${fmtDate(results?.entries?.[0]?.publishedAt)}</span></div>${tie ? notice('Tied result', `${escapeHtml(winners.map((entry) => entry.name).join(' and '))} received an equal number of votes. The outcome remains tied pending the election organiser’s decision.`) : ''}<div class="stats"><div class="stat"><small>Accepted votes</small><b>${stats.total}</b></div><div class="stat"><small>Eligible voters</small><b>${stats.eligibleVoters}</b></div><div class="stat"><small>Turnout</small><b>${stats.turnout.toFixed(0)}%</b></div></div>${rows}${table}</div>`;
}

function results() {
  if (state.publishedResult) {
    return (
      heading('Election results', 'Published results for completed elections.') +
      publishedResult(state.publishedResult.election, state.publishedResult.results) +
      '<div class="actions">' + btn('results', 'Back to results list', true) + '</div>'
    );
  }
  const rows = state.resultsList
    .map(
      ({ election, results: summary }) =>
        '<tr><td>' +
        escapeHtml(election.title) +
        '</td><td>' +
        fmtDateTime(election.votingClose) +
        '</td><td>' +
        durationDays(election.votingOpen, election.votingClose) +
        '</td><td>' +
        escapeHtml(summary.winner || 'Tied result') +
        (summary.tie ? '<br>' + badge('Tied result', 'red') : '') +
        '</td><td>' +
        link('result-detail?id=' + election.slug, 'Check description →') +
        '</td></tr>'
    )
    .join('');
  return (
    heading('Election results', 'Completed school elections and their published outcomes.') +
    `<div class="panel"><div class="table-scroll"><table class="election-list"><thead><tr><th>Election title</th><th>Closing date & time</th><th>Voting duration</th><th>Winner</th><th>Description</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No results have been published yet.</td></tr>'}</tbody></table></div></div>`
  );
}

function resultDetail() {
  const data = state.resultDetail;
  if (!data) {
    return (
      heading('Election result description', 'Published election result.') +
      notice('Results unavailable', 'This election does not have published results yet.') +
      '<div class="actions">' + btn('results', 'Back to results list', true) + '</div>'
    );
  }
  return (
    heading(data.election.title, 'Published election result.') +
    publishedResult(data.election, data.results) +
    '<div class="actions">' + btn('results', 'Back to results list', true) + '</div>'
  );
}

function admin() {
  const overview = state.adminOverview;
  if (!overview) return heading('Administration', 'Administration information is unavailable.');
  const rows = overview.elections
    .map((election) => {
      const action =
        election.status === 'published'
          ? link('result-detail?id=' + election.slug, 'View results →')
          : link('manage?election=' + election.slug, 'Manage →');
      return `<tr><td>${escapeHtml(election.title)}</td><td>${statusBadge(election)}</td><td>${action}</td></tr>`;
    })
    .join('');
  const pending = overview.pendingNominations || [];
  const pendingRows = pending.length
    ? pending
        .slice(0, 8)
        .map(
          (candidate) =>
            `<tr><td><strong>${escapeHtml(candidate.name)}</strong><br><small>${escapeHtml(candidate.electionTitle || '')}</small></td><td>${escapeHtml(candidate.memberId || '—')}</td><td>${badge('Pending')}</td><td>${link('admin-review?id=' + candidate.id, 'Review →')}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4">No applications are waiting for review.</td></tr>';
  return (
    heading('Administration', 'Create elections, review nominations and manage election stages.') +
    `<div class="section-head"><h2>Election overview</h2>${btn('setup', '+ Create election')}</div><div class="stats"><div class="stat"><small>Open elections</small><b>${overview.stats.openElections}</b><span>Voting in progress</span></div><div class="stat"><small>Candidate nominations</small><b>${overview.stats.nominations}</b><span>${overview.stats.pending} pending review</span></div><div class="stat"><small>Published elections</small><b>${overview.stats.published}</b><span>Results available</span></div></div><div class="panel"><h2 class="panel-title">Manage elections</h2><div class="actions">${btn('candidate-entry', 'Enter candidate descriptions', true)}${btn('setup', 'Candidate entry settings', true)}</div><div class="table-scroll"><table><thead><tr><th>Election</th><th>Stage</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div><div class="panel"><div class="section-head"><h2>Applications to review</h2>${btn('admin-nominations', 'Open review queue →', true)}</div><div class="table-scroll"><table><thead><tr><th>Applicant</th><th>Member ID</th><th>Status</th><th>Action</th></tr></thead><tbody>${pendingRows}</tbody></table></div></div><div class="actions">${btn('admin-nominations', 'Review nominations', true)}${btn('counting', 'Vote counting & publication', true)}</div>`
  );
}

function voterModeFields(d) {
  const mode = d.voterMode || 'open';
  return (
    '<fieldset class="entry-mode field full"><legend>Who can vote?</legend><label class="entry-option"><input type="radio" name="voterMode" value="open" ' +
    (mode === 'open' ? 'checked' : '') +
    '><span><strong>Open voting</strong><small>Any verified voter account may vote once per round.</small></span></label><label class="entry-option"><input type="radio" name="voterMode" value="roll" ' +
    (mode === 'roll' ? 'checked' : '') +
    '><span><strong>Voter roll with one-time codes</strong><small>Only voters on the imported list can vote. Each receives a one-time code by email.</small></span></label></fieldset>'
  );
}

function entryModeFields(d) {
  const mode = d.entryMode || 'students';
  return (
    '<fieldset class="entry-mode field full"><legend>How are candidates added?</legend><label class="entry-option"><input type="radio" name="entryMode" value="admin" ' +
    (mode === 'admin' ? 'checked' : '') +
    '><span><strong>Administrator enters candidates</strong><small>Enter every candidate’s name, picture, introduction and statement.</small></span></label><label class="entry-option"><input type="radio" name="entryMode" value="students" ' +
    (mode === 'students' ? 'checked' : '') +
    '><span><strong>Students apply as candidates</strong><small>Students create their introductions through “Become a candidate”.</small></span></label></fieldset>' +
    '<div class="field full" id="round-setup-summary">' +
    roundSetupSummary() +
    '</div><div class="field full" id="admin-entry-link" ' +
    (mode === 'admin' ? '' : 'hidden') +
    '>' +
    btn(
      'candidate-entry?election=' + (state.setupSlug || 'student-council'),
      'Enter candidate descriptions →',
      true
    ) +
    '</div><div class="field full" id="student-entry-note" ' +
    (mode === 'students' ? '' : 'hidden') +
    '><p class="compact-copy">Student applications will be shown as available in the upcoming election list.</p></div>'
  );
}

function roundSetupSummary() {
  return (
    '<div class="notice"><p><strong>Rounds are decided by approved candidates</strong>' +
    'More than eight approved candidates: first round, then the top eight in a second round. ' +
    'Eight or fewer: one voting round. The round is locked when voting starts.</p></div>'
  );
}

function setup() {
  const election = state.setupElection;
  const d = election
    ? {
        electionTitle: election.title,
        description: election.description,
        seats: String(election.seats),
        method: election.method,
        nomOpen: toInputDate(election.nominationOpen),
        nomClose: toInputDate(election.nominationClose),
        voteOpen: toInputDateTime(election.votingOpen),
        voteClose: toInputDateTime(election.votingClose),
        round2Open: toInputDateTime(election.round2Open),
        round2Close: toInputDateTime(election.round2Close),
        publishAt: toInputDateTime(election.resultsAt),
        voterGroup: election.eligibleGroup,
        voterMode: election.voterMode || 'open',
        entryMode: election.entryMode,
        stage: election.stage,
        votingRules: election.votingRules.join('\n')
      }
    : {
        electionTitle: '',
        description: '',
        seats: '1',
        method: 'Single candidate selection',
        nomOpen: offsetDateInput(0),
        nomClose: offsetDateInput(7),
        voteOpen: offsetDateTimeInput(8),
        voteClose: offsetDateTimeInput(14, 18),
        round2Open: offsetDateTimeInput(15),
        round2Close: offsetDateTimeInput(18, 18),
        publishAt: offsetDateTimeInput(19, 12),
        voterGroup: 'All registered voters',
        voterMode: 'open',
        entryMode: 'students',
        stage: 'Nominations open',
        votingRules: defaultRulesText()
      };
  const voterGroups = ['All registered voters', 'Student Council members', 'School House Captain members'];
  if (!voterGroups.includes(d.voterGroup)) voterGroups.push(d.voterGroup);
  return (
    heading(
      election ? 'Edit election setup' : 'Create an election',
      'Define the election information, timetable and rules.'
    ) +
    `<form class="panel" data-form="setup" novalidate data-slug="${election ? election.slug : ''}"><h2 class="panel-title">Election particulars</h2><div class="formgrid">${field('Election title', 'electionTitle', 'text', d.electionTitle, true)}${area('Election description', 'description', d.description)}${field('Number of seats', 'seats', 'number', d.seats)}${select('Election method', 'method', ['Single candidate selection'], d.method)}${field('Nominations open', 'nomOpen', 'date', d.nomOpen)}${field('Nomination deadline', 'nomClose', 'date', d.nomClose)}${field('Voting opens (HKT)', 'voteOpen', 'datetime-local', d.voteOpen)}${field('Voting closes (HKT)', 'voteClose', 'datetime-local', d.voteClose)}${field('Second round opens (HKT)', 'round2Open', 'datetime-local', d.round2Open)}${field('Second round closes (HKT)', 'round2Close', 'datetime-local', d.round2Close)}${field('Results announcement (HKT)', 'publishAt', 'datetime-local', d.publishAt)}${select('Eligible voter group', 'voterGroup', voterGroups, d.voterGroup)}${voterModeFields(d)}${election ? '' : select('Initial stage', 'stage', ['Draft', 'Nominations open'], d.stage)}${entryModeFields(d)}${area('Voting rules', 'votingRules', d.votingRules)}</div><div class="formfoot"><button class="btn">Save election draft →</button> ${btn('admin', 'Cancel', true)}</div></form>`
  );
}

function manage() {
  const election = state.adminElection;
  if (!election) return heading('Manage election', 'Election information is unavailable.');
  const approved = state.adminCandidates.filter((candidate) => candidate.status === 'approved').length;
  const eligible = state.adminCount?.count?.eligibleVoters || 0;
  const stageOptions = [
    'Draft',
    'Nominations open',
    'Candidate review',
    'First round',
    'Second round',
    'Voting open',
    'Voting closed',
    'Results published'
  ];
  return (
    heading('Manage election', election.title) +
    `<div class="tabs">${link('manage?election=' + election.slug, 'Overview', 'selected')}${link('admin-nominations?election=' + election.slug, 'Nominations')}${link('counting?election=' + election.slug, 'Counting & results')}${link('voter-roll?election=' + election.slug, 'Voter roll')}</div><div class="panel"><div class="section-head"><h2>Election stage</h2>${statusBadge(election)}</div>${timelineFor(election)}<form data-form="stage" data-slug="${election.slug}"><div class="formgrid">${select('Preview election stage', 'stage', stageOptions, election.stage)}</div><div class="actions"><button class="btn">Update stage</button></div></form></div><div class="panel"><h2 class="panel-title">Election summary</h2><dl class="facts"><div><dt>Eligible voters</dt><dd>${eligible} ${election.voterMode === 'roll' ? 'on the roll' : 'verified voters'}</dd></div><div><dt>Voter mode</dt><dd>${election.voterMode === 'roll' ? 'Voter roll with one-time codes' : 'Open voting'}</dd></div><div><dt>Approved candidates</dt><dd>${approved} candidate${approved === 1 ? '' : 's'}</dd></div><div><dt>Voting period</dt><dd>${fmtRange(election.votingOpen, election.votingClose)}</dd></div><div><dt>Results announcement</dt><dd>${fmtDateTime(election.resultsAt)}</dd></div></dl><div class="actions">${btn('counting?election=' + election.slug, 'View counting screen →')}${btn('candidate-entry?election=' + election.slug, 'Edit candidate descriptions', true)}${btn('vote?round=1', 'First-round preview', true)}${btn('vote?round=2', 'Second-round preview', true)}${btn('setup?edit=' + election.slug, 'Edit upcoming election', true)}</div></div>`
  );
}

function review() {
  const election = state.adminElection;
  const list = state.adminCandidates;
  const rows = list
    .map(
      (candidate) =>
        `<tr><td><strong>${escapeHtml(candidate.name)}</strong>${!election && candidate.electionTitle ? `<br><small>${escapeHtml(candidate.electionTitle)}</small>` : ''}<br><small>Member ID: ${escapeHtml(candidate.memberId || '—')}</small></td><td>${escapeHtml(candidate.tag || candidate.bio || 'Candidate nomination')}</td><td>${fmtDate(candidate.submittedAt || candidate.updatedAt)}</td><td>${badge(candidate.status === 'approved' ? 'Approved' : candidate.status === 'rejected' ? 'Rejected' : 'Pending review', candidate.status === 'approved' ? 'green' : candidate.status === 'rejected' ? 'red' : 'gold')}</td><td>${link('admin-review?id=' + candidate.id, 'Review →')}</td></tr>`
    )
    .join('');
  const pending = list.filter((candidate) => candidate.status === 'pending');
  const pendingHtml = pending.length
    ? `<div class="panel"><div class="section-head"><h2>Nominations awaiting review</h2>${badge(pending.length + ' pending', 'gold')}</div>${pending
        .map(
          (candidate) =>
            `<div class="dashboard-row"><h3>${escapeHtml(candidate.name)}</h3><p>${escapeHtml(candidate.tag || candidate.bio || 'Candidate nomination')}</p><div class="actions"><button class="btn secondary small" type="button" data-action="nomination-status" data-id="${candidate.id}" data-status="approved">Approve</button><button class="btn secondary small" type="button" data-action="nomination-status" data-id="${candidate.id}" data-status="rejected">Reject</button>${link('admin-review?id=' + candidate.id, 'Open review form →')}</div></div>`
        )
        .join('')}</div>`
    : '';
  const tabs = election
    ? `<div class="tabs">${link('manage?election=' + election.slug, 'Overview')}${link('admin-nominations?election=' + election.slug, 'Nominations', 'selected')}${link('counting?election=' + election.slug, 'Counting & results')}${link('voter-roll?election=' + election.slug, 'Voter roll')}</div>`
    : '';
  return (
    heading(
      'Review nominations',
      election ? election.title + ' · Submitted candidate profiles.' : 'All applications waiting for an administrator decision.'
    ) +
    tabs +
    `<div class="panel"><div class="section-head"><h2>Candidate nominations</h2>${badge(list.length + ' nominations')}</div><div class="table-scroll"><table><thead><tr><th>Candidate</th><th>Summary</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No nominations have been submitted.</td></tr>'}</tbody></table></div></div>${pendingHtml}`
  );
}

function adminReview() {
  const data = state.adminReview;
  const candidate = data?.candidate;
  if (!candidate) {
    return heading('Review application', 'This application is unavailable.');
  }
  const election = data.election;
  const applicant = data.applicant;
  const manifesto = candidate.manifesto || [];
  const statusBadgeHtml = badge(
    candidate.status === 'approved' ? 'Approved' : candidate.status === 'rejected' ? 'Rejected' : 'Pending review',
    candidate.status === 'approved' ? 'green' : candidate.status === 'rejected' ? 'red' : 'gold'
  );
  const contacts = candidate.contacts || {};
  const contactRows = Object.entries(contacts)
    .filter(([, value]) => value && value.value)
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value.value)}</dd></div>`)
    .join('');
  return (
    heading('Review application', election.title + ' · ' + candidate.name) +
    `<div class="tabs">${link('manage?election=' + election.slug, 'Overview')}${link('admin-nominations?election=' + election.slug, 'Nominations', 'selected')}${link('counting?election=' + election.slug, 'Counting & results')}${link('voter-roll?election=' + election.slug, 'Voter roll')}</div>` +
    `<div class="candidate-intro-layout"><div class="panel"><div class="profile-head">${candidate.picture ? `<img class="intro-picture" src="${escapeHtml(candidate.picture)}" alt="${escapeHtml(candidate.name)}">` : `<div class="avatar">${escapeHtml(candidate.initials)}</div>`}<div><span class="eyebrow">Application ${candidate.id}</span><h2>${escapeHtml(candidate.name)}</h2><p>${escapeHtml(candidate.tag || '')}</p>${statusBadgeHtml}</div></div><dl class="facts mt"><div><dt>Member ID</dt><dd>${escapeHtml(candidate.memberId || '—')}</dd></div><div><dt>Submitted</dt><dd>${fmtDateTime(candidate.submittedAt || candidate.updatedAt)}</dd></div><div><dt>Applicant account</dt><dd>${escapeHtml(applicant?.username || applicant?.fullName || 'Administrator entry')}</dd></div><div><dt>Applicant email</dt><dd>${escapeHtml(applicant?.email || '—')}</dd></div></dl><h2 class="panel-title mt">Introduction / design philosophy</h2><p class="compact-copy">${escapeHtml(candidate.bio || 'Not provided.')}</p><h2 class="panel-title mt">Portfolio</h2><p class="compact-copy">${escapeHtml(candidate.portfolio || 'Not provided.')}</p><h2 class="panel-title mt">Election statement</h2><ol class="rules">${manifesto.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Not provided.</li>'}</ol>${contactRows ? `<h2 class="panel-title mt">Contacts</h2><dl class="facts">${contactRows}</dl>` : ''}</div><aside class="candidate-preview-panel"><div class="eyebrow">Administrator decision</div><form data-form="review" data-id="${candidate.id}" data-updated-at="${escapeHtml(candidate.updatedAt || '')}"><div class="formgrid">${area('Review note', 'reviewNote', candidate.reviewNote || '', 'Stored with the decision and shown to the applicant when changes are requested or the application is rejected.')}</div><div class="actions"><button class="btn" type="button" data-action="nomination-status" data-id="${candidate.id}" data-status="approved">Approve</button><button class="btn secondary" type="button" data-action="nomination-status" data-id="${candidate.id}" data-status="pending">Return for changes</button><button class="btn secondary" type="button" data-action="nomination-status" data-id="${candidate.id}" data-status="rejected">Reject</button></div></form>${notice('Round rule', 'Approved candidates determine the round: more than eight means a first round and a top-eight second round; otherwise one round.')}</aside></div>`
  );
}

function counting() {
  const data = state.adminCount;
  if (!data) return heading('Vote counting & publication', 'Counting information is unavailable.');
  const election = data.election;
  const count = data.count;
  const entries = count.candidates;
  const leader = count.tie
    ? count.tiedLeaders.map((candidate) => candidate.name).join(' & ')
    : count.leader?.name;
  const rows = entries
    .map(
      (candidate) =>
        `<tr><td>${escapeHtml(candidate.name)}</td><td>${candidate.votes}</td><td>${candidate.share.toFixed(1)}%</td></tr>`
    )
    .join('');
  const isPublished = election.published;
  return (
    heading('Vote counting & publication', election.title + ' · Post-voting review.') +
    `<div class="tabs">${link('manage?election=' + election.slug, 'Overview')}${link('admin-nominations?election=' + election.slug, 'Nominations')}${link('counting?election=' + election.slug, 'Counting & results', 'selected')}${link('voter-roll?election=' + election.slug, 'Voter roll')}</div>` +
    notice('Accepted vote count', 'These figures are calculated from the accepted votes stored in the database.') +
    `<div class="stats"><div class="stat"><small>Accepted votes</small><b>${count.totalVotes}</b></div><div class="stat"><small>Eligible voters</small><b>${count.eligibleVoters}</b></div><div class="stat"><small>Turnout</small><b>${count.turnout.toFixed(0)}%</b></div></div><div class="panel"><h2 class="panel-title">Count summary</h2><div class="table-scroll"><table><thead><tr><th>Candidate</th><th>Accepted votes</th><th>Share</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No approved candidates.</td></tr>'}</tbody></table></div><p class="compact-copy mt">${leader ? `Leading candidate: <b>${escapeHtml(leader)}</b> · ${count.candidates[0].votes} accepted votes${count.tie ? ' · ' + badge('Tied result', 'red') : ''}` : 'No votes have been accepted yet.'}</p><div class="formfoot"><p class="compact-copy">Publication status: <b>${isPublished ? 'Published' : 'Awaiting publication'}</b></p><button type="button" class="btn" data-action="publish">${isPublished ? 'View published results' : 'Publish results preview →'}</button></div></div>`
  );
}

function voterRollPage() {
  const data = state.adminVoterRoll;
  if (!data) return heading('Voter roll', 'Voter roll information is unavailable.');
  const election = data.election;
  const summary = data.summary;
  const tabs = `<div class="tabs">${link('manage?election=' + election.slug, 'Overview')}${link('admin-nominations?election=' + election.slug, 'Nominations')}${link('counting?election=' + election.slug, 'Counting & results')}${link('voter-roll?election=' + election.slug, 'Voter roll', 'selected')}</div>`;
  const rows = data.voters
    .map((voter) => {
      const stateBadge = voter.revokedAt
        ? badge('Revoked', 'red')
        : voter.round1UsedAt || voter.round2UsedAt
          ? badge('Used', 'green')
          : voter.boundUserId
            ? badge('Linked', 'green')
            : badge('Unused');
      const usage = [
        voter.round1UsedAt ? 'Round 1' : '',
        voter.round2UsedAt ? 'Round 2' : ''
      ].filter(Boolean).join(', ') || '—';
      return `<tr><td><strong>${escapeHtml(voter.fullName)}</strong><br><small>${escapeHtml(voter.externalId)}</small></td><td>${escapeHtml(voter.email)}</td><td>${stateBadge}<br><small>Email: ${escapeHtml(voter.emailStatus)}</small></td><td>${escapeHtml(usage)}</td><td><button class="btn secondary small" type="button" data-action="resend-voter-code" data-id="${voter.id}" ${voter.revokedAt ? 'disabled' : ''}>Resend</button> <button class="btn secondary small" type="button" data-action="revoke-voter-code" data-id="${voter.id}" ${voter.revokedAt ? 'disabled' : ''}>Revoke</button></td></tr>`;
    })
    .join('');
  return (
    heading('Voter roll', election.title + ' · ' + (election.voterMode === 'roll' ? 'One-time code required' : 'Open voting')) +
    tabs +
    `<div class="stats"><div class="stat"><small>On the roll</small><b>${summary.active}</b><span>${summary.revoked} revoked</span></div><div class="stat"><small>Linked accounts</small><b>${summary.bound}</b><span>${summary.round1Used} used in round 1</span></div><div class="stat"><small>Emails</small><b>${summary.sent}</b><span>${summary.failed} failed · ${summary.pending} pending</span></div></div>` +
    `<div class="panel"><div class="section-head"><h2>Import voter roll</h2>${badge('CSV', 'green')}</div><p class="compact-copy">Upload a CSV with the columns <b>external_id, full_name, email</b>. Importing switches this election to one-time-code mode. Codes are emailed automatically and are never shown here.</p><div class="formgrid"><div class="field full"><label for="voterRollFile">CSV file</label><input id="voterRollFile" type="file" accept=".csv,text/csv"></div></div><div class="actions"><button class="btn" type="button" data-action="import-voter-roll">Import and send codes</button>${summary.total ? '<button class="btn secondary" type="button" data-action="clear-voter-roll">Clear voter roll</button>' : ''}</div></div>` +
    `<div class="panel"><div class="section-head"><h2>Voters</h2>${badge(summary.total + ' entries')}</div><div class="table-scroll"><table><thead><tr><th>Voter</th><th>Email</th><th>Status</th><th>Used in</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No voters have been imported.</td></tr>'}</tbody></table></div></div>`
  );
}

function parseVoterCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(value);
      value = '';
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  if (!rows.length) return [];
  const normalize = (cell) => String(cell || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const headers = rows[0].map(normalize);
  const externalIndex = headers.findIndex((header) => ['external_id', 'externalid', 'id'].includes(header));
  const nameIndex = headers.findIndex((header) => ['full_name', 'fullname', 'name'].includes(header));
  const emailIndex = headers.findIndex((header) => header === 'email');
  const hasHeader = externalIndex !== -1 && nameIndex !== -1 && emailIndex !== -1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const indexes = hasHeader
    ? { externalIndex, nameIndex, emailIndex }
    : { externalIndex: 0, nameIndex: 1, emailIndex: 2 };
  return dataRows
    .map((cells) => ({
      externalId: String(cells[indexes.externalIndex] || '').trim(),
      fullName: String(cells[indexes.nameIndex] || '').trim(),
      email: String(cells[indexes.emailIndex] || '').trim()
    }))
    .filter((voter) => voter.externalId || voter.fullName || voter.email);
}

function upcoming() {
  const rows = upcomingElections
    .map(
      (e) =>
        '<tr><td>' +
        escapeHtml(e.title) +
        '</td><td>' +
        escapeHtml(e.start) +
        '</td><td>' +
        escapeHtml(e.duration) +
        '</td><td>' +
        badge(e.apply ? 'Open to students' : 'Administrator entries', e.apply ? 'green' : '') +
        '</td><td>' +
        link('upcoming-detail?id=' + e.id, 'View details →') +
        '</td></tr>'
    )
    .join('');
  return (
    heading('Upcoming elections', 'Election schedules and student candidate applications.') +
    '<div class="panel"><div class="table-scroll"><table class="election-list"><thead><tr><th>Election title</th><th>Start date & time</th><th>Voting duration</th><th>Student applications</th><th>Action</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5">No upcoming elections are scheduled.</td></tr>') +
    '</tbody></table></div></div>'
  );
}

function upcomingDetail(id) {
  const election = findElection(id) || upcomingElections[0]?.election;
  if (!election) {
    return heading('Upcoming election details', 'Election information is unavailable.');
  }
  const actions = [];
  if (election.status === 'nominations_open' && election.entryMode === 'students') {
    actions.push(btn('nomination?election=' + election.slug, 'Join as a candidate →'));
  } else if (election.entryMode === 'students') {
    actions.push(badge('Student applications'));
  } else {
    actions.push(badge('Administrator enters candidate descriptions'));
  }
  actions.push(btn('upcoming', 'Back to upcoming elections', true));
  const roundsNote =
    election.roundMode === 'two'
      ? notice(
          'Two voting rounds',
          'More than eight candidates take part in the first round. The top eight proceed to the second round.'
        ) +
        '<div class="actions">' +
        btn('vote?round=1', 'View first-round layout', true) +
        btn('vote?round=2', 'View second-round layout', true) +
        '</div>'
      : '';
  return (
    heading(election.title, 'Upcoming election details.') +
    '<div class="panel"><dl class="facts"><div><dt>Voting begins</dt><dd>' +
    fmtDateTime(election.votingOpen) +
    '</dd></div><div><dt>Voting duration</dt><dd>' +
    durationDays(election.votingOpen, election.votingClose) +
    '</dd></div><div><dt>Candidate entry method</dt><dd>' +
    escapeHtml(election.entryMode === 'students' ? 'Student applications' : 'Administrator-entered candidates') +
    '</dd></div><div><dt>Nomination deadline</dt><dd>' +
    (election.nominationClose ? fmtDateTime(election.nominationClose) : 'Candidates entered by the administrator') +
    '</dd></div></dl><div class="actions">' +
    actions.join('') +
    '</div></div>' +
    roundsNote
  );
}

function candidateEntry() {
  const election = state.adminElection;
  const list = state.adminCandidates;
  if (!election || !list.length) {
    return (
      heading('Enter candidate descriptions', 'Administrator candidate entry.') +
      notice('No candidates', 'Add a candidate to begin entering descriptions.') +
      '<div class="actions"><button class="btn" type="button" data-action="add-admin-candidate">+ Add candidate</button></div>'
    );
  }
  const index = Math.min(state.adminCandidateIndex, list.length - 1);
  state.adminCandidateIndex = index;
  const c = list[index];
  return (
    heading('Enter candidate descriptions', 'Administrator candidate entry.') +
    '<div class="candidate-intro-layout"><form class="panel" data-form="admin-candidate" data-id="' +
    c.id +
    '" novalidate><h2 class="panel-title">Candidate details</h2><div class="formgrid">' +
    select('Candidate to edit', 'editCandidate', list.map((item) => item.name), c.name) +
    field('Candidate name', 'adminCandidateName', 'text', c.name) +
    field('Member ID', 'adminMemberId', 'text', c.memberId || '') +
    area('Introduction / design philosophy', 'adminIntroduction', c.bio) +
    area('Portfolio', 'adminPortfolio', c.portfolio || '') +
    area('Election statement', 'adminStatement', c.manifesto.join('\n')) +
    field('Slogan', 'adminSlogan', 'text', c.tag, true) +
    '<div class="field full"><label for="adminPicture">Profile picture or logo</label><input id="adminPicture" type="file" accept="image/png,image/jpeg,image/webp"></div></div><div class="formfoot"><button class="btn">Save candidate description</button> ' +
    btn('setup?edit=' + election.slug, 'Return to election setup', true) +
    '</div></form><aside class="panel"><h2 class="panel-title">Candidates</h2>' +
    list
      .map(
        (item, i) =>
          '<div class="dashboard-row"><b>' +
          String(i + 1).padStart(2, '0') +
          '. ' +
          escapeHtml(item.name) +
          '</b><p>' +
          escapeHtml(item.tag) +
          '</p></div>'
      )
      .join('') +
    '<button type="button" class="btn secondary mt" data-action="add-admin-candidate">+ Add candidate</button></aside></div>'
  );
}

async function loadDashboard() {
  state.myVotes = state.user ? (await api('/api/my-votes')).votes : [];
  const mine = state.user ? await api('/api/nominations/mine') : { candidate: null };
  state.myNomination = mine.candidate;
}

async function loadVoteRoute(context, q) {
  const requestedSlug = q?.get('election');
  const slug = requestedSlug || voteSlugForContext(context);
  let round = roundNumber(context);
  let data = await api(`/api/elections/${slug}/candidates?round=${round}`);
  if (requestedSlug && data.election.roundMode === 'two' && !q.get('round')) {
    const listed = findElection(slug);
    const stageRound = activeRoundForElection({
      ...data.election,
      results: listed?.results || data.election.results
    });
    if (stageRound !== round) {
      round = stageRound;
      data = await api(`/api/elections/${slug}/candidates?round=${round}`);
    }
  }
  state.voteElection = data.election;
  state.voteCandidates = data.candidates;
  state.voteRound = round;
  state.voteContext =
    data.election.roundMode === 'two' ? (round === 2 ? 'second' : 'first') : 'single';
  if (state.user) {
    state.myVotes = (await api('/api/my-votes')).votes;
  }
  return data;
}

async function loadRouteData(route, q) {
  state.elections = (await api('/api/elections')).elections;
  deriveLists();
  switch (route) {
    case 'home':
    case 'dashboard':
      if (state.user) await loadDashboard();
      break;
    case 'details': {
      const slug = q.get('election') || 'student-council';
      const data = await api('/api/elections/' + slug);
      state.election = data.election;
      state.electionCandidates = data.candidates;
      state.candidates = data.candidates;
      break;
    }
    case 'upcoming':
    case 'upcoming-detail':
      break;
    case 'candidates': {
      const data = await api('/api/elections/student-council');
      state.election = data.election;
      state.candidates = data.candidates;
      break;
    }
    case 'profile': {
      const round = q.get('round') === '2' ? 2 : 1;
      const slug = q.get('election') || (round === 2 ? 'arts' : 'student-council');
      const data = await api(`/api/elections/${slug}/candidates?round=${round}`);
      state.election = data.election;
      let list = data.candidates;
      const id = Number(q.get('id'));
      if (!list.some((candidate) => candidate.id === id) && state.user?.role === 'admin') {
        const adminData = await api('/api/admin/candidates/' + id);
        if (adminData?.candidate) {
          const adminElection = await api('/api/admin/elections/' + adminData.election.slug);
          list = adminElection.candidates;
          state.election = adminElection.election;
        }
      }
      state.candidates = list;
      state.voteCandidates = list;
      state.voteElection = state.election;
      state.voteContext =
        data.election.roundMode === 'two' ? (round === 2 ? 'second' : 'first') : 'single';
      break;
    }
    case 'nomination': {
      let slug = q.get('election');
      if (!slug) {
        const open = state.elections.find((election) => election.status === 'nominations_open');
        slug = open ? open.slug : 'neighbourhood';
      }
      const data = await api('/api/elections/' + slug);
      state.nominationElection = data.election;
      state.election = data.election;
      const mine = await api('/api/nominations/mine?election=' + slug);
      state.nominationCandidate = mine.candidate;
      state.nominationCanEdit = mine.canEdit !== false;
      const candidate = mine.candidate;
      state.nominationPicture = candidate?.picture || null;
      const contacts = candidate?.contacts || {};
      state.myNomination = candidate;
      nominationSubmitted = Boolean(candidate);
      nomination = candidate
        ? {
            candidateName: candidate.name,
            candidateMember: candidate.memberId || '',
            introduction: candidate.bio,
            manifesto: candidate.manifesto.join('\n'),
            portfolio: candidate.portfolio || '',
            campaign: candidate.tag,
            showInstagram: Boolean(contacts.instagram?.show),
            instagramContact: contacts.instagram?.value || '',
            showFacebook: Boolean(contacts.facebook?.show),
            facebookContact: contacts.facebook?.value || '',
            declaration: true
          }
        : {};
      break;
    }
    case 'nomination-success': {
      const mine = await api('/api/nominations/mine');
      state.myNomination = mine.candidate;
      state.lastNomination = state.lastNomination || mine.candidate;
      if (mine.election) state.nominationElection = mine.election;
      break;
    }
    case 'vote': {
      const context = roundFromHash(q);
      await loadVoteRoute(context, q);
      break;
    }
    case 'ballot':
    case 'confirm': {
      const context = roundFromHash(q);
      await loadVoteRoute(context, q);
      if (route === 'confirm') {
        const selection = restoreSelection();
        if (
          !selection ||
          selection.electionSlug !== state.voteElection.slug ||
          selection.round !== state.voteRound ||
          (state.voteElection.voterMode === 'roll' && !selection.voterCode)
        ) {
          notify('Choose a candidate and enter your voting code before confirming.');
          location.hash = voteLink('ballot', context);
          return;
        }
      }
      break;
    }
    case 'vote-success': {
      const votes = (await api('/api/my-votes')).votes;
      state.lastVote = votes[0] || null;
      state.myVotes = votes;
      break;
    }
    case 'status': {
      state.statusData = await api('/api/status' + (q.get('election') ? '?election=' + encodeURIComponent(q.get('election')) : ''));
      break;
    }
    case 'results': {
      const data = await api('/api/results');
      state.resultsList = data.results;
      state.publishedResult = null;
      if (q.has('published')) {
        const slug = q.get('published');
        const match = data.results.find(
          (item) => item.election.slug === slug || (slug === '1' && item === data.results[0])
        );
        if (match) state.publishedResult = match;
      }
      break;
    }
    case 'result-detail': {
      const slug = q.get('id') || 'activities';
      try {
        state.resultDetail = await api('/api/elections/' + slug + '/results');
      } catch (error) {
        state.resultDetail = null;
        notify(error.message);
      }
      break;
    }
    case 'admin': {
      state.adminOverview = await api('/api/admin/overview');
      break;
    }
    case 'voter-roll': {
      const slug = q.get('election') || state.adminElection?.slug || 'student-council';
      const data = await api('/api/admin/elections/' + slug + '/voter-roll');
      state.adminVoterRoll = data;
      state.adminElection = data.election;
      break;
    }
    case 'setup': {
      const edit = q.get('edit');
      if (edit) {
        const data = await api('/api/admin/elections/' + edit);
        state.setupElection = data.election;
        state.setupSlug = data.election.slug;
      } else {
        state.setupElection = null;
        state.setupSlug = null;
      }
      break;
    }
    case 'manage':
    case 'admin-nominations':
    case 'admin-review':
    case 'counting':
    case 'candidate-entry': {
      const slug = q.get('election') || 'student-council';
      if (route === 'admin-nominations' && !q.get('election')) {
        const overview = await api('/api/admin/overview');
        state.adminOverview = overview;
        state.adminElection = null;
        state.adminCandidates = overview.pendingNominations || [];
        state.adminCount = null;
      } else if (route === 'admin-review') {
        const data = await api('/api/admin/candidates/' + (q.get('id') || ''));
        state.adminReview = data;
        state.adminElection = data.election;
        state.adminCandidates = [data.candidate];
      } else if (route === 'counting') {
        const data = await api('/api/admin/elections/' + slug + '/count');
        state.adminCount = data;
        state.adminElection = data.election;
      } else {
        const data = await api('/api/admin/elections/' + slug);
        state.adminElection = data.election;
        state.adminCandidates = data.candidates;
        state.adminCount = data.count;
        state.adminCandidateIndex = Math.min(
          state.adminCandidateIndex,
          Math.max(0, data.candidates.length - 1)
        );
      }
      break;
    }
    default:
      break;
  }
}

function paint(route, q) {
  signedIn = Boolean(state.user);
  accountRole = state.user?.role === 'admin' ? 'Administrator' : 'Voter';
  stage = state.adminElection?.stage || currentElection()?.stage || 'Voting open';
  published = state.adminElection?.published || state.elections.some((election) => election.published);
  deriveLists();
  candidates = state.candidates;

  document.getElementById('nav-links').innerHTML = navItems
    .filter(([r]) => r !== 'admin' || state.user?.role === 'admin')
    .map(([r, t]) => link(r, t, routeGroup(route) === r ? 'active' : ''))
    .join('');
  document.getElementById('account').innerHTML = accountHtml();

  let html;
  switch (route) {
    case 'upcoming':
      html = upcoming();
      break;
    case 'upcoming-detail':
      html = upcomingDetail(q.get('id'));
      break;
    case 'result-detail':
      html = resultDetail();
      break;
    case 'candidate-entry':
      html = candidateEntry();
      break;
    case 'home':
      html = state.user ? dashboard() : login();
      break;
    case 'login':
      html = login();
      break;
    case 'register':
      html = register();
      break;
    case 'register-success':
      html = success('register');
      break;
    case 'verify-email':
      html = verifyEmailPage();
      break;
    case 'dashboard':
      html = dashboard();
      break;
    case 'elections':
      html = elections();
      break;
    case 'details':
      html = details(q.get('election') === 'neighbourhood');
      break;
    case 'candidates':
      html = candidateList();
      break;
    case 'profile':
      html = profile(Number(q.get('id')) || state.candidates[0]?.id);
      break;
    case 'nomination':
      html = nominationPage();
      break;
    case 'nomination-success':
      html = success('nomination');
      break;
    case 'vote':
      html = voting();
      break;
    case 'ballot':
      html = ballotPage();
      break;
    case 'confirm':
      html = confirm();
      break;
    case 'vote-success':
      html = success('vote');
      break;
    case 'status':
      html = status();
      break;
    case 'results':
      html = results();
      break;
    case 'admin':
      html = admin();
      break;
    case 'setup':
      html = setup();
      break;
    case 'manage':
      html = manage();
      break;
    case 'admin-nominations':
      html = review();
      break;
    case 'admin-review':
      html = adminReview();
      break;
    case 'counting':
      html = counting();
      break;
    case 'voter-roll':
      html = voterRollPage();
      break;
    default:
      html = state.user ? dashboard() : login();
  }

  document.getElementById('main').innerHTML = ['home', 'login', 'dashboard'].includes(route)
    ? html
    : shell(route, html);
  document.title = `${pageTitles[route]} | Election Management & Voting System`;
  document.querySelector('.nav').classList.remove('open');
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
}

const protectedRoutes = [
  'dashboard',
  'nomination',
  'nomination-success',
  'ballot',
  'confirm',
  'vote-success',
  'status'
];
const adminRoutes = ['admin', 'setup', 'manage', 'admin-nominations', 'admin-review', 'counting', 'candidate-entry', 'voter-roll'];

async function render() {
  const token = ++renderToken;
  const { route, q } = currentRoute();
  if (protectedRoutes.includes(route) && !state.user) {
    notify('Please log in to continue.');
    location.hash = 'login';
    return;
  }
  if (adminRoutes.includes(route)) {
    if (!state.user) {
      notify('Please log in to continue.');
      location.hash = 'login';
      return;
    }
    if (state.user.role !== 'admin') {
      notify('Administrator access is required.');
      location.hash = 'dashboard';
      return;
    }
  }
  try {
    await loadRouteData(route, q);
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      notify('Please log in to continue.');
      location.hash = 'login';
      return;
    }
    notify(error.message);
    if (error.status === 404) {
      location.hash = 'home';
      return;
    }
  }
  if (token !== renderToken) return;
  paint(route, q);
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"], button:not([type])');
  if (button) button.disabled = true;
  try {
    if (type === 'login') {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: { username: data.username, password: data.password }
      });
      state.user = result.user;
      notify(`Welcome, ${result.user.fullName}.`);
      location.hash = result.user.role === 'admin' ? 'admin' : 'dashboard';
      if (location.hash === '#admin' || location.hash === '#dashboard') {
        if (currentRoute().route === (result.user.role === 'admin' ? 'admin' : 'dashboard')) {
          render();
        }
      }
      return;
    }
    if (type === 'register') {
      if (data.newpassword !== data.repeatpassword) {
        notify('The two passwords do not match.');
        return;
      }
      await api('/api/auth/register', {
        method: 'POST',
        body: {
          username: data.newusername,
          password: data.newpassword,
          confirm_password: data.repeatpassword,
          full_name: data.fullname,
          email: data.email
        }
      });
      state.registeredUsername = data.newusername;
      state.pendingEmail = String(data.email || '').toLowerCase();
      location.hash = 'verify-email';
      notify('Account created. Enter the verification code sent to your email.');
      return;
    }
    if (type === 'verify-email') {
      const result = await api('/api/auth/verify-email', {
        method: 'POST',
        body: { email: data.email, code: data.code }
      });
      state.user = result.user;
      notify(result.message);
      location.hash = result.user.role === 'admin' ? 'admin' : 'dashboard';
      if (location.hash === '#admin' || location.hash === '#dashboard') {
        if (currentRoute().route === (result.user.role === 'admin' ? 'admin' : 'dashboard')) {
          render();
        }
      }
      return;
    }
    if (type === 'vote') {
      const candidateId = Number(data.candidate);
      if (!candidateId) {
        notify('Choose a candidate before continuing.');
        return;
      }
      const voterCode = String(data.voterCode || '').trim();
      if (state.voteElection?.voterMode === 'roll' && !voterCode) {
        notify('Enter the one-time voting code sent to your email.');
        return;
      }
      const selection = {
        electionSlug: form.dataset.election,
        round: Number(form.dataset.round),
        candidateId,
        voterCode
      };
      saveSelection(selection);
      location.hash = voteLink('confirm', state.voteContext);
      return;
    }
    if (type === 'nomination') {
      const payload = {
        candidateName: data.candidateName,
        candidateMember: data.candidateMember,
        introduction: data.introduction,
        manifesto: data.manifesto,
        portfolio: data.portfolio,
        campaign: data.campaign,
        declaration: data.declaration === 'on',
        showInstagram: data.showInstagram === 'on',
        instagramContact: data.instagramContact,
        showFacebook: data.showFacebook === 'on',
        facebookContact: data.facebookContact,
        picture: data.pictureUrl || state.nominationPicture || undefined
      };
      const nominationId = data.nominationId;
      const result = nominationId
        ? await api('/api/nominations/' + nominationId, { method: 'PUT', body: payload })
        : await api('/api/elections/' + data.electionId + '/nominations', {
            method: 'POST',
            body: payload
          });
      state.lastNomination = result.candidate;
      state.myNomination = result.candidate;
      state.nominationCandidate = result.candidate;
      state.nominationElection = result.election;
      state.nominationCanEdit = true;
      notify(result.message);
      location.hash = 'nomination-success';
      return;
    }
    if (type === 'setup') {
      const payload = {
        electionTitle: data.electionTitle,
        description: data.description,
        seats: data.seats,
        method: data.method,
        nomOpen: data.nomOpen,
        nomClose: data.nomClose,
        voteOpen: data.voteOpen,
        voteClose: data.voteClose,
        round2Open: data.round2Open,
        round2Close: data.round2Close,
        publishAt: data.publishAt,
        voterGroup: data.voterGroup,
        voterMode: data.voterMode,
        entryMode: data.entryMode,
        votingRules: data.votingRules
      };
      if (data.stage) payload.stage = data.stage;
      const slug = form.dataset.slug;
      const result = slug
        ? await api('/api/admin/elections/' + slug, { method: 'PUT', body: payload })
        : await api('/api/admin/elections', { method: 'POST', body: payload });
      state.setupElection = result.election;
      state.setupSlug = result.election.slug;
      adminDraft = data;
      adminSaved = true;
      notify(slug ? 'Election setup saved.' : 'Election created as a draft.');
      location.hash = 'admin';
      return;
    }
    if (type === 'stage') {
      const result = await api('/api/admin/elections/' + form.dataset.slug + '/stage', {
        method: 'PATCH',
        body: { stage: data.stage }
      });
      notify(result.message);
      render();
      return;
    }
    if (type === 'admin-candidate') {
      const payload = {
        name: data.adminCandidateName,
        memberId: data.adminMemberId,
        bio: data.adminIntroduction,
        portfolio: data.adminPortfolio,
        manifesto: data.adminStatement,
        tag: data.adminSlogan,
        picture: state.adminPicture
      };
      const result = await api('/api/admin/candidates/' + form.dataset.id, {
        method: 'PUT',
        body: payload
      });
      state.adminPicture = undefined;
      notify(result.message);
      render();
    }
  } catch (error) {
    if (
      (error.code === 'EMAIL_NOT_VERIFIED' || error.code === 'EMAIL_DELIVERY_FAILED') &&
      error.data?.email
    ) {
      state.pendingEmail = error.data.email;
      notify(error.message);
      location.hash = 'verify-email';
      return;
    }
    notify(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleClick(event) {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try {
    if (action === 'logout') {
      await api('/api/auth/logout', { method: 'POST' });
      state.user = null;
      state.myVotes = [];
      state.myNomination = null;
      location.hash = 'home';
      render();
      notify('You have been logged out.');
      return;
    }
    if (action === 'resend-verification') {
      const form = el.closest('form[data-form="verify-email"]');
      const email = form?.querySelector('[name="email"]')?.value || state.pendingEmail;
      if (!email) {
        notify('Enter your email address first.');
        return;
      }
      el.disabled = true;
      try {
        const result = await api('/api/auth/resend-verification', {
          method: 'POST',
          body: { email }
        });
        notify(result.message);
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'admin-demo') {
      const result = await api('/api/auth/demo-admin', { method: 'POST' });
      state.user = result.user;
      notify('Signed in with the administrator demo account.');
      location.hash = 'admin';
      render();
      return;
    }
    if (action === 'import-voter-roll') {
      const election = state.adminVoterRoll?.election;
      const input = document.getElementById('voterRollFile');
      const file = input?.files?.[0];
      if (!election) return;
      if (!file) {
        notify('Choose a CSV file to import.');
        return;
      }
      const voters = parseVoterCsv(await file.text());
      if (!voters.length) {
        notify('The CSV file does not contain any voters.');
        return;
      }
      el.disabled = true;
      try {
        const result = await api('/api/admin/elections/' + election.slug + '/voter-roll/import', {
          method: 'POST',
          body: { voters }
        });
        notify(result.message);
        render();
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'resend-voter-code') {
      const election = state.adminVoterRoll?.election;
      if (!election) return;
      el.disabled = true;
      try {
        const result = await api(
          '/api/admin/elections/' + election.slug + '/voter-roll/' + el.dataset.id + '/resend',
          { method: 'POST' }
        );
        notify(result.message);
        render();
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'revoke-voter-code') {
      const election = state.adminVoterRoll?.election;
      if (!election) return;
      if (!window.confirm('Revoke this voter code? The voter will no longer be able to use it.')) return;
      el.disabled = true;
      try {
        const result = await api(
          '/api/admin/elections/' + election.slug + '/voter-roll/' + el.dataset.id + '/revoke',
          { method: 'POST' }
        );
        notify(result.message);
        render();
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'clear-voter-roll') {
      const election = state.adminVoterRoll?.election;
      if (!election) return;
      if (!window.confirm('Clear the entire voter roll for this election?')) return;
      el.disabled = true;
      try {
        const result = await api('/api/admin/elections/' + election.slug + '/voter-roll', {
          method: 'DELETE'
        });
        notify(result.message);
        render();
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'save-nomination') {
      const form = el.closest('form');
      if (!form) return;
      nomination = Object.fromEntries(new FormData(form));
      nominationDraft = true;
      try {
        sessionStorage.setItem('emvs.nominationDraft', JSON.stringify(nomination));
      } catch (_) {
        /* ignore */
      }
      notify('Nomination draft saved on this device.');
      return;
    }
    if (action === 'submit-vote') {
      const selection = restoreSelection();
      if (!selection) {
        notify('Choose a candidate before submitting your vote.');
        location.hash = voteLink('ballot', state.voteContext);
        return;
      }
      el.disabled = true;
      try {
        const result = await api('/api/elections/' + selection.electionSlug + '/votes', {
          method: 'POST',
          body: {
            candidateId: selection.candidateId,
            round: selection.round,
            voterCode: selection.voterCode || ''
          }
        });
        state.lastVote = result.vote;
        clearSelection();
        notify(`Vote accepted. Reference ${result.vote.reference}.`);
        location.hash = 'vote-success';
      } catch (error) {
        notify(error.message);
        if (error.code === 'ALREADY_VOTED' || error.code === 'VOTING_CLOSED' || error.code === 'NOT_ELIGIBLE') {
          location.hash = 'status';
        } else if (
          ['VOTER_CODE_REQUIRED', 'INVALID_VOTER_CODE', 'VOTER_CODE_REVOKED',
            'VOTER_CODE_BOUND_TO_OTHER_ACCOUNT', 'VOTER_EMAIL_MISMATCH',
            'VOTER_CODE_ALREADY_USED'].includes(error.code)
        ) {
          location.hash = voteLink('ballot', state.voteContext);
        }
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'nomination-status') {
      el.disabled = true;
      const form = el.closest('[data-form="review"]');
      const body = { status: el.dataset.status };
      if (form) {
        body.note = form.querySelector('[name="reviewNote"]')?.value || '';
        if (form.dataset.updatedAt) body.expectedUpdatedAt = form.dataset.updatedAt;
      }
      try {
        const result = await api('/api/admin/candidates/' + el.dataset.id + '/status', {
          method: 'PATCH',
          body
        });
        notify(result.message);
        render();
      } catch (error) {
        notify(error.message);
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'publish') {
      const election = state.adminCount?.election;
      if (!election) return;
      el.disabled = true;
      try {
        const result = await api('/api/admin/elections/' + election.slug + '/publish', {
          method: 'POST',
          body: {}
        });
        notify(result.message);
        location.hash = 'results?published=' + election.slug;
      } catch (error) {
        notify(error.message);
      } finally {
        el.disabled = false;
      }
      return;
    }
    if (action === 'add-admin-candidate') {
      const election = state.adminElection;
      if (!election) return;
      const name = 'New candidate ' + (state.adminCandidates.length + 1);
      const result = await api('/api/admin/elections/' + election.slug + '/candidates', {
        method: 'POST',
        body: { name, bio: '', manifesto: '', tag: '' }
      });
      state.adminCandidateIndex = state.adminCandidates.length;
      notify(result.message);
      render();
    }
  } catch (error) {
    notify(error.message);
  }
}

function handleChange(event) {
  const form = event.target.closest('form[data-form="setup"]');
  if (form) {
    if (event.target.name === 'entryMode') {
      const isAdmin = event.target.value === 'admin';
      const linkEl = document.getElementById('admin-entry-link');
      const noteEl = document.getElementById('student-entry-note');
      if (linkEl) linkEl.hidden = !isAdmin;
      if (noteEl) noteEl.hidden = isAdmin;
    }
    if (event.target.name === 'candidateCount') {
      const summary = document.getElementById('round-setup-summary');
      if (summary) summary.innerHTML = roundSetupSummary(event.target.value);
    }
  }
  if (event.target.name === 'editCandidate') {
    state.adminCandidateIndex = event.target.selectedIndex;
    state.adminPicture = undefined;
    render();
  }
  if (event.target.id === 'adminPicture') {
    const image = event.target.files[0];
    if (!image) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      notify('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (image.size > 2 * 1024 * 1024) {
      notify('The profile picture must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.adminPicture = reader.result;
      notify('Candidate picture ready to save.');
    };
    reader.readAsDataURL(image);
  }
  if (event.target.id === 'candidatePicture') {
    const image = event.target.files[0];
    if (!image) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
      notify('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (image.size > 2 * 1024 * 1024) {
      notify('The profile picture must be 2 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.nominationPicture = reader.result;
      const nominationForm = event.target.closest('form[data-form="nomination"]');
      if (nominationForm) refreshIntroPreview(nominationForm);
    };
    reader.readAsDataURL(image);
    return;
  }
  const nominationForm = event.target.closest('form[data-form="nomination"]');
  if (nominationForm) refreshIntroPreview(nominationForm);
}

function handleInput(event) {
  if (event.target.name === 'candidateCount') {
    const summary = document.getElementById('round-setup-summary');
    if (summary) summary.innerHTML = roundSetupSummary(event.target.value);
  }
  const nominationForm = event.target.closest('form[data-form="nomination"]');
  if (nominationForm && event.target.type !== 'file') refreshIntroPreview(nominationForm);
}

function initialise() {
  document.querySelector('.skip').addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('main').focus();
    document.getElementById('main').scrollIntoView();
  });
  document.querySelector('.mobile-menu').addEventListener('click', () => {
    const isOpen = document.querySelector('.nav').classList.toggle('open');
    document.querySelector('.mobile-menu').setAttribute('aria-expanded', String(isOpen));
  });
  document.getElementById('print-page').addEventListener('click', () => window.print());
  document.getElementById('text-size').addEventListener('click', () => {
    const large = document.body.classList.toggle('large-text');
    document.body.style.zoom = large ? '1.1' : '1';
    document.getElementById('text-size').textContent = large ? 'A' : 'A+';
  });
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  window.addEventListener('hashchange', () => {
    render().then(() => document.getElementById('main').focus({ preventScroll: true }));
  });
}

(async function start() {
  initialise();
  try {
    const session = await api('/api/auth/session');
    state.user = session.user;
    state.demoMode = Boolean(session.demoMode);
    state.googleEnabled = Boolean(session.googleEnabled);
    state.emailMode = session.emailMode || 'console';
  } catch (_) {
    state.user = null;
  }
  const params = new URLSearchParams(location.search);
  if (params.get('google_error')) {
    notify(params.get('google_error'));
    params.delete('google_error');
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
  }
  await render();
})();
