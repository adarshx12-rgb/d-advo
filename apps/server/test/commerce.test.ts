import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAdultPrompt } from "@hps/content";
import { hmacHex, MockPaymentProvider, RazorpayPaymentProvider } from "../src/payments/provider";
import { PaymentService } from "../src/payments/service";
import { MemoryPersistence } from "../src/persistence/memory";
import type { RunningServer } from "../src/server";
import { bootServer, TestClient } from "./harness";

let server: RunningServer & { mem: MemoryPersistence };
const clients: TestClient[] = [];

beforeAll(async () => {
  server = await bootServer();
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function api<T = Record<string, unknown>>(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${server.url}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as T };
}

let n = 0;
async function account() {
  const email = `host${++n}-${Date.now()}@example.com`;
  const r = await api<{ token: string; user: { id: string } }>("/api/auth/register", { body: { email, password: "correct-horse", displayName: `Host ${n}` } });
  expect(r.status).toBe(200);
  return r.json;
}

async function buy(token: string, productId: string) {
  const co = await api<{ purchaseId: string; amountPaise: number }>("/api/store/checkout", { token, body: { productId, amountPaise: 1 } });
  expect(co.status).toBe(200);
  const done = await api<{ status: string }>("/api/store/mock/complete", { token, body: { purchaseId: co.json.purchaseId } });
  expect(done.json.status).toBe("granted");
  return co.json;
}

describe("store and payments", () => {
  it("lists the approved catalog with server-side prices in paise", async () => {
    const r = await api<{ products: { id: string; pricePaise: number | null; purchasable: boolean; preview: { question: string }[] }[] }>("/api/store/products");
    const price = (id: string) => r.json.products.find((p) => p.id === id)!.pricePaise;
    expect(price("pack-base")).toBe(0);
    expect(price("pack-dark-humor")).toBe(9900);
    expect(price("pack-friendship-destroyer")).toBe(14900);
    expect(price("pack-dating")).toBe(14900);
    expect(price("pack-anime-gaming")).toBe(14900);
    expect(price("creator-streamer-branding")).toBe(29900);
    expect(price("bundle-all-access")).toBeNull();
    const themes = r.json.products.filter((p) => p.id.startsWith("theme-"));
    expect(themes.every((t) => t.pricePaise! >= 4900 && t.pricePaise! <= 19900)).toBe(true);
    expect(r.json.products.find((p) => p.id === "bundle-all-access")!.purchasable).toBe(false);
    // previews never include adult prompts
    const all = await server.mem.listPrompts();
    for (const p of r.json.products) for (const q of p.preview) expect(isAdultPrompt(all.find((x) => x.question === q.question)!)).toBe(false);
  });

  it("ignores client-supplied prices, requires an account, and refuses the unpriced bundle", async () => {
    expect((await api("/api/store/checkout", { body: { productId: "pack-dating" } })).status).toBe(401);
    const { token } = await account();
    const co = await api<{ amountPaise: number }>("/api/store/checkout", { token, body: { productId: "pack-dating", amountPaise: 1 } });
    expect(co.json.amountPaise).toBe(14900);
    expect((await api("/api/store/checkout", { token, body: { productId: "bundle-all-access" } })).status).toBe(409);
    expect((await api("/api/store/checkout", { token, body: { productId: "pack-base" } })).status).toBe(409);
  });

  it("grants entitlements only from a correctly signed webhook, idempotently", async () => {
    const { token, user } = await account();
    const co = await api<{ purchaseId: string; orderId: string }>("/api/store/checkout", { token, body: { productId: "pack-anime-gaming" } });
    const body = JSON.stringify({ id: "evt_fixed_1", event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: co.json.orderId, amount: 14900 } } } });
    const post = (sig: string) => fetch(`${server.url}/api/webhooks/payments`, { method: "POST", headers: { "content-type": "application/json", "x-mock-signature": sig }, body });
    expect((await post("00".repeat(32))).status).toBe(400);
    expect((await server.payments.ownership(user.id)).packIds).not.toContain("anime-gaming");
    const good = hmacHex("dev-mock-webhook-secret", body);
    expect(await (await post(good)).json()).toEqual({ status: "granted" });
    expect(await (await post(good)).json()).toEqual({ status: "duplicate" });
    expect((await server.payments.ownership(user.id)).packIds).toContain("anime-gaming");
    const lib = await api<{ purchases: { status: string; receiptNumber: string }[] }>("/api/library", { token });
    expect(lib.json.purchases[0]!.status).toBe("PAID");
    expect(lib.json.purchases[0]!.receiptNumber).toMatch(/^HPS-/);
  });

  it("rejects a webhook whose amount does not match the order", async () => {
    const { token } = await account();
    const co = await api<{ orderId: string }>("/api/store/checkout", { token, body: { productId: "pack-dark-humor" } });
    const body = JSON.stringify({ id: "evt_amount", event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: co.json.orderId, amount: 100 } } } });
    const res = await fetch(`${server.url}/api/webhooks/payments`, { method: "POST", headers: { "x-mock-signature": hmacHex("dev-mock-webhook-secret", body) }, body });
    expect(res.status).toBe(409);
  });

  it("revokes entitlements on refund", async () => {
    const { token, user } = await account();
    const { purchaseId } = await buy(token, "pack-dark-humor");
    expect((await server.payments.ownership(user.id)).packIds).toContain("dark-humor");
    await api("/api/store/mock/refund", { token, body: { purchaseId } });
    expect((await server.payments.ownership(user.id)).packIds).not.toContain("dark-humor");
  });

  it("verifies Razorpay webhook signatures over the exact raw body", () => {
    const rz = new RazorpayPaymentProvider("rzp_test_key", "key_secret", "whsec_test");
    const raw = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_9", order_id: "order_9", amount: 9900 } } } }));
    const ev = rz.verifyWebhook(raw, hmacHex("whsec_test", raw));
    expect(ev).toMatchObject({ kind: "PAYMENT_CAPTURED", orderId: "order_9", paymentId: "pay_9", amountPaise: 9900 });
    expect(rz.verifyWebhook(raw, hmacHex("wrong_secret", raw))).toBeNull();
    expect(rz.verifyWebhook(Buffer.concat([raw, Buffer.from(" ")]), hmacHex("whsec_test", raw))).toBeNull();
    expect(rz.verifyWebhook(raw, undefined)).toBeNull();
  });

  it("never honours mock entitlements in production", async () => {
    const db = new MemoryPersistence();
    await db.grantEntitlement({ userId: "u1", productId: "pack-dating", purchaseId: null, mode: "MOCK" });
    const dev = new PaymentService(db, new MockPaymentProvider("x"), false);
    const prod = new PaymentService(db, new MockPaymentProvider("x"), true);
    expect((await dev.ownership("u1")).packIds).toContain("dating");
    expect((await prod.ownership("u1")).packIds).not.toContain("dating");
  });

  it("cosmetic themes only change appearance and can be equipped once owned", async () => {
    const { token } = await account();
    expect((await api("/api/library/equip", { token, body: { themeId: "tabloid" } })).status).toBe(403);
    await buy(token, "theme-tabloid");
    const lib = await api<{ equippedTheme: string }>("/api/library", { token });
    expect(lib.json.equippedTheme).toBe("tabloid");
  });
});

