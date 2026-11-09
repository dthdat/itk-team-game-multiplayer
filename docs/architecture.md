# Architecture

## Baseline and migration boundaries

The timestamped HTML backup is the immutable rollback and baseline artifact.
The parent-folder HTML is preserved unchanged; `multiplayer/index.html` is the
editable service-backed game copy and catalog-generation source.

| Existing owner | Responsibility | Migration |
| --- | --- | --- |
| `AP.MISSIONS`, `DISCIPLINES`, `RANKS` | Content, criteria, rank thresholds | Reuse content; generate trusted server catalog during build |
| `buildWorld`, `box`, `cyl`, `desk`, `kiosk`, `person`, `plant` | Render office and register colliders | Preserve; run trusted builder at build time to extract exact colliders |
| `blocked`, `step`, `P` | Local movement and camera | Preserve prediction; server validates swept movement against same colliders |
| `submitMission`, `state.done` | Browser scoring and rewards | Replace with authenticated grading API and SQLite results |
| `save`, localStorage drafts | Resume and draft editing | Keep profile convenience and drafts only; never import legacy scores |
| Supabase `office` broadcast/presence | Peer discovery, positions, scores | Replace with one-origin, validated WebSocket snapshots |
| `makeAvatar`, render loop | Remote rendering | Preserve appearance; add time-based interpolation and disposal |

## Decision: Oracle WebSockets rather than Supabase movement

Status: accepted for local implementation, deployment gated by real A1 benchmarks.
Supabase is convenient managed infrastructure, but 70 senders at 5 Hz produce
350 incoming broadcasts/s and approximately 24,500 accounted messages/s with
69 recipients. Idle suppression does not make an all-moving exercise fit a
100 message/s free allowance or 2 million messages/month. Spatial channels
would add substantial complexity and still need a trusted grading service.

Use Node 22.13+ (24 LTS preferred), TypeScript, ws, Zod, and built-in
node:sqlite WAL. This avoids native addon compilation on ARM64. SQLite and room
state remain single-process; the service binds to loopback and Caddy provides
TLS while reverse-proxying static/API/WS on one origin.
Operational ownership, backups and availability move to the account owner.
No second Supabase transport is maintained. No chat is added.

Server identities are opaque random guest cookies; public player IDs are
separate. Mutations require matching Origin and a CSRF token. Movement is
checked against generated world colliders and a token-bucket speed limit.
Progress comes only from verified provider reviews; mock mode cannot award XP.
Provider output must include every rubric criterion once with bounded text.
References remain visible for learning, so grading is not cheat-proof.

Live provider calls are limited by per-guest request quota, queue concurrency,
queue size, answer/output bounds, conservative daily token/USD reservations,
and a one-retry policy. Price values must be supplied from the owner's current
account; reservations are not invoice reconciliation. The owner must verify
provider retention, region and terms before enabling live mode.

## Baseline evidence

Automated tests passed on 2026-11-09. Two separate local Edge processes joined
the local room; both saw both names and mock review awarded no XP. A 70-client
local mock test kept 70 clients connected for 10 seconds. Neither check proves
cross-machine networking or Oracle A1 capacity. See
`docs/testing-results.md` and `reports/load-report.json`.