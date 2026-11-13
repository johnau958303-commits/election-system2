# Software Requirements Specification

## 1. Purpose and scope

The Election Management & Voting System supports a school, club, or organization election from account registration through result publication. It covers:

- election setup and scheduling;
- email-verified voter registration and optional Google Sign-In;
- candidate nomination, review, and approval;
- eligible-voter checks, including per-election voter rolls with one-time codes;
- single-round and two-round voting;
- vote counting, tie handling, and result publishing;
- public election information and published results;
- administrator reporting and lifecycle management.

Out of scope: national or statutory elections, paper-ballot reconciliation, biometric identity verification, payment, and multi-tenant organization management.

## 2. Stakeholders

| Stakeholder | Interest |
|---|---|
| Voter | Register, verify an email, review candidates, vote once per round, and view published results |
| Candidate | Submit and edit a nomination before the deadline and present a profile |
| Election administrator | Create elections, review nominations, manage stages, count votes, publish results |
| School election committee | Accurate eligibility, auditable process, and timely results |
| IT support | Deploy, monitor, back up, and maintain the system |
| External auditor | Verify that rules and result snapshots are applied consistently |

## 3. Definitions

- **Election** — a scheduled contest with candidates, an electorate, and a result method.
- **Round** — one voting period. A two-round election has a first and second round.
- **Eligible voter** — a verified account marked as eligible, and on the voter roll when the election requires one.
- **Voter roll** — the per-election list of voters; entries can be bound to an account and used once per round.
- **Nomination** — a candidate submission awaiting or receiving administrator review.
- **Result snapshot** — frozen vote totals stored in `result_entries` at publication time.
- **Turnout** — accepted votes divided by the eligible voter count.

## 4. User stories

| ID | User story |
|---|---|
| US-01 | As a visitor, I can view election information and published results without logging in. |
| US-02 | As a visitor, I can create an account, verify my email, and optionally sign in with Google. |
| US-03 | As an eligible voter, I can submit one nomination per election before the deadline. |
| US-04 | As a candidate, I can edit my nomination until the deadline while it is still pending review. |
| US-05 | As an eligible voter, I can cast one vote per round for an approved candidate, using a one-time code when required. |
| US-06 | As a voter, I can see whether I am eligible, have already voted, or voting is not open. |
| US-07 | As an administrator, I can create and edit elections, dates, rules, and candidate limits. |
| US-08 | As an administrator, I can approve, reject, or return nominations. |
| US-09 | As an administrator, I can advance finalists in a two-round election. |
| US-10 | As an administrator, I can count votes and publish a frozen result. |
| US-11 | As a voter, I can view the published winner or tied result. |

## 5. Functional requirements

### 5.1 Accounts and access

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The system shall allow a visitor to register with a unique username, password, full name, and unique email address, then verify the email with a 6-digit code. | Must |
| FR-02 | The system shall reject duplicate usernames, duplicate case-insensitive emails, and invalid username, password or email formats. | Must |
| FR-03 | The system shall authenticate a verified user with a username and password and create a seven-day session. | Must |
| FR-03a | The system shall support Google Sign-In with state, PKCE, verified ID-token email and safe account linking when configured. | Should |
| FR-04 | The system shall store passwords using a random salt and `scrypt`, and compare hashes in constant time. | Must |
| FR-05 | The system shall reject non-administrator access to administrator APIs. | Must |
| FR-06 | The system shall invalidate a session on logout and remove expired sessions. | Must |
| FR-07 | The system shall throttle repeated failed login attempts. | Should |

### 5.2 Elections and nominations

