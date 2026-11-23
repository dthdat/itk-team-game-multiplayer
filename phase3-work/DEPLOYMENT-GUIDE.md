# Deployment guide

> **Read first:** Production has already been deployed and updated. [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) is the current deployment and rollback record; its latest entry is dated 2026-11-12 and should be checked against live state. This guide preserves chronological staging/production notes and the original rollout plan. Some proposed steps and version identifiers below are superseded; do not execute an old plan verbatim.

The production game uses the same-origin Worker proxy and dedicated Oracle backend. Refer to the production status file for the latest documented grading configuration. The external public 70-player capacity test remains unverified; see [LOAD-TEST-RESULTS.md](LOAD-TEST-RESULTS.md).

## Current staging release

- Public frontend: https://game-staging.itkvn.workers.dev
- Cloudflare account: itkvn
- Staging Worker: game-staging
- Current staging Worker version: 7e59219d-a6ce-46b7-9540-fea677019d56
- Current production Worker version: game, 03da1b69-c0b1-470a-878c-b47352d3764b; rollback: cf6eca4a-3c43-4c10-87a7-8b4649ed8cab
- Wrangler: 4.160.0
- Staging origin: api-staging.itkteam.store through the existing remotely managed Tunnel to http://127.0.0.1:3001
- Staging service: prompt-works-staging.service, active on 127.0.0.1:3001 with zero restarts at the latest check
- Staging database: /var/lib/prompt-works-staging/game.sqlite
- Staging backups: /var/backups/promptworks-staging, daily local timer; latest snapshot verified
- Grading: disabled; submissions pending; XP awards zero

The owner manually verified the staging Service Auth policy. An unauthenticated direct request to the API origin returns 403; the public Worker root and /api/session return 200. The existing route ssh.itkteam.store to ssh://localhost:22 is unchanged. Production Worker game remains unchanged.

The latest full browser evidence is reports/staging-guest-flow-final.json. It covers guest identity, reload and server-restart persistence, pending submissions, three-player late join, movement, reconnect, jump, English/Vietnamese, missions, and mobile controls. The browser reported no page or console errors and no failed requests.

## Release files and validation

The exact current public candidate is the five-file set under cloudflare-game/public. Both asset manifests were rebuilt from these files:

- cloudflare-game/verification/asset-manifest.json
- cloudflare-game/verification/asset-manifest-production.json

The manifest records file size and SHA-256. All five entries were compared with assets served by the staging URL and matched. The production manifest is only a release artifact; it has not been deployed to Worker game. The public folder contains no credentials, environment file, database, private key, or API key.

The root Phase 3 project is built and tested with Node 24.22.2 on ARM64. Run from phase3-work:

    npm ci
    npm test

Wrangler 4.160.0 is pinned by package-lock. Staging deployment, if separately authorized, is from cloudflare-game:

    PHASE3_SERVICE_ENABLED=1 npm run prepare:assets
    npx wrangler deploy --env staging

Never use the base production deploy script during staging work.

Current release-preparation artifacts:

- [Production change proposal and approval boundary](PRODUCTION-APPROVAL-PACKET.md)
- [Public staging load-test results and remaining uncertainty](LOAD-TEST-RESULTS.md)
- [Windows external staging load runner](windows-load-test/README.md)
- [Production asset manifest](cloudflare-game/verification/asset-manifest-production.json)
- [Allowlisted backend archive manifest](release/production-release-manifest.json)
- [Demo local backup and restore procedure](BACKUP-RESTORE.md)

## Oracle production service — installed 2026-11-12

The production service must be isolated from staging and from the old static Worker:

- ARM64 Node 24 runtime: /opt/prompt-works/runtime/node
- Release: /opt/prompt-works
- Unprivileged service user/group: promptworks
- Protected environment: /etc/prompt-works/prompt-works.env, mode 0600
- New production SQLite database and WAL: /var/lib/prompt-works/game.sqlite, directory mode 0700
- Local daily snapshots: /var/backups/promptworks, directory mode 0700
- Listener: 127.0.0.1:3000 only
- Service: deploy/prompt-works.service, with restart policy, resource/task limits, strict filesystem permissions, and dedicated bounded journald namespace
- Backup timer: deploy/prompt-works-backup.service and deploy/prompt-works-backup.timer

Use a new production database. Do not copy staging guest data or modify another production database. Startup applies the application's schema migrations to that new database; no destructive migration against existing data is planned. The production env template begins with GRADING_PROVIDER=mock, and Groq stays disabled.

