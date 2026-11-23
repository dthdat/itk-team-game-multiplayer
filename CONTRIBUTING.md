# Contributing

Thanks for helping with ITK-BGSV Prompt Works. The repository has both an original baseline and a later Phase 3 implementation. Start in `phase3-work/` unless you are specifically fixing the original baseline.

## Find the right source file

| Work area | Edit here | Main checks |
| --- | --- | --- |
| 3D office, NPCs, controls, mission presentation | `phase3-work/index.html` | `npm test`; browser flow |
| Guest/progress/mission UI, player list, status | `phase3-work/cloudflare-game/phase3-ui.js` | `npm test`; browser flow |
| Mission answer starter text | `phase3-work/cloudflare-game/mission-templates.json` and `mission-template-history.json` | `npm test`; bilingual browser check |
| Static asset generation and local Three.js | `phase3-work/cloudflare-game/prepare.mjs` | `npm run prepare:assets` |
| Worker routing, cookies, Access service auth, WSS proxy | `phase3-work/cloudflare-game/src/worker.js` | Worker proxy tests and local HTTP/WSS checks |
| HTTP API, session and guest handling | `phase3-work/server/index.ts` and `accounts.ts` | API/account tests |
| SQLite schema and persistence | `phase3-work/server/store.ts` | migration, persistence, and backup tests |
| Multiplayer protocol and movement authority | `phase3-work/server/protocol.ts` and `room.ts` | protocol and WebSocket tests |
| Grading and XP validation | `phase3-work/server/grader.ts`, `grading-provider.ts`, `grading-jobs.ts` | grading tests; keep mock behavior honest |
| Deployment service and backup templates | `phase3-work/deploy/` | inspect generated units and documentation; never install on production as part of a code change |

The contents of `phase3-work/cloudflare-game/public/` are prepared deployment output. Prefer editing its source files and running `npm run prepare:assets` from `phase3-work/cloudflare-game/`; then review the generated changes. Do not edit generated files by hand unless the source generator cannot represent the required change.

## Local setup

Use Node.js 24.7 or newer for the current Phase 3 code.

```sh
cd phase3-work
npm ci
npm test
```

The backend uses local mock grading by default. For a local server, use a disposable database and a `.env` created from `phase3-work/.env.example`; edit paths and host settings for your machine. Do not use a production database path or production environment file.

The Worker package has its own lockfile:

```sh
cd phase3-work/cloudflare-game
npm ci
npm run prepare:assets
npm run dev
```

This preview serves the frontend. It does not verify the backend or multiplayer. For the integrated local proxy, follow `phase3-work/cloudflare-game/README.md`; use only fresh local placeholder credentials shared between the local Worker and local Node process. Never use Cloudflare production or staging secrets locally.

## Change workflow

1. Create a focused branch from the latest project branch.
2. Make the change in `phase3-work/` and keep generated output reproducible.
3. Add or update a test for behavior that can regress.
4. Run `npm test` from `phase3-work/`. For game UI or Worker changes, also run the appropriate local browser/proxy check documented by the project.
5. Update the relevant architecture, protocol, security, or deployment notes when behavior changes.
6. Review `git diff --check` and `git status`. Confirm no local data or secrets are staged.
7. Describe what changed, the checks actually run, and any unverified behavior in the commit or pull request.

Automated tests use Node's built-in test runner. Browser and load checks may require additional runtimes and must use synthetic data. Never describe a localhost-only test as public production verification. For load testing, follow `phase3-work/windows-load-test/README.md` and honor its concurrency, duration, and quota safeguards.

## Security and privacy rules

- Do not commit `.env`, `.dev.vars`, Worker state, SQLite files, backups, tokens, passwords, private keys, or service credentials.
- Do not log passwords, session cookies, proxy credentials, player answers, or AI API keys. Test with synthetic answers only.
- Do not add client-side provider credentials or a direct browser connection to the Oracle API hostname.
- The display name is profile text, not proof of identity. Guest identity comes from a backend-generated opaque session.
- XP, reviews, and leaderboard data must remain server-owned. Mock grading must never be presented as a real review or award production XP.
- Keep the browser on same-origin `/api/*` and `/ws` routes. Keep the Node service bound to localhost behind the approved Tunnel and Access protection.
- Do not add chat or collect personal data that the game does not need.

## Release and production boundaries

The latest documented production and rollback state is in `phase3-work/PRODUCTION-DEPLOYMENT-STATUS.md`; that file is a dated operational snapshot and must be verified before use. The `deploy` and Wrangler scripts can affect live services. Code contributors should not run them against staging or production unless the owner has explicitly approved the exact action. Do not change production Worker `game`, Cloudflare DNS/Tunnel/Access settings, Oracle services or data, SSH, firewall, or billing as part of ordinary development.

Keep phase3 docs factual: separate automated local results from staging and production results, include the date and target, and call out incomplete tests. Use the release status file as the current deployment reference; older rollout notes are historical evidence, not a guarantee of present state.
