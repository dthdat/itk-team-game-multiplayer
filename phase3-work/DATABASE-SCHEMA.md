# SQLite schema

The service uses Node.js `node:sqlite` and one SQLite database outside the
Worker assets directory. The production example path is
`/var/lib/prompt-works/game.sqlite`; the server creates the parent directory,
sets the main database file to mode `0600`, enables WAL and foreign keys, and
uses a 5-second busy timeout. There is no database file in the deployment
assets.

## Tables

| Table | Purpose and retention |
|---|---|
| `guests` | Canonical player/progress owner row. Stores random owner ID, hash of the opaque guest token, CSRF token, display name, discipline, and expiry. Guest rows expire after 30 days; an account's linked row is extended while its account remains active. |
| `users` | Account row keyed to the same `guests.id`. Stores normalized unique login ID, Argon2id password hash, display name, discipline, JSON avatar preferences, active/disabled status, timestamps, and forced password-change flag. No email or corporate identity is requested. |
| `account_sessions` | SHA-256 token hash, user ID, CSRF token, creation/expiry, and revocation timestamp. Browser token is never stored. Session lifetime is 30 days; expired and revoked rows are pruned. |
| `invitations` | SHA-256 invitation token hash, expiry, revocation/use timestamps, and consuming user. Codes are single use. Old used or revoked records are pruned after 90 days. |
| `results` | Server-verified score and XP by player and mission. This is the sole leaderboard XP source. In Phase 3 grading is disabled, so the public submission path never inserts verified rows or awards XP. |
| `mission_submissions` | UUID submission ID, owner, mission, answer text and hash, state, optional score/XP/result, and timestamps. Duplicate IDs are idempotent for identical content and conflict for changed content. Pending/failed/retryable rows are pruned after 90 days. |
| `attempts` | Legacy mock/review idempotency record. Stores answer hash and response, not submitted answer text. Pruned after 30 days. Mock results are unverified and award zero XP. |
| `player_positions` | One validated x/z/yaw snapshot per player. Replaced in place; no high-frequency movement history. Deleted with the owner row. |
| `quotas` | Expiring rate-limit counters. Keys contain hashed client/login identifiers or random user IDs, never plaintext passwords or session tokens. Expired counters are pruned. |
| `usage` | Legacy provider token/cost counters. No paid provider is enabled or contacted in this phase. |
| `schema_migrations` | Applied account/submission/position migration versions with timestamp. Each migration and version record commits in one SQLite transaction. |

The store also indexes account-session owner/expiry, submissions by owner/date
and owner/mission/state, and legacy attempts by owner/mission/answer hash.
Foreign keys cascade account deletion to sessions, results, attempts,
submissions, and saved position. An invitation's `used_by` reference is nulled
when its account is deleted.

## Migrations

`server/accounts.ts` applies migrations in order. Current versions are:

1. Accounts, sessions, invitations, and the session index.
2. Pending submissions and owner/history indexes.
3. Saved player positions.
4. Forced password-change state for administrator recovery.

Every migration uses `BEGIN IMMEDIATE`; DDL and its version row roll back
together. There are no destructive down-migrations. To reverse a schema change,
stop the service and restore a verified pre-migration backup. Automated tests
cover repeat application and synthetic migration failure rollback.

## Transactions and integrity

Invitation consumption and account creation, login-session creation, submission
insertion, account deletion, and legacy result commits use write transactions.
SQLite foreign keys are enabled on every connection. Submission input is schema
validated on the server; mission identity, duplicate detection, quota, and
profile eligibility are server-owned. The database unique key prevents duplicate
submission IDs for an owner. No client field can choose score or XP.

## Sensitive data and retention

Passwords use Argon2id and are never returned by export. Session and invitation
tokens are random and only their hashes are stored. Submission answers are
plaintext in SQLite because a future grader must read them; protect the
database directory and local backups with restrictive file permissions. The
database is not encrypted by SQLite itself. This is a demo, and catastrophic
host/disk progress loss is accepted; no cloud backup or encryption integration
is required. Automated backup and restore files are created with mode 0600.

Account export includes profile, verified progress, submissions, and legacy
attempt history. Account deletion removes the linked guest row and cascades all
account records in one transaction. Expired guest data and pending submissions
are pruned by the room's periodic maintenance. Current default retention is 30
days for guest sessions and legacy attempts, 90 days for unresolved submissions
and old invitations, and no automatic expiry for an active account's profile,
verified progress, or graded submissions. Review these periods before public
operation.

## Backup and restore

Use the online `VACUUM INTO` backup helper; it verifies `integrity_check` and
`foreign_key_check`, sets mode `0600`, and prunes backups older than the configured
retention. Restore verifies the source, refuses to replace a database unless
`--force` is supplied, requires the service stopped with no WAL/SHM sidecars,
creates a safety backup of an existing target, then atomically replaces it.
See [BACKUP-RESTORE.md](BACKUP-RESTORE.md). A nonproduction backup/restore test
preserves account, pending answer, and saved position data.

## Migration 5 — durable AI review and token accounting

mission_submissions gains locale (en default), grading_enabled (0 default), grading_attempts (0), next_attempt_at (0), lease_token, lease_until (0), and error_code. Existing submissions stay ineligible for provider calls. The queue index covers grading_enabled/state/retry/lease fields.

grading_budget has window primary key, reserved/settled tokens and call count. Windows are UTC day and minute. grading_reservations associates a lease token with its original day/minute windows and estimated token reservation. Valid results settle to actual token usage in the same transaction as review and XP; failed/interrupted calls retain a conservative budget charge. Expired metadata is bounded and pruned.

Completion checks lease ownership and guest existence before writing mission_submissions.result/score and results. Results retain per-mission best score/XP. Submission XP records only the positive improvement. The user's discipline and server mission XP determine the 20% bonus and maximum. A stale, duplicate, mock or invalid result cannot write XP. Reset/delete invalidates outstanding jobs transactionally. Daily submission quotas remain in quotas across progress resets.

Migration 5 is additive. Code rollback retains its schema and results; do not run a destructive schema downgrade. Existing local backups and nonproduction restore tests remain the recovery mechanism.
