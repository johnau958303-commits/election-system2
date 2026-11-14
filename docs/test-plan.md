# Software Test Plan

## 1. Objectives

- Demonstrate that the system meets its requirements.
- Detect defects in authentication, nomination, voting, counting, and publishing.
- Prevent regressions when the schema, routes, or UI change.
- Provide evidence for release and acceptance decisions.

Testing can show the presence of defects, not their absence. The plan therefore combines automated tests, static review, and manual acceptance.

## 2. Scope

In scope:

- account registration, email verification, Google login, logout, and sessions;
- role-based access control;
- election creation and editing;
- nomination submission, editing, review, and approval;
- voting eligibility, voter-roll one-time codes, round windows, duplicate prevention, and candidate validity;
- counting, ties, two-round advancement, multi-seat publishing, and result freezing;
- SQLite persistence and the health endpoint;
- input validation and core security controls.

Out of scope for automation:

- visual design review;
- screen-reader and cross-browser accessibility certification;
- large-scale load and soak testing;
- penetration testing;
- backup and disaster-recovery drills.

## 3. Test levels

| Level | Description | Current implementation |
|---|---|---|
| Unit | Pure functions and validation rules | `test/unit.test.js` |
| Component/API integration | Route + database + auth behaviour | `test/api.test.js` |
| System | End-to-end election scenarios through the API | Covered by integration scenarios |
| Release | Full suite against a release candidate | `npm test` and CI |
| User acceptance | Voter and administrator journeys in the browser | Manual checklist |

## 4. Test environment

- Node.js 22.13+ (CI runs 22.x and 24.x).
- Temporary SQLite database per test run via `DB_PATH`.
- `DEMO_MODE=true` for tests that use the seeded administrator.
- `EMAIL_MODE=test` so verification and voter codes use an in-memory outbox.
- `ELECTION_NOW` for deterministic time-dependent checks.
- No external network dependency.

Commands:

```powershell
npm test
npm run test:coverage
```

## 5. Test design techniques

- **Equivalence partitioning:** valid and invalid usernames, passwords, dates, candidate IDs, and image formats.
- **Boundary value analysis:** password length 8/128, candidate count 1/50, picture size 2 MB, round numbers 1/2.
- **State transition testing:** election lifecycle transitions and nomination review.
- **Decision tables:** eligibility, voting window, round, duplicate vote, and candidate approval.
- **Scenario testing:** register ??login ??vote ??receipt; admin ??create ??review ??count ??publish.
- **Regression testing:** full suite after every change; CI on every push and pull request.
- **Security testing:** unauthenticated and non-admin access, origin checks, duplicate submission, ineligible voting.

## 6. Automated test cases

### API integration tests

| ID | Scenario | Requirements |
|---|---|---|
| T-01 | Registration, duplicate usernames, login, sessions | FR-01, FR-02, FR-03, FR-06 |
| T-02 | Election information is stored and returned | FR-08, FR-09 |
| T-03 | Administrators create and edit elections; voters cannot | FR-05, FR-08 |
| T-04 | Nomination submission, deadline editing, approval | FR-11, FR-12, FR-13 |
| T-05 | One vote, duplicates, ineligible voters, closed periods | FR-15, FR-16, FR-17 |
| T-06 | Counting, ties, and publishing | FR-19, FR-20, FR-21, FR-23 |
| T-07 | Two-round advancement (top eight) and round restrictions | FR-18, UC-06 |
| T-08 | Multi-seat publishing elects the requested number | FR-22 |
| T-09 | Invalid stage transitions are rejected | FR-24 |
| T-10 | Data is stored in SQLite on disk | NFR-04, NFR-09 |
| T-11 | Health endpoint is available | FR-26 |
| T-12 | Review notes, member-ID uniqueness, optimistic conflicts, administrator restrictions | FR-11, FR-12, FR-13, FR-15 |
| T-13 | Stage transitions enforce the approved-candidate round rule | FR-18, FR-24, UC-06 |
| T-14 | Email verification is required before login; duplicate emails are blocked; Google is disabled without credentials | FR-01, FR-02 |
| T-15 | Voter-roll codes bind to the matching account, work once per round, and can be resent/revoked | FR-15, FR-16, FR-17 |
| T-16 | Second-round counts include only advanced finalists | FR-18 |
| T-17 | Zero-vote candidates are not elected when seats exceed votes | FR-19, FR-22 |
| T-18 | Publishing after the first round of a two-round election is rejected | FR-20, FR-25 |
| T-19 | Publishing a two-round election selects the second round everywhere | FR-21, FR-22 |
| T-20 | Candidate approvals are locked once voting is open | FR-13, FR-17 |
| T-21 | Editing an election cannot bypass stage transitions | FR-08, FR-24 |
| T-22 | Clearing the voter roll returns the election to open voting | FR-16a |
| T-23 | A malformed cookie header does not break the session endpoint | FR-06 |
| T-24 | Spoofed forwarded hosts do not pass the origin check | NFR-05 |
| T-25 | Unverified accounts are not counted as eligible voters | FR-01, FR-15 |
| T-26 | Voter-roll imports support swapping email addresses | FR-16a |
| T-27 | Health endpoint verifies the database and disables caching | FR-26 |
| T-28 | API responses send hardening headers | NFR-05 |
| T-29 | Candidate picture URLs cannot inject markup | FR-14, NFR-06 |
| T-30 | Audit log is admin-only and records election changes | FR-29 |

