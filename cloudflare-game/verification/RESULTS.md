# Deployment and verification record — 2026-11-10

Deployment status: **LIVE and verified** at <https://game.itkvn.workers.dev>.
Authenticated account Dothanhdat13@gmail.com's Account, ID
`b4b9f742f28e64118e517db91a9e8414`; subdomain verified `itkvn`; Worker `game`.
Deployed version `cf6eca4a-3c43-4c10-87a7-8b4649ed8cab`, created 2026-11-10
04:05:36 UTC; Wrangler 4.159.0. Prior dashboard-template version
`dfc9ec04-22f9-48f1-a079-735a0f6972d7` served `Hello World!` and was replaced
with owner approval. Original repository game and backend were not modified. Before deployment,
persistent invocation logging was enabled; after deployment Logpush is off,
observability is unconfigured, and traces are not enabled.

- Node 24.22.2, npm 11.19.1, Wrangler 4.159.0.
- Root `npm test`: PASS, 9/9 after granting local socket access. Initial sandboxed
  run could not execute HTTP/WebSocket tests; no application fix was required.
- Local `npx wrangler dev --local --ip 127.0.0.1 --port 8787`: started successfully
  for verification and stopped afterward; page and local Three.js return HTTP 200.
- `node cloudflare-game/verify-browser.mjs`: PASS in Chromium with SwiftShader.
- Three.js revision 128: 464 scene meshes, 9 NPC avatar groups, positive draw
  calls/triangles. Office visually checked in office.png. These are local NPCs;
  remote-player avatars require the backend and have NOT been verified here.
- Clock-in, discipline choice, keyboard forward movement, mission log open/close,
  mission open/close, editor and submit UI checked. Not every control or movement
  direction was exhaustively tested.
- All eight briefs open; English -> Vietnamese -> English titles checked for each.
  In-memory test introspection opens each mission; only the first was approached
  through normal office movement. Gate 4 is intentionally open in preview mode.
- Grading submission shows explicit unavailable message, zero XP. No provider call
  or simulated model review. No HTTP API or WebSocket request made in preview mode.
- Mobile viewport 390x844: document 390px, mission sheet 356px with no horizontal
  overflow. Screenshot visually inspected. Touch joystick and physical mobile GPU
  behavior have NOT been tested.
- No browser page errors, console errors, HTTP failures or missing local assets
  observed. Google Fonts loaded during this run; fonts remain external.
- Original index.html, baseline, server, deploy files and root package/lock unchanged
  according to git diff. New files exist only under cloudflare-game/.

Evidence: public.json and office, mission and mobile screenshots (with `public-`
prefixes for public-browser captures). These files are outside `public/`. No
cross-machine multiplayer test has been performed.

- Cloudflare `npx wrangler deploy --dry-run --outdir /tmp/itk-game-deploy-dry-run`:
  PASS; read static assets and exited before publishing.


## Public Deployment Verification — 2026-11-10 04:06 UTC

- Page title `ITK-BGSV Prompt Works`, HTTP 200; `/vendor/three.min.js` HTTP 200
  (603,445 bytes); `/game-config.js` HTTP 200 (313 bytes).
- Public Chromium browser run: PASS. Three.js revision 128, 464 meshes, 9 NPC
  avatar groups, 49 draw calls and 2,426 triangles. Keyboard forward movement
  changed the player position.
- All eight mission titles switched English -> Vietnamese -> English correctly.
  All eight were opened in frontend preview; the Gate 4 prerequisite is intentionally
  bypassed only in this disconnected frontend preview.
- Mobile viewport 390x844: document width 390px, mission sheet/client width 356px,
  no horizontal overflow. Physical touchscreen/joystick behavior was not tested.
- Browser page errors: 0. Console errors: 0. Failed requests: 0. API/WebSocket
  requests: 0. Grading UI explicitly reports backend unavailable; XP remains 0.
- Multiplayer, remote-player avatars, server grading and Oracle integration remain
  untested and disconnected. NPC avatars are local scene objects.
- Cloudflare deploy output uploaded exactly four changed static assets. Wrangler's
  deployment history confirms new version is at 100% traffic; public assets were
  fetched after deployment. No paid Cloudflare resources were provisioned.
