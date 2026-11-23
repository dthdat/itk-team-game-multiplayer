# Production release — 2026-11-12

Live URL: https://game.itkvn.workers.dev

Worker game, account ID b4b9f742f28e64118e517db91a9e8414, workers.dev subdomain itkvn. Current version: a3e052f9-0ce4-4b00-a564-6b56603f2e34. Wrangler 4.160.0. Direct Worker rollback version: 34aa0418-714a-4f62-ba26-257e0bbe4d37.

## Released

- Actual Three.js office, nine NPCs, all eight missions, guest sessions, English/Vietnamese, keyboard and mobile controls, jump and interpolated multiplayer preserved.
- Every answer box begins with an editable mission-specific brainstorming template in English or Vietnamese. Custom drafts are preserved across mission/language changes and reload; unchanged templates are rejected without an AI call or XP.
- Groq Free-plan openai/gpt-oss-20b is active on Oracle. New explicitly consented answers enter a bounded persistent review queue. Old pending answers remain untouched until deliberately resubmitted.
- Validated rubric results compute server-owned scores and per-mission best XP, including the 20% matching discipline bonus. Duplicate IDs/identical answers and improved-best transactions prevent repeat XP. Guest leaderboard/history reads persisted verified results. Mock/failed/invalid reviews award no XP.
- Dedicated production Node service remains unprivileged on localhost:3000 with root-only environment, SQLite migration 5 and bounded journal namespace. Groq key remains only in protected Oracle configuration. Public browser requests use same-origin /api and /ws; direct unauthenticated API origin returns 403.

## Actual verification

30 automated tests passed. The real public browser run passed two-player WSS/presence, movement, reconnect, eight bilingual templates, draft preservation, untouched-template rejection, real English/Vietnamese AI feedback, XP/discipline bonus, duplicate prevention, guest leaderboard/history, keyboard movement, desktop/mobile jump, mobile layout, saved XP/history after reload and a controlled production-service restart. Browser page/console/server error counts were zero. English synthetic review: 100% / 180 XP; Vietnamese synthetic review: 100% / 100 XP. Synthetic guests and their XP/submissions were deleted afterward.

All five public asset hashes and all 19 backend file hashes matched the release manifest. SQLite integrity and foreign-key checks passed. The final local backup succeeded: /var/backups/promptworks/game-2026-11-12T03-21-14.650Z.sqlite. Local backups only; catastrophic host/disk loss is an accepted demo risk.

Reports: reports/ai-browser-production.json, reports/ai-production-assets.json, reports/ai-production-backend.json, reports/groq-live-evaluation.json. Full implementation/security/limits: AI-GRADING-RELEASE.md.

Production, staging, cloudflared and SSH services were active with zero automatic restarts at the final check. Only the approved production application/Worker were upgraded. Existing SSH and staging routes, firewall, Access organization policy and telemetry Workers were preserved. No paid infrastructure or billing upgrade was created.

## Limits

Real AI reviews are advisory, not proof of engineering correctness. The small bilingual/injection/reference evaluation does not establish universal accuracy. Free-plan rate/token limits can delay reviews; saved jobs retry with bounded backoff. No paid fallback is enabled. The external 70-player test remains NOT RUN; public capacity, p95 latency and 70-player grading throughput are unverified.

## Rollback

Protected prior-release environment: /etc/prompt-works/pre-ai-20261112T065240Z.env

Prior-release backend/unit directory: /opt/prompt-works/rollback-ai-20261112T065240Z

To roll back this AI release, stop only prompt-works.service, restore that environment (mode 0600), restore its dist directory and prompt-works.service unit, daemon-reload and start only prompt-works.service. This preserves the prior AI release and its existing configuration. Keep additive migration 5 and existing saved progress; no destructive schema downgrade is required. For a full AI release rollback, then from cloudflare-game:

    npx wrangler rollback d5e0b33d-1d83-4af6-aaee-0ac44d928dd6 --name game --env='' --yes

Do not use the original pre-multiplayer Worker as this AI release's routine rollback point. Keep staging, SSH, cloudflared and firewall untouched. Database restore is a separate recovery operation because it discards newer writes.

## Sample templates and AI response box — latest update

All eight English/Vietnamese starters now mirror their sample answer’s specific structure while leaving blanks. Custom drafts are preserved and untouched prior starters migrate safely. The Actual AI review response box shows the model’s final grading JSON, model/effort, measured request time, queue wait, and reported token counts. Saved reviews and local checks are explicitly labeled. Older results without original response/timing metadata are identified honestly. Player history includes View AI response. Hidden reasoning and raw API envelopes are not exposed.

