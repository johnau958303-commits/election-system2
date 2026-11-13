# Election Management & Voting System

A small, self-contained election platform for a school, club or organization. It provides voter registration with email verification, optional Google Sign-In, candidate nominations, per-election voter rolls with one-time codes, single-round and two-round voting, live counting, result publishing, and an administrator console.

The server is Node.js + Express 5, persistence is SQLite through the built-in `node:sqlite` module, and the browser client is a vanilla HTML/CSS/JavaScript single-page application.

## Features

- Voter registration with email verification and cookie-based sessions
- Optional Google Sign-In with verified-email account linking
- Role-based access control for voters and administrators (administrators cannot apply as candidates or vote)
- Election setup with nomination, voting, and result dates
- Candidate nominations with portfolio, member-ID, and photo fields
- Administrator review console with approve, reject, return-for-changes, and notes
- Administrator-entered candidates
- Single-round and two-round elections, decided by the number of approved candidates (more than eight uses two rounds)
- Per-election open voting or a voter roll with emailed one-time codes
- One-time codes bind to the matching account, work once per round, and can be resent or revoked
- One vote per eligible voter per round, enforced by a database constraint
- Live counting, turnout, tie detection, and frozen result snapshots
- Multi-seat result publishing
- Public election information, candidate profiles, and published results
- Health endpoint for hosting checks
- Automated unit and API integration tests
- GitHub Actions CI for Node.js 22 and 24

## Requirements

- Node.js 22.13 or newer (tested with Node.js 24)
- npm 10 or newer

## Quick start

```powershell
npm install
npm start
```

Open <http://localhost:3000>.

The database is created automatically at `data/election.db` when the app starts. In development, an empty database is seeded with demonstration elections. Use `npm run reset` to rebuild it.

### Demo account

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin1234!` | Administrator |

Voters register through the website and must verify their email address before logging in. Demo elections use open voting by default. Administrators can switch an election to voter-roll mode and import a CSV with `external_id,full_name,email`; each voter then receives a one-time code by email.

The **Admin demo** button is shown only when `DEMO_MODE=true`. Normal administrator login works without it.

```powershell
$env:DEMO_MODE = 'true'
npm start
```

### Email delivery in development

By default `EMAIL_MODE=console`, so verification codes and voter codes are printed in the server console. To send real email, set `EMAIL_MODE=resend`, `RESEND_API_KEY`, and `MAIL_FROM`. Tests use `EMAIL_MODE=test`, which keeps messages in an in-memory outbox.

### Google Sign-In

Google login requires a fixed HTTPS origin. Temporary Cloudflare Quick Tunnel URLs are not suitable.

1. Create an OAuth client in Google Cloud.
2. Add `<origin>/api/auth/google/callback` as an authorized redirect URI.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_BASE_URL` (or `GOOGLE_REDIRECT_URI`).
4. Restart the server. The Google button appears automatically when configured.

