Latest production update: d5e0b33d-1d83-4af6-aaee-0ac44d928dd6; 30 automated tests and actual public browser checks PASS. New coverage: sample-shaped starters, actual final AI JSON box, measured timings/tokens, saved-review labeling/history viewing and persistence. See ../reports/ai-browser-production.json.

Current AI release (2026-11-12): 27/27 automated tests and real public graphical AI/XP/template/WSS/restart checks PASS. Zero browser errors; all synthetic records removed. See ../AI-GRADING-RELEASE.md and ../reports/ai-browser-production.json. External 70-player test is still NOT RUN. Earlier tables below record Phase 3 before AI activation.

# Testing results

## Current staging verification — 2026-11-11

| Check | Result | Scope |
|---|---|---|
| npm test | PASS, 18/18 | ARM64 Node.js 24.22.2; account/session APIs, SQLite persistence and migrations, backup/restore, grading isolation, Worker proxy, WebSocket upgrade, movement validation, and lifecycle. |
| Public staging HTTP | PASS | Staging root and /api/session returned 200. Direct unauthenticated API-origin request returned Access 403. |
| Guest persistence | PASS | Synthetic guest name/session restored after reload; pending history survived a controlled restart of only the staging service. |
| Mission submission and XP | PASS | Submission stored as pending, history restored, verified XP remained zero. |
| Multiplayer browser flow | PASS | Two players saw presence and movement; a third late join saw stationary players; reconnect passed. |
| Jump and smoothing | PASS | Desktop Space and mobile Jump worked. Remote probe saw about 100.7 ms movement samples and 83/83 distinct rendered positions; max tested per-frame movement was 0.5 m. |
| Missions, language, mobile | PASS | Eight missions loaded; English/Vietnamese; 390 px mobile joystick and Jump tested. |
| Browser errors | PASS | Zero page errors, console errors, same-origin 5xx responses, or failed requests in the latest guest-flow run. |
| Static assets | PASS | Five public assets match the deployed staging Worker byte-for-byte and match both current manifests. No credential/database/private-key patterns found. |
| Staging backup | PASS | 2026-11-11 daily SQLite snapshot completed and verified; automated isolated restore test passed. |
| Production unchanged | PASS | Production Worker remained at cf6eca4a-3c43-4c10-87a7-8b4649ed8cab; root returned 200 and /api/session 404. |
| External 70-player public test | NOT RUN | Requires a load generator outside Oracle and Cloudflare account quota headroom. |
| Off-host backup | ACCEPTED RISK | Demo uses the existing daily local SQLite backup only; catastrophic host/disk progress loss is accepted. |

The latest browser report is reports/staging-guest-flow-final.json. The machine was the Oracle host; Chromium automation is not a physical-phone frame-rate test.

The previous 70-client loopback test and a two-client public RTT sample are historical and do not prove current 70-player capacity. See LOAD-TEST-RESULTS.md. Production Worker game, production database, DNS, Tunnel routes, Access policies, firewall, SSH, and telemetry Workers were not changed.
