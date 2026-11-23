Current AI release: 6dc3204f-2cfe-4813-a6a6-f0600991051b is public with real Groq Free-plan reviews and verified XP. Remaining limits are AI evaluation accuracy and unperformed external 70-player capacity testing. See ../AI-GRADING-RELEASE.md for bounded queue/quota behavior and ../PRODUCTION-DEPLOYMENT-STATUS.md for proof/rollback.

# Phase 3 risks and release checks

- Staging guest flow is live and functionally verified. Production Worker game and its service/data path remain unchanged.
- The public 70-client test is outstanding. The previous 70-client test was a one-minute loopback run and does not establish external latency or Oracle capacity. A Windows runner is prepared for 5/20/70 clients; a shorter controlled run must state remaining capacity uncertainty. See LOAD-TEST-RESULTS.md.
- Current Cloudflare account-wide Workers request usage and remaining Free quota are not measured. The daily limit is shared with other Workers, including telemetry; check dashboard usage before an external test.
- SQLite demo answers are stored in plaintext with private file permissions. Daily local backups and isolated restore tests pass. There is no off-host backup by design; loss of demo progress after catastrophic host/disk failure is accepted.
- Rate limits live in one SQLite database and are designed for one Node process. Multiple backend instances need shared rate-limit and presence state.
- The guest cookie expires after 30 days. The browser remembers a display name, but the name is not identity; clearing the cookie loses access to that guest's server-side progress. Guest progress does not move to another browser.
- Cloudflare Access service-token protection applies to the staging API origin. Production Access route/token configuration has not been created.
- Oracle's free allowance is tenancy-specific. Verify current resource eligibility, usage, and transfer limits before production; this work created no additional resources.
- Optional account recovery is administrator-assisted. No email reset provider, email collection, Groq, or paid AI service is used.
- The training game includes reference answers in browser-visible mission content. Server-owned XP prevents direct client score injection, but this is not a proctored exam.
- No production database migration, service restart, production Worker deployment, DNS/Tunnel/Access change, firewall change, or SSH change was made.
