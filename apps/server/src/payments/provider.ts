import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface ProviderOrder {
  orderId: string;
  /** Data the client needs to open checkout. Never contains secrets. */
  clientData: Record<string, string | number>;
}

export type VerifiedPaymentEvent =
  | { kind: "PAYMENT_CAPTURED"; eventId: string; orderId: string; paymentId: string; amountPaise: number | null; raw: unknown }
  | { kind: "PAYMENT_REFUNDED"; eventId: string; paymentId: string; orderId: string | null; raw: unknown }
  | { kind: "IGNORED"; eventId: string; type: string; raw: unknown };

export interface PaymentProvider {
  readonly mode: "MOCK" | "RAZORPAY";
  createOrder(input: { amountPaise: number; currency: string; receipt: string }): Promise<ProviderOrder>;
  /** Verifies the signature over the raw body. Returns null when verification fails. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): VerifiedPaymentEvent | null;
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

function parseRazorpayStyleEvent(body: unknown): VerifiedPaymentEvent {
  const b = body as {
    id?: string;
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } }; refund?: { entity?: { payment_id?: string } } };
  };
  const eventId = b.id ?? `evt_${hmacHex("id", JSON.stringify(body)).slice(0, 24)}`;
  const pay = b.payload?.payment?.entity;
  if ((b.event === "payment.captured" || b.event === "order.paid") && pay?.id && pay.order_id) {
    return { kind: "PAYMENT_CAPTURED", eventId, orderId: pay.order_id, paymentId: pay.id, amountPaise: pay.amount ?? null, raw: body };
  }
  if (b.event === "refund.processed" || b.event === "payment.refunded") {
    const paymentId = b.payload?.refund?.entity?.payment_id ?? pay?.id;
    if (paymentId) return { kind: "PAYMENT_REFUNDED", eventId, paymentId, orderId: pay?.order_id ?? null, raw: body };
  }
  return { kind: "IGNORED", eventId, type: b.event ?? "unknown", raw: body };
}

/**
 * Development provider. Orders are created locally and "paid" by a simulated webhook that is signed with
 * MOCK_WEBHOOK_SECRET and processed by exactly the same verification path as a real provider.
 * Entitlements it grants are tagged MOCK and are ignored in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly mode = "MOCK" as const;
  constructor(private readonly webhookSecret: string) {}

  async createOrder(input: { amountPaise: number; currency: string; receipt: string }): Promise<ProviderOrder> {
    const orderId = `mock_order_${randomBytes(9).toString("hex")}`;
    return { orderId, clientData: { amount: input.amountPaise, currency: input.currency } };
  }

  /** Builds a signed "payment.captured" webhook body, as the mock checkout's "Pay" button would trigger. */
  simulateCapture(orderId: string, amountPaise: number): { body: Buffer; signature: string } {
    const body = Buffer.from(
      JSON.stringify({
        id: `mock_evt_${randomBytes(9).toString("hex")}`,
        event: "payment.captured",
        payload: { payment: { entity: { id: `mock_pay_${randomBytes(9).toString("hex")}`, order_id: orderId, amount: amountPaise } } },
      }),
    );
    return { body, signature: hmacHex(this.webhookSecret, body) };
  }

  simulateRefund(paymentId: string, orderId: string): { body: Buffer; signature: string } {
    const body = Buffer.from(
      JSON.stringify({
        id: `mock_evt_${randomBytes(9).toString("hex")}`,
        event: "refund.processed",
        payload: { refund: { entity: { payment_id: paymentId } }, payment: { entity: { id: paymentId, order_id: orderId } } },
      }),
    );
    return { body, signature: hmacHex(this.webhookSecret, body) };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): VerifiedPaymentEvent | null {
    if (!signature || !safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature)) return null;
    try {
      return parseRazorpayStyleEvent(JSON.parse(rawBody.toString("utf8")));
    } catch {
      return null;
    }
  }
}

/**
 * Razorpay adapter. Orders are created server-side with the server-looked-up amount; entitlements are only
 * granted from a webhook whose X-Razorpay-Signature (HMAC-SHA256 of the raw body) verifies.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly mode = "RAZORPAY" as const;
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createOrder(input: { amountPaise: number; currency: string; receipt: string }): Promise<ProviderOrder> {
    const res = await this.fetchImpl("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.receipt.slice(0, 40) }),
    });
    if (!res.ok) throw new Error(`Razorpay order creation failed (${res.status})`);
    const order = (await res.json()) as { id: string };
    return { orderId: order.id, clientData: { keyId: this.keyId, amount: input.amountPaise, currency: input.currency } };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): VerifiedPaymentEvent | null {
    if (!signature || !safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature)) return null;
    try {
      return parseRazorpayStyleEvent(JSON.parse(rawBody.toString("utf8")));
    } catch {
      return null;
    }
  }
}
