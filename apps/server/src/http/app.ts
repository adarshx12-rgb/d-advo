import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { CARD_THEMES, PACK_IDS, type PackId } from "@hps/shared";
import { AuthError, type AuthService } from "../auth";
import type { Env } from "../env";
import { MockPaymentProvider } from "../payments/provider";
import { PaymentError, type PaymentService } from "../payments/service";
import type { Persistence, UserRecord } from "../persistence/types";
import type { RoomManager } from "../rooms/manager";
import type { PromptService } from "../rooms/prompt-service";
import { csvToObjects, promptInputSchema, toPrompt, validateRows } from "./admin";

interface Deps {
  env: Env;
  db: Persistence;
  auth: AuthService;
  payments: PaymentService;
  prompts: PromptService;
  rooms: RoomManager;
  log: (msg: string) => void;
}

type AuthedRequest = Request & { user?: UserRecord };

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_LOGO_BYTES = 512 * 1024;

/** Accept only raster formats identified by their magic bytes. SVG is rejected (script risk). */
export function sniffImage(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Simple fixed-window limiter keyed by IP for sensitive endpoints. */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > max) {
      res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
      return;
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

export function createApp(deps: Deps) {
  const { env, db, auth, payments, prompts, rooms } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.webOrigins, credentials: false }));

  // Webhooks need the exact raw bytes for signature verification, so they are mounted before express.json().
  app.post("/api/webhooks/payments", express.raw({ type: "*/*", limit: "256kb" }), async (req, res) => {
    const sig = (req.header("x-razorpay-signature") ?? req.header("x-mock-signature")) || undefined;
    const result = await payments.handleWebhook(req.body as Buffer, sig);
    if (result.message === "granted" || result.message === "revoked") {
      const purchase = await findPurchaseFromBody(req.body as Buffer);
      if (purchase) await rooms.onOwnershipChanged(purchase.userId);
    }
    res.status(result.status).json({ status: result.message });
  });

  async function findPurchaseFromBody(body: Buffer) {
    try {
      const j = JSON.parse(body.toString("utf8")) as { payload?: { payment?: { entity?: { order_id?: string } } } };
      const orderId = j.payload?.payment?.entity?.order_id;
      return orderId ? await db.findPurchaseByOrderId(orderId) : null;
    } catch {
      return null;
    }
  }

  app.use(express.json({ limit: "1mb" }));

  const wrap =
    (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req as AuthedRequest, res).catch(next);
    };

  const bearer = (req: Request) => {
    const h = req.header("authorization");
    return h?.startsWith("Bearer ") ? h.slice(7) : null;
  };

  const withUser = (handler: (req: AuthedRequest & { user: UserRecord }, res: Response) => Promise<unknown>) =>
    wrap(async (req, res) => {
      const user = await auth.resolveUser(bearer(req));
      if (!user) throw new HttpError(401, "Sign in to continue.");
      req.user = user;
      await handler(req as AuthedRequest & { user: UserRecord }, res);
    });
  const withAdmin = (handler: (req: AuthedRequest & { user: UserRecord }, res: Response) => Promise<unknown>) =>
    withUser(async (req, res) => {
      // Admin endpoints are invisible to ordinary players.
      if (req.user.role !== "ADMIN") throw new HttpError(404, "Not found.");
      await handler(req, res);
    });

  const body = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => {
    const r = schema.safeParse(req.body);
    if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Invalid request.");
    return r.data;
  };

  /* ------------------------------ session & auth ------------------------------ */

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, persistence: db.kind, payments: payments.provider.mode, rooms: rooms.rooms.size });
  });

  app.post("/api/session/guest", rateLimit(30, 60_000), wrap(async (_req, res) => {
    const { token } = await auth.issueGuest();
    res.json({ guestToken: token });
  }));

  app.post("/api/auth/register", rateLimit(10, 60_000), wrap(async (req, res) => {
    const b = body(z.object({ email: z.string(), password: z.string(), displayName: z.string().default("") }), req);
    const { token, user } = await auth.register(b.email, b.password, b.displayName);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
  }));

  app.post("/api/auth/login", rateLimit(10, 60_000), wrap(async (req, res) => {
    const b = body(z.object({ email: z.string(), password: z.string() }), req);
    const { token, user } = await auth.login(b.email, b.password);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } });
  }));

  app.post("/api/auth/logout", wrap(async (req, res) => {
    const t = bearer(req);
    if (t) await auth.logout(t);
    res.json({ ok: true });
  }));

  app.get("/api/auth/me", withUser(async (req, res) => {
    const own = await payments.ownership(req.user.id);
    res.json({
      user: { id: req.user.id, email: req.user.email, displayName: req.user.displayName, role: req.user.role },
      ownership: own,
      equippedTheme: await db.getEquippedTheme(req.user.id),
    });
  }));

  app.get("/api/rooms/public", (_req, res) => {
    res.json({ rooms: rooms.publicRooms() });
  });

  /* ---------------------------------- store ---------------------------------- */

  app.get("/api/store/products", wrap(async (req, res) => {
    const user = await auth.resolveUser(bearer(req));
    const items = await payments.catalog(user?.id ?? null);
    res.json({
      mode: payments.provider.mode,
      products: items.map((p) => ({
        ...p,
        preview: p.packId ? prompts.preview(p.packId, 3).map(previewOf) : [],
        promptCounts: p.packId ? prompts.counts(p.packId) : null,
      })),
    });
  }));

  app.get("/api/store/products/:id", wrap(async (req, res) => {
    const user = await auth.resolveUser(bearer(req));
    const p = (await payments.catalog(user?.id ?? null)).find((x) => x.id === req.params.id);
    if (!p) throw new HttpError(404, "That product does not exist.");
    res.json({
      mode: payments.provider.mode,
      product: { ...p, preview: p.packId ? prompts.preview(p.packId, 6).map(previewOf) : [], promptCounts: p.packId ? prompts.counts(p.packId) : null },
    });
  }));

  app.post("/api/store/checkout", rateLimit(20, 60_000), withUser(async (req, res) => {
    // Only a product id is accepted. Any price in the body is ignored; the server looks it up.
    const b = body(z.object({ productId: z.string().min(1).max(64) }), req);
    res.json(await payments.checkout(req.user.id, b.productId));
  }));

  app.get("/api/store/purchases/:id", withUser(async (req, res) => {
    const p = await db.findPurchase(String(req.params.id));
    if (!p || p.userId !== req.user.id) throw new HttpError(404, "Purchase not found.");
    res.json({ purchase: p });
  }));

  if (payments.provider instanceof MockPaymentProvider && env.NODE_ENV !== "production") {
    const mock = payments.provider;
    // Development only: plays the role of the payment provider calling our webhook.
    app.post("/api/store/mock/complete", withUser(async (req, res) => {
      const b = body(z.object({ purchaseId: z.string() }), req);
      const p = await db.findPurchase(b.purchaseId);
      if (!p || p.userId !== req.user.id) throw new HttpError(404, "Purchase not found.");
      const { body: raw, signature } = mock.simulateCapture(p.providerOrderId, p.amountPaise);
      const result = await payments.handleWebhook(raw, signature);
      await rooms.onOwnershipChanged(req.user.id);
      res.status(result.status).json({ status: result.message, purchase: await db.findPurchase(p.id) });
    }));
    app.post("/api/store/mock/refund", withUser(async (req, res) => {
      const b = body(z.object({ purchaseId: z.string() }), req);
      const p = await db.findPurchase(b.purchaseId);
      if (!p || p.userId !== req.user.id || !p.providerPaymentId) throw new HttpError(404, "Paid purchase not found.");
      const { body: raw, signature } = mock.simulateRefund(p.providerPaymentId, p.providerOrderId);
      const result = await payments.handleWebhook(raw, signature);
      await rooms.onOwnershipChanged(req.user.id);
      res.status(result.status).json({ status: result.message });
    }));
  }

  app.get("/api/library", withUser(async (req, res) => {
    const [own, purchases, products, equipped] = await Promise.all([
      payments.ownership(req.user.id),
      db.listPurchases(req.user.id),
      db.listProducts(),
      db.getEquippedTheme(req.user.id),
    ]);
    res.json({
      ownership: own,
      equippedTheme: equipped,
      themes: CARD_THEMES.map((t) => ({ ...t, owned: own.themeIds.includes(t.id) })),
      purchases: purchases.map((p) => ({ ...p, productName: products.find((x) => x.id === p.productId)?.name ?? p.productId })),
    });
  }));

  app.post("/api/library/equip", withUser(async (req, res) => {
    const b = body(z.object({ themeId: z.string() }), req);
    const own = await payments.ownership(req.user.id);
    if (!own.themeIds.includes(b.themeId)) throw new HttpError(403, "You do not own that theme.");
    await db.equipTheme(req.user.id, b.themeId);
    res.json({ equippedTheme: b.themeId });
  }));

  /* --------------------------------- branding --------------------------------- */

  const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be hex values like #8B6CFF");
  const requireBranding = async (userId: string) => {
    if (!(await payments.ownership(userId)).streamerBranding) throw new HttpError(403, "Streamer Branding is a paid creator feature. Unlock it in the store.");
  };

  app.get("/api/branding", withUser(async (req, res) => {
    const own = await payments.ownership(req.user.id);
    const b = await db.getBranding(req.user.id);
    res.json({
      unlocked: own.streamerBranding,
      branding: b
        ? { accentColor: b.accentColor, secondaryColor: b.secondaryColor, lobbyHeader: b.lobbyHeader, resultsTagline: b.resultsTagline, hasLogo: !!b.logoData, logoUrl: b.logoData ? `/api/branding/logo/${req.user.id}?v=${b.logoData.length}` : null }
        : null,
    });
  }));

  app.put("/api/branding", withUser(async (req, res) => {
    await requireBranding(req.user.id);
    const b = body(
      z.object({
        accentColor: colour,
        secondaryColor: colour,
        lobbyHeader: z.string().trim().max(60).nullable(),
        resultsTagline: z.string().trim().max(80).nullable(),
      }),
      req,
    );
    await db.saveBranding(req.user.id, { ...b, lobbyHeader: b.lobbyHeader || null, resultsTagline: b.resultsTagline || null });
    await rooms.onBrandingChanged(req.user.id);
    res.json({ ok: true });
  }));

  app.post("/api/branding/logo", withUser(async (req, res) => {
    await requireBranding(req.user.id);
    const b = body(z.object({ dataBase64: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 8) }), req);
    const buf = Buffer.from(b.dataBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) throw new HttpError(400, "Logos must be under 512 KB.");
    const mime = sniffImage(buf);
    if (!mime) throw new HttpError(400, "Upload a PNG, JPEG or WebP image.");
    await db.saveBranding(req.user.id, { logoData: buf, logoMime: mime });
    await rooms.onBrandingChanged(req.user.id);
    res.json({ ok: true });
  }));

  app.delete("/api/branding/logo", withUser(async (req, res) => {
    await db.saveBranding(req.user.id, { logoData: null, logoMime: null });
    await rooms.onBrandingChanged(req.user.id);
    res.json({ ok: true });
  }));

  app.get("/api/branding/logo/:userId", wrap(async (req, res) => {
    const userId = String(req.params.userId);
    const own = await payments.ownership(userId);
    const b = own.streamerBranding ? await db.getBranding(userId) : null;
    if (!b?.logoData || !b.logoMime) throw new HttpError(404, "No logo.");
    res.setHeader("Content-Type", b.logoMime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(b.logoData);
  }));

  /* ---------------------------------- admin ---------------------------------- */

  app.get("/api/admin/prompts", withAdmin(async (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const pack = String(req.query.pack ?? "");
    const mode = String(req.query.mode ?? "");
    const rating = String(req.query.rating ?? "");
    const list = (await db.listPrompts()).filter(
      (p) =>
        (!q || p.question.toLowerCase().includes(q) || p.id.includes(q) || p.tags.some((t) => t.includes(q))) &&
        (!pack || p.packId === pack) &&
        (!mode || p.mode === mode) &&
        (!rating || p.contentRating === rating),
    );
    res.json({ prompts: list, total: list.length });
  }));

  app.post("/api/admin/prompts", withAdmin(async (req, res) => {
    const input = body(promptInputSchema, req);
    if (input.id && (await db.getPrompt(input.id))) throw new HttpError(409, "A prompt with that id already exists.");
    const saved = await db.upsertPrompt(toPrompt(input));
    await prompts.refresh();
    res.json({ prompt: saved });
  }));

  app.put("/api/admin/prompts/:id", withAdmin(async (req, res) => {
    const id = String(req.params.id);
    if (!(await db.getPrompt(id))) throw new HttpError(404, "Prompt not found.");
    const input = body(promptInputSchema, req);
    const saved = await db.upsertPrompt(toPrompt(input, id));
    await prompts.refresh();
    res.json({ prompt: saved });
  }));

  app.patch("/api/admin/prompts/:id", withAdmin(async (req, res) => {
    const id = String(req.params.id);
    const cur = await db.getPrompt(id);
    if (!cur) throw new HttpError(404, "Prompt not found.");
    const b = body(z.object({ enabled: z.boolean() }), req);
    await db.upsertPrompt({ ...cur, enabled: b.enabled });
    await prompts.refresh();
    res.json({ ok: true });
  }));

  app.post("/api/admin/prompts/validate", withAdmin(async (req, res) => {
    const b = body(z.object({ format: z.enum(["json", "csv"]), data: z.string().max(2_000_000) }), req);
    res.json(parseImport(b.format, b.data));
  }));

  app.post("/api/admin/prompts/import", withAdmin(async (req, res) => {
    const b = body(z.object({ format: z.enum(["json", "csv"]), data: z.string().max(2_000_000) }), req);
    const result = parseImport(b.format, b.data);
    if (result.errors.length) throw new HttpError(400, `Fix ${result.errors.length} invalid row(s) before importing.`);
    for (const p of result.valid) await db.upsertPrompt(toPrompt(p));
    await prompts.refresh();
    res.json({ imported: result.valid.length });
  }));

  function parseImport(format: "json" | "csv", data: string) {
    let rows: unknown[];
    try {
      rows = format === "json" ? (JSON.parse(data) as unknown[]) : csvToObjects(data);
    } catch {
      throw new HttpError(400, "Could not parse the file. Check that it is valid JSON or CSV.");
    }
    if (!Array.isArray(rows)) throw new HttpError(400, "JSON imports must be an array of prompts.");
    if (rows.length > 2000) throw new HttpError(400, "Import at most 2000 prompts at a time.");
    return validateRows(rows);
  }

  app.get("/api/admin/packs", withAdmin(async (_req, res) => {
    const packs = await db.listPacks();
    res.json({ packs: packs.map((p) => ({ ...p, counts: prompts.counts(p.id) })) });
  }));

  app.patch("/api/admin/packs/:id", withAdmin(async (req, res) => {
    const id = String(req.params.id);
    if (!(PACK_IDS as readonly string[]).includes(id)) throw new HttpError(404, "Pack not found.");
    if (id === "base") throw new HttpError(400, "Base Game cannot be disabled; it guarantees the game is always playable for free.");
    const b = body(z.object({ enabled: z.boolean() }), req);
    await db.setPackEnabled(id as PackId, b.enabled);
    await prompts.refresh();
    res.json({ ok: true });
  }));

  app.get("/api/admin/reports", withAdmin(async (_req, res) => {
    res.json({ reports: await db.listReports() });
  }));

  app.patch("/api/admin/reports/:id", withAdmin(async (req, res) => {
    const b = body(z.object({ status: z.enum(["OPEN", "REVIEWED", "ACTIONED", "DISMISSED"]) }), req);
    await db.updateReport(String(req.params.id), b.status);
    res.json({ ok: true });
  }));

  /* --------------------------------- errors --------------------------------- */

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof AuthError || err instanceof PaymentError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    deps.log(`http error: ${(err as Error)?.stack ?? err}`);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return app;
}

function previewOf(p: { id: string; mode: string; question: string; leftLabel: string; rightLabel: string }) {
  return { id: p.id, mode: p.mode, question: p.question, leftLabel: p.leftLabel, rightLabel: p.rightLabel };
}