Public browser checks passed exact final-response comparison, read-only display, recorded timing/token totals, viewing saved responses without a new AI call, and metadata persistence after reload/restart, plus the existing bilingual/XP/multiplayer/mobile checks. The measured production request took 813 ms with 852 input and 283 completion tokens. Browser errors were zero. This is one observed request, not a performance guarantee. Local backup and final integrity/hash checks passed; production, staging, Tunnel and SSH remain active.


## Review consistency and game controls — latest update

The stable backend criterion IDs are now attached to browser criteria so the score, PASS/FIX labels, evidence, suggested fixes and raw AI response correspond. Old v1 answers can be explicitly re-reviewed without duplicate XP. The gameplay VI toggle was removed and right-click browser menus are disabled. Mission-specific English/Vietnamese switching remains available. No database migration was required.

The production Worker is `fbf9c441-c5f5-479c-ab7a-4730b1228e93`; its direct rollback version is `d5e0b33d-1d83-4af6-aaee-0ac44d928dd6`. The backend installer preserved the previous code, systemd unit, root-only environment and local database backup at `/opt/prompt-works/rollback-ai-20261112T065240Z` and `/etc/prompt-works/pre-ai-20261112T065240Z.env`. Production database integrity passed and the synthetic browser guest was removed. Full focused production result is in `reports/review-consistency-production.json`.


## Resume input recovery — latest update

Restoring a visible game tab clears stale movement keys and refocuses the desktop canvas. Remote movement interpolation validates its sample list before reading its length. After a tab has been hidden for at least two seconds, the frontend also attempts a rate-limited Three.js WebGL context recovery. Worker `34aa0418-714a-4f62-ba26-257e0bbe4d37` can be rolled back to `deb0b196-4dfa-461f-a694-b605462df5f8` without changing the Oracle backend.

The live public page returned HTTP 200 and contained both recovery changes. A synthetic Chromium run verified keyboard movement initially, after reload/resume, and after a simulated hidden/visible transition (movement deltas 0.478, 0.410 and 0.615 world units); focus and key delivery returned, network status was Online, and there were no page or console errors. The automated browser did not emit WebGL context-lost/restored events, so that specific graphics recovery was not verified. The reported `length` TypeError did not reproduce in Chromium; Firefox/Android remains untested. See `reports/resume-public.json`.


## Movement correction recovery — 2026-11-12

The supplied Network screenshot showed the player repeatedly sending `move` at `x=-0.442, z=2.3`; the server returned the same `correction` until it closed the socket with `4008 Invalid movement`. The generated collision map places that saved point inside the central desk margin (0.4 units). An invalid persisted position therefore made even stationary movement fail; the browser also reset its send marker after correction, causing an immediate retry loop.

The backend now validates restored and reused player positions against the collision map and moves blocked positions to `(0, 8.5)`. It also rebases a blocked runtime position before accepting more movement. The frontend treats a correction as the latest sent position, so it does not resend an unchanged coordinate. Mission progress and the rest of the SQLite database are untouched.

Verification: 34 automated tests passed. A local WebSocket regression seeded the exact blocked coordinate, confirmed the welcome position was the safe spawn, and confirmed the next movement was accepted. The local browser correction probe received one correction for one invalid move, stayed connected, and continued moving. Public Chromium testing through `game.itkvn.workers.dev` confirmed WSS status Online, exactly one correction and one invalid move, no socket close, continued movement, all eight missions accessible, and zero browser errors. The temporary synthetic guest DELETE returned 204 and its session cookie was removed; no answer was submitted and no Groq request was made.

Production `prompt-works.service` is healthy on `127.0.0.1:3000`; the code-only restart made no environment changes or database migration. The existing local SQLite backup service completed successfully. Backend rollback copy: `/opt/prompt-works/rollback-movement-20261112T083636Z`. Worker `a3e052f9-0ce4-4b00-a564-6b56603f2e34` rolls back directly to `34aa0418-714a-4f62-ba26-257e0bbe4d37`. Reports: `reports/movement-production-backend.json`, `reports/play-production-movement-fix.json`.


### Movement-fix rollback

This hotfix made no database schema or environment change; do not restore the database or Groq environment to roll it back.

To restore the preceding backend build:

    sudo systemctl stop prompt-works.service
    sudo mv /opt/prompt-works/dist /opt/prompt-works/dist.failed-movement
    sudo cp -a /opt/prompt-works/rollback-movement-20261112T083636Z/dist /opt/prompt-works/dist
    sudo systemctl start prompt-works.service

To restore the preceding frontend Worker:

    cd ~/itk-team-game-multiplayer/phase3-work/cloudflare-game
    npx wrangler rollback 34aa0418-714a-4f62-ba26-257e0bbe4d37 --name game --env='' --yes

Confirm `/readyz` returns healthy after either rollback. Keep the existing database and environment as-is.
