# Architecture record

The current verified design and status are maintained in the root [ARCHITECTURE.md](../ARCHITECTURE.md).

The public staging path is browser to Workers Static Assets/Worker, then same-origin /api or /ws through an Access-protected Cloudflare Tunnel origin to Node on localhost, then SQLite. Staging is guest-first: the backend generates an opaque guest identity and cookie; display names are profile fields. The original Three.js office, nine NPCs, eight missions, bilingual content, jump and touch/keyboard controls remain.

The staging Worker and Oracle service are live and verified for guest persistence, pending submissions, three-player presence/late join, movement, reconnect, and restart recovery. Groq remains disabled and pending submissions award zero XP. A controlled external load run is next. Local-only SQLite backup is the accepted demo policy; catastrophic host/disk data loss is an accepted risk. Production Worker game and production services remain unchanged.
