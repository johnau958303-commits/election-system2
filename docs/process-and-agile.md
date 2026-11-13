# Software Process and Agile Plan

## 1. Process model

The project uses a **hybrid incremental process**:

- **Plan-driven where correctness matters:** the election data model, vote uniqueness, round rules, and result publication are specified and validated before release.
- **Agile where requirements evolve:** the browser UI, wording, dashboard layout, and candidate presentation are refined through short iterations and review.

This matches the lecture guidance that most real projects combine plan-driven and agile elements rather than following a pure waterfall or pure agile model.

## 2. Process activities

| Activity | Inputs | Outputs |
|---|---|---|
| Specification | Stakeholder needs, election rules | User stories, requirements, acceptance criteria |
| Design | Requirements, constraints | Data model, API design, architecture, UI flow |
| Implementation | Design, tasks | Working routes, pages, schema, seed data |
| Validation | Requirements, test plan | Unit tests, API tests, manual acceptance |
| Evolution | Feedback, defects, new needs | Backlog items, schema changes, UI improvements |

These activities are interleaved. A change to a voting rule may touch the requirement, the schema, a helper, a route, the UI, and the tests in the same iteration.

## 3. Roles

The team division of work maps to the following process roles:

| Role | Responsibility |
|---|---|
| Product owner | Prioritizes features and represents student and administrator needs |
| Scrum master / facilitator | Runs ceremonies, removes blockers, protects the team from disruption |
| Developers | Implement database, auth, domain, routes, and frontend |
| QA / test owner | Maintains the test plan, regression suite, and acceptance record |
| Technical reviewer | Reviews security, data integrity, and architecture decisions |
| Stakeholders | Students, candidates, administrators, and the election committee |

For a solo or small-team version, one person can hold multiple roles, but the responsibilities should still be explicit.

## 4. Product backlog

### Epics

1. **Accounts and access** — registration, login, sessions, roles.
2. **Election setup** — dates, seats, rules, entry mode, rounds.
3. **Nominations** — submission, editing, review, approval.
4. **Voting** — eligibility, round windows, ballot, receipt.
5. **Results** — counting, ties, multi-seat, publication.
6. **Administration** — dashboard, candidate management, lifecycle.
7. **Quality** — tests, CI, documentation, security hardening.

### Prioritized backlog

| Priority | Item | Acceptance criteria |
|---|---|---|
| Must | Student registration and login | Duplicate usernames rejected; session works after login |
| Must | Election creation and scheduling | Dates validated; unique slug; rules stored |
| Must | Nomination workflow | One nomination per student; edit before deadline; admin review |
| Must | Vote casting | Eligible voter, open window, approved candidate, one vote per round |
| Must | Counting and publishing | Turnout, tie detection, frozen snapshot, hidden before publication |
| Must | Two-round support | Top eight advance; second-round vote restricted |
| Must | Role-based access | Students cannot access administrator APIs |
| Should | Multi-seat publishing | Elected count respects seats; boundary tie reported |
| Should | Stage transition validation | Invalid lifecycle jumps rejected |
| Should | Automated tests and CI | Suite runs on Node.js 22 and 24 |
| Could | Audit log | Administrator actions recorded with actor and timestamp |
| Could | Per-election voter roll | Eligibility group enforced |
| Could | Frontend module split | `app.js` split into core, student, and admin files |
| Could | Stable deployment | Named tunnel or platform deployment |

## 5. Sprint plan

### Sprint 0 — Foundation

- Confirm stack and schema.
- Implement authentication and session handling.
- Define election and candidate data model.
- Establish the test harness and seed data.

### Sprint 1 — Core election flow

- Election creation and public election pages.
- Nomination submission and administrator review.
- Single-round voting and duplicate prevention.
- Basic counting and publishing.

### Sprint 2 — Integrity and administration

- Two-round advancement.
- Result freezing and public result pages.
- Administrator dashboard and candidate management.
- Security hardening and origin checks.

### Sprint 3 — Quality and evolution

