# Oracle ARM64 Deployment Preparation

This is a prepared runbook only. No OCI tenancy was accessed, no cloud resource
was created, and no billing, networking, DNS, or provider setting was changed.
Do not treat this document or the local load test as an OCI capacity approval.

## Artifacts

- `deploy/prompt-works.service` is the systemd unit. It runs as the unprivileged
  `promptworks` account, binds the app to its configured loopback address, and
  limits write access to `/var/lib/prompt-works`.
- `deploy/Caddyfile.example` is the HTTPS and WebSocket reverse-proxy template.
- `deploy/prompt-works-arm64.env.example` is the production environment
  template. It starts in mock grading mode and contains no credentials.
- `package-lock.json` pins the npm dependency graph. Runtime SQLite is the
  Node built-in `node:sqlite` API; the project has no native npm addon that
  needs an ARM-specific compilation step.

## Owner-Gated Checklist

1. In the OCI console, confirm tenancy status, Always Free eligibility, actual
   A1 quota and capacity in the chosen home region, public IPv4 availability,
   boot-volume limits, and current pricing. These are account-specific and are
   not verified here. Do not create a VM until the owner approves the cost and
   availability decision.
2. Select a supported Linux ARM64 image and confirm `aarch64` architecture.
   Install a supported Node.js release (22.13 or newer; 24 LTS preferred) and
   verify both `node --version` and `node -p "process.arch"` (`arm64`). Install
   Caddy from its current official repository.
3. On an ARM64 build host or the target after owner approval, copy only this
   `multiplayer/` project. Run `npm ci`, `npm test`, then `npm prune --omit=dev`.
   Never reuse the Windows `node_modules` folder. Save the test output with the
   release artifact. The build uses TypeScript in dev dependencies, so pruning
   happens only after build and tests pass.
4. Create the `promptworks` system account and directories with ownership:
   `/opt/prompt-works` for the application, `/var/lib/prompt-works` for SQLite,
   and `/etc/prompt-works` for the private environment file. Set the data
   directory to mode `0700`; restrict the environment file to root and the
   service group. Do not place secrets in the project tree or a synced folder.
5. Copy `deploy/prompt-works-arm64.env.example` to
   `/etc/prompt-works/prompt-works.env`. Keep `GRADING_PROVIDER=mock`, set
   `SQLITE_PATH=/var/lib/prompt-works/game.sqlite`, and set `ROOM_CAPACITY` to
   a conservative value. Leave the Groq key and prices blank. Do not enable
   live grading until the owner verifies model availability, data terms,
   current prices, account-side limits, and approves a spend cap.
6. Install `deploy/prompt-works.service` as
   `/etc/systemd/system/prompt-works.service`. Confirm the Node executable path
   and `WorkingDirectory=/opt/prompt-works` match the host. Run `systemd-analyze
   verify` and inspect the unit before enabling it. Do not expose port 3000.
7. Configure Caddy with an owner-controlled hostname only after DNS ownership,
   ingress policy, and a change window are approved. Allow inbound 80/443 and
   administrator-restricted SSH only. Do not change nameservers or DNSSEC.
8. Before opening access, verify service restart/shutdown, `/healthz`, secure
   session cookie attributes, same-origin/CSRF rejection, WSS upgrade, room
   reconnect, backup and restore, and deletion behavior. Run a staged load
   test on the actual A1 VM and region and collect host metrics separately
   from the load generator.

## ARM64 Release Gate

The current Windows build and local load runs validate application behavior,
not the target architecture. A release still requires an ARM64 `npm ci &&
npm test`, service-unit verification on the chosen Linux image, a restore drill,
and staged tests behind the selected TLS proxy. The local 70-client result is
not a claim that an Oracle A1 shape can support 70 concurrent players.