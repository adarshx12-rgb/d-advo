import { randomBytes } from "node:crypto";
import { CARD_THEMES, PACK_IDS, type PackId } from "@hps/shared";
import type { Persistence, ProductRecord } from "../persistence/types";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";

export class PaymentError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ownership {
  packIds: PackId[];
  themeIds: string[];
  productIds: string[];
  streamerBranding: boolean;
}

export class PaymentService {
  constructor(
    private readonly db: Persistence,
    readonly provider: PaymentProvider,
    private readonly production: boolean,
  ) {}

  /** Entitlements honoured right now. Mock entitlements never count in production. */
  async ownership(userId: string | null): Promise<Ownership> {
    const out: Ownership = { packIds: ["base"], themeIds: ["classic"], productIds: ["pack-base"], streamerBranding: false };
    if (!userId) return out;
    const [ents, products] = await Promise.all([this.db.listEntitlements(userId), this.db.listProducts()]);
    for (const e of ents) {
      if (e.status !== "ACTIVE") continue;
      if (this.production && e.mode === "MOCK") continue;
      const p = products.find((x) => x.id === e.productId);
      if (!p) continue;
      out.productIds.push(p.id);
      if (p.packId && (PACK_IDS as readonly string[]).includes(p.packId) && !out.packIds.includes(p.packId)) out.packIds.push(p.packId);
      if (p.themeId) out.themeIds.push(p.themeId);
      if (p.kind === "CREATOR") out.streamerBranding = true;
    }
    return out;
  }

  /** Server-side price lookup. The client only ever sends a product id. */
  async checkout(userId: string, productId: string) {
    const product = await this.db.getProduct(productId);
    if (!product) throw new PaymentError(404, "That product does not exist.");
    if (!product.published || !product.priceId || product.pricePaise === null || product.pricePaise <= 0) {
      throw new PaymentError(409, "This product is not on sale yet.");
    }
    const owned = await this.ownership(userId);
    if (owned.productIds.includes(product.id)) throw new PaymentError(409, "You already own this.");
    const receipt = `hps_${randomBytes(6).toString("hex")}`;
    const order = await this.provider.createOrder({ amountPaise: product.pricePaise, currency: product.currency, receipt });
    const purchase = await this.db.createPurchase({
      userId,
      productId: product.id,
      priceId: product.priceId,
      amountPaise: product.pricePaise,
      currency: product.currency,
      mode: this.provider.mode,
      providerOrderId: order.orderId,
    });
    return {
      purchaseId: purchase.id,
      orderId: order.orderId,
      amountPaise: purchase.amountPaise,
      currency: purchase.currency,
      mode: this.provider.mode,
      productName: product.name,
      clientData: order.clientData,
    };
  }

  /** Processes a webhook body. Grants or revokes entitlements only after signature verification. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ status: number; message: string }> {
    const ev = this.provider.verifyWebhook(rawBody, signature);
    if (!ev) return { status: 400, message: "Invalid signature" };
    return this.applyVerifiedEvent(ev);
  }

  private async applyVerifiedEvent(ev: VerifiedPaymentEvent): Promise<{ status: number; message: string }> {
    if (ev.kind === "IGNORED") {
      await this.db.recordPaymentEvent({ provider: this.provider.mode, providerEventId: ev.eventId, type: ev.type, purchaseId: null, payload: ev.raw });
      return { status: 200, message: "ignored" };
    }
    const purchase =
      ev.kind === "PAYMENT_CAPTURED"
        ? await this.db.findPurchaseByOrderId(ev.orderId)
        : ev.orderId
          ? await this.db.findPurchaseByOrderId(ev.orderId)
          : null;
    if (!purchase) return { status: 404, message: "Unknown order" };
    const fresh = await this.db.recordPaymentEvent({
      provider: this.provider.mode,
      providerEventId: ev.eventId,
      type: ev.kind,
      purchaseId: purchase.id,
      payload: ev.raw,
    });
    if (!fresh) return { status: 200, message: "duplicate" };

    if (ev.kind === "PAYMENT_CAPTURED") {
      if (ev.amountPaise !== null && ev.amountPaise !== purchase.amountPaise) return { status: 409, message: "Amount mismatch" };
      const receiptNumber = `HPS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
      await this.db.markPurchasePaid(purchase.id, ev.paymentId, receiptNumber);
      const product = await this.db.getProduct(purchase.productId);
      const grants = [purchase.productId, ...(product?.kind === "BUNDLE" ? product.bundleItems : [])];
      for (const productId of grants) {
        await this.db.grantEntitlement({ userId: purchase.userId, productId, purchaseId: purchase.id, mode: this.provider.mode });
      }
      if (product?.themeId) await this.db.equipTheme(purchase.userId, product.themeId).catch(() => {});
      return { status: 200, message: "granted" };
    }
    await this.db.markPurchaseRefunded(purchase.id);
    await this.db.revokeEntitlementsForPurchase(purchase.id);
    return { status: 200, message: "revoked" };
  }

  async catalog(userId: string | null): Promise<(ProductRecord & { owned: boolean; purchasable: boolean })[]> {
    const [products, owned] = await Promise.all([this.db.listProducts(), this.ownership(userId)]);
    return products.map((p) => ({
      ...p,
      owned: owned.productIds.includes(p.id) || (p.kind === "COSMETIC_THEME" && !!p.themeId && owned.themeIds.includes(p.themeId)),
      purchasable: p.published && p.pricePaise !== null && p.pricePaise > 0,
    }));
  }

  themeName(id: string): string {
    return CARD_THEMES.find((t) => t.id === id)?.name ?? id;
  }
}