describe("host-owned packs in rooms", () => {
  it("a guest host cannot enable paid packs; an owning host can and everyone in the room uses them", async () => {
    const guest = await new TestClient(server.url, "Guesty").connect();
    clients.push(guest);
    await guest.call("room:create", { displayName: "Guesty", avatar: "star" });
    await guest.waitFor(() => !!guest.room);
    expect(guest.room!.packs.find((p) => p.packId === "dating")!.owned).toBe(false);
    await expect(guest.call("room:settings", { patch: { enabledPacks: ["base", "dating"] } })).rejects.toThrow(/do not own/);

    const { token } = await account();
    await buy(token, "pack-dating");
    const owner = await new TestClient(server.url, "Owner").connect(undefined, token);
    clients.push(owner);
    const { code } = await owner.call<{ code: string }>("room:create", { displayName: "Owner", avatar: "crown" });
    await owner.call("room:settings", { patch: { enabledPacks: ["base", "dating"] } });
    await owner.waitFor(() => owner.room?.settings.enabledPacks.includes("dating") === true);
    const friend = await new TestClient(server.url, "Friend").connect();
    clients.push(friend);
    await friend.call("room:join", { code, displayName: "Friend", avatar: "cat" });
    await friend.waitFor(() => !!friend.room);
    expect(friend.room!.packs.find((p) => p.packId === "dating")!.owned).toBe(true);
    await expect(friend.call("room:settings", { patch: { enabledPacks: ["base"] } })).rejects.toThrow(/Only the host/);
    const room = server.rooms.rooms.get(code)!;
    expect(server.rooms.buildPool(room).pool.some((p) => p.packId === "dating")).toBe(true);
  });

  it("NSFW off reliably excludes adult content; on requires every player's consent", async () => {
    const { token } = await account();
    await buy(token, "pack-friendship-destroyer");
    const h = await new TestClient(server.url, "H").connect(undefined, token);
    clients.push(h);
    const { code } = await h.call<{ code: string }>("room:create", { displayName: "H", avatar: "crown" });
    const p2 = await new TestClient(server.url, "P2").connect();
    clients.push(p2);
    await p2.call("room:join", { code, displayName: "P2", avatar: "cat" });
    const room = server.rooms.rooms.get(code)!;
    const adultIn = () => server.rooms.buildPool(room).pool.filter(isAdultPrompt);

    await h.call("room:settings", { patch: { enabledPacks: ["base", "friendship-destroyer"] } });
    expect(adultIn()).toHaveLength(0);
    expect(server.rooms.buildPool(room).pool.filter((p) => p.packId === "friendship-destroyer")).toHaveLength(30);

    await expect(h.call("room:settings", { patch: { nsfwByPack: { base: true } } })).rejects.toThrow();
    await h.call("room:settings", { patch: { nsfwByPack: { base: false, "dark-humor": false, "friendship-destroyer": true, dating: false, "anime-gaming": false } } });
    expect(adultIn()).toHaveLength(0); // nobody consented yet

    await expect(h.call("player:consent", { adultContent: true, ageConfirmed: false, hiddenTopics: [] })).rejects.toThrow(/18/);
    await h.call("player:consent", { adultContent: true, ageConfirmed: true, hiddenTopics: [] });
    expect(adultIn()).toHaveLength(0); // one player still has not opted in
    await p2.call("player:consent", { adultContent: true, ageConfirmed: true, hiddenTopics: [] });
    expect(adultIn().length).toBe(10);
    expect(adultIn().every((p) => p.packId === "friendship-destroyer")).toBe(true);
    await h.waitFor(() => h.room?.adultContent.active === true);

    // a player hiding a topic removes it for the room
    await p2.call("player:consent", { adultContent: true, ageConfirmed: true, hiddenTopics: ["sex"] });
    expect(server.rooms.buildPool(room).pool.some((p) => p.tags.includes("sex"))).toBe(false);
    // and a late joiner who has not consented switches adult content off again
    const p3 = await new TestClient(server.url, "P3").connect();
    clients.push(p3);
    await p3.call("room:join", { code, displayName: "P3", avatar: "eye" });
    expect(adultIn()).toHaveLength(0);
  });
});

