import type { PackId, ProductKind, Prompt } from "@hps/shared";

export type PaymentModeName = "MOCK" | "RAZORPAY";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: "HOST" | "ADMIN";
}

export interface ProductRecord {
  id: string;
  kind: ProductKind;
  name: string;
  tagline: string;
  description: string;
  published: boolean;
  packId: PackId | null;
  themeId: string | null;
  bundleItems: string[];
  accent: string;
  priceId: string | null;
  pricePaise: number | null;
  currency: string;
}

export interface PurchaseRecord {
  id: string;
  userId: string;
  productId: string;
  priceId: string;
  amountPaise: number;
  currency: string;
  mode: PaymentModeName;
  status: "CREATED" | "PAID" | "FAILED" | "REFUNDED";
  providerOrderId: string;
  providerPaymentId: string | null;
  receiptNumber: string | null;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
}

export interface EntitlementRecord {
  id: string;
  userId: string;
  productId: string;
  purchaseId: string | null;
  status: "ACTIVE" | "REVOKED";
  mode: PaymentModeName;
  grantedAt: Date;
}

export interface BrandingRecord {
  userId: string;
  logoMime: string | null;
  logoData: Buffer | null;
  accentColor: string;
  secondaryColor: string;
  lobbyHeader: string | null;
  resultsTagline: string | null;
}

export interface ReportRecord {
  id: string;
  kind: string;
  promptId: string | null;
  roomCode: string | null;
  playerId: string | null;
  reason: string;
  status: "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED";
  createdAt: Date;
}

export interface PackRecord {
  id: PackId;
  name: string;
  description: string;
  enabled: boolean;
}

/** Everything written when a match completes. Only revealed/derived data — never sealed secrets. */
export interface MatchSummary {
  matchId: string;
  roomCode: string;
  hostUserId: string | null;
  seed: string;
  config: unknown;
  settings: unknown;
  startedAt: Date;
  completedAt: Date;
  players: { playerId: string; displayName: string; seat: number; finalScore: number; finalRank: number | null; sharedRank: boolean }[];
  rounds: { segment: string; index: number; promptId: string }[];
  timeline: { kind: string; text: string; at: Date }[];
  scoreEvents: { eventKey: string; playerId: string; type: string; amount: number; segment: string; label: string; detail: unknown; at: Date }[];
  predictions: { roundIndex: number; predictorId: string; targetId: string; value: number; points: number }[];
  debates: { hearing: number; promptId: string; debaterAId: string; debaterBId: string; sideA: string; swapped: boolean; winnerId: string; tiebreak: boolean; votes: { voterId: string; winnerId: string }[] }[];
  bluffs: { turn: number; speakerId: string; role: string; claimed: number; promptId: string; votes: { voterId: string; guess: string; correct: boolean }[] }[];
  contracts: { playerId: string; type: string; status: string }[];
  cardPlays: { id: string; playerId: string; card: string; unitKey: string; outcome: string; at: Date }[];
}

/**
 * Persistence boundary. The Prisma implementation is used whenever DATABASE_URL is set;
 * the in-memory implementation powers tests and zero-setup local play.
 */
export interface Persistence {
  readonly kind: "memory" | "postgres";

  createGuestSession(tokenHash: string, expiresAt: Date): Promise<string>;
  findGuestSession(tokenHash: string): Promise<{ id: string } | null>;

  createUser(input: { email: string; passwordHash: string; displayName: string }): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUserSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findUserBySessionHash(tokenHash: string): Promise<UserRecord | null>;
  deleteUserSession(tokenHash: string): Promise<void>;

  listProducts(): Promise<ProductRecord[]>;
  getProduct(id: string): Promise<ProductRecord | null>;

  createPurchase(input: Omit<PurchaseRecord, "id" | "status" | "providerPaymentId" | "receiptNumber" | "createdAt" | "paidAt" | "refundedAt">): Promise<PurchaseRecord>;
  findPurchase(id: string): Promise<PurchaseRecord | null>;
  findPurchaseByOrderId(orderId: string): Promise<PurchaseRecord | null>;
  markPurchasePaid(id: string, providerPaymentId: string, receiptNumber: string): Promise<PurchaseRecord>;
  markPurchaseRefunded(id: string): Promise<PurchaseRecord>;
  listPurchases(userId: string): Promise<PurchaseRecord[]>;
  /** Returns false when this provider event was already processed (webhook idempotency). */
  recordPaymentEvent(input: { provider: PaymentModeName; providerEventId: string; type: string; purchaseId: string | null; payload: unknown }): Promise<boolean>;

  grantEntitlement(input: { userId: string; productId: string; purchaseId: string | null; mode: PaymentModeName }): Promise<void>;
  revokeEntitlementsForPurchase(purchaseId: string): Promise<void>;
  listEntitlements(userId: string): Promise<EntitlementRecord[]>;

  equipTheme(userId: string, themeId: string): Promise<void>;
  getEquippedTheme(userId: string): Promise<string>;

  getBranding(userId: string): Promise<BrandingRecord | null>;
  saveBranding(userId: string, patch: Partial<Omit<BrandingRecord, "userId">>): Promise<BrandingRecord>;

  listPrompts(): Promise<Prompt[]>;
  getPrompt(id: string): Promise<Prompt | null>;
  upsertPrompt(p: Prompt): Promise<Prompt>;
  listPacks(): Promise<PackRecord[]>;
  setPackEnabled(id: PackId, enabled: boolean): Promise<void>;

  createReport(input: { kind: string; promptId: string | null; roomCode: string | null; playerId: string | null; reason: string }): Promise<void>;
  listReports(): Promise<ReportRecord[]>;
  updateReport(id: string, status: ReportRecord["status"]): Promise<void>;

  saveMatchResult(summary: MatchSummary): Promise<void>;
  close(): Promise<void>;
}
