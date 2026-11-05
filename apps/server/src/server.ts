import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AuthService } from "./auth";
import { createApp } from "./http/app";
import type { Env } from "./env";
import { MockPaymentProvider, RazorpayPaymentProvider, type PaymentProvider } from "./payments/provider";
import { PaymentService } from "./payments/service";
import { MemoryPersistence } from "./persistence/memory";
import type { Persistence } from "./persistence/types";
import { createSocketServer } from "./realtime/socket";
import { RoomManager } from "./rooms/manager";
import { PromptService } from "./rooms/prompt-service";

export interface RunningServer {
  url: string;
  port: number;
  db: Persistence;
  rooms: RoomManager;
  payments: PaymentService;
  close(): Promise<void>;
}

export async function startServer(env: Env, opts: { persistence?: Persistence; log?: (m: string) => void } = {}): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.info(`[server] ${m}`));
  let db: Persistence;
  if (opts.persistence) db = opts.persistence;
  else if (env.DATABASE_URL) {
    const { PrismaPersistence } = await import("./persistence/prisma");
    db = new PrismaPersistence(env.DATABASE_URL);
  } else {
    db = new MemoryPersistence();
    log("DATABASE_URL is empty: running with in-memory persistence (nothing is saved).");
  }

  const provider: PaymentProvider =
    env.PAYMENT_MODE === "razorpay"
      ? new RazorpayPaymentProvider(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!, env.RAZORPAY_WEBHOOK_SECRET!)
      : new MockPaymentProvider(env.MOCK_WEBHOOK_SECRET);
  const payments = new PaymentService(db, provider, env.NODE_ENV === "production");
  const auth = new AuthService(db, env.SESSION_SECRET);
  const prompts = new PromptService(db);
  await prompts.refresh();
  const rooms = new RoomManager(db, prompts, payments, auth, {
    reconnectWindowMs: env.RECONNECT_WINDOW_SECONDS * 1000,
    timerScale: env.GAME_TIMER_SCALE,
    log,
  });

  const app = createApp({ env, db, auth, payments, prompts, rooms, log });
  const http = createHttpServer(app);
  const io = createSocketServer(http, rooms, auth, env.webOrigins, log);

  await new Promise<void>((resolve) => http.listen(env.PORT, resolve));
  const port = (http.address() as AddressInfo).port;
  log(`listening on http://localhost:${port} (persistence: ${db.kind}, payments: ${provider.mode})`);

  return {
    url: `http://localhost:${port}`,
    port,
    db,
    rooms,
    payments,
    async close() {
      rooms.shutdown();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await db.close();
    },
  };
}
