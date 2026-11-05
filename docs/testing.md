# Testing

```bash
pnpm test          # every package's Vitest suite
pnpm test:e2e      # Playwright (starts its own servers on :4100 and :3100)
pnpm typecheck
pnpm lint
```

## Suites

| Suite | Location | What it covers |
| --- | --- | --- |
| Content | `packages/content/test` | 220 prompts with unique IDs, per-pack targets, Base Game stream-safe, mature never stream-safe, every mode covered, per-pack NSFW toggles plus all-player consent, ownership, blocked topics, intensity cap, safe fallback |
| Engine | `packages/game-engine/test` | Scoring brackets, full deterministic matches with 3, 6 and 12 players, segment order, per-segment maxima, hidden opinions and roles until reveal, private answers kept out of the vault, action-ID deduplication, court/bluff/finale scoring, finale seating and Underdog Stakes, target and court rotation, bluff claim distance, card windows / priority / objection / Cross-Examination / pending-card exit deferral, contract offers and resolution, pause/resume, skips, early end, disconnects, tiebreaks |
| Server | `apps/server/test` | Real HTTP and Socket.IO against an in-memory server: room lifecycle, invite keys, kicks and bans, handshake auth, a complete 3-player match played by bots over sockets with spectator payload leak checks, persistence of match summaries, legal/illegal cards, reconnecting into the same seat, host-only controls, spectator voting, catalog prices, safe-only store previews, ignored client prices, mock and Razorpay webhook signatures, idempotency, amount mismatch, refunds, production ignoring mock entitlements, host-owned packs in rooms, NSFW consent rules, admin access and import validation |
| Web components | `apps/web/test` | Slider accessibility, ActionDock renders only server-legal actions and surfaces rejections, the bluff instruction, stage lock counts, card tray disabled states |
| E2E | `tests/e2e` | Browsers: create a room, join by link and by code, settings locked for non-hosts, ready/start, locking answers, early phase completion, host-only controls, spectator view without private controls, a complete match to results, back to lobby; store purchase with mock payment, the library, enabling a host-owned pack, 18+ toggle with consent and age confirmation |

## Timing

The server and E2E suites set `GAME_TIMER_SCALE` (0.01 and 0.2) so that full matches run in seconds rather than minutes. Every timer comes from engine config, so scaling doesn't change the order of events.
