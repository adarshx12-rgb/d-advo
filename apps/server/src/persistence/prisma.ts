import { createPrismaClient, type PrismaClient } from "@hps/database";
import type { PackId, ProductKind, Prompt } from "@hps/shared";
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

type DbPurchase = Awaited<ReturnType<PrismaClient["purchase"]["findUniqueOrThrow"]>>;

function toPurchase(p: DbPurchase): PurchaseRecord {
  return {
    id: p.id,
    userId: p.userId,
    productId: p.productId,
    priceId: p.priceId,
    amountPaise: p.amountPaise,
    currency: p.currency,
    mode: p.mode,
    status: p.status,
    providerOrderId: p.providerOrderId,
    providerPaymentId: p.providerPaymentId,
    receiptNumber: p.receiptNumber,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
    refundedAt: p.refundedAt,
  };
}

function toPrompt(p: {
  id: string; packId: string; mode: string; question: string; leftLabel: string; rightLabel: string; tags: string[];
  contentRating: string; streamSafe: boolean; intensity: number; difficulty: number; language: string; enabled: boolean;
}): Prompt {
  return {
    id: p.id,
    packId: p.packId as PackId,
    mode: p.mode as Prompt["mode"],
    question: p.question,
    leftLabel: p.leftLabel,
    rightLabel: p.rightLabel,
    tags: p.tags,
    contentRating: p.contentRating as Prompt["contentRating"],
    streamSafe: p.streamSafe,
    intensity: p.intensity,
    difficulty: p.difficulty,
    language: "en",
    enabled: p.enabled,
  };
}

export class PrismaPersistence implements Persistence {
  readonly kind = "postgres" as const;
  readonly db: PrismaClient;

  constructor(url: string) {
    this.db = createPrismaClient(url);
  }

