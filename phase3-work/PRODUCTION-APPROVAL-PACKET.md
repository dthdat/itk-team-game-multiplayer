Current result: production published on 2026-11-12 as Worker version 03da1b69-c0b1-470a-878c-b47352d3764b, with public guest/WSS/restart verification passing. This packet records the originally approved changes; [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) is the current release record.

# ITK-BGSV Phase 3 production approval packet

## Status

Approved by the owner on 2026-11-12. The Oracle service/database/local backups are installed and locally smoke-tested. Cloudflare public cutover is blocked by API authorization; see [current deployment status](PRODUCTION-DEPLOYMENT-STATUS.md). The remainder below records the approved change set. Production Worker game is still at version cf6eca4a-3c43-4c10-87a7-8b4649ed8cab and serves the existing frontend-only game. The candidate frontend is the exact five-file asset set currently verified on staging. Staging remains at 7e59219d-a6ce-46b7-9540-fea677019d56.

The intended order is: complete the bounded external staging load run, review its uncertainty, then request final approval for this exact production change set. The full 30-minute soak is preferred. A passing five-minute 70-client run is a shorter evidence point, not a proof of sustained capacity.

## 1. Production Worker replacement

- Cloudflare account: itkvn.
- Cloudflare account ID in the prepared Wrangler config: b4b9f742f28e64118e517db91a9e8414.
- Worker: game.
- Public URL: https://game.itkvn.workers.dev.
- Current version to preserve as rollback: cf6eca4a-3c43-4c10-87a7-8b4649ed8cab.
- Candidate frontend manifest: cloudflare-game/verification/asset-manifest-production.json.
- Candidate bundle: release/itk-bgsv-phase3-production-backend.tar.gz.
- Backend artifact hash and file list: release/production-release-manifest.json.

