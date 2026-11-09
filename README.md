# ITK-BGSV Prompt Works Multiplayer

This folder contains the runnable Node.js multiplayer service, the editable game copy, deployment files, tests, and local verification reports. The original game and older backup remain in the parent folder unchanged.

## Run Locally

Requires Node.js 22.13 or newer. The tested development runtime is Node 24.19.

```powershell
npm install
npm test
npm start
```

Open <http://127.0.0.1:3000>. The default grading mode is `mock`: it returns an explicit “Not evaluated” result and never awards XP. Do not interpret mock output as a model review. Three.js is served from the locally installed package; the game no longer uses Supabase.

For live grading, copy `.env.example` to `.env`, confirm the current Groq model ID (candidate: `openai/gpt-oss-20b`), provider data-retention terms, region, quotas, and per-token prices in the owner’s account, then fill in the private key and budgets. Live mode will not start without explicit positive input/output prices and a daily USD cap. Never commit `.env` or expose the API key to browser code.

## Commands

- `npm test` builds the catalog and runs baseline, grader, storage, HTTP, and WebSocket tests.
- `npm run test:browser` runs two separate local Edge processes against an already-running server and checks roster, online status, and mock no-XP behavior.
- `npm run load` starts an isolated local mock server; set `LOAD_CLIENTS` (1-200), `LOAD_DURATION_MS` (1,000-1,800,000), and optionally `LOAD_RECONNECT_INTERVAL_MS` (default 300,000) to configure the run. The report samples process/host CPU and RAM, loopback ping latency percentiles, WebSocket payload bandwidth, message rates, and planned/unexpected disconnects under `reports/phase2-load.json`.
- `npm run evaluate` submits all eight reference answers to the configured live provider. It requires `EVALUATION_MAX_USD` and independently checks a conservative worst-case estimate before sending any request. It is an opt-in paid operation.

Reports and screenshots are written under `reports/`. Never place provider keys, real user answers, or personal data in reports or issue trackers.

The load report is local-only: CPU/RAM include the local load generator at host level, and bandwidth counts WebSocket application payload rather than TCP/IP/TLS wire bytes. It does not establish Oracle ARM64 or production capacity.

## Data and Trust Boundaries

Guest identity is an opaque random cookie, HTTP-only, SameSite Strict, and Secure in production. API mutations require a same-origin Origin and CSRF token. Scores, pass gates, ranks, and XP are server-owned. Browser local storage holds only the editable profile convenience and drafts; legacy local scores are ignored. “Delete guest data” removes the guest, stored reviews, results, and cookie. Guest records expire after 30 days, and cached review records are pruned after 30 days.

Live grading sends the submitted answer, mission prompt, and rubric to Groq. The service stores the answer hash and review result, not raw answer text. Provider-side handling is outside this project’s control and must be reviewed by the account owner. Reference answers remain in the client bundle for the learning workflow, so this is not a cheat-proof assessment system.

The service and SQLite database are single-instance. Do not run multiple app processes against one SQLite file. Back up `data/game.sqlite` with the service stopped or through a SQLite-aware backup mechanism. The server defaults to loopback; expose it only behind the TLS reverse proxy.

## Operations

See [Oracle and Cloudflare deployment](docs/deployment-oracle-cloudflare.md), [privacy and risk notes](docs/risks.md), and [verified test results](docs/testing-results.md). Deployment, spending, and DNS changes require the account owner; none are performed by this project.

The prepared Oracle ARM64 artifacts and owner-gated checklist are in [Oracle ARM64 deployment preparation](docs/oracle-arm64-deployment.md). They are templates only and do not create cloud resources.