| ID | Requirement | Priority |
|---|---|---|
| FR-08 | An administrator shall create an election with title, description, seats, dates, entry mode, initial stage, eligible group, and voting rules. The round mode is derived from the number of approved candidates. | Must |
| FR-09 | The system shall generate a unique slug for each election. | Must |
| FR-10 | The system shall validate that nomination and voting close dates follow their open dates. | Must |
| FR-11 | An eligible voter who is not an administrator shall submit at most one nomination per election while nominations are open. | Must |
| FR-12 | A voter shall edit only their own pending nomination, and not after the deadline, approval, or rejection. | Must |
| FR-13 | An administrator shall approve, reject, or return a nomination for review, with an optional review note and optimistic conflict protection. | Must |
| FR-14 | The system shall accept candidate pictures only as PNG, JPEG, or WebP data URLs up to 2 MB. | Should |

### 5.3 Voting and results

| ID | Requirement | Priority |
|---|---|---|
| FR-15 | Only an eligible, authenticated voter who is not an administrator shall cast a vote. In voter-roll mode the account email must match the roll and a valid one-time code is required. | Must |
| FR-16 | A voter shall cast at most one vote per election round, enforced by a database constraint. A one-time code may be used once per round by the same bound account. | Must |
| FR-16a | An administrator shall import a voter roll by CSV, resend or revoke codes, and never see plaintext codes. | Must |
| FR-17 | A vote shall be accepted only during the configured round window and only for an approved candidate. | Must |
| FR-18 | A two-round election applies when more than eight candidates are approved; in the second round a vote shall be accepted only for one of the top eight advanced candidates. | Must |
| FR-19 | The system shall count accepted votes, calculate turnout, and detect ties. | Must |
| FR-20 | An administrator shall publish results only after voting is closed. | Must |
| FR-21 | Publishing shall freeze result entries and prevent later vote changes from altering the published result. | Must |
| FR-22 | Result publishing shall respect the configured number of seats and identify boundary ties. | Must |
| FR-23 | Public results shall be visible only after publication. | Must |

### 5.4 Lifecycle

| ID | Requirement | Priority |
|---|---|---|
| FR-24 | The system shall restrict election stage changes to a defined transition graph. | Must |
| FR-25 | The system shall reject publishing while voting is open. | Must |
| FR-26 | The system shall expose a health endpoint for deployment checks. | Should |
| FR-27 | The system shall avoid automatic demo seeding when `NODE_ENV=production`. | Must |
| FR-28 | The administrator demo endpoint shall require `DEMO_MODE=true`. | Must |

## 6. Non-functional requirements

| ID | Requirement | Measure |
|---|---|---|
| NFR-01 | Usability | A voter can complete login, candidate selection, confirmation, and receipt in one flow without training. |
| NFR-02 | Accessibility | Keyboard navigation, visible focus, semantic headings, and text-size control are available. |
| NFR-03 | Performance | A normal API request should complete in under 500 ms on a local machine with the demo database. |
| NFR-04 | Reliability | A duplicate vote or duplicate nomination must never be stored, including concurrent requests. |
| NFR-05 | Security | Passwords are never stored in plain text; sessions are HTTP-only; state-changing requests are origin-checked. |
| NFR-06 | Privacy | Public APIs expose only approved candidate information and published results. |
| NFR-07 | Maintainability | Domain logic is separated into database, helper, route, and frontend layers. |
| NFR-08 | Testability | Core rules have automated tests and the suite runs in CI on Node.js 22 and 24. |
| NFR-09 | Portability | The app runs on any platform supported by Node.js 22.5+ with no external database server. |
| NFR-10 | Auditability | Result snapshots preserve vote totals and publication timestamps. |

## 7. Business rules and constraints

1. A voter may vote once per election round.
2. Only approved candidates appear on the ballot.
3. A candidate must be advanced to appear in the second round; the second round advances the top eight.
4. Results remain hidden until publication.
5. The number of elected candidates must not exceed the configured seats; a tie at the seat boundary is reported rather than broken arbitrarily.
6. Administrator actions require an administrator session; administrator accounts cannot apply as candidates or vote.
7. Nomination editing is locked after the nomination deadline, approval, or rejection.
8. The system does not currently enforce the free-text `eligible_group` field; eligibility is account-level.
9. Self-registration currently grants eligibility. A production deployment must verify the electoral roll.

