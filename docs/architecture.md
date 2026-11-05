# Architecture

## Overview

```
 Browser (Next.js)                         Game server (Node)                         Storage
 ┌──────────────────────┐  socket.io  ┌──────────────────────────────┐          ┌────────────┐
 │ controller / lobby   │◀───────────▶│ realtime/socket.ts           │          │ PostgreSQL │
 │ spectate / broadcast │  (auth in   │  └ RoomManager (rooms/)      │─Persistence─▶ (Prisma) │
 │ store / admin        │  handshake) │      └ game-engine reduce()  │  iface   │  or memory │
 └──────────────────────┘    HTTPS    │ http/app.ts (REST, webhooks) │          └────────────┘
            ▲                ────────▶│ payments/ (provider iface)   │◀── signed webhooks ── Razorpay
            └────────── role-specific projections only ─────────────┘
```

### Packages

| Package | Responsibility |
| --- | --- |
| `packages/game-engine` | A pure, deterministic match reducer: `createMatch`, `reduce(state, action, now)`, `tick(state, now)`, `nextWakeAt`, plus the four projections. It does no I/O, uses no wall clock and no `Math.random`. Its RNG (mulberry32) state lives inside `MatchState`. |
| `packages/shared` | Zod schemas for every client→server payload, the typed Socket.IO event maps, room settings, the product catalog and all projection types. |
| `packages/content` | 220 prompts with stable, append-only IDs (`<pack>:<sp\|db\|bl\|fn>:<nn>`), plus `checkPrompt` / `buildEligiblePool` filtering. |
| `packages/database` | The Prisma 7 schema (`prisma-client` generator with the `@prisma/adapter-pg` driver), migrations, an idempotent seed, and scrypt / SHA-256 helpers. |
| `apps/server` | Express 5 REST API, Socket.IO, `RoomManager`, payments and authentication. |
| `apps/web` | Next.js 16 App Router client, built with Tailwind 4, Radix primitives (`packages/ui`) and Motion. |

## Authoritative state flow

1. A client emits `game:action` with `{ actionId, action }`. The server checks it against `gameActionEnvelopeSchema`, which is rate-limited.
2. `RoomManager.dispatch` resolves the sender from the socket's authenticated session, never from the payload. It then calls `reduce(state, {kind: "PLAYER", playerId, action}, now)`.
3. The engine either throws an `EngineError` (returned to that client only as an ack error) or returns a new state. Repeated `actionId`s return `duplicate`, so retries are safe.
4. `afterChange` persists results when the match completes and re-arms the single room timer from `nextWakeAt(state)`. It then broadcasts.
5. `broadcast` computes a projection for each recipient:
   - `getHostGameState` for the host,
   - `getPlayerGameState(playerId)` for every other player,
   - `getSpectatorGameState` for spectators,
   - `getPublicGameState` for broadcast viewers.

   The full `MatchState` is never sent to anyone.

Deadlines are absolute server epoch milliseconds. Clients estimate the server's clock offset with `time:ping` (taking the lowest-RTT of four samples) and count down against the server's deadline.

### What each audience can see

| Data | Owner | Other players | Spectators / broadcast |
| --- | --- | --- | --- |
| Calibration answer and prediction | ✔ | at reveal only | at reveal only |
| "Keep private" answers | ✔ | value at reveal; never becomes evidence | same |
| Court stance | ✔ | at hearing reveal | at hearing reveal |
| Court side | after locking stance | from the openings | from the openings |
| Bluff genuine answer and instruction | speaker only | at reveal | at reveal |
| Finale role (honest/bluff) | after locking stance | at finale reveal | at finale reveal |
| Secret contract | ✔ | at results | at results |
| Influence charges, cards played | public | public | public |
| Who has locked (not what) | public | public | public |

The Socket.IO integration test `spectators never receive private state` scans every spectator payload for private fields.

### Chaos card resolution

When a card is played, it starts a pending window:

1. **Collecting (1 s).** Simultaneous plays compete. RECEIPTS beats CROSS_EXAMINATION, which beats SWITCH_SIDES; ties go to the player in the earliest rotated seat. Outranked cards are not charged.
2. **Reaction (6 s).** Anyone with a charge may play OBJECTION to cancel the card. An Objection itself cannot be countered.

While a card is pending, phase exits are deferred. A timer that expires mid-window waits for the card to resolve, so a card never resolves against the wrong phase.

## Rooms, sessions and reconnects

- A guest session is a random 256-bit token issued by `POST /api/session/guest`. Only its SHA-256 hash is stored. It travels in the Socket.IO handshake `auth`, so it never appears in URLs or server logs.
- A host user session works the same way. It is attached as `userToken` and links the room to that user's purchases.
- Reconnecting with the same guest token reclaims the same seat and private state within `RECONNECT_WINDOW_SECONDS`. Phase completion only waits on connected players.
- If everyone in a running match disconnects, the match pauses automatically.
- Kicked sessions are banned from rejoining that room.
- Spectator IDs are HMAC-signed with `SESSION_SECRET`.

## Ephemeral vs persistent state

| Ephemeral (memory on the game server) | Persistent (Postgres, or memory when `DATABASE_URL` is empty) |
| --- | --- |
| Rooms, lobby membership, ready flags | Users, sessions (hashes only), guest sessions |
| Live `MatchState`, timers, pending cards | Products, versioned prices, purchases, payment events, entitlements |
| Per-room consent and hidden topics | Prompts, packs, admin pack switches |
| Spectator ballots | Match summaries: players, final scores, debates, bluffs (results only, never private answers mid-match) |
| | Reports, branding, equipped theme |

Rooms do not survive a server restart. Matches are therefore short-lived, and a restart ends any match in progress.

## Security notes

- Every client payload is validated with Zod. Display names are filtered by code point, so control characters and bidi overrides are removed.
- Both HTTP and socket events are rate-limited. Votes and reports have stricter limits.
- Prices come only from the server's catalog. The checkout endpoint accepts a product ID and ignores any amount sent by the client.
- Entitlements are granted only after webhook HMAC verification, with idempotency on the provider event ID and an amount check.
- Content filtering happens on the server before prompts enter the match pool. Disallowed prompts are never sent to clients.
- Admin endpoints return 404 to non-admins.
- Logo uploads are checked by magic bytes (PNG, JPEG or WebP only; SVG is rejected), limited to 512 KB, and served with `nosniff` and a restrictive CSP.
- Next.js sets a CSP, `X-Frame-Options: DENY` (except on the broadcast page, which OBS embeds), and a `Permissions-Policy` that disables the camera and microphone.

## Not implemented yet

These are known gaps, stated plainly:

- **Handshake alliances** (6+ players) are not implemented.
- **Variant modes** LAST_CHANCE, BLIND_VOTE and DOUBLE_AGENT are not implemented.
- **Weighted audience voting:** `spectatorVoteWeight` is stored, but audience votes are always advisory (weight 0).
- **Card themes:** they can be purchased and equipped, but in-game cards do not yet render the equipped theme.
- **Horizontal scaling:** rooms live in one process. Running several server instances would need sticky sessions plus a shared room store such as Redis.
- **Accounts:** there is no email verification and no password reset.
