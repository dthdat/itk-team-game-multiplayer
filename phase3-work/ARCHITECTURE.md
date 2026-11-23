# ITK-BGSV Phase 3 architecture

> **Current-state pointer:** This document contains dated architecture and rollout snapshots. Use [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) for the latest documented production Worker/backend versions, configuration, and verification. Its latest entry is dated 2026-11-12; verify live state before making operational changes. Older states below are historical.

## AI release — 2026-11-12

The production AI grading release and later movement fixes are recorded in [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md) and [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md). Older version identifiers and pending-only descriptions below document earlier staging and rollout states; they are not authoritative for current production.


## Verified staging state

Staging is live at https://game-staging.itkvn.workers.dev. The current Worker version is 7e59219d-a6ce-46b7-9540-fea677019d56, deployed with Wrangler 4.160.0 on 2026-11-11. The matching public assets were fetched and SHA-256-compared with the local release candidate. The staging root and /api/session return HTTP 200; direct unauthenticated requests to api-staging.itkteam.store return Access HTTP 403.

The Oracle staging Node service listens only on 127.0.0.1:3001 and uses a dedicated SQLite database. Its systemd service is active with zero restarts at the latest check. The daily staging backup completed and the resulting SQLite snapshot passed verification. Groq is disabled, submissions remain pending, and no XP is awarded.

Production uses the same-origin API/WSS proxy and a dedicated Oracle backend through the production Access-protected Tunnel route. Refer to PRODUCTION-DEPLOYMENT-STATUS.md for the current version and latest public guest, movement, persistence, and restart checks.

## Request path

The browser downloads the original Three.js office and local vendor assets from Workers Static Assets. Selective Worker-first routing sends only /api/* and /ws through the Worker handler. The handler forwards those requests over HTTPS to the Access-protected staging Tunnel hostname; cloudflared forwards to the localhost-only Node server. The browser uses the workers.dev origin for both HTTP and WSS and never receives a service token or proxy secret.

The Worker strips client-supplied proxy and Access headers, injects its protected Worker secrets, and forwards the game session cookie, Origin, and CSRF header. The Node server verifies the shared proxy secret and exact public game origin. The owner manually verified that the staging Access application has only a Service Auth policy selecting the staging Worker token, with no Allow or Bypass policy. The existing SSH route remains separate and unchanged.

## Guest identity, profile, and progress

The public game uses guest entry; sign-in is not required or shown in the game flow. The server generates a random UUID identity and a separate 256-bit opaque session token. Only a hash of that token is stored in SQLite. The Secure, HttpOnly, SameSite=Strict cookie authenticates the guest; the display name is never an authentication credential. Duplicate display names receive distinct identities.

The browser remembers the display name and language in localStorage. The backend stores the guest profile, saved position, submissions, and progress against the cookie identity. Reloading in the same browser restores that guest. Guest sessions currently expire after 30 days; clearing the site cookie loses the link to the server-side guest record. Guest progress does not follow a player to another browser.

All eight mission briefs remain open. Answers are stored server-side as pending submissions. AI grading is disabled, no mock review is presented as verified, and no XP is awarded. The leaderboard reads only server-owned verified XP, which remains zero. The player panel shows progress, submission history, and the verified-XP leaderboard. Existing account APIs and database tables remain for future use but are not required by the staging UI.

## Multiplayer and controls

The existing Node WebSocket room remains authoritative. A validated guest cookie and same-origin upgrade determine identity. The server validates positions, movement speed, bounds, collisions, sequence numbers, message rates, heartbeat, and duplicate connections. A welcome packet includes the full current roster, so late joiners see stationary players. Nine local NPCs remain separate from online players.

The frontend sends movement changes at up to 10 Hz. The room coalesces and broadcasts movement at 10 Hz; remote avatars interpolate timestamped samples and animate their arms and legs. Jump is available with Space on desktop and a localized button on touch devices; vertical movement is synchronized with a server cap of 1.5 metres and does not affect progress or XP. No chat exists.

## Recovery and release limits

The existing daily local SQLite snapshots are verified, and automated restore tests use disposable databases. No cloud-storage, encryption, or off-host backup integration is planned for this demo. Catastrophic host or disk loss may erase demo player progress; that risk is accepted.

Public guest-flow, restart-persistence, movement interpolation, jump, language, mission, mobile-control, and browser-error checks passed with synthetic staging data. A 70-player public load test has not been run. The test environment is Oracle itself, the requested generator must be outside Oracle, and current account-wide Workers quota headroom has not been confirmed. See LOAD-TEST-RESULTS.md.

Production deployment and movement recovery are recorded in PRODUCTION-DEPLOYMENT-STATUS.md. The controlled external public 70-player load test remains outstanding; localhost tests do not establish public capacity. Local-only backup is accepted for this demo.