Google accounts must have a verified email address. An existing local account with the same verified email is linked; an unverified local account is linked and its local password is reset.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Start the server on port 3000 |
| `npm run dev` | Start with Node.js watch mode |
| `npm run seed` | Seed an empty database |
| `npm run reset` | Delete and rebuild the database with demo data |
| `npm test` | Run all unit and API tests |
| `npm run test:coverage` | Run tests with Node.js code coverage |
| `npm run check` | Syntax-check every JavaScript file |
| `npm run backup` | Write a consistent SQLite snapshot with `VACUUM INTO` |
| `start-public.cmd` | Start the app and a temporary Cloudflare Quick Tunnel |
| `stop-public.cmd` | Stop the public session and server |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DB_PATH` | `data/election.db` | SQLite database file |
| `NODE_ENV` | unset | Set to `production` to disable auto-seeding and demo logging |
| `DEMO_MODE` | `false` | Enables the administrator demo endpoint and button |
| `AUTO_SEED` | unset | Set to `false` to disable automatic seeding in development |
| `TRUST_PROXY` | unset | Trusted proxy hops or Express trust value, e.g. `1` behind a tunnel |
| `ELECTION_NOW` | unset | Overrides the current time for deterministic tests |
| `PUBLIC_BASE_URL` | unset | Fixed HTTPS origin used for Google OAuth callbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | unset | Google OAuth credentials; hides Google login when unset |
| `GOOGLE_REDIRECT_URI` | derived | Overrides the Google callback URL |
| `EMAIL_MODE` | `console` | `resend`, `console`, or `test` email delivery |
| `EMAIL_TIMEOUT_MS` | `10000` | Timeout for the Resend HTTP request |
| `RESEND_API_KEY` / `MAIL_FROM` | unset | Resend API key and sender for real emails |
| `VOTER_CODE_SECRET` | dev fallback | Secret used to hash one-time voter codes; required in production |
| `EMAIL_CODE_SECRET` | falls back | Optional separate secret for email verification code hashes |

## Voter rolls and one-time codes

1. Open an election in the administrator console and choose **Voter roll with one-time codes** in the setup form, or import a roll.
2. Import a CSV with the columns `external_id,full_name,email`. The importer accepts quoted fields and a header row.
3. Each voter receives a formatted code such as `ABCD-EF23`. Codes are stored only as HMAC-SHA256 hashes.
4. The voter registers or signs in with the same email address and enters the code on the ballot page.
5. The code binds to that account. The same code may be used once in each voting round by the same account.
6. Administrators can resend a code (which rotates it) or revoke it. Plaintext codes are never shown in the administrator interface.

Open elections do not require a code. Any verified voter account may vote once per round.

## Project structure

```text
.
|-- app.js                  Browser SPA: routing, pages, API calls, events
|-- index.html              Page shell, layout, and CSS
|-- server.js               HTTP entry point
|-- server/
|   |-- app.js              Express app, middleware, router mounting
|   |-- auth.js             Password hashing, sessions, guards, origin check
|   |-- google.js           Google OAuth client, PKCE and account linking
|   |-- mailer.js           Resend/console/test email delivery
|   |-- voter-codes.js      One-time code generation and HMAC hashing
|   |-- db.js               SQLite schema, connections, time helpers, transactions
|   |-- helpers.js          Serialization, eligibility, counting, status logic
|   |-- seed.js             Demo data and database rebuild
|   `-- routes/
|       |-- auth.js         Registration, verification, Google login, sessions
|       |-- elections.js    Public election and result APIs
|       |-- nominations.js  Nomination submission and editing
|       |-- votes.js        Vote casting and personal vote lookup
|       `-- admin.js        Lifecycle, candidates, voter rolls, counting, publishing
|-- test/
|   |-- api.test.js         API integration tests
|   `-- unit.test.js        Unit tests for pure helpers
|-- scripts/                Syntax check and database backup utilities
|-- docs/                   Requirements, models, architecture, design, testing, operations, threat model
|-- .github/                CI workflow and Dependabot configuration
|-- data/                   SQLite database (created at runtime)
`-- start-public.* / stop-public.*  Optional public sharing scripts
```

## Architecture summary

The system uses a layered, client-server architecture:

1. **Browser SPA** - renders pages and calls JSON APIs.
2. **Express application** - validates requests, enforces authentication and authorization, and coordinates domain logic.
3. **Domain helpers** - serialize elections and candidates, count votes, derive election status, and freeze results.
4. **SQLite repository** - stores users, sessions, elections, candidates, voter rolls, votes, and result entries.

The frontend follows an MVC-like split: `state` and API loading act as the model, `paint()`/page functions render the view, and the global event handlers act as controllers.

More detail is in [docs/architecture.md](docs/architecture.md).

## Testing

```powershell
npm test
npm run test:coverage
```

The suite covers registration and email verification, duplicate email/username handling, session guards, election setup, role enforcement, nomination review, open voting, voter-roll code binding and resends, voting restrictions, duplicate prevention, ties, two-round advancement, multi-seat publishing, invalid stage transitions, SQLite persistence, security headers, picture URL hardening, audit-log access, the production demo guard, and the health endpoint.

## Security notes

This project is suitable for coursework and controlled demonstrations. Before using it for a real election:

- Set `NODE_ENV=production`. The server refuses to start if `DEMO_MODE=true` in production.
- Set a long random `VOTER_CODE_SECRET` (and optionally `EMAIL_CODE_SECRET`), `RESEND_API_KEY`, `MAIL_FROM`, and Google OAuth variables.
- Serve the app over HTTPS and set `TRUST_PROXY=1` when it runs behind a trusted reverse proxy or tunnel.
- The in-memory rate limits (login, registration, verification, nominations) are per process; use a shared limiter if running multiple instances.
- Security headers (CSP, HSTS in production, frame and MIME protections) and `Cache-Control: no-store` on API responses are set by default.
- Use voter-roll mode with one-time codes for elections that need an official eligibility list. Open voting marks verified accounts as eligible automatically.
- Administrator actions and result publication are audit-logged and visible in the election management page.
- Run `npm run backup` before maintenance and store snapshots on encrypted, off-host storage.
- Review the vote-storage model if ballot secrecy from database administrators is required.
- Add CSRF tokens if the app is embedded in a broader site or if third-party cookies are allowed.

## Deployment

Google OAuth requires a fixed HTTPS callback URL. Use a named Cloudflare Tunnel or another stable deployment; temporary Quick Tunnel URLs are not suitable for Google Sign-In. Set `PUBLIC_BASE_URL` (or `GOOGLE_REDIRECT_URI`) to the fixed HTTPS origin and register `/api/auth/google/callback` in Google Cloud. Configure Resend for verification and voter-code emails. Set `NODE_ENV=production`, provide a persistent disk for `data/election.db`, and set `TRUST_PROXY=1` if a tunnel or reverse proxy terminates TLS. Use `/api/health` for readiness checks and `npm run backup` for snapshots. Run `npm run seed` once if an empty database is acceptable. See [docs/operations.md](docs/operations.md) for the runbook.

## Documentation

- [Requirements specification](docs/requirements.md)
- [System models](docs/system-models.md)
- [Architecture](docs/architecture.md)
- [Design and implementation](docs/design.md)
- [Test plan](docs/test-plan.md)
- [Process and agile plan](docs/process-and-agile.md)
- [Operations runbook](docs/operations.md)
- [Threat model](docs/threat-model.md)

## Repository

<https://github.com/johnau958303-commits/election-system2>