describe("admin", () => {
  it("is invisible to ordinary users and works for admins, with validation", async () => {
    const { token, user } = await account();
    expect((await api("/api/admin/prompts", { token })).status).toBe(404);
    server.mem.makeAdmin(user.id);
    const list = await api<{ total: number }>("/api/admin/prompts?pack=base", { token });
    expect(list.json.total).toBe(60);
    const bad = await api("/api/admin/prompts", { token, body: { packId: "base", mode: "SPECTRUM", question: "Is this mature?", leftLabel: "No", rightLabel: "Yes", tags: [], contentRating: "MATURE", streamSafe: false, intensity: 3 } });
    expect(bad.status).toBe(400);
    const ok = await api<{ prompt: { id: string } }>("/api/admin/prompts", { token, body: { packId: "dating", mode: "SPECTRUM", question: "How many first dates is too many in one week?", leftLabel: "One", rightLabel: "No limit", tags: ["dating"], contentRating: "SAFE", streamSafe: true, intensity: 2 } });
    expect(ok.status).toBe(200);
    expect((await api(`/api/admin/prompts/${ok.json.prompt.id}`, { method: "PATCH", token, body: { enabled: false } })).status).toBe(200);
    const csv = 'packId,mode,question,leftLabel,rightLabel,tags,contentRating,streamSafe,intensity\nbase,DEBATE,"Snacks are a meal, actually.",Disagree,Agree,food,SAFE,true,1\nbase,SPECTRUM,short,a,b,,SAFE,true,1\n';
    const v = await api<{ valid: unknown[]; errors: { row: number }[] }>("/api/admin/prompts/validate", { token, body: { format: "csv", data: csv } });
    expect(v.json.valid).toHaveLength(1);
    expect(v.json.errors[0]!.row).toBe(2);
    expect((await api("/api/admin/prompts/import", { token, body: { format: "csv", data: csv } })).status).toBe(400);
    expect((await api("/api/admin/packs/base", { method: "PATCH", token, body: { enabled: false } })).status).toBe(400);
  });
});
