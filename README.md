# Hybrid Party Show

A browser-based live party game for 3–12 players. Everyone plays on their own device. A host runs the room, and the stage can be shown on a TV or captured into OBS as a stream overlay.

A match runs through these segments:

1. **Read the Room**: answer a spectrum question privately, then predict a friend's answer.
2. **Secret Contracts**: pick a hidden side objective.
3. **Devil's Court**: debate an assigned side in front of judges who predict your real stance.
4. **Catch the Bluff**: defend a number that may or may not be your real answer.
5. **Final Verdict**: the top two players debate. Each one may be arguing for or against what they really believe.
6. **Results**: standings, awards and the revealed contracts.

Chaos Cards (Switch Sides, Receipts, Objection, Cross-Examination) run through every debate.

The server is authoritative. Clients only ever receive role-specific projections of the match, so hidden numbers, bluff instructions and contracts never reach anyone who shouldn't see them.

## Quick start

Requirements: Node 22.12+, pnpm 9, and Docker (optional, for Postgres).

```bash
pnpm install
cp .env.example .env            # defaults work for local development

# Option A: with Postgres (purchases, accounts and match history persist)
pnpm db:up                      # postgres:17 on localhost:5433
pnpm db:deploy                  # apply migrations
pnpm db:seed                    # products, prices, 220 prompts, admin account from .env

# Option B: no database. Set DATABASE_URL= (empty) in .env; everything lives in memory.

pnpm dev                        # game server :4000 + web :3000
```

Open http://localhost:3000. Host a room in one browser window, then join it from two more (private windows or other devices on your network) using the four-letter code.

**Testing payments locally.** `PAYMENT_MODE=mock` gives you a test checkout. Pressing "Pay (test)" makes the server send itself a signed webhook through the same verification path that real Razorpay webhooks use. Mock purchases are ignored when `NODE_ENV=production`, and the server refuses to start in production with mock payments.

**Admin access.** `pnpm db:seed` creates an admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Sign in at `/account`, then open `/admin`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs the game server (tsx watch) and Next.js dev together |
| `pnpm test` | Unit and integration tests in every package (engine, content, server sockets/HTTP, web components) |
| `pnpm test:e2e` | Playwright: full three-player match, spectator view, store purchase, packs and 18+ consent |
| `pnpm typecheck` | `tsc` across all packages |
| `pnpm lint` | ESLint |
| `pnpm build` | Production build of the web app |
| `pnpm db:*` | Postgres up / migrate / deploy / seed |

## Pages

| Route | Purpose |
| --- | --- |
| `/` | Host a room or join one by code |
| `/room/[code]` | Lobby (settings, packs, content preferences), then the player controller |
| `/room/[code]/spectate` | Public stage plus advisory audience voting |
| `/room/[code]/broadcast` | 1920×1080 stage for a TV or OBS, with optional stream delay |
| `/store`, `/store/[id]` | Content packs, cosmetic card themes, Streamer Branding |
| `/library` | Owned items, purchase history and receipts, equipping themes |
| `/branding` | Logo, colours and lobby/results text (needs Streamer Branding) |
| `/account` | Host sign-in and registration (players never need an account) |
| `/admin` | Prompt CRUD, CSV/JSON import with validation, pack switches, report queue (admins only) |

### OBS setup

1. Add a **Browser Source** pointing at `http://<host>:3000/room/ABCD/broadcast`.
2. Set the width to 1920 and the height to 1080. The page scales itself to fit any size.
3. Optional: in the lobby, set **Broadcast delay** (5–60 s). The broadcast view then shows everything that much later than the players see it.
4. Optional: turn on **Streamer mode** so only stream-safe prompts are used.

The broadcast view only receives the public projection, the same data spectators get. It never includes private answers or roles.

## Repository layout

```
apps/web            Next.js App Router client (controller, stage, store, admin)
apps/server         Express + Socket.IO authoritative server
packages/game-engine  Pure, deterministic match reducer and role projections
packages/shared     Types, Zod protocol schemas, settings, catalog
packages/content    220 original prompts, content filters
packages/database   Prisma schema, migrations, seed
packages/ui         Radix-based UI primitives
tests/e2e           Playwright specs
docs/               Architecture, rules, content, payments, deployment, testing
```

## Documentation

- [Architecture](docs/architecture.md): state flow, projections, persistence, security
- [Game rules](docs/game-rules.md): every mode and the exact scoring
- [Content system](docs/content-system.md): packs, ratings, NSFW and consent rules, admin import
- [Payments](docs/payments.md): catalog, the provider interface, webhooks and entitlements
- [Deployment](docs/deployment.md)
- [Testing](docs/testing.md)

## Status and known limitations

The game is complete and playable locally from start to finish. What isn't done yet is listed honestly under "Not implemented" in [docs/architecture.md](docs/architecture.md#not-implemented-yet). In short:

- Handshake alliances for 6+ players are not implemented.
- The LAST_CHANCE, BLIND_VOTE and DOUBLE_AGENT variants are not implemented.
- Audience votes are advisory only.
- Cosmetic card themes can be bought and equipped, but they don't yet restyle the in-game cards.
- There is no voice or microphone feature, by design: no audio is captured or stored.
