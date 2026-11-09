# Verification Record

Last local run: 2026-11-09. These checks ran on one Windows development machine with Node 24.19 and npm 11.17. They are not production or Oracle measurements.

| Check | Result | Evidence / limit |
|---|---|---|
| Build and automated tests | PASS, 9/9 | `npm test`; includes source baseline, schema/storage, mock isolation, provider output contract, retry/queue behavior, HTTP/CSRF/static serving, session deletion, WebSocket hello, and phase-2 abuse/lifecycle checks. The latest HTTP-only assertion was separately re-run 2/2. |
| Game content baseline | PASS | Eight missions, six disciplines, 60% pass threshold; 58 extracted colliders; reference answers remain in the baseline artifact. |
| Browser multiplayer | PASS, local only | Two separate Edge processes joined the same local service and each saw both names. No page errors. Same host/process environment, not separate machines. |
| Review UI in mock mode | PASS | Mock response displayed NOT EVALUATED, 0%, and no XP. No external provider was called. |
| WebSocket load | PASS, local only | 70 clients for 10.017 s; 70 connected at end; 0 disconnects; 597 received messages/s; p95 ping 14 ms. See `reports/load-report.json`. Single-machine mock test only. |
| Live provider smoke/evaluation | NOT RUN | No API key, verified model ID, current provider pricing, owner approval, or spend cap supplied. |
| Provider retention / regional processing | NOT VERIFIED | Must be checked against the owner's current provider account and terms. |
| Oracle A1 capacity | NOT RUN | No OCI tenancy access or VM. Local 70-client results do not establish A1 capacity. |
| Public TLS, Caddy, Cloudflare, DNS | NOT RUN | No domain/OCI/Cloudflare access or owner authorization. |
| Cross-machine browser test | NOT RUN | No second physical/network environment was available. |
| Browser mobile test on migrated service | PASS, local only | At 390px viewport width, document width was 390px and the mission sheet width matched its 356px client width; no horizontal overflow. See `reports/current-browser.json`. |

## Phase 2 Production-Readiness Verification

Run date: 2026-11-09. These results are local development checks, not a release
approval. The original root HTML files were not edited.

| Check | Result | Evidence / limit |
|---|---|---|
| Full automated suite | PASS, 9/9 | `npm test`, including new isolated WebSocket lifecycle and abuse-control coverage. |
| Late join and stationary presence | PASS | Late join welcome roster includes the existing stationary player and position. |
| Movement synchronization | PASS | Server delta for a valid move was observed by another peer. |
| Reconnect and departure | PASS | Reconnect handshake restores the same guest; planned leave is broadcast to remaining peers. |
| XP authority and roster integrity | PASS in mock mode | Spoofed client `xp` movement field is rejected; extra score/XP/review fields on the API are rejected; mock review and peer progress stay at 0 XP. Existing Store test covers server-side verified-result XP accounting. |
| Assessment anti-cheating | LIMITATION | Reference answers are present in the client bundle for training; server-owned XP prevents direct score injection but does not prove authorship or make this a secure employment assessment. |
| Duplicate submissions | PASS | Same ID and same content returns cached result; different content with the same completed ID returns HTTP 409. |
| Rate limits | PASS | Review quota returns HTTP 429; WebSocket message flood closes the client with code 4008. |
| Malformed AI response | PASS, mocked provider | Invalid JSON from the provider adapter is rejected as `ProviderError`; no external call was made. |
| Groq English/Vietnamese live grading | NOT RUN | No Groq key, model, prices, or spend cap is configured. Fictional answers were not sent externally. |
| 70-client 30-minute sustained load | PASS, local mock only | 1,800.074 s; 70 online at end; 1,788 one-second samples; 5 planned reconnects all succeeded; 0 unexpected disconnects; 0 failed clients. See `reports/phase2-load.json`. |
| Oracle ARM64 deployment preparation | PREPARED, not deployed | Environment template and gated checklist are in `deploy/prompt-works-arm64.env.example` and `docs/oracle-arm64-deployment.md`. No ARM64 build host or OCI VM was used. |
| OCI, DNS, billing, public TLS changes | NOT PERFORMED | No cloud resource, account setting, DNS record, nameserver, DNSSEC, or billing setting was changed. |

### Remaining Risks and Release Checklist

- Review the full sustained test report. Its loopback bandwidth excludes
  IP/TCP/TLS framing, and host CPU/RAM includes the local load generator and
  other workstation processes. A short Edge browser smoke overlapped this run.
- Run `npm ci && npm test` on the owner-selected Linux ARM64 image; verify the
	systemd unit and Caddy configuration there, then perform a database restore
	drill before public access.
- Run cross-machine browser tests through the approved HTTPS/WSS endpoint and
	repeat staged load tests on the actual VM/region. Local results do not prove
	OCI capacity or public network behavior.
- Before enabling Groq, confirm current model availability, pricing, quota,
	retention, training and processing-region terms; obtain owner approval and
	configure strict provider-side spend controls. Evaluate both English and
	Vietnamese rubric fairness using fictional data only.
- Treat the game as training, not a proctored or cheat-proof certification:
	reference answers are client-visible and model grading is not identity proof.
- Confirm account-specific OCI quota/capacity, operating ownership, TLS renewal,
	monitoring, backup/restore, incident response and deletion procedures. Do
	not change DNS, DNSSEC, billing, or create resources without owner approval.

### Sustained Load Measurements

The 70-client mock-mode run used one Windows development machine, loopback
WebSockets, and 5 Hz movement/snapshot settings. A short browser smoke overlapped
the run, so host-wide resource figures include unrelated workstation activity
and are not an isolated capacity measurement.

| Metric | Measured result |
|---|---:|
| Server CPU average / peak | 2.66% / 10.93% of one logical core |
| Host CPU average / peak | 19.05% / 100% across logical cores |
| Server RSS peak / end | 86.33 MB / 82.24 MB |
| Host used RAM peak | 24.39 GB |
| WebSocket payload bandwidth in / out | 0.232 / 16.451 Mbps |
| Ping/pong RTT p50 / p95 / p99 | 4.328 / 9.263 / 13.355 ms |
| WebSocket messages in / out | 367.76 / 367.91 per second |
| Combined WebSocket messages | 735.67 per second |
| Planned disconnects / successful reconnects | 5 / 5 |
| Unexpected disconnects / failed clients | 0 / 0 |

Bandwidth counts WebSocket application payload only and excludes TCP/IP, TLS,
HTTP upgrade, and proxy overhead. Host CPU peaked at 100%; host-wide CPU/RAM
cannot be attributed solely to this service. These values do not establish
Oracle ARM64 or production capacity.

## Release Gates

- Run `npm ci && npm test` on the target Node release and deployment architecture.
- Configure owner-approved provider limits and run the reference evaluation under an explicit spend cap; review results manually for every language and mission.
- Run browser tests from at least two separate client networks against the HTTPS/WSS deployment, including reconnect, movement correction, reset, and deletion.
- Run staged load tests on the actual VM and region while measuring CPU, RSS, event-loop delay, network, SQLite latency, and provider queue saturation.
- Verify TLS renewal, backups, restore, OS patching, incident contacts, and data deletion procedures.
- Update this record only with dated output from the named environment. Never promote a local measurement to a cloud claim.