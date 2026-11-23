# Multiplayer protocol, version 1

## Connection and identity

Clients open same-origin wss://<workers.dev-host>/ws (or ws://localhost in local development). The browser sends its normal pw_account or pw_session HttpOnly cookie and an Origin header. The Worker forwards both. The Node server validates the cookie, public origin, and proxy contract before upgrading. A guest UUID or account ID comes only from that validated session; the client cannot nominate identity or submit XP. Display names are not credentials. Each stable identity has one active socket. A newer socket closes the old one with code 4001. The old browser stops automatic retries and displays “Active in another tab”; reload explicitly to take over. Session-ended code 4004 stops retries and requests a reload. Network interruptions use exponential backoff.

The server accepts at most 80 joined players by default. A client must send hello within eight seconds. Initial join uses:

    {"type":"hello","v":1}

A reconnect uses the same schema with reconnect as the type. The welcome message contains the player's own authenticated ID, restored profile and position, the current joined roster, server-owned progress, sequence number, and server timestamp. Stationary players are included so late joiners see the full room. The current player is rendered locally.

## Client messages

| Type | Fields | Behavior |
|---|---|---|
| hello | v: 1 | Join after session validation. |
| reconnect | v: 1 | Rejoin the same authenticated identity and restore its last position. |
| move | seq, finite x, z, yaw, optional finite y | Strictly increasing sequence. Server checks world bounds, collision path, token-bucket speed, and caps jump height y at 1.5 m. |
| ping | finite at | Requests an application-level pong for RTT measurement. |
| leave | none | Closes the socket and broadcasts departure. |

Unknown fields, malformed JSON, binary messages, invalid types, and non-finite coordinates are rejected. No chat or peer-to-peer messages exist.

## Server messages

| Type | Fields | Behavior |
|---|---|---|
| welcome | you, self, players, progress, seq, at | Initial snapshot and restored self position. |
| join | player, seq, at | New peer/profile visible to other clients. |
| leave | id, seq, at | Peer disconnected or replaced. |
| delta | moves, seq, at | Coalesced movement tuple: id, x, z, yaw, updatedAt, y. |
| snapshot | players, seq, at | Full roster every ten seconds. |
| correction | authoritative x, z, yaw, seq, at | Client receives its last accepted location after invalid motion. |
| progress | player, optional owner progress, seq, at | Reserved for verified server progress; this phase cannot create verified grades. |
| pong | echoed at, serverAt | Application RTT response. |
| error | stable code, safe message | Invalid message; repeated violations close the socket. |

## Timing and limits

- The browser sends changed movement at up to 10 Hz and runs the 3D renderer independently. The room coalesces movement and broadcasts at up to 10 Hz.
- Remote players interpolate timestamped movement samples in a short adaptive buffer and animate legs/arms from velocity. Movement is capped to legal server speed; this limits visual jumps after delayed packets.
- Jump lasts about 720 ms, is available through Space on desktop and a localized touch button, and synchronizes only bounded vertical position. Jump does not affect collisions, mission progress, or XP.
- The foreground browser sends an application ping after welcome and every ten seconds. The displayed value is browser-to-backend round-trip time over WebSocket frames.
- Server ping/pong heartbeat runs every 15 seconds. A missed heartbeat, expired session, or hello timeout closes the socket.
- Incoming payload limit is 2 KiB. A 40-token burst / 25-per-second message bucket, bounded movement bucket, slow-client queue limit, and strike counters close flooding or invalid clients.
- Default capacity is 80. Position snapshots are stored no more than every ten seconds and at disconnect or graceful shutdown. Per-frame movement stays in memory.

The server does not trust localStorage for identity or progress. The display name and language may be remembered there, while the backend's opaque session cookie selects the guest record. A guest cookie currently expires after 30 days. The server restores profile and progress on each authenticated join. Account deletion disables position persistence and detaches the peer before removing records.

## Verification and limitations

Automated tests cover authentication cookies, Origin rejection, roster join/leave, stationary late join, movement deltas, jump bounds, invalid/flooded messages, reconnect identity, position restoration across restart, and account deletion while a socket is connected. The latest public staging browser test verified three guest identities, movement, late join, reconnection, jump, and pending progress persistence. It observed roughly 100 ms movement samples and no browser errors.

A historical local 70-client, one-minute loopback soak with five planned reconnects completed with zero unexpected disconnects. A historical public two-client test measured p50/p95/p99 RTT 10.14/15.92/54.54 ms. Neither run is a current 70-player public capacity test. See LOAD-TEST-RESULTS.md and NETWORK-INCIDENT.md.


## AI review progress notifications

No new high-frequency messages or movement polling are introduced. After a validated review/XP transaction commits, the existing server progress message updates the submitting player's progress and broadcasts public XP/rank changes to peers. The browser then fetches its owner-scoped /api/submissions/:id result. A visible/online review has a 30-second, ten-minute-bounded fallback status check. Reconnect restores current progress from SQLite. AI result/answer bodies are never sent to other players over WebSockets.
