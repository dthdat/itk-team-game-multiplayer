# Guest play and movement verification — 2026-11-11

## Accepted guest experience

Staging opens with a display name and engineering discipline; sign-in is not required. The name and language preference are remembered in this browser. A server-generated opaque guest session cookie restores server-side profile, submissions, position, and progress. Display names are not authentication credentials. Clearing the cookie loses the local link to that guest session.

All eight missions remain available. Answers submitted in the connected staging game are stored as pending. No AI grading is active and pending submissions award zero XP. The player panel reads progress, history, and a leaderboard derived only from verified server-owned XP. The original 3D office and nine NPCs remain present.

## Jump and smoother remote movement

- Desktop Space triggers a short jump. Touch users receive a localized Jump/ Nhảy button beside the movement stick.
- Jump height is sent as bounded movement state; the server caps it at 1.5 metres. It does not affect collision, mission, or XP rules.
- The browser sends changed movement at up to 10 Hz without tying network cadence to rendering.
- The room broadcasts movement at up to 10 Hz. Remote avatars interpolate timestamped samples and animate arms and legs from velocity.
- Local and remote movement remain server-validated; smoothing does not grant extra travel or bypass collision checks.

## Latest public browser verification

The latest deployed staging assets were fetched and compared byte-for-byte with the local candidate. Browser automation on 2026-11-11 used synthetic guests and passed:

- Name and guest identity restored after reload.
- All eight missions available and English/Vietnamese switching worked.
- Pending submission and zero XP were correct.
- Pending history survived a controlled restart of prompt-works-staging.service.
- Two-player presence and movement worked; a third late join saw stationary peers.
- WebSocket reconnect passed.
- Desktop keyboard jump passed; mobile jump and joystick movement passed at 390 px viewport.
- The interpolation probe received movement at about 100.7 ms intervals and observed 83 distinct positions in 83 render frames, with a maximum tested per-frame step of 0.5 m and working leg animation.
- Page errors, console errors, same-origin 5xx responses, and failed requests were all zero.
- Synthetic test guests were deleted after the run.

The interpolation probe suppressed WebGL drawing only during its motion-measurement segment to avoid renderer contention on the two-core host. This verifies motion sample application and interpolation, not the owner's device FPS or public 70-player network quality.

Evidence is reports/staging-guest-flow-final.json. Current staging Worker: 7e59219d-a6ce-46b7-9540-fea677019d56. Previous staging version: 4d6eb292-ed7c-417b-9629-dd2b7a5ffb4b.

Two additional public play checks used actual controls against that same deployed build. The desktop run used WASD reversals/strafing and Shift, remained Online with zero corrections or socket closes, opened all eight mission panels, restored the name after reload, and recorded no page errors (reports/play-latest-desktop.json). The 390 px mobile run used real touch events on the joystick, moved from z=8.5 to z=3.60, remained Online with zero corrections or socket closes, opened all eight missions, and restored the name after reload (reports/play-latest-mobile.json). Screenshots are reports/play-latest-desktop.png and reports/play-latest-mobile.png.

## Staging rollback

From cloudflare-game, the previous staging Worker can be restored with:

    npx wrangler rollback 4d6eb292-ed7c-417b-9629-dd2b7a5ffb4b --env staging --yes

This restores the earlier staging frontend only. The staging backend's previous source copy is under /opt/prompt-works-staging/rollback-10hz-20261111; do not replace the current backend unless an approved staging rollback is necessary. Production game, SSH, database, Tunnel, Access, and firewall settings remain unchanged.
