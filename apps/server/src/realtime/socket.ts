import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { AVATARS, profileSchema, readySchema, targetPlayerSchema, timePingSchema, type Ack } from "@hps/shared";
import type { AuthService } from "../auth";
import { RoomError, type GameServer, type GameSocket, type RoomManager } from "../rooms/manager";

/** Token bucket per socket. Protects the engine from floods without affecting normal play. */
class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly perSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof RoomError) return e.message;
  return "Something went wrong on the server. Try again.";
}

export function createSocketServer(
  http: HttpServer,
  manager: RoomManager,
  auth: AuthService,
  origins: string[],
  log: (msg: string) => void,
): GameServer {
  const io: GameServer = new Server(http, {
    cors: { origin: origins, credentials: false },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  manager.attach(io);

  // Every connection must present a valid guest session token (issued over HTTP). Tokens are never in URLs.
  io.use(async (socket, next) => {
    try {
      const { guestToken, userToken } = (socket.handshake.auth ?? {}) as { guestToken?: unknown; userToken?: unknown };
      const sessionId = await auth.resolveGuest(guestToken);
      if (!sessionId) return next(new Error("SESSION_INVALID"));
      const user = userToken ? await auth.resolveUser(userToken) : null;
      socket.data = { sessionId, userId: user?.id ?? null, roomCode: null, role: null, memberId: null, watcherId: null };
      next();
    } catch {
      next(new Error("SESSION_INVALID"));
    }
  });

  io.on("connection", (socket: GameSocket) => {
    const general = new RateLimiter(15, 40);
    const votes = new RateLimiter(2, 4);

    function handle<T>(name: string, fn: () => T | Promise<T>, ack: Ack<T> | undefined, limiter = general) {
      if (typeof ack !== "function") ack = () => {};
      if (!limiter.take()) {
        ack({ ok: false, error: "Slow down — too many actions." });
        return;
      }
      Promise.resolve()
        .then(fn)
        .then((data) => ack!({ ok: true, data }))
        .catch((e: unknown) => {
          if (!(e instanceof RoomError)) log(`handler ${name} failed: ${(e as Error).stack ?? e}`);
          ack!({ ok: false, error: errorMessage(e) });
        });
    }

    socket.on("room:create", (p, ack) => handle("room:create", () => manager.createRoom(socket, p), ack));
    socket.on("room:join", (p, ack) => handle("room:join", () => manager.join(socket, p), ack));
    socket.on("room:leave", (ack) => handle("room:leave", () => manager.leave(socket, "left"), ack));
    socket.on("room:settings", (p, ack) => handle("room:settings", () => manager.updateSettings(socket, p), ack));
    socket.on("player:ready", (p, ack) =>
      handle("player:ready", () => {
        const r = readySchema.safeParse(p);
        if (!r.success) throw new RoomError("Invalid request.");
        manager.setReady(socket, r.data.ready);
      }, ack),
    );
    socket.on("player:profile", (p, ack) =>
      handle("player:profile", () => {
        const r = profileSchema.safeParse(p);
        if (!r.success || !(AVATARS as readonly string[]).includes(r.data.avatar)) throw new RoomError("Invalid profile.");
        manager.setProfile(socket, r.data.displayName, r.data.avatar);
      }, ack),
    );
    socket.on("player:consent", (p, ack) => handle("player:consent", () => manager.setConsent(socket, p), ack));
    socket.on("host:start", (ack) => handle("host:start", () => manager.start(socket), ack));
    socket.on("host:kick", (p, ack) =>
      handle("host:kick", () => {
        const r = targetPlayerSchema.safeParse(p);
        if (!r.success) throw new RoomError("Invalid request.");
        return manager.kick(socket, r.data.playerId);
      }, ack),
    );
    socket.on("host:transfer", (p, ack) =>
      handle("host:transfer", () => {
        const r = targetPlayerSchema.safeParse(p);
        if (!r.success) throw new RoomError("Invalid request.");
        return manager.transferHost(socket, r.data.playerId);
      }, ack),
    );
    socket.on("host:pause", (ack) => handle("host:pause", () => manager.hostCommand(socket, "PAUSE"), ack));
    socket.on("host:resume", (ack) => handle("host:resume", () => manager.hostCommand(socket, "RESUME"), ack));
    socket.on("host:skipPrompt", (ack) => handle("host:skipPrompt", () => manager.hostCommand(socket, "SKIP_PROMPT"), ack));
    socket.on("host:advance", (ack) => handle("host:advance", () => manager.hostCommand(socket, "ADVANCE"), ack));
    socket.on("host:end", (ack) => handle("host:end", () => manager.hostCommand(socket, "END"), ack));
    socket.on("host:returnToLobby", (ack) => handle("host:returnToLobby", () => manager.returnToLobby(socket), ack));
    socket.on("game:action", (p, ack) => handle("game:action", () => manager.gameAction(socket, p), ack));
    socket.on("spectator:vote", (p, ack) => handle("spectator:vote", () => manager.spectatorVote(socket, p), ack, votes));
    socket.on("state:request", (ack) => handle("state:request", () => manager.requestState(socket), ack));
    socket.on("report:submit", (p, ack) => handle("report:submit", () => manager.report(socket, p), ack, votes));
    socket.on("time:ping", (p, ack) => {
      if (typeof ack !== "function" || !timePingSchema.safeParse(p).success) return;
      ack({ ok: true, data: { serverNow: Date.now() } });
    });
    socket.on("disconnect", () => manager.handleDisconnect(socket));
  });

  return io;
}
