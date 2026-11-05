import path from "node:path";
import { config } from "dotenv";
import { CATALOG } from "@hps/shared";
import { PACK_META, SEED_PROMPTS } from "@hps/content";
import { createPrismaClient, hashPassword } from "./index";

config({ path: path.resolve(import.meta.dirname, "../../../.env") });

/**
 * Idempotent seed: safe to run any number of times.
 * - Products are upserted; a price row is only added when the catalog price changes (old one deactivated).
 * - Prompts are inserted if missing and never overwritten, so admin edits survive re-seeding.
 * - An admin account is created only when ADMIN_EMAIL and ADMIN_PASSWORD are set.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  const db = createPrismaClient(url);
  try {
    for (const p of CATALOG) {
      await db.product.upsert({
        where: { id: p.id },
        create: {
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
        },
        update: {
          kind: p.kind,
          name: p.name,
          tagline: p.tagline,
          description: p.description,
          published: p.published,
          packId: p.packId ?? null,
          themeId: p.themeId ?? null,
          bundleItems: p.bundleProductIds ?? [],
          accent: p.accent,
        },
      });
      const active = await db.price.findFirst({ where: { productId: p.id, active: true } });
      if (!active || active.amountPaise !== p.pricePaise) {
        await db.$transaction([
          db.price.updateMany({ where: { productId: p.id, active: true }, data: { active: false } }),
          db.price.create({ data: { productId: p.id, amountPaise: p.pricePaise, currency: p.currency, active: true } }),
        ]);
      }
    }

    for (const pack of PACK_META) {
      const product = CATALOG.find((c) => c.packId === pack.id);
      await db.contentPack.upsert({
        where: { id: pack.id },
        create: { id: pack.id, name: pack.name, description: pack.description, productId: product?.id ?? null },
        update: { name: pack.name, description: pack.description, productId: product?.id ?? null },
      });
    }

    const created = await db.prompt.createMany({
      data: SEED_PROMPTS.map((p) => ({
        id: p.id,
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
      })),
      skipDuplicates: true,
    });

    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      const existing = await db.user.findUnique({ where: { email } });
      if (!existing) {
        await db.user.create({ data: { email, passwordHash: await hashPassword(password), displayName: "Admin", role: "ADMIN" } });
        console.info(`Created admin ${email}`);
      } else if (existing.role !== "ADMIN") {
        await db.user.update({ where: { email }, data: { role: "ADMIN" } });
      }
    }
    console.info(`Seed complete: ${CATALOG.length} products, ${PACK_META.length} packs, ${created.count} new prompts.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
