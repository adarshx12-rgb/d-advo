import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16).default("dev-only-session-secret-change-me"),
  RECONNECT_WINDOW_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  GAME_TIMER_SCALE: z.coerce.number().min(0.001).max(10).default(1),
  PAYMENT_MODE: z.enum(["mock", "razorpay"]).default("mock"),
  MOCK_WEBHOOK_SECRET: z.string().default("dev-mock-webhook-secret"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { webOrigins: string[] };

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.parse(source);
  const env: Env = { ...parsed, webOrigins: parsed.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean) };
  if (env.NODE_ENV === "production") {
    if (env.PAYMENT_MODE === "mock") {
      throw new Error("Refusing to start: PAYMENT_MODE=mock is not allowed in production.");
    }
    if (env.SESSION_SECRET.startsWith("dev-") || env.SESSION_SECRET.startsWith("change-me")) {
      throw new Error("Refusing to start: set a strong SESSION_SECRET in production.");
    }
  }
  if (env.PAYMENT_MODE === "razorpay" && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) {
    throw new Error("PAYMENT_MODE=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.");
  }
  return env;
}
