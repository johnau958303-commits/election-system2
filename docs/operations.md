# Operations runbook

This runbook covers deployment, health checks, backups and routine maintenance.

## Runtime requirements

- Node.js 22.13 or newer (Node.js 24 is used in CI)
- A persistent directory for `data/election.db` (plus SQLite WAL sidecars)
- An HTTPS reverse proxy or tunnel for production
- Optional: Resend account and a verified sender for email delivery
- Optional: Google OAuth client for Google Sign-In

## Environment

Set at minimum:

```powershell
$env:NODE_ENV = 'production'
$env:DB_PATH = 'data/election.db'
$env:VOTER_CODE_SECRET = '<long random value>'
$env:PUBLIC_BASE_URL = 'https://elections.example.org'
$env:TRUST_PROXY = '1'
```

Add `EMAIL_MODE=resend`, `RESEND_API_KEY` and `MAIL_FROM` for real email. Add the Google variables for Google Sign-In. Never enable `DEMO_MODE` in production; the server refuses to start if both are set.

## Start and stop

```powershell
npm ci --omit=dev
npm start
```

The process handles `SIGINT` and `SIGTERM` by closing HTTP connections and the SQLite handle. Give it up to 10 seconds before forcing termination.

## Health check

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

A healthy response is `{ "ok": true, "database": "ok", ... }`. A `503` means the database cannot be queried. Do not route traffic to the instance until it is healthy.

## Backups

Create a consistent snapshot while the server is running:

```powershell
npm run backup
# or choose a destination
npm run backup -- D:\backups\election-2026-06-01.db
```

`VACUUM INTO` writes a compact database snapshot without copying an in-flight WAL. The command refuses to overwrite an existing file.

Store snapshots off-host and encrypted. Retain at least one snapshot from before every election stage change that alters the voter roll or publishes results.

### Restore

1. Stop the server.
2. Move the current `data/election.db`, `election.db-wal` and `election.db-shm` aside.
3. Copy the snapshot to `DB_PATH`.
4. Start the server and run the health check.
5. Confirm the election list and audit log in the administrator console.

## Routine maintenance

- Before an election: verify `/api/health`, take a backup, confirm email delivery, and test one voter-roll code end to end.
- During an election: monitor disk space and the application log. Rate limits are in memory; restarting clears them.
- After an election: export the audit log and final results, take a backup, and restrict access to the database file.
- Weekly: review dependency update pull requests from Dependabot and run `npm test`.

## Rate limits

| Action | Default limit |
|---|---|
| Login | 10 attempts per 10 minutes per IP and username |
| Registration | 30 per hour per IP |
| Email verification | 30 per 15 minutes per IP |
| Resend verification | 10 per hour per IP |
| Nomination submit/edit | 30 per 10 minutes per IP and user |

Set `DISABLE_RATE_LIMIT=true` only for load tests. Limits are not shared between processes; run a single instance or put a shared limiter in front of multiple instances.

Changing `EMAIL_CODE_SECRET`, `VOTER_CODE_SECRET` or `SESSION_SECRET` invalidates outstanding verification codes and voter codes. Rotate secrets between elections and ask affected users to request new codes.

## Troubleshooting

| Symptom | Check |
|---|---|
| Server exits at startup | `NODE_ENV=production` without `VOTER_CODE_SECRET`/`SESSION_SECRET`, or `DEMO_MODE=true` in production |
| Health returns 503 | Database path permissions, disk space, or a locked database file |
| Login cookie is not stored | HTTPS termination and `TRUST_PROXY`; the session cookie is `Secure` in production |
| Emails are not delivered | `EMAIL_MODE`, `RESEND_API_KEY`, `MAIL_FROM`, and the request timeout log entry |
| Audit page is empty | No administrator actions have been recorded for that election yet |