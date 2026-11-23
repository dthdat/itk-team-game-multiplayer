# Cloudflare and Oracle release status

The separate staging deployment is live at https://game-staging.itkvn.workers.dev. Production Worker game remains the existing frontend-only release and was not modified.

The request path is:

1. Browser loads local game assets from Workers Static Assets.
2. Same-origin /api/* and /ws requests invoke the Worker.
3. Worker adds protected Access Service Auth credentials and forwards to the staging API hostname.
4. The existing remotely managed Cloudflare Tunnel forwards to Node on 127.0.0.1:3001.
5. Node validates the guest/account session and persists progress in a staging-only SQLite database.

Staging HTTP and WSS, secure cookie forwarding, direct-origin Access denial, guest persistence, late join, movement, reconnect, and a controlled backend restart have passed. The current service and Worker versions, release limits, and approval-gated production plan are in:

- [Architecture](../ARCHITECTURE.md)
- [Deployment guide](../DEPLOYMENT-GUIDE.md)
- [ARM64 deployment status](oracle-arm64-deployment.md)
- [Load test results](../LOAD-TEST-RESULTS.md)
- [Security controls](../SECURITY.md)

The production origin api.itkteam.store and its Access policy are not configured. A production service and database are not installed. The existing SSH route and Tunnel connector were left unchanged. Do not deploy Worker game or make production route, service, or database changes without separate approval.
