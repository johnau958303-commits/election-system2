# Threat model

Scope: the voter-facing site, the administrator console and the JSON API exposed by `server.js`.

## Assets

- Ballots in `votes` (voter identity and choice)
- Published result snapshots in `result_entries`
- Voter-roll entries, one-time codes and email status
- Account credentials, sessions and email verification state
- Election configuration and candidate data
- Audit log entries

## Actors and trust boundaries

| Actor | Trust |
|---|---|
| Anonymous visitor | Untrusted; may read public election data and register |
| Verified voter | Authenticated; may vote once per round and manage their nomination |
| Administrator | Authenticated; may configure elections, review candidates and publish results |
| Reverse proxy / tunnel | Trusted only when `TRUST_PROXY` is configured |
| Email provider (Resend) | External processor for addresses and one-time codes |
| Google identity provider | External identity source for Google Sign-In |

## Key threats and mitigations

| Threat | Impact | Mitigation |
|---|---|---|
| Stored XSS through candidate fields | Session theft, ballot manipulation | Server-side length/format validation, escaped HTML sinks, strict CSP (`script-src 'self'`) |
| Candidate picture URL injection | Script execution in the ballot page | URLs are parsed and canonicalised; quotes/control characters are rejected; frontend escapes attributes |
| CSRF against state-changing APIs | Unauthorised vote or admin action | JSON-only bodies, `SameSite=Lax` cookies, Origin/Host check on non-GET requests |
| Credential stuffing / brute force | Account takeover | scrypt hashes, generic login errors, per-IP/username throttle |
| Email bombing and account spam | Provider abuse, denial of service | Per-IP limits on registration and verification resends; per-account cooldown |
| Verification-code brute force | Account takeover | HMAC-SHA256 hashes with a server secret, 15-minute TTL, 5 attempts per code |
| Voter code sharing | Ballot stuffing | Code binds to the first matching account, works once per round, can be revoked |
| Duplicate voting | Incorrect result | `UNIQUE (election_id, round, voter_id)` database constraint |
| Round or stage bypass | Invalid result | Server-side transition table, round-mode lock, publish guards |
| Published results tampering | Loss of trust | Result entries are written in a transaction; every stage change is audit-logged |
| Database theft | Password/code cracking, ballot privacy loss | Scrypt password hashes, HMAC code hashes, file permissions, encrypted off-host backups |
| Malicious admin | Undetected changes | Audit log with actor, action and detail; immutable result entries until explicitly republished |
| Proxy header spoofing | Rate-limit bypass, wrong client IP | `TRUST_PROXY` is opt-in and should match the deployed topology |
| Dependency compromise | Supply-chain attack | Lockfile, Dependabot updates, CI tests on Node 22 and 24 |

## Residual risks

- Ballots are stored with voter IDs. Database administrators can link voters to choices; ballot secrecy from DB operators is not provided.
- In-memory rate limits reset on restart and are not shared between instances.
- A single administrator can publish or republish results; separation of duties is not enforced.
- Published results can be withdrawn by an administrator for corrections. The change is audited but prior snapshots are not versioned.
- Email delivery depends on a third-party provider; delivery failure is surfaced but not retried automatically.
- Tie handling marks boundary candidates as tied and leaves the seat unfilled; a human decision is required.

## Security testing checklist

- Attempt HTML/attribute injection through every candidate text and URL field.
- Send cross-origin POST requests with and without cookies.
- Replay expired sessions, malformed cookies and invalid verification codes.
- Verify non-admin access to every `/api/admin/*` route.
- Confirm registration, resend and login limits trip under sustained requests.
- Inspect response headers for CSP, HSTS, `X-Content-Type-Options`, frame protection and `Cache-Control: no-store`.
- Restore a backup into a clean directory and verify results and audit history.