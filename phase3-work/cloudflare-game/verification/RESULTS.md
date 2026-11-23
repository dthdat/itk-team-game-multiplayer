Latest public production release d5e0b33d-1d83-4af6-aaee-0ac44d928dd6 passed real AI-output/template/XP/WSS/browser verification; all five static asset hashes matched. See ../../reports/ai-browser-production.json.

Current AI release: production 6dc3204f-2cfe-4813-a6a6-f0600991051b passed public AI/XP/template/WSS/restart verification on 2026-11-12. See ../../PRODUCTION-DEPLOYMENT-STATUS.md and ../../reports/ai-browser-production.json. Earlier release records below are historical.

# Current release and verification record — 2026-11-11

## Production Worker

The production workers.dev site is https://game.itkvn.workers.dev. Read-only verification returned HTTP 200 for / and HTTP 404 for /api/session, confirming that it still serves the original frontend-only game. Its current Worker version remains cf6eca4a-3c43-4c10-87a7-8b4649ed8cab. No Phase 3 backend was published to production.

The initial static frontend deployment was completed on 2026-11-10 with owner approval. This record supersedes the initial deployment notes below for current Phase 3 status. No production database, service, DNS, Tunnel route, Access policy, SSH configuration, firewall rule, or telemetry Worker was changed during staging work.

## Current staging release

- Public staging: https://game-staging.itkvn.workers.dev
- Worker version: 7e59219d-a6ce-46b7-9540-fea677019d56
- Wrangler: 4.160.0
- API origin: api-staging.itkteam.store, Access-protected, Tunnel to localhost:3001
- Staging Node service: active, unprivileged, zero restarts at the latest check
- Staging database: separate SQLite file; grading disabled; pending submissions award zero XP
- Root staging page and /api/session: HTTP 200
- Direct unauthenticated API-origin request: HTTP 403
- Current public assets: all five files match the staging URL byte-for-byte and both asset manifests

The latest public browser report is reports/staging-guest-flow-final.json. It verifies guest name/session restoration, all eight missions, pending submission history across a service restart, zero XP, two-player movement, third-player late join, reconnect, jump, English/Vietnamese, mobile controls, and no browser errors or failed requests. The latest daily SQLite snapshot was verified. The automated test suite passes 18/18.

The previous account-focused report cloudflare-game/verification/phase3-staging.json is historical evidence from before the guest-first UI was accepted; it does not describe the current default entry flow. Use reports/staging-guest-flow-final.json for the current staging experience.

## Release limits

The 70-client public test through Cloudflare, Tunnel, and Oracle has not been run. A Windows runner is prepared; a five-minute controlled test is available and a 30-minute soak is preferred. A past loopback result is historical and is not public capacity evidence. Check current account-wide Workers quota before running. Local-only SQLite backup is the accepted demo policy. Production changes remain pending the owner's final approval.

## Initial production static-site verification — 2026-11-10

The initial production deployment confirmed the original office frontend, Three.js revision 128, nine local NPCs, eight missions, keyboard navigation, bilingual content, and 390 px viewport. It did not include API or multiplayer. Its evidence remains useful only for that initial static release, not as Phase 3 staging evidence.
