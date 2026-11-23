# SQLite backup and restore

## AI release — 2026-11-12

Production Worker game is deployed at https://game.itkvn.workers.dev as version d5e0b33d-1d83-4af6-aaee-0ac44d928dd6. Oracle now runs the Groq Free-plan grading queue, server-validated best-mission XP and guest leaderboard. All eight answer boxes have editable English/Vietnamese brainstorming scaffolds that preserve drafts. Old pending submissions are not sent automatically; new submissions require the AI notice/consent flag. See [AI-GRADING-RELEASE.md](AI-GRADING-RELEASE.md) and [PRODUCTION-DEPLOYMENT-STATUS.md](PRODUCTION-DEPLOYMENT-STATUS.md) for current verification and rollback. Earlier pending-only Phase 3 notes below are historical.


## Accepted demo backup policy

The demo uses the existing daily local SQLite backup mechanism only. No Google Drive, cloud storage, encryption, remote transfer, or backup integration will be added. The owner accepts that a catastrophic Oracle host or disk failure can erase demo player progress and local backups.

The staging systemd timer writes a daily snapshot to /var/backups/promptworks-staging and retains seven days. It runs as the unprivileged promptworks-staging account. On 2026-11-11 at 04:24 UTC, a staging backup completed and passed SQLite verification:

    /var/backups/promptworks-staging/game-2026-11-11T04-24-15.263Z.sqlite

The backup helper uses SQLite VACUUM INTO, then checks integrity and foreign keys. The automated nonproduction restore test restores a disposable database and verifies synthetic session/profile/submission/position data. The production template keeps 30 daily local copies under /var/backups/promptworks. It was installed and its initial backups succeeded on 2026-11-12 after approval.

## Backup commands

The staging timer runs automatically. A manual snapshot can be made by the staging backup service. To verify a selected snapshot:

    /opt/prompt-works-staging/runtime/node /opt/prompt-works-staging/app/tools/backup.mjs verify /var/backups/promptworks-staging/game-TIMESTAMP.sqlite

The project also provides npm run db:backup for a local development environment. Do not place production secrets in a project-tree .env file.

## Staging restore procedure

For an approved staging recovery, stop only the staging unit, verify the selected snapshot, restore it, then start and health-check the same service:

    sudo systemctl stop prompt-works-staging.service
    sudo -u promptworks-staging /opt/prompt-works-staging/runtime/node /opt/prompt-works-staging/app/tools/backup.mjs verify /var/backups/promptworks-staging/game-TIMESTAMP.sqlite
    sudo -u promptworks-staging /opt/prompt-works-staging/runtime/node /opt/prompt-works-staging/app/tools/backup.mjs restore /var/backups/promptworks-staging/game-TIMESTAMP.sqlite /var/lib/prompt-works-staging/game.sqlite --force
    sudo systemctl start prompt-works-staging.service
    curl --fail http://127.0.0.1:3001/readyz

The restore helper creates a safety snapshot before replacing an existing database and refuses to replace it while WAL/SHM sidecars remain. Keep the safety snapshot until the service is verified.

## Production recovery

After the separately approved production service is installed, use its daily local snapshot if recovery is needed. Stop only prompt-works.service, verify no SQLite WAL/SHM sidecars remain, then restore a verified snapshot with explicit --force. Restore replaces newer writes. The helper makes a safety snapshot before replacement. Start the service and verify /healthz, /readyz, a synthetic session, and submission history.

The new dedicated production database and local backup service were initialized and smoke-tested on 2026-11-12 after approval. There is no off-host recovery copy; this is an accepted demo risk.
