# AI grading, verified XP and brainstorming templates

Current production Worker: a3e052f9-0ce4-4b00-a564-6b56603f2e34. Public verification record: reports/ai-browser-production.json.

## Released behavior

New guest submissions can be reviewed by Groq openai/gpt-oss-20b using strict structured JSON. The Oracle server validates every rubric criterion exactly once and computes the score itself. It never accepts a provider/client XP value. AI feedback is advisory training feedback and may be imperfect.

All eight missions remain accessible. Their answer boxes start with editable English/Vietnamese brainstorming scaffolds. Existing drafts, including intentionally empty drafts, are preserved. Switching language translates only an untouched scaffold. The original mission content, reference answers, 3D office, NPCs, movement, jump and multiplayer remain intact. An unchanged scaffold is rejected by the browser and backend before any AI call or XP write.

Submitting from the new UI explicitly includes aiConsent only when the server announces Groq mode and the UI displays the Groq submission notice. Older open frontend versions omit consent and keep answers pending without sending them to the provider. Existing pending answers are not processed automatically; players may deliberately resubmit them. Guest names remain profile data; opaque cookies own progress.

## Persistence and integrity

Additive migration 5 extends mission_submissions with locale, grading eligibility, attempt count, retry time, lease token/expiry and safe error category. It adds an indexed persistent queue and grading_budget/grading_reservations tables. Existing submissions default to grading_enabled=0. No existing answers, results, identities or positions are deleted by this migration.

One consumer claims a job transactionally and holds a 90-second lease. A process restart can reclaim expired work. Attempt count is bounded to three provider calls; stale completions cannot commit after another consumer owns the lease. Provider errors retain the saved answer, never grant XP, and expose only safe error categories. Short answers use a local word check and grant zero XP. No mock provider is connected to the production award path.

Accepted review and mission result are committed in the same SQLite transaction. Score is recomputed from validated booleans. Passing XP is round(mission XP * score / 100 * discipline factor), where matching discipline adds 20%. Per-mission best XP only improves; each submission records only the positive difference. Duplicate request IDs and identical answers for the same player/mission reuse an existing eligible submission. Guest leaderboard entries use the same server-owned results. Resets invalidate outstanding jobs and clear results; daily submission counters survive a progress reset.

## Limits and operations

The owner confirmed a Groq Free-plan organization. No billing or provider upgrade is performed. Credentials remain only in protected Oracle configuration. Worker secrets and browser assets never contain the Groq key.

Default admission limits: 20 new submissions/player/day, 1,000 submissions/shared public IP/hour, 200 queued jobs, one worker, at least 15 seconds between provider calls, 300 calls/day, 100,000 application-budget tokens/day and 8,000 application-budget tokens/minute. The provider may impose lower organization-specific limits; HTTP 429 is handled with bounded retries rather than a plan upgrade. Each call reserves estimated tokens first; valid results settle to the provider's reported usage. Failed/interrupted calls retain conservative reservations. Old budget rows are pruned. Actual token usage is stored in validated review metadata. These limits do not establish 70-player grading throughput.

The API provides owner-scoped individual submission status. WSS progress notifications trigger a result refresh; the active answer has a 30-second fallback check, paused offline/hidden and bounded to ten minutes. Movement remains on WebSockets. Persisted history is available after reload even when no result poll is active.

Groq calls time out after 25 seconds. Service shutdown waits for the active consumer before closing SQLite; production systemd TimeoutStopSec is 45 seconds. Existing daily local backups remain in place. Catastrophic host/disk loss is accepted for this demo. No off-host storage integration is introduced.

## Evidence before release

- npm test: 27 passing tests including migration idempotency/rollback, all eight XP formulas and discipline bonuses, best-score differences, duplicates, stale leases, delete/reset during review, retry exhaustion, explicit consent, quota persistence, guest leaderboard, API ownership, CSRF, restart persistence, templates and mock isolation.
- A private production-database copy migrated without deleting submissions, passed integrity/foreign-key checks, and left existing answers ineligible for AI. The live database was untouched during this drill.
- Ten bounded real Groq evaluations passed: eight English reference answers scored 75–100%; Vietnamese example scored 100% with Vietnamese feedback; irrelevant instruction-injection example scored 0%. Metadata: reports/groq-live-evaluation.json. This small synthetic evaluation is not proof of universal grading accuracy.
- Local and actual public production graphical verification both passed: reports/ai-browser-local.json and reports/ai-browser-production.json. The public run also verified XP/history through a controlled production-service restart; synthetic guests were deleted.
- External 70-player capacity remains unverified.

## Release and rollback

The owner authorized AI/XP implementation and production publishing. Publish only Worker game and update only prompt-works.service on port 3000. Staging, SSH, Tunnel routes, Access policy and firewall remain intact. Before updating, preserve the existing application release, root-only environment, unit and a verified local SQLite snapshot.

Before this AI release, the production Worker rollback version is 03da1b69-c0b1-470a-878c-b47352d3764b. Disable the consumer by restoring GRADING_PROVIDER=mock, restore the saved backend dist/unit, and roll only Worker game back to that version if needed. Keep additive migration 5 and existing verified results; do not run a destructive schema downgrade. Any database restore requires checking newer writes separately.

