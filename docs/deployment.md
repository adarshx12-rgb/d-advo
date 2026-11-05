# Deployment

The system has three parts:

1. **Web:** a Next.js app that can be deployed anywhere Next 16 runs.
2. **Game server:** a long-lived Node process holding WebSockets and in-memory rooms.
3. **PostgreSQL 15+.**

## Game server

- It needs a persistent process, not serverless functions, and WebSocket support. Fly.io, Render, Railway, a VM or a container all work.
- Run **one instance**. Rooms live in process memory. Scaling out needs sticky sessions plus a shared room store and the Socket.IO Redis adapter, which is not implemented.
- Start it with `pnpm --filter @hps/server start` (tsx). Alternatively, bundle `apps/server/src/index.ts` with your tool of choice.
- On deploy, before starting, run `pnpm db:deploy` (applies migrations) and then `pnpm db:seed` (idempotent; it adds new prompts and price versions).

### Production environment

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Turns on the production guards |
| `DATABASE_URL` | Required in production |
| `SESSION_SECRET` | Long random value; signs spectator IDs |
| `WEB_ORIGIN` | Exact web origin(s), comma-separated; used for CORS |
| `PAYMENT_MODE=razorpay` + `RAZORPAY_*` | Mock mode is refused in production |
| `RECONNECT_WINDOW_SECONDS` | Default 120 |
| `GAME_TIMER_SCALE` | Keep at `1` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Only read by the seed; change the password after first sign-in |

Put the server behind TLS so that browsers can use `wss://`. Socket.IO also falls back to HTTP long-polling, so proxies must allow both. The server sets `trust proxy` to 1 for rate-limit IPs.

## Web

- Set `NEXT_PUBLIC_SERVER_URL` to the game server's public origin **at build time**, since it is inlined into the client bundle and the CSP.
- Run `pnpm build`, then `pnpm --filter @hps/web start`.
- The CSP only allows connections to that server and to Razorpay.

## Database

- Use `docker-compose.yml` for local Postgres on port 5433. In production, use a managed Postgres.
- Back up `Purchase`, `PaymentEvent` and `Entitlement`. They are the record of what people paid for.

## Checklist

- [ ] TLS on both the web and server origins
- [ ] `PAYMENT_MODE=razorpay` with the webhook configured and its secret set
- [ ] A secrets manager for every credential; `.env` is never committed
- [ ] Migrations applied and the seed run
- [ ] The admin password changed after the first login
