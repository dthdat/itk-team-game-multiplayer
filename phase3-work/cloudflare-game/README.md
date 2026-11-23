# ITK-BGSV game Worker

This directory packages the actual ITK-BGSV Three.js game and same-origin API/WebSocket proxy. Production Worker game remains the existing frontend-only release. Phase 3 is live only on separate staging Worker game-staging at https://game-staging.itkvn.workers.dev.

## Asset manifest

cloudflare-game/public contains the office game, public mode config, guest progress panel, Three.js 0.128.0, and its license. It preserves the 3D office, nine local NPCs, all eight missions, keyboard and mobile controls, jump, and English/Vietnamese content. The generated index pins its two original inline game scripts in the CSP.

Google Fonts remain an optional external stylesheet with local font fallbacks. There are no remote textures, external Three.js CDN imports, API keys, database files, server environment values, or Node dependencies in public.

Touch devices and devices reporting four or fewer logical CPU cores render without multisample antialiasing and cap device pixel ratio at 1.25. Other devices retain antialiasing with a maximum pixel ratio of 2. This reduces GPU work on mobile while keeping the same scene and mission content.

The source asset preparation defaults to serviceEnabled:false. The deployed staging assets are backend-enabled, with an empty backend origin so browser requests stay on the workers.dev host. The production candidate manifest is verification/asset-manifest-production.json. Never put a backend hostname, proxy secret, or Cloudflare Access token in game-config.js.

The current production proposal, candidate backend package/hash, rollback sequence, local-only backup policy, and approval boundary are documented in [../PRODUCTION-APPROVAL-PACKET.md](../PRODUCTION-APPROVAL-PACKET.md). The public 70-player test is prepared but has not run; see [../windows-load-test/README.md](../windows-load-test/README.md) and [../LOAD-TEST-RESULTS.md](../LOAD-TEST-RESULTS.md).

## Guest entry

The game opens with display name and engineering discipline. Sign-in is not required or shown. The browser remembers the name; an opaque backend guest cookie restores that player's server-side progress and submissions. Display names are not credentials. The office remains walkable if the backend is unavailable. Pending submissions require the backend and do not earn XP.

## Worker routing

wrangler.jsonc uses Static Assets and routes only /api/* and /ws through src/worker.js with run_worker_first. Other requests use ASSETS. Worker proxy secrets remain Cloudflare Worker secrets, never browser assets. The Worker preserves game session cookies, strips upstream CF_Authorization, and forwards WebSocket upgrades.

The staging origin api-staging.itkteam.store is protected by the owner-verified Service Auth policy and routes through the existing Tunnel to localhost:3001. Production api.itkteam.store remains unconfigured. See the root deployment guide and reports/staging-guest-flow-final.json.

## Local setup

Requirements: Node 24.7+, npm, Wrangler 4.160.0.

    cd cloudflare-game
    npm ci
    cp .dev.vars.example .dev.vars

Use a temporary local database and a random local proxy secret shared only between local Wrangler and the local Node process. Never use staging or production Worker secrets for local tests. The .dev.vars file is ignored and must not be copied into public.

npm run prepare:assets generates the frontend-only default. npm run dev starts the static preview. npm run dev:phase3 and npm run dev:staging prepare backend-enabled assets for local use. The staging deployment targets only Worker game-staging. npm run deploy targets production Worker game and must be run only after separate production approval.

## Checks and release boundary

Run npm test from the parent phase3-work directory. A no-publish Wrangler bundle check is:

    npm run prepare:assets
    npx wrangler deploy --dry-run --env staging

The latest public staging tests verified guest persistence, three-player late join, movement, reconnect, zero-XP pending submissions, jump, mobile controls, and no browser errors. The public 70-player test remains outstanding. Production publishing requires approval after reviewing the exact account, Worker, asset manifest, API route, Access scope, secrets, and rollback plan. Never modify SSH, firewall, production source/data, or telemetry Workers as part of staging.