  async createGuestSession(tokenHash: string, expiresAt: Date) {
    const g = await this.db.guestSession.create({ data: { tokenHash, expiresAt } });
    return g.id;
  }
  async findGuestSession(tokenHash: string) {
    const g = await this.db.guestSession.findUnique({ where: { tokenHash } });
    if (!g || g.expiresAt < new Date()) return null;
    // keep the session alive while it is in use (cheap, at most once per connection)
    await this.db.guestSession.update({ where: { id: g.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    return { id: g.id };
  }

  async createUser(input: { email: string; passwordHash: string; displayName: string }): Promise<UserRecord> {
    try {
      const u = await this.db.user.create({ data: input });
      return { id: u.id, email: u.email, passwordHash: u.passwordHash, displayName: u.displayName, role: u.role };
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new Error("EMAIL_TAKEN", { cause: e });
      throw e;
    }
  }
  async findUserByEmail(email: string) {
    const u = await this.db.user.findUnique({ where: { email } });
    return u ? { id: u.id, email: u.email, passwordHash: u.passwordHash, displayName: u.displayName, role: u.role } : null;
  }
  async findUserById(id: string) {
    const u = await this.db.user.findUnique({ where: { id } });
    return u ? { id: u.id, email: u.email, passwordHash: u.passwordHash, displayName: u.displayName, role: u.role } : null;
  }
  async createUserSession(userId: string, tokenHash: string, expiresAt: Date) {
    await this.db.userSession.create({ data: { userId, tokenHash, expiresAt } });
  }
  async findUserBySessionHash(tokenHash: string) {
    const s = await this.db.userSession.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!s || s.expiresAt < new Date()) return null;
    const u = s.user;
    return { id: u.id, email: u.email, passwordHash: u.passwordHash, displayName: u.displayName, role: u.role };
  }
  async deleteUserSession(tokenHash: string) {
    await this.db.userSession.deleteMany({ where: { tokenHash } });
  }

  async listProducts(): Promise<ProductRecord[]> {
    const rows = await this.db.product.findMany({ include: { prices: { where: { active: true }, take: 1 } }, orderBy: { createdAt: "asc" } });
    return rows.map((p) => ({
      id: p.id,
      kind: p.kind as ProductKind,
      name: p.name,
      tagline: p.tagline,
      description: p.description,
      published: p.published,
      packId: (p.packId as PackId | null) ?? null,
      themeId: p.themeId,
      bundleItems: p.bundleItems,
      accent: p.accent,
      priceId: p.prices[0]?.id ?? null,
      pricePaise: p.prices[0]?.amountPaise ?? null,
      currency: p.prices[0]?.currency ?? "INR",
    }));
  }
  async getProduct(id: string) {
    return (await this.listProducts()).find((p) => p.id === id) ?? null;
  }

  async createPurchase(input: Parameters<Persistence["createPurchase"]>[0]) {
    return toPurchase(await this.db.purchase.create({ data: input }));
  }
  async findPurchase(id: string) {
    const p = await this.db.purchase.findUnique({ where: { id } });
    return p ? toPurchase(p) : null;
  }
  async findPurchaseByOrderId(orderId: string) {
    const p = await this.db.purchase.findUnique({ where: { providerOrderId: orderId } });
    return p ? toPurchase(p) : null;
  }
  async markPurchasePaid(id: string, providerPaymentId: string, receiptNumber: string) {
    const cur = await this.db.purchase.findUniqueOrThrow({ where: { id } });
    if (cur.status === "PAID") return toPurchase(cur);
    return toPurchase(await this.db.purchase.update({ where: { id }, data: { status: "PAID", providerPaymentId, receiptNumber, paidAt: new Date() } }));
  }
  async markPurchaseRefunded(id: string) {
    return toPurchase(await this.db.purchase.update({ where: { id }, data: { status: "REFUNDED", refundedAt: new Date() } }));
  }
  async listPurchases(userId: string) {
    return (await this.db.purchase.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })).map(toPurchase);
  }
  async recordPaymentEvent(input: { provider: "MOCK" | "RAZORPAY"; providerEventId: string; type: string; purchaseId: string | null; payload: unknown }) {
    try {
      await this.db.paymentEvent.create({
        data: { provider: input.provider, providerEventId: input.providerEventId, type: input.type, purchaseId: input.purchaseId, payload: input.payload as object },
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return false;
      throw e;
    }
  }

  async grantEntitlement(input: { userId: string; productId: string; purchaseId: string | null; mode: "MOCK" | "RAZORPAY" }) {
    await this.db.entitlement.upsert({
      where: { userId_productId: { userId: input.userId, productId: input.productId } },
      create: { ...input, status: "ACTIVE" },
      update: { status: "ACTIVE", purchaseId: input.purchaseId, mode: input.mode, revokedAt: null },
    });
  }
  async revokeEntitlementsForPurchase(purchaseId: string) {
    await this.db.entitlement.updateMany({ where: { purchaseId }, data: { status: "REVOKED", revokedAt: new Date() } });
  }
  async listEntitlements(userId: string): Promise<EntitlementRecord[]> {
    const rows = await this.db.entitlement.findMany({ where: { userId } });
    return rows.map((e) => ({ id: e.id, userId: e.userId, productId: e.productId, purchaseId: e.purchaseId, status: e.status, mode: e.mode, grantedAt: e.grantedAt }));
  }

  async equipTheme(userId: string, themeId: string) {
    await this.db.$transaction([
      this.db.userCosmetic.updateMany({ where: { userId }, data: { equipped: false } }),
      this.db.userCosmetic.upsert({
        where: { userId_themeId: { userId, themeId } },
        create: { userId, themeId, equipped: true },
        update: { equipped: true },
      }),
    ]);
  }
  async getEquippedTheme(userId: string) {
    return (await this.db.userCosmetic.findFirst({ where: { userId, equipped: true } }))?.themeId ?? "classic";
  }

  async getBranding(userId: string): Promise<BrandingRecord | null> {
    const b = await this.db.streamerBranding.findUnique({ where: { userId } });
    if (!b) return null;
    return {
      userId,
      logoMime: b.logoMime,
      logoData: b.logoData ? Buffer.from(b.logoData) : null,
      accentColor: b.accentColor,
      secondaryColor: b.secondaryColor,
      lobbyHeader: b.lobbyHeader,
      resultsTagline: b.resultsTagline,
    };
  }
  async saveBranding(userId: string, patch: Partial<Omit<BrandingRecord, "userId">>) {
    const data = { ...patch, logoData: patch.logoData === undefined ? undefined : patch.logoData === null ? null : new Uint8Array(patch.logoData) };
    await this.db.streamerBranding.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return (await this.getBranding(userId))!;
  }

  async listPrompts() {
    return (await this.db.prompt.findMany({ orderBy: { id: "asc" } })).map(toPrompt);
  }
  async getPrompt(id: string) {
    const p = await this.db.prompt.findUnique({ where: { id } });
    return p ? toPrompt(p) : null;
  }
  async upsertPrompt(p: Prompt) {
    const data = {
      packId: p.packId,
      mode: p.mode,
      question: p.question,
      leftLabel: p.leftLabel,
      rightLabel: p.rightLabel,
      tags: p.tags,
      contentRating: p.contentRating,
      streamSafe: p.streamSafe,
      intensity: p.intensity,
      difficulty: p.difficulty,
      language: p.language,
      enabled: p.enabled,
    };
    return toPrompt(await this.db.prompt.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data }));
  }
  async listPacks(): Promise<PackRecord[]> {
    return (await this.db.contentPack.findMany({ orderBy: { id: "asc" } })).map((p) => ({ id: p.id as PackId, name: p.name, description: p.description, enabled: p.enabled }));
  }
  async setPackEnabled(id: PackId, enabled: boolean) {
    await this.db.contentPack.update({ where: { id }, data: { enabled } });
  }

