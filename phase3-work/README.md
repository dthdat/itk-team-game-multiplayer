# ITK-BGSV Prompt Works — Phase 3

This directory contains the active full game implementation: the Three.js office and missions, guest experience, Node.js API and WebSocket server, SQLite persistence, Cloudflare Worker proxy, tests, deployment templates, and operational notes.

## Current release state

The latest documented production release, its verification, and rollback details are recorded in [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md). The latest entry is dated 2026-11-12; verify live Worker and backend state before relying on a version identifier or claiming current availability. Older sections in architecture and deployment notes are dated rollout records and may describe superseded states.

Production has the Groq grading integration described in [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md). Local development defaults to mock grading; mock results do not award verified XP. Staging configuration and data are separate. Never copy production credentials or data to a development environment.

The game includes the 3D engineering office, nine local NPCs, eight missions, English and Vietnamese, keyboard and mobile controls, jump, guest progress, same-origin API/WebSocket requests, and remote-player interpolation. The guest display name is remembered in the browser. The backend creates an opaque guest identity cookie; a display name is not a credential.

## Requirements and automated checks

Use Node.js 24.7 or newer and npm.

```sh
npm ci
npm test
```

The test command builds the TypeScript service and runs the automated test suite against isolated data. Do not point tests at production. `npm run test:browser` runs local browser checks and needs its documented browser runtime. `npm run load` runs the bounded local mock-service load test; it is not evidence of public-path capacity. The prepared Windows runner for external staging tests is in [windows-load-test/README.md](windows-load-test/README.md).

## Source layout

- `index.html` — game scene, controls, NPCs, and mission display source.
- `cloudflare-game/phase3-ui.js` — guest sessions, mission progress, player roster, connection state, and account UI integration.
- `cloudflare-game/mission-templates.json` and `mission-template-history.json` — bilingual mission answer scaffolds.
- `cloudflare-game/prepare.mjs` — builds the deployable `cloudflare-game/public/` static bundle from the source and local Three.js dependency.
- `cloudflare-game/src/worker.js` — Worker proxy for `/api/*` and `/ws`.
- `server/` — Node.js HTTP API, accounts, SQLite store, grading adapter/queue, and authoritative WebSocket room.
- `tests/` — backend, database, protocol, Worker proxy, and grading tests.
- `deploy/` — systemd, journald, and local backup templates.
- `tools/` — admin utilities and local verification/load scripts.

After editing game or UI sources, regenerate the static bundle from `cloudflare-game/`:

```sh
npm ci
npm run prepare:assets
```

Review `cloudflare-game/verification/asset-manifest-production.json` before a release. Do not put secrets, database files, or production environment settings in `cloudflare-game/public/`.

## Local development

Start the backend from this directory after building or testing it:

```sh
npm start
```

It binds to `127.0.0.1:3000` by default. For persistent local development, configure a disposable `.env` using `.env.example` as a reference and change paths/host settings for your machine. Keep `GRADING_PROVIDER=mock` unless a separately approved task explicitly enables a provider.

For Worker static preview and integrated local proxy instructions, read [cloudflare-game/README.md](cloudflare-game/README.md). The basic static preview does not verify multiplayer, saved progress, or grading. Use only local placeholder secrets; never use staging or production Worker secrets.

Optional account administration commands are available for the account APIs but are not required for the guest-first game:

```sh
npm run admin:invite -- issue 168
npm run admin:invite -- revoke INVITE_CODE
npm run admin:invite -- recover LOGIN_ID
```

Recovery creates a temporary password that must be delivered privately. Do not paste credentials or real player submissions into issues, test output, or documentation.

## Data, AI, and deployment boundaries

- SQLite databases, backups, and protected environment files stay outside Worker assets and Git.
- The browser uses only the game Worker origin. The backend stays on localhost behind the approved Tunnel and Access configuration.
- The Node server owns sessions, progress, movement validation, reviews, XP, and leaderboard results.
- Mock or failed grading never awards production XP. The live production provider is controlled by protected backend configuration.
- Daily local SQLite backups are used for the demo. Catastrophic host/disk loss of demo progress is an accepted risk.
- The public 70-player capacity test is not documented as passed. Read [LOAD-TEST-RESULTS.md](LOAD-TEST-RESULTS.md) for the measured evidence and remaining uncertainty.
- Do not run deploy scripts, change Worker `game`, production backend/data, DNS, Tunnel, Access, SSH, firewall, telemetry Workers, or billing without explicit owner approval.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the contributor workflow and [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) for deployment history, templates, and safety checks.
