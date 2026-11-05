# Payments and entitlements

## Catalog

Prices are integer **paise**, defined in `packages/shared/src/catalog.ts` and seeded into versioned `Price` rows.

| Product | Price |
| --- | --- |
| Base Game | Free |
| Dark Humor pack | ₹99 |
| Friendship Destroyer, Dating & Relationships, Anime & Gaming packs | ₹149 each |
| Card themes (Neon Docket, Velvet Gavel, Tabloid Scandal, Midnight Arcade) | ₹49–₹199 |
| Streamer Branding | ₹299 |
| All-Access bundle | Not published; price not finalized, so it cannot be bought |

Nothing on sale affects play. There are no points, no extra Influence charges, no guaranteed wins, no audience voting power and no cash prizes. Card themes are cosmetic only.

## Ownership model

- Purchases belong to the **host's account**. When a signed-in host creates a room, their packs become available to everyone in it. Players never need to buy anything.
- Branding applies to rooms the owner hosts, and to those rooms' broadcast and spectate views.

## Flow

```
client                    server                               provider
  │ POST /api/store/checkout {productId}                          │
  │──────────────────────────▶ look up server price ──createOrder─▶│
  │◀── {purchaseId, orderId, amount, clientData} ── Purchase CREATED
  │ open provider checkout ──────────────────────────────────────▶│
  │                           ◀──── POST /api/webhooks/payments ───│ (signed)
  │                           verify HMAC over raw body
  │                           idempotency on provider event id
  │                           amount must equal the purchase amount
  │                           Purchase PAID + receipt + Entitlement(s)
  │ GET /api/store/purchases/:id (polls until PAID)                │
```

- **The client's amount is ignored.** Checkout accepts only `productId`.
- **Entitlements come only from verified webhooks.** The browser's "success" callback grants nothing; the client simply polls the purchase status.
- **Idempotency.** Each provider event ID is recorded once in `PaymentEvent`, and replays return `duplicate`.
- **Refunds.** `refund.processed` / `payment.refunded` marks the purchase REFUNDED and revokes the entitlements it granted.
- **Bundles.** A bundle grants one entitlement per included product, all linked to the same purchase.
- Rooms refresh the host's ownership as soon as a webhook is applied.

## Providers

`PaymentProvider` (in `apps/server/src/payments/provider.ts`) has two methods: `createOrder` and `verifyWebhook`.

- **`MockPaymentProvider`** is used when `PAYMENT_MODE=mock`. The test checkout's "Pay" button calls `POST /api/store/mock/complete`. That endpoint builds a `payment.captured` body, signs it with `MOCK_WEBHOOK_SECRET`, and feeds it through the normal webhook verification path. It only exists when `NODE_ENV` is not `production`.
- **`RazorpayPaymentProvider`** is used when `PAYMENT_MODE=razorpay`. It creates orders through the Orders API with Basic auth, verifies `X-Razorpay-Signature` (an HMAC-SHA256 of the raw body using `RAZORPAY_WEBHOOK_SECRET`), and the web client opens Razorpay Checkout with the order ID.

### Guarantees about mock purchases

- Entitlements record the mode that granted them (`MOCK` or `RAZORPAY`).
- When `NODE_ENV=production`, `PaymentService.ownership` ignores every `MOCK` entitlement.
- `loadEnv` refuses to start in production with `PAYMENT_MODE=mock`, and requires all three Razorpay values whenever the mode is `razorpay`.

### Razorpay setup

1. Create API keys in the Razorpay dashboard. Use test mode first.
2. Add a webhook pointing at `https://<server>/api/webhooks/payments` with the events `payment.captured`, `refund.processed` and `payment.refunded`, and set a webhook secret.
3. Set `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`. Keep these in your host's secret store and never commit them.

Real Razorpay calls have not been exercised in this repository's tests, because they need live credentials. Razorpay webhook signature verification and event parsing are tested in `apps/server/test/commerce.test.ts`.
