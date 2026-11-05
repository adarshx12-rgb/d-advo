import "dotenv/config";
import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load the repo-root .env so `pnpm db:*` works from any directory.
config({ path: path.resolve(import.meta.dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx src/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://hps:hps_dev_password@localhost:5433/hybrid_party_show" },
});
