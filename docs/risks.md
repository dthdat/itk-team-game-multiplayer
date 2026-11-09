# Risks and release gates

- No Oracle, Cloudflare, registrar or Groq account access has been supplied.
  No live deployment, DNS change or paid resource is authorized.
- 50-70 player support is a benchmark target, not an established capacity.
- Local browser contexts do not prove separate-machine networking or A1 graphics.
- Guest cookies are bearer credentials. Clearing cookies loses recovery; guests
  can create new identities. Quotas limit abuse but cannot establish real people.
- Guest profiles and cached review results are retained for up to 30 days.
  The delete-guest endpoint cascades guest results, cached feedback, and profile;
  it cannot erase provider-side data or copies made outside this service.
- The privacy UI discloses that live answers are sent to Groq. Do not submit
  personal, confidential, regulated, or customer data without owner approval.
  Provider retention, region, and training terms were not verified here.
- Legacy local XP must not be imported. References remain browser-readable and
  copyable. This is a learning game, not a cheat-proof certification system.
- External grading requires owner approval of provider terms and data handling.
  Do not submit confidential material. Do not claim Groq ZDR is enabled by default.
- Groq documentation fetch returned ERR_BLOCKED_BY_CSP. Current model access,
  pricing, quotas, retention and the account's daily controls must be confirmed
  by the owner. Live mode refuses to start without explicit prices and a daily
  USD cap; app-side reservations are conservative estimates, not billing data.
- SQLite and room state are single-instance: no horizontal scaling without a
  coordination design. A1 free capacity and idle reclamation affect availability.
- Behind Cloudflare, Caddy's example sees Cloudflare as the network peer. Before
  enabling the proxy, configure Caddy's trusted-proxy list and client-IP
  extraction from Cloudflare's documented header ranges; never trust arbitrary
  forwarded IP headers. The example deliberately sets X-Real-IP itself.
- Live provider grading, cross-machine browser tests, TLS/DNS, restore drills,
  and A1 load/capacity remain release gates, not passing checks.