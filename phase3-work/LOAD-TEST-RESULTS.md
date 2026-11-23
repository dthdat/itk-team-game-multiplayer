# Staging load and browser test results

## AI release — 2026-11-12

Production Worker game is deployed at https://game.itkvn.workers.dev as version d5e0b33d-1d83-4af6-aaee-0ac44d928dd6. Oracle now runs the Groq Free-plan grading queue, server-validated best-mission XP and guest leaderboard. All eight answer boxes have editable English/Vietnamese brainstorming scaffolds that preserve drafts. Old pending submissions are not sent automatically; new submissions require the AI notice/consent flag. See [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md) and [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) for current verification and rollback. Earlier pending-only Phase 3 notes below are historical.


## Current public staging result

Date: 2026-11-11. Target: https://game-staging.itkvn.workers.dev through Cloudflare Worker, Access, Tunnel, and the Oracle staging Node service.

The latest synthetic browser test passed with three independent guest identities. It verified name persistence after reload, guest session restoration, all eight missions, pending answer history, zero XP, two-player presence and movement, a third late join seeing stationary players, reconnect, and pending history after a controlled staging-service restart. English and Vietnamese switching, desktop Space jump, mobile Jump button, and mobile joystick movement passed. The browser reported zero page errors, zero console errors, zero same-origin 5xx responses, and zero failed requests. Synthetic browser-test guests were deleted after the run.

The remote animation probe received movement samples about every 100.7 ms. It observed 83 distinct rendered positions across 83 animation frames, a maximum measured per-frame remote displacement of 0.5 metres, and working leg animation. The probe suppressed WebGL drawing only during its interpolation measurement to avoid renderer contention on the two-core host. This verifies the interpolation path; it is not a graphics frame-rate or user's-device performance benchmark.

Public HTTP and origin checks passed: staging root HTTP 200, same-origin /api/session HTTP 200, and direct unauthenticated https://api-staging.itkteam.store/api/session HTTP 403. A recent connection test verified WSS, movement, and reconnection. The latest three-guest run did not record a latency distribution, so current staging RTT p50/p95/p99 is not claimed.

Full browser evidence: reports/staging-guest-flow-final.json. Current Wrangler version: 4.160.0. Current staging Worker version: 7e59219d-a6ce-46b7-9540-fea677019d56.

Separate public gameplay checks then used real desktop WASD/Shift input and real touch joystick events at 390 px. Both stayed Online with zero movement corrections, socket closes, or page errors; all eight mission panels opened and the name restored after reload. Reports: reports/play-latest-desktop.json and reports/play-latest-mobile.json.

## Public 70-player run: NOT RUN

The public 5-, 20-, and 70-client test was not run. This Codex environment is on the Oracle VPS, while the load runner is intended to run from an external Windows machine. Running it on the VPS would compete with the backend and would not meet the external-runner requirement. Cloudflare account request usage and remaining quota were also unavailable from the authorized checks, so no public load was generated here. The runner's JavaScript syntax and help path passed locally; this Linux host has no PowerShell, so the Windows wrapper has not been executed.

The account-wide Workers Free allowance is currently documented as 100,000 Worker requests per day. Only requests invoking Worker code count; a WebSocket upgrade is one request, while messages on an established WebSocket do not add Worker requests. This allowance is shared with other Workers, including telemetry. Static asset delivery uses the separate Workers Static Assets path. The limit is not a measurement of current account headroom.

For a stable example workload of 70 players, assume each player starts one guest session, saves a profile once, opens the progress panel once (three API requests), submits once, and opens one WebSocket. That is approximately 490 Worker requests/day for the game, excluding retries, repeated dashboard views, or other traffic. If all 70 players reconnect every 15 minutes for a full day, that adds about 6,720 handshakes. During a prolonged outage, the 120-second foreground retry cap could approach 50,400 handshakes/day; the 300-second hidden-tab cap about 20,160/day. These are code-based planning estimates, not dashboard measurements. Other account Workers share the same daily limit.

References: Cloudflare [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Historical measurements, not current staging capacity evidence

A 60-second local loopback test on 2026-11-10 ran 70 mock clients against a temporary in-memory Node server at 5 Hz. It recorded ping/pong p50/p95/p99 of 3.67/6.45/7.81 ms, zero unexpected disconnects, and five of five planned reconnects. Server RSS peaked at 97.37 MB, average server CPU was 2.96% of one core, and WebSocket application payload was 0.233 Mbps inbound / 16.764 Mbps outbound (excluding TCP/TLS overhead). This was before the current 10 Hz public movement revision and did not traverse Cloudflare or Tunnel; it is not evidence that public 70-player capacity passes.

A prior public two-client, 70-second test recorded RTT p50/p95/p99 of 10.14/15.92/54.54 ms with no unexpected closes or corrections. It predates the current final frontend build and did not measure 70 players. Treat it as a historical small-session observation only.

## Usage and cost observations

No Worker request count or current account-wide headroom was captured during browser tests. WebSocket movement uses frames on established connections rather than polling. Seventy sockets can remain open without one Worker request per movement frame. Account usage must be read from Workers Analytics before the 70-player run.

The staging VPS is the existing ARM64 Oracle VM; no additional compute or paid resources were created. Oracle documents up to 10 TB/month of Always Free outbound transfer and up to 2 OCPU/12 GB for eligible A1 usage, subject to tenancy limits. The VM's remaining allowance was not measured. The current 10 Hz 70-player bandwidth, CPU, and memory are not measured, so no current 70-player resource projection is claimed.

## Bounded external run requirements

Run only from a machine outside Oracle after confirming available Workers request headroom in the Cloudflare dashboard. Use staging-only synthetic guest records and the existing public staging URL. Start with five clients, inspect errors and host metrics, then increase to 20 and inspect again. Proceed to 70 only if both stages remain healthy. Keep the final stage capped at 30 minutes and five planned reconnections. Stop on any repeated reconnect loop, HTTP 429/5xx, Tunnel errors, unexpected service restart, rising failed connections, or quota pressure. Capture client RTT p50/p95/p99, disconnect/reconnect counts, the Oracle service CPU/RSS and network counters, Tunnel health, and Cloudflare Worker requests before and after. Delete synthetic guests after the run.

A controlled public 70-player run should precede final production approval; localhost and three-player browser checks do not establish 70-player capacity. The prepared Windows runner defaults to a five-minute final stage. That shorter run can provide an initial capacity result if a 30-minute soak cannot be run immediately; report the shorter duration and remaining sustained-capacity uncertainty. A 30-minute run is preferred, not a prerequisite for preparing or reviewing the demo release.

The bounded runner and Windows instructions are in [windows-load-test/](windows-load-test/README.md). It targets only the staging hostname, sends synthetic guest/profile/movement data, includes five planned reconnects, checks cleanup, and requires an explicit Cloudflare quota confirmation before network activity.


## Production release verification — 2026-11-12

Worker game version 03da1b69-c0b1-470a-878c-b47352d3764b passed the public three-guest browser flow, WSS movement/reconnect/late join, eight missions, language/mobile/jump, secure guest reload, pending history across controlled service restart, zero XP, and zero browser/server/network errors. The five deployed assets matched the release manifest. Evidence: reports/production-guest-flow.json. This is functional verification only; an external 70-player capacity run is still NOT RUN.
