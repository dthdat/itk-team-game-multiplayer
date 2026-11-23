# Staging reconnect investigation — 2026-11-10

The owner's report concerned network lag. The earlier mobile resolution change
was not a fix for that report. A room-size health sample was insufficient to
rule out short reconnects. Actual socket close codes and lifecycle tests found
two defects, now fixed on staging.

## Confirmed faults and fixes

1. Two tabs sharing an account or guest identity replaced each other's sockets.
   Every close (including intentional server code 4001) triggered a retry. The
   public browser reproduction opened six sockets in each tab in seven seconds.
   The replaced tab now stops retrying and displays "Active in another tab".
   Code 4004 similarly stops retries and asks the player to reload/sign in.
   Normal network failures retain the existing reconnect backoff.
2. Deleting a connected guest removed its SQLite record before the asynchronous
   socket close saved its last position. That write failed its foreign key,
   crashing the backend and dropping unrelated players with code 1006. This
   occurred during synthetic test cleanup; the systemd journal confirmed the
   exception in `Store.savePosition`. Deletion now detaches the peer, disables
   its position writes, and removes its dirty entry before deleting records.
   Position inserts also atomically check that their owner still exists.

No heartbeat protocol change was needed. Native control pings are not visible
at the public client, but the sustained public test passes without changing the
server heartbeat. The initial suspicion that missing control frames caused the
disconnect was superseded by the crash log.

The frontend now displays actual application RTT beside connection status.
It sends a small WebSocket ping on welcome and every ten foreground seconds,
clears its timer on close, and hides stale latency on disconnect. No HTTP
movement polling, new service, paid feature, AI call, or XP award was added.

## Verification

- `npm test`: build and all 18 tests passed with localhost socket permissions,
  on the same ARM64 Node 24.22.2 runtime. The former restricted-runner native
  assertions did not recur in this permitted run.
- `node tools/verify-network-lifecycle.mjs`: passed with an isolated in-memory
  backend. Checks duplicate replacement, deletion with an open socket, survival
  of another player, readiness, and a position write after record deletion.
- [Browser before](reports/staging-duplicate-tabs-before.json): both tabs
  repeatedly closed with 4001 and reopened.
- [Browser after](reports/staging-duplicate-tabs-after.json): each tab opened
  once; only the old tab closed with 4001, the new tab stayed Online and showed
  11 ms RTT. Cleanup deleted its synthetic guest without a backend restart.
- [Public WSS check](reports/staging-network-check.json): two clients for
  70 seconds, 138 RTT samples, zero unexpected closes, zero movement corrections,
  both connections open at the end. Median 10.14 ms, p95 15.92 ms, p99 54.54 ms.
  The duplicate-tab browser test and its guest deletion ran concurrently.
- The sustained check originated on Oracle and traversed public Worker,
  Access and Tunnel. It does not measure the owner's device/network or prove
  70-player capacity. The new browser RTT display supports that next check.
- After the staging update, the same backend PID survived these tests with
  `NRestarts=0`. Synthetic sessions were deleted by the test tools.

## Release and recovery

Only Worker `game-staging` was published. Active version:
`59b210cb-c832-4ed3-aec8-da9217e24b52`. Backend service
`prompt-works-staging.service` received three compiled files (`index.js`,
`room.js`, `store.js`) and one controlled restart. No database migration was
needed. Production Worker, production data, SSH, Tunnel routes, Access policy,
firewall and telemetry Workers were untouched.

The prior backend files are protected under
`/opt/prompt-works-staging/rollback-network-20261110/`. Restoring them would
reintroduce the guest-deletion crash, so prefer a forward fix. If an approved
staging rollback is necessary:

```sh
sudo install -o root -g promptworks-staging -m 0640 \
  /opt/prompt-works-staging/rollback-network-20261110/index.js \
  /opt/prompt-works-staging/rollback-network-20261110/room.js \
  /opt/prompt-works-staging/rollback-network-20261110/store.js \
  /opt/prompt-works-staging/app/dist/server/
sudo systemctl restart prompt-works-staging.service
```

The previous staging Worker version `d8f910ab-221a-4667-8448-1dcdadc7e01f`
already includes duplicate-tab handling, but lacks the latency readout. From
`cloudflare-game/`, the staging-only rollback command is:

```sh
npx wrangler rollback d8f910ab-221a-4667-8448-1dcdadc7e01f --env staging --yes
```
