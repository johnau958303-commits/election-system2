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

- Node.js 22.5+ (CI runs 22.x and 24.x).
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

## 7. Security test checklist

- [ ] Unauthenticated access to protected APIs returns 401.
- [ ] Voter access to administrator APIs returns 403.
- [ ] Duplicate votes are rejected even under repeated requests.
- [ ] Unverified accounts cannot log in.
- [ ] Voter codes are invalid for a different account or email.
- [ ] Ineligible users cannot vote.
- [ ] Voting outside the configured window is rejected.
- [ ] Second-round votes are rejected for non-advanced candidates.
- [ ] Results are hidden before publication.
- [ ] State-changing requests from an untrusted origin are rejected.
- [ ] Login throttling returns 429 after repeated failures.
- [ ] Demo admin is unavailable when `DEMO_MODE` is not `true`.
- [ ] Production mode does not auto-seed demo accounts.
- [ ] Error responses do not expose stack traces or secrets.

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
- Coverage is at least 80% of lines for the backend modules.
- Requirements traceability has no unverified Must requirement.

## 10. Current coverage

The `npm run test:coverage` report currently shows approximately:

- **81.5% lines**
- **59.6% branches**
- **82.2% functions**

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

- No browser end-to-end automation (Playwright/Cypress).
- No load, stress, or soak tests.
- No automated accessibility audit.
- No penetration test.
- No database migration or backup restore test.
- No test for concurrent vote insertion from parallel processes.