The deployment replaces the current frontend-only game with the tested guest-first frontend and the /api/* and /ws proxy. Public pages remain unrestricted on workers.dev. The Worker uses Static Assets with Worker-first handling only for /api/* and /ws. No staging Worker, telemetry Worker, or other Worker is targeted.

The exact publish command, after final approval, is from cloudflare-game:

    npm run deploy

It has not been run for production.

## 2. Oracle service and database

The current ARM64 Ubuntu host has 2 OCPU, about 11 GiB RAM with about 10 GiB available at the latest check, and about 39 GiB free on its 45 GiB root volume. Staging is active on 127.0.0.1:3001. Production port 3000, production service files, production directory, database directory, and backup directory are currently absent.

Proposed isolated production service:

- Unit: prompt-works.service, account/group promptworks.
- Node: 24.22.2 ARM64, using a separate copy at /opt/prompt-works/runtime/node.
- Release: /opt/prompt-works, from the candidate archive.
- Listener: 127.0.0.1:3000 only.
- Environment: /etc/prompt-works/prompt-works.env, mode 0600.
- Fresh database: /var/lib/prompt-works/game.sqlite, directory mode 0700.
- Local daily backup: /var/backups/promptworks, 30-day retention.
- Grading: GRADING_PROVIDER=mock; pending submissions award zero XP; Groq remains disabled.
- Service limits: MemoryMax=2G, CPUQuota=150%, TasksMax=128, with restart-on-failure and strict filesystem permissions.
- Journal namespace: promptworks, bounded to 64 MiB persistent and 16 MiB runtime.
- Namespace limit file: /etc/systemd/journald@promptworks.conf, matching the already-working staging namespace pattern; the global journald configuration is not changed.

The database will be new and empty. No staging guest data or current production database is imported. Startup applies schema migrations to this new database only. The existing staging service, staging database, staging backup timer, and SSH remain unchanged.

The systemd unit template is prepared but has not been installed or started. Its executable-path check will pass after the separate production Node runtime is copied into place. After approval, the host file changes would be exactly:

1. Create the unprivileged `promptworks` account/group and isolated paths `/opt/prompt-works`, `/etc/prompt-works`, `/var/lib/prompt-works`, and `/var/backups/promptworks`.
2. Copy the existing staging Node 24.22.2 ARM64 executable to `/opt/prompt-works/runtime/node` and extract the 18-file allowlisted candidate archive into `/opt/prompt-works`.
3. Install runtime npm dependencies from the pinned lockfile with development dependencies omitted; no native or paid service is added.
4. Create `/etc/prompt-works/prompt-works.env` from the included example, keep it root-owned mode 0600, and add the fresh proxy secret only through a protected editor. It remains mock-only with Groq disabled.
5. Install only `prompt-works.service`, its daily backup service/timer, and `/etc/systemd/journald@promptworks.conf`. Run `systemd-analyze verify`, then activate only `prompt-works.service` and `prompt-works-backup.timer` after approval.
6. Confirm the new service binds to `127.0.0.1:3000`; its dedicated empty SQLite database is created at `/var/lib/prompt-works/game.sqlite`. Staging's service, database, backup timer, journal namespace, and SSH remain untouched.

These Oracle changes were applied on 2026-11-12 after explicit approval; local persistence, WebSockets and backups passed.

## 3. Production Tunnel route and Access

After approval, add one route to the existing remotely managed Tunnel:

    api.itkteam.store -> http://127.0.0.1:3000

The checked route inventory already contains ssh.itkteam.store -> ssh://localhost:22 and api-staging.itkteam.store -> http://127.0.0.1:3001. Add only the production API hostname. Do not restart cloudflared or change the SSH/staging routes. The production hostname did not resolve from this host during the latest check; verify the zone and existing DNS/Access inventory in the dashboard before creating it.

Create a production-only Cloudflare Access self-hosted application scoped to api.itkteam.store. Its only policy must be Service Auth including the dedicated token itk-game-production-worker. Do not create Allow or Bypass policies and do not alter account-wide policy. Confirm direct unauthenticated API-origin requests are denied before connecting the Worker.

## 4. Worker secrets

After approval, configure exactly these Worker secret bindings on Worker game through masked Wrangler prompts or the dashboard:

- ORIGIN_BASE = https://api.itkteam.store
- GAME_PROXY_SECRET = same fresh random value as production TRUSTED_PROXY_SECRET
- CF_ACCESS_CLIENT_ID = the production Service Token ID
- CF_ACCESS_CLIENT_SECRET = the production Service Token secret

Store TRUSTED_PROXY_SECRET only in the protected production environment file. Do not put secret values in this packet, command arguments, shell history, source, reports, or public assets. The browser receives no service credentials and continues to use only same-origin HTTPS/WSS.

## 5. Release sequence and verification

After final approval:

1. Install the separate production service and fresh local SQLite database; verify systemd units and localhost health/readiness.
2. Add the production Tunnel route and scoped Service Auth policy; verify direct origin denial.
3. Configure the four Worker secret bindings securely.
4. Publish only Worker game with the production command above.
5. Verify the public root, guest session and secure cookie, profile/name persistence, pending submission with zero XP, eight missions, English/Vietnamese, WSS movement/reconnect, SQLite persistence across service restart, direct-origin denial, and mobile controls.
6. Record the active Worker version and local backup status. Keep staging available for comparison.

The public 70-client run is not yet complete. The Windows runner is in windows-load-test/. It defaults to 5/20/70 clients with a five-minute final stage and supports up to 30 minutes. It requires an explicit Cloudflare quota check and deletes synthetic guests after the run. Oracle-side CPU/RSS and network counters plus Cloudflare Analytics must be captured separately.

## 6. Cost, data risk, and rollback

No paid resource is proposed. The service uses the existing Oracle VM and the existing Cloudflare Free account. Cloudflare documents 100,000 Worker requests/day shared across the account; current account headroom is not yet measured. The 70-player usage model is in LOAD-TEST-RESULTS.md. Oracle Always Free eligibility/remaining tenancy quota must be checked in the account.

Backups remain local only: daily production SQLite snapshots with 30-day retention. No encryption or cloud-storage integration will be added. The owner accepts catastrophic host/disk loss of demo progress.

Rollback after approval:

- Restore the existing frontend Worker version with Wrangler rollback to cf6eca4a-3c43-4c10-87a7-8b4649ed8cab.
- Stop only prompt-works.service if backend rollback is needed; preserve /var/lib/prompt-works/game.sqlite.
- Remove or disable only the production api.itkteam.store route and its dedicated Access application if the origin must be withdrawn.
- Leave the staging route/service, SSH route, cloudflared connector, telemetry Workers, and firewall unchanged.

## Final approval boundary

The changes above create a new production service/database, production API route and Access application, production Worker secrets, and a new version of the live Worker game. The owner approved these changes on 2026-11-12. Oracle installation is complete; Cloudflare activation awaits authenticated dashboard setup. No Groq integration or real XP awarding is included.