  async createReport(input: { kind: string; promptId: string | null; roomCode: string | null; playerId: string | null; reason: string }) {
    const promptExists = input.promptId ? await this.db.prompt.count({ where: { id: input.promptId } }) : 0;
    await this.db.contentReport.create({ data: { ...input, promptId: promptExists ? input.promptId : null } });
  }
  async listReports(): Promise<ReportRecord[]> {
    return (await this.db.contentReport.findMany({ orderBy: { createdAt: "desc" }, take: 200 })).map((r) => ({
      id: r.id,
      kind: r.kind,
      promptId: r.promptId,
      roomCode: r.roomCode,
      playerId: r.playerId,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }
  async updateReport(id: string, status: ReportRecord["status"]) {
    await this.db.contentReport.update({ where: { id }, data: { status, reviewedAt: new Date() } });
  }

  async saveMatchResult(m: MatchSummary) {
    await this.db.$transaction(async (tx) => {
      const room = await tx.room.create({ data: { code: m.roomCode, hostUserId: m.hostUserId, settings: m.settings as object, closedAt: m.completedAt } });
      await tx.match.create({
        data: { id: m.matchId, roomId: room.id, seed: m.seed, config: m.config as object, startedAt: m.startedAt, completedAt: m.completedAt },
      });
      await tx.roomMember.createMany({ data: m.players.map((p) => ({ roomId: room.id, playerId: p.playerId, displayName: p.displayName })) });
      await tx.matchPlayer.createMany({ data: m.players.map((p) => ({ matchId: m.matchId, ...p })) });
      await tx.matchRound.createMany({ data: m.rounds.map((r) => ({ matchId: m.matchId, ...r })), skipDuplicates: true });
      await tx.gameEvent.createMany({ data: m.timeline.map((t, seq) => ({ matchId: m.matchId, seq, ...t })) });
      await tx.scoreEvent.createMany({ data: m.scoreEvents.map((e) => ({ matchId: m.matchId, ...e, detail: e.detail as object })), skipDuplicates: true });
      await tx.prediction.createMany({ data: m.predictions.map((p) => ({ matchId: m.matchId, ...p })) });
      for (const d of m.debates) {
        const { votes, ...rest } = d;
        const row = await tx.debate.create({ data: { matchId: m.matchId, ...rest } });
        await tx.debateVote.createMany({ data: votes.map((v) => ({ debateId: row.id, ...v })) });
      }
      for (const b of m.bluffs) {
        const { votes, ...rest } = b;
        const row = await tx.bluffAssignment.create({ data: { matchId: m.matchId, ...rest } });
        await tx.bluffVote.createMany({ data: votes.map((v) => ({ assignmentId: row.id, ...v })) });
      }
      await tx.contractAssignment.createMany({ data: m.contracts.map((c) => ({ matchId: m.matchId, ...c })) });
      await tx.chaosCardPlay.createMany({ data: m.cardPlays.map((c) => ({ matchId: m.matchId, ...c })), skipDuplicates: true });
    });
  }

  async close() {
    await this.db.$disconnect();
  }
}