Official integration references: [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [model API](https://console.groq.com/docs/api-reference), [rate limits](https://console.groq.com/docs/rate-limits).

## Sample-shaped starters and visible AI output — 2026-11-12

All eight bilingual starters now follow the corresponding sample answer's sections and mission-specific inputs/outputs. They retain editable blanks. Untouched prior starters are recognized during draft migration and still rejected before grading, while custom drafts remain intact.

The mission result includes an Actual AI review response box. It shows the model's final message content (formatted JSON), provider/model, configured effort, measured API request duration, queue wait, and provider-reported token counts when present. The model evaluates the submitted prompt against the rubric; the call does not execute the engineering task inside the prompt. This makes the scope and speed of the review inspectable.

Only final message content is retained as responseText. The raw API envelope, authorization headers and hidden reasoning content are excluded. Response text must pass the same strict rubric validation and match the accepted review before persistence. Timing/count values are validated; they are not invented for older records. Saved/reused reviews and local minimum-length checks have explicit labels. Player history offers View AI response without another provider call. Output is assigned through a read-only textarea value and textContent, preventing model text from becoming HTML.

The extension requires no new database migration and does not alter XP calculations. Thirty automated tests cover the new evidence validation/persistence, exclusion of hidden reasoning, sample-specific template sections, prior-template rejection and existing integrity controls. Local real-provider browser verification passed, including exact final-response comparison and saved-history viewing. The candidate English request measured 866 ms with 852 input and 278 completion tokens; this is an observed request, not a latency guarantee.

The extension is live as d5e0b33d-1d83-4af6-aaee-0ac44d928dd6. Public browser verification passed all response/template/history checks, including persistence across a controlled production restart. Observed production request: 813 ms, 1135 total tokens. Its rollback Worker is 6dc3204f-2cfe-4813-a6a6-f0600991051b.


## Review consistency and gameplay controls — 2026-11-12

The mismatch came from the browser mission rubric lacking the `c1`…`cN` criterion IDs used by the server response. The UI therefore could display FIX for a criterion the server counted as passed. The frontend now assigns the same stable IDs; the displayed score, PASS/FIX rows and actual saved AI JSON all use that mapping. Every row shows the model feedback, and each FIX includes a verbatim answer excerpt and a concrete suggested change. The overall count is computed from the verified criterion booleans. Changing missions or submitting another answer clears the prior result; editing a submitted draft labels the saved review as applying only to the submitted text. Older reviews remain identifiable as using the prior format.

The server now validates that evidence quotes actually occur in the submitted answer, that pass/fix fields agree, and that the overall label is neutral. A v1 answer can be deliberately resubmitted for the new rubric once; it does not award duplicate XP. No schema migration was required. AI summaries intentionally describe review completion; the UI calculates pass/fail from the verified score.

The gameplay panel's separate VI toggle is removed, and the browser context menu is suppressed on the game page. The mission editor retains its English/Vietnamese content switch.

Automated tests: 32 passed. Focused public browser run: PASS for a mixed synthetic answer (4/6 criteria, 67%; c4 and c5 FIX), exact alignment with saved/raw response, evidence and fixes, draft editing, switching missions and language, hidden gameplay toggle, and context-menu suppression. Browser page, console and server errors: zero. Report: `reports/review-consistency-production.json`. Production Worker: `fbf9c441-c5f5-479c-ab7a-4730b1228e93`; rollback target: `d5e0b33d-1d83-4af6-aaee-0ac44d928dd6`.


## Resume and rendering recovery — 2026-11-12

When a browser tab returns, the game clears stale held keys and restores keyboard focus on desktop. Multiplayer rendering validates the remote movement sample list before reading its length. After at least two seconds in the background, the frontend makes a rate-limited attempt to force a Three.js WebGL context loss/restore, addressing browsers that resume with a stale graphics context.

The live public page returned HTTP 200 and contained both recovery changes. A synthetic Chromium run passed keyboard movement initially, after reload/resume and after a simulated hidden/visible transition (movement deltas 0.478, 0.410 and 0.615 world units); key delivery and focus returned, status was Online, and page/console errors were zero. Chromium did not emit WebGL context-lost/restored events, so graphics-context recovery itself was not verified. The exact reported `length` TypeError did not reproduce; Firefox/Android remains untested. The resume-only Worker at that point was `34aa0418-714a-4f62-ba26-257e0bbe4d37`; its direct rollback was `deb0b196-4dfa-461f-a694-b605462df5f8`. This was a frontend Worker update only; the Oracle backend/database were not restarted or migrated. See `reports/resume-public.json`. If the error persists, the browser name and full console stack will identify whether another call site is involved.


## Movement correction recovery — 2026-11-12

The production Network trace showed repeated `move`/`correction` messages at `(-0.442, 2.3)` followed by close code `4008 Invalid movement`. That coordinate is inside the central desk's server collision margin, so a stale saved position could never pass path validation. The old frontend correction handler also forced an immediate resend of the same corrected location.

Restored positions are now checked against current collision geometry; an invalid position falls back to the safe office spawn `(0, 8.5)`. The server also rebases a blocked runtime position. The frontend records the authoritative correction coordinates as its last sent state and waits for actual movement before sending another frame. This changes position recovery only and does not alter mission progress, XP, the database schema, or Groq configuration.

The 34-test suite passed. Local seeded-position and browser correction probes passed. On the live public path, WSS stayed Online; one deliberately invalid synthetic move produced one correction, no duplicate retry, and no disconnect. Keyboard movement continued, all eight missions remained accessible, and browser errors were zero. The synthetic guest DELETE returned 204 and its cookie was removed; no answer was submitted or sent to Groq. The production backend health check passed after the restart, with no environment edit or migration; the local backup service succeeded. Current Worker: `a3e052f9-0ce4-4b00-a564-6b56603f2e34`; direct rollback Worker: `34aa0418-714a-4f62-ba26-257e0bbe4d37`. Backend rollback copy: `/opt/prompt-works/rollback-movement-20261112T083636Z`. Detailed output: `reports/movement-production-backend.json` and `reports/play-production-movement-fix.json`.
