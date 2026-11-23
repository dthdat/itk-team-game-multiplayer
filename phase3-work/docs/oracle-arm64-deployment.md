# Oracle ARM64 deployment status

The staging Phase 3 service is installed and active on the existing Oracle ARM64 VPS. It runs as unprivileged promptworks-staging on 127.0.0.1:3001, with a dedicated SQLite database, protected environment, separate systemd unit, bounded journal namespace, and daily local backup timer. The staging backup completed and verified on 2026-11-11. It uses Node 24.22.2.

Production was installed and locally verified on 2026-11-12 after explicit approval. Public cutover is blocked by Cloudflare DNS/Access permissions. See ../PRODUCTION-DEPLOYMENT-STATUS.md. Its separate templates are:

- deploy/prompt-works.service — unprivileged production service on 127.0.0.1:3000 with restart policy, resource/task limits, restricted writable paths.
- deploy/prompt-works-backup.service and deploy/prompt-works-backup.timer — daily SQLite online backup with 30-day local retention.
- deploy/prompt-works-arm64.env.example — mock-only environment template with placeholders, no real secrets.
- deploy/promptworks-journald.conf — bounded production journal namespace.
- tools/backup.mjs — online backup, integrity verification, and restore.

The production database path is /var/lib/prompt-works/game.sqlite and the service account is promptworks. The application must bind only to 127.0.0.1:3000. The future production Worker proxy would reach it through a dedicated Access-protected Tunnel hostname. No production route or Access application is configured.

The current Oracle host was inspected as ARM64 Ubuntu with 2 OCPU and approximately 12 GB RAM. No additional VM or paid resource was created. Verify account-specific Always Free eligibility and usage before release. Do not change the firewall, SSH route, existing Tunnel connector, or production database.

See [DEPLOYMENT-GUIDE.md](../DEPLOYMENT-GUIDE.md) for the production sequence and [BACKUP-RESTORE.md](../BACKUP-RESTORE.md) for local recovery. The Windows public load runner is prepared. No off-host backup integration is planned; catastrophic host/disk progress loss is accepted.