- Multi-seat publishing.
- Stage transition validation.
- Demo/production configuration separation.
- Unit tests, coverage, CI, documentation.
- Usability and accessibility review.

Each sprint ends with a demonstrable increment, a test run, and a short retrospective.

## 6. Scrum artifacts and ceremonies

| Artifact / ceremony | Practice |
|---|---|
| Product backlog | Prioritized epics and user stories |
| Sprint backlog | Selected stories broken into technical tasks |
| Increment | Working software and updated tests |
| Sprint planning | Select backlog items and agree on acceptance criteria |
| Daily stand-up | Progress, blockers, next step |
| Sprint review | Demonstrate the increment to stakeholders |
| Retrospective | Identify one process improvement for the next sprint |
| Definition of Done | See below |

## 7. Definition of Done

A backlog item is done when:

1. The requirement and acceptance criteria are clear.
2. The implementation is complete on a feature branch.
3. Automated tests cover the normal and error paths.
4. `npm test` passes.
5. No new high-severity security issue is introduced.
6. The change is documented if it affects setup, APIs, or behaviour.
7. The change is reviewed and merged into `main`.
8. The demo or acceptance scenario has been exercised.

## 8. Extreme-programming practices

| Practice | Application in this project |
|---|---|
| User stories | Requirements are expressed as student and administrator stories |
| Small releases | Each sprint produces a demonstrable increment |
| Simple design | No framework or build step; smallest structure that satisfies the rules |
| Test-first / test-driven | New election rules should start with a failing API or unit test |
| Refactoring | Helpers and routes are improved as the schema evolves |
| Continuous integration | GitHub Actions runs tests on every push and pull request |
| Collective ownership | Backend modules are small and documented for shared maintenance |
| Sustainable pace | Work is split by module and reviewed incrementally |

Pair programming is recommended for security-sensitive changes such as vote casting, result publishing, and authentication.

## 9. Change control

1. Record the change request and the reason.
2. Identify affected requirements and business rules.
3. Assess impact on schema, APIs, UI, and tests.
4. Decide whether to accept, defer, or reject.
5. Implement on a branch with a test that proves the change.
6. Update the requirements traceability matrix.
7. Review and merge.
8. Record the change in the release notes.

Examples:

- **Add a per-election voter roll:** affects `users`, election eligibility, nomination and vote guards, admin UI, and tests.
- **Change result publication to multi-seat:** affects counting, result entries, public results, and tests.
- **Add an audit log:** affects schema, admin routes, and reporting.

## 10. Process metrics

| Metric | How to collect | Use |
|---|---|---|
| Test pass rate | CI and local test output | Release readiness |
| Line and branch coverage | `npm run test:coverage` | Find untested rules |
| Defects by severity | Defect log | Prioritize fixes |
| Lead time per backlog item | Git history and task board | Process improvement |
| Escaped defects | Issues found after demo | Improve test design |
| Build success rate | GitHub Actions | CI health |

Metrics should guide improvement, not drive it. The primary goal is a correct, trustworthy election result.

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Eligibility is not verified | Ineligible users could vote | Import an official roll; require admin approval |
| Demo credentials reach production | Unauthorized administrator access | Disable demo mode and seeding in production |
| Ballots are linkable to voters | Privacy concern | Separate ballot identity from vote content or encrypt |
| Quick Tunnel instability | Public demo fails | Use a named tunnel or hosted deployment |
| Schema drift | Data loss or failed upgrades | Add migrations and backups |
| Monolithic frontend | Hard to maintain | Split `app.js` into modules |
| Test time dependency | Flaky CI | Inject a deterministic clock |
| Single-instance assumptions | Concurrency issues at scale | Add a shared database and rate limiter |

## 12. Process improvement cycle

1. **Measure:** test pass rate, coverage, defect count, deployment failures.
2. **Analyze:** identify the weakest step (for example, security review or release testing).
3. **Change:** introduce one improvement, such as a security checklist or a new test level.
4. **Review:** compare the next iteration's metrics with the baseline.

The current improvement priorities are: deterministic tests, security configuration, per-election eligibility, auditability, and frontend modularity.
