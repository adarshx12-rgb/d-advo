import { io as connect, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameActionInput,
  PlayerGameState,
  PublicGameState,
  RoomView,
  ServerToClientEvents,
} from "@hps/shared";
import { loadEnv } from "../src/env";
import { MemoryPersistence } from "../src/persistence/memory";
import { startServer, type RunningServer } from "../src/server";

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export async function bootServer(extra: Record<string, string> = {}): Promise<RunningServer & { mem: MemoryPersistence }> {
  const env = loadEnv({
    NODE_ENV: "test",
    PORT: "0",
    GAME_TIMER_SCALE: "0.01",
    RECONNECT_WINDOW_SECONDS: "5",
    WEB_ORIGIN: "http://localhost:3000",
    ...extra,
  });
  const mem = new MemoryPersistence();
  const s = await startServer(env, { persistence: mem, log: () => {} });
  return Object.assign(s, { mem });
}

export class TestClient {
  socket!: ClientSocket;
  room: RoomView | null = null;
  state: (PublicGameState & Partial<PlayerGameState>) | null = null;
  events: string[] = [];
  guestToken = "";
  private waiters: (() => void)[] = [];

  constructor(
    readonly url: string,
    readonly name: string,
  ) {}

  async connect(guestToken?: string, userToken?: string): Promise<this> {
    if (!guestToken) {
      const res = await fetch(`${this.url}/api/session/guest`, { method: "POST" });
      guestToken = ((await res.json()) as { guestToken: string }).guestToken;
    }
    this.guestToken = guestToken;
    this.socket = connect(this.url, { auth: { guestToken, userToken }, transports: ["websocket"], forceNew: true });
    this.socket.on("room:updated", (r) => {
      this.room = r;
      this.flush();
    });
    this.socket.on("game:state", (s) => {
      this.state = s as PublicGameState & Partial<PlayerGameState>;
      this.flush();
    });
    this.socket.on("game:cleared", () => {
      this.state = null;
      this.flush();
    });
    this.socket.on("game:event", (e) => this.events.push(e.kind));
    await new Promise<void>((resolve, reject) => {
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
    });
    return this;
  }

  private flush() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  async waitFor(pred: () => boolean, timeoutMs = 10_000, label = "condition"): Promise<void> {
    const start = Date.now();
    while (!pred()) {
      if (Date.now() - start > timeoutMs) throw new Error(`${this.name}: timed out waiting for ${label} (phase ${this.state?.phase.name})`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  call<T = unknown>(event: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const ack = (res: { ok: boolean; data?: T; error?: string }) => (res.ok ? resolve(res.data as T) : reject(new Error(res.error)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = this.socket as any;
      if (payload === undefined) s.emit(event, ack);
      else s.emit(event, payload, ack);
    });
  }

  private n = 0;
  act(action: GameActionInput) {
    return this.call("game:action", { actionId: `${this.name}-${Date.now()}-${++this.n}`, action });
  }

  close() {
    this.socket.disconnect();
  }
}

/** Plays whatever the server says is legal, choosing deterministic values. */
export function startBot(c: TestClient, opts: { yieldFloor?: boolean; skip?: string[] } = {}) {
  let busy = false;
  let stopped = false;
  const step = async () => {
    if (busy || stopped || !c.state?.me) return;
    const me = c.state.me;
    const st = c.state;
    const legal = me.legal.filter(
      (l) => l !== "PLAY_CARD" && l !== "REQUEST_SKIP" && (opts.yieldFloor !== false || l !== "YIELD_FLOOR") && !(opts.skip ?? []).includes(l),
    );
    const l = legal[0];
    if (!l) return;
    busy = true;
    const v = 40 + (c.name.length * 5) % 30;
    let a: GameActionInput | null = null;
    switch (l) {
      case "SUBMIT_OPINION": a = { type: l, value: v, keepPrivate: false }; break;
      case "SUBMIT_PREDICTION": a = { type: l, value: 50 }; break;
      case "SELECT_CONTRACT": a = { type: l, offerId: me.contractOffers![0]!.offerId }; break;
      case "COURT_LOCK_STANCE": a = { type: l, value: v }; break;
      case "JUDGE_PREDICT": a = { type: l, value: 50 }; break;
      case "COURT_VERDICT": a = { type: l, winnerId: st.court!.debaterA }; break;
      case "ANALYST_CALL": a = { type: l, winnerId: st.court!.debaterB }; break;
      case "YIELD_FLOOR": a = { type: l }; break;
      case "BLUFF_LOCK": a = { type: l, value: v }; break;
      case "BLUFF_VOTE": a = { type: l, guess: "BLUFF" }; break;
      case "FINALE_LOCK_STANCE": a = { type: l, value: v === 50 ? 55 : v }; break;
      case "FINALE_PREDICT": a = { type: l, value: 50 }; break;
      case "FINALE_VERDICT": a = { type: l, winnerId: st.finale!.debaterA }; break;
      case "FINALE_WINNER_CALL": a = { type: l, winnerId: st.finale!.debaterB }; break;
      case "FINALE_CLASSIFY": {
        const done = new Set(me.finale!.myClassifications.map((x) => x.targetId));
        const t = me.finale!.classifyTargets.find((x) => !done.has(x));
        if (t) a = { type: l, targetId: t, guess: "HONEST" };
        break;
      }
      default: break;
    }
    try {
      if (a) await c.act(a);
    } catch {
      /* state moved on; next state update retries */
    } finally {
      busy = false;
      setTimeout(() => void step(), 5);
    }
  };
  c.socket.on("game:state", () => void step());
  void step();
  return () => {
    stopped = true;
  };
}

export async function lobbyOfThree(url: string) {
  const host = await new TestClient(url, "Alex").connect();
  const { code } = await host.call<{ code: string }>("room:create", { displayName: "Alex", avatar: "gavel" });
  const ben = await new TestClient(url, "Ben").connect();
  const chris = await new TestClient(url, "Chris").connect();
  await ben.call("room:join", { code, displayName: "Ben", avatar: "mask", as: "player" });
  await chris.call("room:join", { code, displayName: "Chris", avatar: "flame", as: "player" });
  for (const c of [host, ben, chris]) await c.call("player:ready", { ready: true });
  await host.waitFor(() => host.room?.canStart === true, 5000, "canStart");
  return { code, host, ben, chris, all: [host, ben, chris] };
}