The systemd units, dedicated database and local backups were installed and activated after approval on 2026-11-12. The following checklist describes the installation checks; current results are in PRODUCTION-DEPLOYMENT-STATUS.md. After separate approval, the operator must verify the service account, Node 24 ARM64 binary, file ownership, environment permissions, database path, backup directory, and service unit with systemd-analyze verify. Start only prompt-works.service, then verify localhost /healthz and /readyz before exposing the route.

## Production Tunnel, Access, and Worker plan — approval required

No production API route or production Access policy is currently configured. After separate approval:

1. Add only api.itkteam.store to the existing remotely managed Tunnel, targeting http://127.0.0.1:3000. Preserve ssh.itkteam.store -> ssh://localhost:22 and do not restart cloudflared.
2. Add an Access Service Auth application for api.itkteam.store. Its only service-token include must be the dedicated production Worker token. Do not add Allow or Bypass policies. Confirm direct unauthenticated requests are denied.
3. In the Worker named game, enter these four values through masked Wrangler prompts or the Cloudflare dashboard. Never put them in source, shell arguments, or static assets:
   - ORIGIN_BASE: https://api.itkteam.store
   - GAME_PROXY_SECRET: the same fresh random value as production TRUSTED_PROXY_SECRET
   - CF_ACCESS_CLIENT_ID: production Access service-token ID
   - CF_ACCESS_CLIENT_SECRET: production Access service-token secret
4. Keep the workers.dev frontend public. Selective Worker-first routing handles only /api/* and /ws; public pages must not be covered by a login-required Cloudflare Access application.
5. After reviewing the production account, route, secret names, exact asset manifest, and rollback version, deploy only after separate explicit approval. The production command in cloudflare-game is npm run deploy, but do not run it before that approval.

The browser continues to use same-origin HTTPS and WSS. The browser never connects directly to api.itkteam.store or receives a service token. Test cookie forwarding, CSRF, session expiry, API authorization, WebSocket upgrades, reconnect, and direct-origin denial before accepting players.

## Production rollback plan

Before deployment, record the currently active Worker version. At this review it is cf6eca4a-3c43-4c10-87a7-8b4649ed8cab; confirm again immediately before release.

- Worker rollback, after approval: from cloudflare-game, run npx wrangler rollback <previous-production-version> --name game --yes.
- Backend code rollback: stop only prompt-works.service, restore the last known compatible /opt/prompt-works release, then start and check /healthz and /readyz. Preserve the database.
- Database recovery: use only a verified snapshot and a separately approved maintenance step. Restore replaces newer writes, so do not use it as a routine code rollback.
- Tunnel/Access rollback: remove or disable only the newly created production API route and its dedicated production Access application. Leave the SSH route, connector, staging route, staging policy, and telemetry Workers untouched.
- Production Worker rollback returns to the old static game and disconnects Phase 3 API use. Preserve database files for a later forward deployment.

## Free-tier limits and release gates

The Worker uses static assets plus lightweight proxy code; no Durable Objects, KV, D1, R2, or paid AI are used. Cloudflare currently documents 100,000 Workers Free requests per day shared across the account and 10 ms CPU per invocation. An initial WebSocket upgrade is one request; ongoing WebSocket frames are not separate Worker requests.

A planning example for 70 players who each start one session, save a profile, open the three-request progress panel once, submit once, and open one WebSocket is about 490 Worker requests/day, excluding retries and repeat views. If every player reconnects every 15 minutes all day, that adds about 6,720 handshakes/day. During a long outage, backoff caps can raise retry traffic considerably. These are code-based estimates, not account analytics. Current account-wide usage/headroom has not been measured; check it before the 70-client test.

The existing Oracle VPS was inspected as ARM64 Ubuntu with 2 OCPU, about 11.6 GiB RAM, and an existing disk. Oracle's published Always Free allowance includes up to 2 OCPU/12 GB on eligible A1 resources and 10 TB/month outbound transfer; verify this tenancy's current limits and usage. No additional Oracle or Cloudflare resource was created. Expected incremental monthly cost is $0 while existing resources remain eligible for Always Free and Worker usage stays within Free limits; the current tenancy bill and remaining allowances were not inspected.

Production was published and publicly verified on 2026-11-12; see PRODUCTION-DEPLOYMENT-STATUS.md. Next is a controlled public load test from the Windows runner after checking quota. The default run uses five minutes at 70 clients; a 30-minute soak is preferred. Report remaining capacity uncertainty if using the shorter test. Local-only backups are accepted for this demo. Present the exact production changes for final approval before applying them.