## 8. Use cases

### UC-01 Register and log in

- **Actor:** Visitor
- **Precondition:** None
- **Main flow:** Register with valid details, log in, receive a session cookie, and view the dashboard.
- **Alternate flow:** Duplicate username, invalid password, or invalid email is rejected with a message.

### UC-02 Submit a nomination

- **Actor:** Eligible voter
- **Precondition:** Nominations are open and the voter has no nomination in the election.
- **Main flow:** Complete the form, upload an optional picture, confirm the declaration, and submit for review.
- **Alternate flow:** Duplicate nomination, closed window, ineligible account, or invalid image is rejected.

### UC-03 Vote

- **Actor:** Eligible voter
- **Precondition:** Voting is open, the voter is eligible, and the voter has not voted in the round.
- **Main flow:** Select an approved candidate, review the choice, confirm, and receive a vote reference.
- **Alternate flow:** Already voted, ineligible, closed window, wrong round, or invalid candidate is rejected.

### UC-04 Review nominations

- **Actor:** Administrator
- **Precondition:** Administrator session.
- **Main flow:** Open the pending list, inspect a nomination, and approve, reject, or return it.

### UC-05 Count and publish

- **Actor:** Administrator
- **Precondition:** Voting is closed and accepted votes exist.
- **Main flow:** Review totals and turnout, publish results, and store the frozen result snapshot.
- **Alternate flow:** Voting still open, no approved candidates, or no votes is rejected.

### UC-06 Advance finalists

- **Actor:** Administrator
- **Precondition:** Two-round election in the first round.
- **Main flow:** Change the stage to Second round; the system advances the top eight, including boundary ties.
- **Alternate flow:** Eight or fewer approved candidates, or an invalid stage transition, is rejected.

## 9. Requirements validation checklist

- **Validity:** Each requirement maps to a user story or business rule.
- **Consistency:** No requirement permits a second vote in the same round or a vote for a non-approved candidate.
- **Completeness:** All implemented API routes and pages are covered by FR-01 to FR-28.
- **Realism:** The stack (Node.js, SQLite, vanilla SPA) supports the requirements without external services.
- **Verifiability:** Each Must requirement has an automated test or a documented manual acceptance step.

## 10. Traceability matrix

| Requirement | Automated test | Notes |
|---|---|---|
| FR-01, FR-02 | Test 1, unit validation tests | Duplicate username and format checks |
| FR-03, FR-04, FR-06 | Test 1, unit password tests | Session and password behaviour |
| FR-05 | Test 3, Test 4 | Voter denied administrator routes |
| FR-08 to FR-10 | Test 2, Test 3 | Creation, edit, dates, slug |
| FR-11, FR-12 | Test 4 | Nomination limits and deadline |
| FR-13 | Test 4 | Approval and administrator review |
| FR-14 | Manual/API validation | Image format and size checks |
| FR-15, FR-16 | Test 5 | Eligibility and duplicate prevention |
| FR-17, FR-18 | Test 5, Test 7 | Windows, approved candidates, round restrictions |
| FR-19 | Test 6 | Counting and ties |
| FR-20, FR-21, FR-23 | Test 6 | Publication gating and frozen results |
| FR-22 | Test 8 | Multi-seat publishing |
| FR-24, FR-25 | Test 9, Test 6 | Invalid transitions and open-voting guard |
| FR-26 | Test 11 | Health endpoint |
| FR-27, FR-28 | Configuration review | Startup and demo-mode behaviour |

## 11. Known limitations and future requirements

- Eligibility groups are descriptive only; there is no per-election voter roll.
- Self-registration marks accounts as eligible.
- Ballots are stored with voter IDs; database administrators can link a voter to a candidate.
- There is no administrator audit log.
- There is no schema migration framework.
- There is no browser end-to-end or load-test suite.