### Unit tests

| ID | Scenario |
|---|---|
| U-01 | Manifesto parsing handles arrays, newline text, and JSON arrays |
| U-02 | Contact parsing accepts objects and valid JSON only |
| U-03 | Candidate serialization maps database fields to API fields |
| U-04 | Election status derives draft, open, upcoming, closed, and published states |
| U-05 | Date-only and full-date ISO conversion |
| U-06 | Password and username validation boundaries |
| U-07 | Password hash verification accepts only the original password |
| U-08 | Email validation requires a plausible address |
| U-09 | One-time voter codes normalize, format, and hash consistently |
| U-10 | Production refuses to start when `NODE_ENV=production` and `DEMO_MODE=true` |

## 7. Security test checklist

- [x] Unauthenticated access to protected APIs returns 401. (T-03)
- [x] Voter access to administrator APIs returns 403. (T-03, T-12)
- [x] Duplicate votes are rejected even under repeated requests. (T-05)
- [x] Unverified accounts cannot log in. (T-14)
- [x] Voter codes are invalid for a different account or email. (T-15, T-26)
- [x] Ineligible users cannot vote. (T-25)
- [x] Voting outside the configured window is rejected. (T-05)
- [x] Second-round votes are rejected for non-advanced candidates. (T-07, T-16)
- [x] Results are hidden before publication. (T-06)
- [x] State-changing requests from an untrusted origin are rejected. (T-24)
- [ ] Login throttling returns 429 after repeated failures. Manual: throttling is disabled under `NODE_ENV=test`, so this is checked by hand.
- [ ] Demo admin is unavailable when `DEMO_MODE` is not `true`. Code review: the route returns 403 unless `DEMO_MODE=true`.
- [x] Production mode does not auto-seed demo accounts. (code review of `server/app.js` plus U-10)
- [ ] Error responses do not expose stack traces or secrets. Manual/code review: handlers return generic messages.

## 8. Manual acceptance checklist

### Voter journey

1. Register a new account.
2. Log in and open the dashboard.
3. Browse elections and candidate profiles.
4. Open a nomination form during the nomination window.
5. Submit a nomination and confirm the success message.
6. Open the ballot during the voting window.
7. Select, confirm, and submit a vote.
8. Confirm the receipt and that a second vote is blocked.
9. View a published result.

### Administrator journey

1. Log in as an administrator.
2. Create an election with valid dates and rules.
3. Add or review candidates.
4. Approve a nomination.
5. Move the election to voting open.
6. Count votes.
7. Close voting and publish results.
8. Confirm the winner or tie is displayed.
9. Attempt an invalid stage transition and confirm it is rejected.

### Accessibility and usability

1. Navigate the main flows using only the keyboard.
2. Confirm visible focus and skip links.
3. Use the text-size control.
4. Print an election information page.
5. Check the layout at tablet and mobile widths.

## 9. Entry and exit criteria

### Entry criteria

- The application starts with a clean or seeded database.
- `npm test` passes locally.
- The CI workflow is green.

### Exit criteria

- All automated tests pass.
- No open high-severity defects.
- Manual acceptance checklist is complete.
- Coverage is tracked against a target of 80% of lines for the backend modules. The latest run is 78.82%, so this item is not formally met; the remaining gap and its cause are recorded in §10 and §12.
- Requirements traceability has no unverified Must requirement.

## 10. Current coverage

The latest `npm run test:coverage` run (Node.js 24) reports:

- **78.82% lines**
- **65.93% branches**
- **83.33% functions**

Coverage is measured only for the backend modules loaded by the test suite. The browser client (`app.js`, about 2,400 lines) has no automated coverage and is not included.

The main gaps are:

- the optional Google OAuth path (`server/google.js` 21%, `server/routes/auth.js` 55%), which cannot run without live credentials and is verified manually;
- administrator reporting and roll-management branches in `server/routes/admin.js` (80%);
- route-level error paths in `server/routes/votes.js` (72%) and `server/routes/elections.js` (74%).

Coverage is a guide, not a goal by itself. The most important election rules are covered by scenario tests.

## 11. Defect management

| Severity | Definition | Example | Target |
|---|---|---|---|
| Critical | Vote integrity or data loss | Duplicate vote accepted, published result changes | Fix before release |
| High | Security or major workflow failure | Voter can publish results, login bypass | Fix before release |
| Medium | Incorrect but non-critical behaviour | Wrong message, missing validation message | Fix in next iteration |
| Low | Cosmetic or minor usability | Layout issue, wording | Backlog |

A defect record should include the requirement ID, steps to reproduce, expected and actual behaviour, environment, and evidence.

## 12. Known gaps

- No browser end-to-end automation (Playwright/Cypress), so the frontend (`app.js`) has no automated regression coverage.
- Backend line coverage is 78.82%, just under the 80% exit target; the gap is concentrated in the optional Google OAuth path and administrator reporting branches.
- No load, stress, or soak tests.
- No automated accessibility audit.
- No penetration test.
- No database migration or backup restore test.
- No test for concurrent vote insertion from parallel processes.
