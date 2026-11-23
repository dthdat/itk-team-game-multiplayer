# Phase 3 security status

> **Current-state pointer:** This file includes dated security reviews. Use [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) for the latest documented deployment and verification. Older staging-only findings below describe the environment and date in their section, not current production state.

## AI release — 2026-11-12

The production grading and movement releases are recorded in [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md) and [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md). Older version identifiers and staging-only conclusions below are historical.


## Staging security review — 2026-11-11

The isolated staging deployment is live at https://game-staging.itkvn.workers.dev. The Node service listens only on 127.0.0.1:3001, runs under the unprivileged promptworks-staging account, and uses a separate staging SQLite database. Its protected environment file and database are outside static assets. Direct unauthenticated requests to api-staging.itkteam.store are denied with HTTP 403 by Cloudflare Access; Worker-mediated game API access succeeds.

The owner manually confirmed that the staging Access application is scoped to api-staging.itkteam.store and has a Service Auth policy selecting only itk-game-staging-worker, with no additional Allow or Bypass policy. The Worker has exactly the four expected secret bindings. Secret values were not read or printed during this review.

The public asset scan found five files: game-config.js, index.html, phase3-ui.js, and the local Three.js library plus license. It found no environment files, databases, keys, credentials, API keys, proxy secret patterns, or Access secret patterns. All five public assets matched the currently served staging assets byte-for-byte. Groq remains disabled, pending submissions award zero XP, and the production backend/database were separately installed after approval on 2026-11-12; production public routing, Worker, SSH and firewall remain unchanged.

## Guest identity and session protection

- The backend generates a random UUID for a guest identity and a separate 256-bit opaque cookie token. SQLite stores only the token hash. Display names are profile data and are not credentials.
- Cookies are Secure, HttpOnly, SameSite=Strict, and scoped to the game origin. The Worker preserves game session cookies and strips the upstream CF_Authorization cookie.
- Mutating API calls require the exact public Origin and a session CSRF token. WebSocket upgrades require a valid guest/account cookie and matching Origin.
- The Worker strips client-supplied proxy and Access headers, then injects its secrets. Node verifies the proxy secret with constant-time comparison and checks the forwarded public Origin.
- Guest sessions expire after 30 days. The remembered display name is stored in localStorage; server progress is keyed by the opaque guest session, not by that name. Clearing the cookie loses access to that guest's server-side progress.
- Account registration/login APIs remain protected for future use, but registration is not required or shown in the staging guest flow.

## Server and data protections

- Zod validates profile, submission, account, and WebSocket payloads. SQL uses prepared statements. Request bodies and WebSocket frames are size-limited.
- Movement is server-validated for sequence, world bounds, collision path, speed, and message rate. The server ignores client-supplied identity and XP. Duplicate identities replace the older socket; stale or slow peers are closed.
- Submission IDs, ownership, state, score, XP, and leaderboard results are server-controlled. Submissions are pending only. No mock result can award XP. Reference answers remain visible in the training game, so it is not a proctored exam.
- Passwords for optional account APIs use Argon2id. Login errors are generic; invitation tokens and sessions are random and stored as hashes. Account export excludes credentials, and account deletion is transactional.
- The application does not log request bodies, passwords, player answers, cookies, proxy secrets, or service-token headers. Staging uses a bounded journald namespace; current staging limits are 64 MiB persistent and 16 MiB runtime.

## Data protection and known limits

SQLite and local backups contain demo answers as plaintext and are protected by filesystem permissions. The existing daily local SQLite backup and isolated restore tests pass. This demo will not add cloud-storage or encryption integrations. The owner accepts that catastrophic host or disk loss can erase demo progress; do not store sensitive personal or corporate information in answers.

The 70-player public load test and current account-wide Cloudflare quota headroom are unverified. Do not claim 70-player capacity. The dedicated production localhost backend is installed with a new database schema; no existing database was migrated. Public cutover and guest/WSS verification completed on 2026-11-12. Direct unauthenticated origin access returns 403. See PRODUCTION-DEPLOYMENT-STATUS.md.

## Remaining verification

The controlled external public 70-player load test remains unverified. Consult [LOAD-TEST-RESULTS.md](LOAD-TEST-RESULTS.md) and the latest deployment status before making capacity or release-readiness claims. Local SQLite backups are sufficient for the demo; catastrophic host or disk loss of demo progress is an accepted risk.
