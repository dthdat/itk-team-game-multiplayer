# Oracle Cloud and Cloudflare Deployment Runbook

This is a gated runbook, not a deployment record. No tenancy, domain, billing, key, email, DNS, or Cloudflare access was provided; nothing here changes infrastructure. The owner must review costs, region availability, quotas, data handling, and recovery before proceeding.

## 1. Owner Checks

1. Confirm the Oracle tenancy’s remaining Always Free A1 allowance, home region capacity, public IPv4 availability, and account status in the OCI console. Public Always Free documentation describes an aggregate allowance equivalent to 2 OCPUs and 12 GB RAM, plus 10 TB/month outbound transfer; this is not proof that a particular tenancy can create that capacity. Oracle capacity is not guaranteed in every region.
2. Confirm the project owner accepts responsibility for operating-system updates, backups, monitoring, incident response, and possible account/service availability changes.
3. Confirm Groq’s currently available model ID, rate limits, price, prompt/data retention, training usage, and processing region in the owner’s account and current provider terms. The default candidate is a configuration value only, not an assertion about current availability or free quota.
4. Confirm the domain, registrar access, existing DNS records, mail-related records, current DNSSEC state, and the current DNS provider. Do not start a nameserver change until the owner approves a maintenance window and has exported the zone.
5. Decide whether free-tier outage risk and the single-node SQLite architecture are acceptable. This project has no horizontal scaling, automatic failover, or managed database.

## 2. Prepare the VM

1. Create an ARM64 A1 VM only after confirming actual quota/capacity. Restrict ingress to SSH from administrator networks and TCP 80/443 from the internet. Do not expose port 3000.
2. Install supported Node.js 22.13+ (24 LTS preferred), Caddy, and a system user with no interactive login. Keep the Node process bound to `127.0.0.1`.
3. Transfer only this `multiplayer/` project directory. Install production dependencies with the lockfile (`npm ci --omit=dev`), build in a controlled environment (`npm ci && npm test && npm run build`), and deploy the tested `dist/`, `index.html`, `node_modules/three`, package metadata, and runtime server files.
4. Create a private data directory owned by the service account. Set mode `0700` on the directory and restrictive file permissions on SQLite and its WAL/SHM files. Keep data off synced folders and public web roots.
5. Create `.env` outside source control with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, `SQLITE_PATH` pointing to the private data directory, `GRADING_PROVIDER=mock` initially, and an appropriate `ROOM_CAPACITY`.
6. Enable a systemd service using the supplied [systemd unit](../deploy/prompt-works.service). Use `WorkingDirectory` set to the app directory, `EnvironmentFile` set to the private `.env`, `Restart=on-failure`, `NoNewPrivileges=true`, `ProtectSystem=strict`, and `ReadWritePaths` limited to the data directory. Confirm graceful SIGTERM shutdown and restart behavior before inviting users.

## 3. Caddy and TLS

Use [Caddyfile](../deploy/Caddyfile.example) as a starting point. Replace `game.example.com` with the owner-controlled hostname and verify the origin resolves to this VM before enabling automatic certificates. Caddy should reverse-proxy HTTP and WebSocket requests to `127.0.0.1:3000`; it must preserve the browser Host header and must not enable unauthenticated public access to port 3000.

Validate the configuration, confirm certificate issuance and renewal, and verify `/healthz`, the page, API session cookie (`Secure`, `HttpOnly`, `SameSite=Strict`), and `wss://` upgrade through the public HTTPS origin. Test that nonmatching Origin and missing CSRF requests fail. Configure host firewall and OCI security lists consistently.

## 4. Cloudflare (Optional)

Cloudflare is not required for the app or Caddy. If the owner chooses it, confirm their current product/plan supports their intended WebSocket use and review the current limits. Proxy WebSockets through the orange-cloud record only after testing stable upgrades and idle reconnects. Set SSL/TLS to **Full (strict)**, with a valid origin certificate whose hostname matches the site.

The sample Caddyfile keys the short-lived session-start limiter using Caddy's immediate remote peer. If Cloudflare is proxied, that peer is a Cloudflare edge address, not an end user. Before enabling Cloudflare, configure Caddy's trusted-proxy ranges using Cloudflare's current published IP ranges, use Caddy's trusted client-IP placeholder for `X-Real-IP`, and verify spoofed client forwarding headers are ignored. Do not simply trust `CF-Connecting-IP` or `X-Forwarded-For` from arbitrary sources.

For a full-zone onboarding only: export and compare all DNS records, identify mail and verification records, check DNSSEC with the registrar, and agree on a change window. Follow Cloudflare’s current onboarding steps. If their instructions require disabling old DNSSEC before nameserver replacement, the owner must perform that change and re-enable DNSSEC after the new zone is active. Verify mail, apex/www records, CAA, certificate issuance, and DNSSEC after propagation. Never alter nameservers or DNSSEC without explicit owner authorization.

## 5. Enable Live Grading (Separate Approval)

Start and validate with `GRADING_PROVIDER=mock`. Before live grading, the owner must approve provider use and data transfer, verify retention/region/terms, set a low initial cap, and supply a private API key. Fill in the model ID, positive `GROQ_INPUT_USD_PER_MILLION` and `GROQ_OUTPUT_USD_PER_MILLION` values from current account pricing, `DAILY_MAX_USD`, and `DAILY_MAX_TOKENS`. Restart and inspect startup. Run the reference evaluation only after setting `EVALUATION_MAX_USD`; it will stop before provider calls if its conservative ceiling exceeds that cap.

The application estimates token usage conservatively and reserves up to two attempts per review. It does not reconcile estimated reservations to provider invoices. Configure account-side limits/alerts as the primary spend control. Provider model output still requires ongoing human rubric validation.

## 6. Backups, Monitoring, and Rollback

- Back up the SQLite database using SQLite’s online backup mechanism or with the service stopped, including a documented restore drill. A file copy while WAL writes are active is not a verified backup.
- Monitor free disk, CPU, memory, process restarts, certificate renewal, HTTP status, connected clients, provider errors, budget reservations, and daily outbound traffic without logging answer text, cookies, or API keys.
- Set OS and package update windows; rebuild and run `npm test` before release.
- Roll back the app release by restoring the previous project build, but retain a compatible SQLite backup. Schema changes require a tested migration/rollback strategy before deployment.
- Test restore, expired sessions, provider outage, budget exhaustion, app restart, WebSocket reconnect, and Caddy certificate renewal before production use.

## 7. Capacity Gate

The local 70-client run in `reports/load-report.json` is a single-machine mock-mode result only. It does not test an A1 VM, TLS proxy, real provider latency, multi-region clients, process restarts, or Oracle network limits. Before selecting a public capacity, benchmark on the actual VM and region at 1, 10, 25, 50, and 70 clients with realistic movement, then measure CPU/RAM, event-loop delay, socket counts, bandwidth, reconnect storms, SQLite writes, and provider queue behavior. Add headroom and a lower enforced room cap if any resource saturates. Do not advertise “70 players” based on the local run.