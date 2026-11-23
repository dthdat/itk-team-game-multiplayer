# ITK-BGSV testing frontend on Cloudflare Workers

Status: **DEPLOYED and browser-verified** at <https://game.itkvn.workers.dev>.
Wrangler account: Dothanhdat13@gmail.com’s Account (ID
`b4b9f742f28e64118e517db91a9e8414`), workers.dev subdomain `itkvn`. Worker `game`
now serves the ITK-BGSV frontend. Deployed version:
`cf6eca4a-3c43-4c10-87a7-8b4649ed8cab` (2026-11-10 04:05 UTC).

The pre-deployment `game` version was a Cloudflare dashboard template serving
`Hello World!`, with no bindings. The approved deployment replaced that placeholder.
The original repository game source, Node backend and Oracle deployment were not
changed. Before deployment, persistent invocation logging was enabled. The
post-deploy API settings show Logpush off, observability unconfigured and no traces
enabled. No paid resource was created.

## Source and deployment boundary

Current source: repository `index.html` at commit `9afbcbf`; older original:
`baseline/ITK-BGSV Prompt Works_backup_2026-11-09_10-25-05-288.html`.
`prepare.mjs` reads the current source without editing it. It copies Three.js
0.128.0 from the locked root dependency and its MIT license. There is no frontend
bundler: `npm run build` in the root generates the server catalog and compiles
TypeScript for Node, not a Workers-compatible backend.

Only `public/` is uploaded as Workers Static Assets:

- `index.html`: actual game, eight missions, six disciplines, office, procedural
  textures, embedded base64 logo, movement and mission UI.
- `game-config.js`: public backend configuration; disabled by default.
- `vendor/three.min.js` and `vendor/three.LICENSE.txt`.

No node_modules, server code, database, .env, keys, tokens, reference documents or
verification screenshots are in the uploaded directory. Reference mission answers
already present in the game remain client-visible, as in the existing source.
External resources: Google Fonts stylesheet (Barlow Condensed, IBM Plex Mono,
IBM Plex Sans) from fonts.googleapis.com, with font files from fonts.gstatic.com.
No remote Three.js CDN, external texture files, ES module imports or Supabase
integration is used by the current frontend. Fonts require network access and
fall back to the existing CSS font stacks.

## Deployment and verification record

- Wrangler 4.159.0 deployed four static files: `public/index.html`,
  `public/game-config.js`, `public/vendor/three.min.js` and its license.
- The game page and Three.js asset return HTTP 200 from the public URL.
- Public Chromium verification passed for Three.js rendering, the office and nine
  local NPC avatars, keyboard movement, all eight mission briefs and English/
  Vietnamese title switching. The 390px mobile viewport has no horizontal overflow.
- No console errors, failed HTTP requests or backend calls were observed.
- Grading is unavailable and awards zero XP. Multiplayer and remote avatars require
  the Oracle backend; neither service is connected by this static deployment.
- Root `npm test` passed 9/9 before deployment. See
  [verification results](verification/RESULTS.md) and [public browser report](verification/public.json).

## Deliberate frontend-only behavior

The current original requires a Node session to clock in. The isolated copy adds
an explicit frontend preview mode so the office can be explored without pretending
the service exists. All eight mission briefs, including the normally gated Gate 4
mission, are open for frontend testing. No passed missions or XP are fabricated.
Drafts and profile convenience values use a separate browser localStorage key.
Submission shows that Oracle grading is disconnected. No remote players are
simulated. NPCs are part of the original local office, not multiplayer peers.
Reset/delete only affect local preview data. Backend mode restores the original
mission prerequisite checks and server-owned progress.

## Reproduce

Requires Node >=22.13 (validated here with Node 24.22.2).

```sh
# From repository root
npm ci
npm test
cd cloudflare-game
npm ci
npm run prepare:assets
npx wrangler dev --local --port 8787
# In another terminal, from repository root:
node cloudflare-game/verify-browser.mjs
```

Browser checks use root Playwright and Chromium (`npx playwright install chromium`
and, if needed, `npx playwright install-deps chromium`). Test-only closure
introspection is injected in memory by Playwright; it is absent from public HTML.
The existing `npm run test:browser` assumes two Microsoft Edge processes and a
running Node backend, so it is not the static-preview test.

## Authentication, target verification and approval gate

