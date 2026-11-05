import { randomUUID } from "node:crypto";
import { CATALOG, type PackId, type Prompt } from "@hps/shared";
import { PACK_META, SEED_PROMPTS } from "@hps/content";
import type {
  BrandingRecord,
  EntitlementRecord,
  MatchSummary,
  PackRecord,
  Persistence,
  ProductRecord,
  PurchaseRecord,
  ReportRecord,
  UserRecord,
} from "./types";

/** In-memory persistence: zero setup, used by tests and when DATABASE_URL is empty. Data is lost on restart. */
export class MemoryPersistence implements Persistence {
  readonly kind = "memory" as const;
  private guests = new Map<string, { id: string; expiresAt: Date }>();
  private users = new Map<string, UserRecord>();
  private sessions = new Map<string, { userId: string; expiresAt: Date }>();
  private purchases = new Map<string, PurchaseRecord>();
  private paymentEvents = new Set<string>();
  private entitlements: EntitlementRecord[] = [];
  private themes = new Map<string, string>();
  private brandings = new Map<string, BrandingRecord>();
  private prompts = new Map<string, Prompt>(SEED_PROMPTS.map((p) => [p.id, { ...p }]));
  private packs = new Map<PackId, PackRecord>(PACK_META.map((p) => [p.id, { ...p, enabled: true }]));
  private reports: ReportRecord[] = [];
  readonly matches: MatchSummary[] = [];

  async createGuestSession(tokenHash: string, expiresAt: Date) {
    const id = `g_${randomUUID()}`;
    this.guests.set(tokenHash, { id, expiresAt });
    return id;
  }
  async findGuestSession(tokenHash: string) {
    const g = this.guests.get(tokenHash);
    return g && g.expiresAt > new Date() ? { id: g.id } : null;
  }

  async createUser(input: { email: string; passwordHash: string; displayName: string }) {
    if ([...this.users.values()].some((u) => u.email === input.email)) throw new Error("EMAIL_TAKEN");
    const u: UserRecord = { id: `u_${randomUUID()}`, role: "HOST", ...input };
    this.users.set(u.id, u);
    return u;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createUserSession(userId: string, tokenHash: string, expiresAt: Date) {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }
  async findUserBySessionHash(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt < new Date()) return null;
    return this.users.get(s.userId) ?? null;
  }
  async deleteUserSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  /** Test helper: promote a user to admin. */
  makeAdmin(userId: string) {
    const u = this.users.get(userId);
    if (u) u.role = "ADMIN";
  }

  async listProducts(): Promise<ProductRecord[]> {
    return CATALOG.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      tagline: p.tagline,
      description: p.description,
      published: p.published,
      packId: p.packId ?? null,
      themeId: p.themeId ?? null,
      bundleItems: p.bundleProductIds ?? [],
      accent: p.accent,
      priceId: `price_${p.id}`,
      pricePaise: p.pricePaise,
      currency: p.currency,
    }));
  }
  async getProduct(id: string) {
    return (await this.listProducts()).find((p) => p.id === id) ?? null;
  }

  async createPurchase(input: Parameters<Persistence["createPurchase"]>[0]) {
    const p: PurchaseRecord = {
      ...input,
      id: `pur_${randomUUID()}`,
      status: "CREATED",
      providerPaymentId: null,
      receiptNumber: null,
      createdAt: new Date(),
      paidAt: null,
      refundedAt: null,
    };
    this.purchases.set(p.id, p);
    return p;
  }
  async findPurchase(id: string) {
    return this.purchases.get(id) ?? null;
  }
  async findPurchaseByOrderId(orderId: string) {
    return [...this.purchases.values()].find((p) => p.providerOrderId === orderId) ?? null;
  }
  async markPurchasePaid(id: string, providerPaymentId: string, receiptNumber: string) {
    const p = this.purchases.get(id);
    if (!p) throw new Error("PURCHASE_NOT_FOUND");
    if (p.status !== "PAID") Object.assign(p, { status: "PAID", providerPaymentId, receiptNumber, paidAt: new Date() });
    return p;
  }
  async markPurchaseRefunded(id: string) {
    const p = this.purchases.get(id);
    if (!p) throw new Error("PURCHASE_NOT_FOUND");
    Object.assign(p, { status: "REFUNDED", refundedAt: new Date() });
    return p;
  }
  async listPurchases(userId: string) {
    return [...this.purchases.values()].filter((p) => p.userId === userId);
  }
  async recordPaymentEvent(input: { provider: string; providerEventId: string }) {
    const key = `${input.provider}:${input.providerEventId}`;
    if (this.paymentEvents.has(key)) return false;
    this.paymentEvents.add(key);
    return true;
  }

  async grantEntitlement(input: { userId: string; productId: string; purchaseId: string | null; mode: "MOCK" | "RAZORPAY" }) {
    const existing = this.entitlements.find((e) => e.userId === input.userId && e.productId === input.productId);
    if (existing) {
      Object.assign(existing, { status: "ACTIVE", purchaseId: input.purchaseId, mode: input.mode });
      return;
    }
    this.entitlements.push({ id: `ent_${randomUUID()}`, status: "ACTIVE", grantedAt: new Date(), ...input });
  }
  async revokeEntitlementsForPurchase(purchaseId: string) {
    for (const e of this.entitlements) if (e.purchaseId === purchaseId) e.status = "REVOKED";
  }
  async listEntitlements(userId: string) {
    return this.entitlements.filter((e) => e.userId === userId);
  }

  async equipTheme(userId: string, themeId: string) {
    this.themes.set(userId, themeId);
  }
  async getEquippedTheme(userId: string) {
    return this.themes.get(userId) ?? "classic";
  }

  async getBranding(userId: string) {
    return this.brandings.get(userId) ?? null;
  }
  async saveBranding(userId: string, patch: Partial<Omit<BrandingRecord, "userId">>) {
    const cur: BrandingRecord = this.brandings.get(userId) ?? {
      userId,
      logoMime: null,
      logoData: null,
      accentColor: "#8B6CFF",
      secondaryColor: "#3FD6E8",
      lobbyHeader: null,
      resultsTagline: null,
    };
    const next = { ...cur, ...patch };
    this.brandings.set(userId, next);
    return next;
  }

  async listPrompts() {
    return [...this.prompts.values()];
  }
  async getPrompt(id: string) {
    return this.prompts.get(id) ?? null;
  }
  async upsertPrompt(p: Prompt) {
    this.prompts.set(p.id, { ...p });
    return p;
  }
  async listPacks() {
    return [...this.packs.values()];
  }
  async setPackEnabled(id: PackId, enabled: boolean) {
    const p = this.packs.get(id);
    if (p) p.enabled = enabled;
  }

  async createReport(input: { kind: string; promptId: string | null; roomCode: string | null; playerId: string | null; reason: string }) {
    this.reports.push({ id: `rep_${randomUUID()}`, status: "OPEN", createdAt: new Date(), ...input });
  }
  async listReports() {
    return [...this.reports].reverse();
  }
  async updateReport(id: string, status: ReportRecord["status"]) {
    const r = this.reports.find((x) => x.id === id);
    if (r) r.status = status;
  }

  async saveMatchResult(summary: MatchSummary) {
    this.matches.push(summary);
  }
  async close() {}
}