Wrangler is pinned to 4.159.0, the npm latest release checked on 2026-11-10.
For this remote SSH session, use the official OAuth device flow: run
`npx wrangler login --device --browser=false` in `cloudflare-game/`. Wrangler
prints a short-lived code and verification URL; open the URL on your phone, enter
the code and approve Wrangler. Keep the SSH command running while you approve;
Wrangler polls for completion. The code expires after a few minutes, so rerun the
command if needed. Do not share the code or save it in the repository. Never paste
or export API tokens to this project.
After login, run `npx wrangler whoami` and verify the exact account ID and name.
Read the account's Workers subdomain using the authenticated Cloudflare dashboard
or GET `/accounts/{account_id}/workers/subdomain`: it MUST be `itkvn`.
List Workers and inspect only `game` if present: current code/assets, bindings,
routes, deployments, workers.dev enablement and whether it is the production game
or unrelated. Do not overwrite it if ownership/purpose cannot be established or
if it is the protected production game. Do not touch telemetry Workers.
The verified account ID is pinned in `wrangler.jsonc`. Recheck it immediately
before publishing.

Then show the owner the exact account, Worker `game`, intended URL
`https://game.itkvn.workers.dev`, this public file manifest and whether an existing
Worker is being replaced. Obtain explicit publishing approval. Authentication is
not publishing approval. Do not use Wrangler's temporary-account deployment.

Only after verification and approval:

```sh
cd cloudflare-game
npx wrangler deploy
```

Verify the public URL in a browser and repeat rendering, controls, translation,
asset, console and mobile checks. Local success does not verify public deployment.
Keep the returned deployment/version IDs in the verification record.

## Redeploy and rollback

Redeploy: root `npm ci`, run existing tests, then `cd cloudflare-game && npm ci &&
npm run prepare:assets`; review diffs and rerun local browser checks. Repeat target
verification and obtain publishing approval, then `npx wrangler deploy`.

Before replacing an owned testing Worker, record its current version with
`npx wrangler deployments list` and `npx wrangler versions list` and retain the
previous source/assets. After explicit rollback approval, use
`npx wrangler rollback <previous-version-id>` in this directory, verify the
account/name and public URL. If this is the first version, there is no earlier
version to roll back to; retain it for later rollback. Do not delete a live Worker
as a fallback. Backend data migrations would require a separate rollback plan.

## Oracle connection: future phase, not configured

Node backend files are `server/index.ts` (HTTP/API), `room.ts` (WebSocket rooms),
`store.ts` (SQLite/progress/session authority), `grader.ts` (mock or Groq),
`protocol.ts` and `catalog.ts`. These cannot be served as static files or treated
as a Node process running in Workers. Root server tests are local Node checks.

Existing routes: GET/DELETE `/api/session`, POST `/api/profile`, `/api/reset`,
`/api/review`, and WebSocket `/ws`. Existing browser uses same-origin routes,
HTTP-only SameSite=Strict cookies, a session CSRF token and Origin verification
for writes and WebSocket upgrades. The original has no hardcoded localhost
backend endpoint; location determines the host and WS/WSS protocol.

`public/game-config.js` provides `serviceEnabled` and `backendOrigin` (empty =
same origin). Cross-origin mode requires HTTPS, derives WSS, and sends credentials.
It is a prepared client hook, NOT working cross-origin integration: the current
Node backend has no credentialed CORS handling and rejects foreign Origins;
SameSite=Strict cookies also prevent cross-site authentication. Prefer a separately
approved same-origin `/api/*` and `/ws` reverse proxy to a verified Oracle HTTPS
origin. That phase needs a Worker proxy script and routing, cookie/Origin trust
review, API no-cache behavior and WebSocket forwarding, and separate approval.
Do not simply enable serviceEnabled on this static-only deployment.

Before enabling: owner supplies the real endpoint, test cookie/CSRF security,
profile, reset/delete, two independent clients, roster/movement, reconnect and
server-owned progress through public TLS/WSS. Keep Groq as the existing provider;
no provider or leaderboard migration is included. Start with the original mock
provider (explicit not-evaluated output, zero XP), then separately approve live
provider evaluation and spending.

Server-only settings (see root `.env.example`): NODE_ENV, HOST, PORT, SQLITE_PATH,
ROOM_CAPACITY, SESSION_STARTS_PER_IP_HOUR, GRADING_PROVIDER, GROQ_API_KEY,
GROQ_MODEL, GRADING_MAX_OUTPUT_TOKENS, GRADING_CONCURRENCY, GRADING_QUEUE,
DAILY_MAX_TOKENS, DAILY_MAX_USD, GROQ_INPUT_USD_PER_MILLION,
GROQ_OUTPUT_USD_PER_MILLION. LOAD_TEST_METRICS is an additional local-only diagnostic setting. Never place backend environment
values or secrets in public/game-config.js. Groq requests go server-side to
https://api.groq.com/openai/v1/chat/completions.

## Free-tier considerations

This is assets-only: no KV, D1, R2, Durable Objects, paid plan changes or Worker
proxy is provisioned. Cloudflare documents static asset requests as free and
unlimited, without asset storage charges. Free plan limits: 20,000 asset files per
version and 25 MiB per file. A future backend proxy invokes Worker code and has
separate Free plan quotas; Oracle and Groq costs are separate.

Official references:
- https://developers.cloudflare.com/workers/static-assets/get-started/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/
