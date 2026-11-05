"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@hps/shared";
import { clearGuestToken, getGuestToken, getUserToken, SERVER_URL } from "./session";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;
let connecting: Promise<GameSocket> | null = null;
let clockOffset = 0;

/** Server time estimate. Countdowns are always computed against server deadlines. */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

async function syncClock(s: GameSocket) {
  const samples: { offset: number; rtt: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const res = await new Promise<{ ok: boolean; data?: { serverNow: number } }>((resolve) => {
      s.timeout(3000).emit("time:ping", { clientSentAt: t0 }, (err: unknown, r: { ok: boolean; data?: { serverNow: number } }) =>
        resolve(err ? { ok: false } : r),
      );
    });
    const t1 = Date.now();
    if (res.ok && res.data) samples.push({ rtt: t1 - t0, offset: res.data.serverNow - (t0 + (t1 - t0) / 2) });
  }
  samples.sort((a, b) => a.rtt - b.rtt);
  if (samples[0]) clockOffset = samples[0].offset;
}

export async function getSocket(): Promise<GameSocket> {
  if (socket?.connected) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    const guestToken = await getGuestToken();
    const s: GameSocket = io(SERVER_URL, {
      auth: (cb) => cb({ guestToken: localGuest() ?? guestToken, userToken: getUserToken() ?? undefined }),
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 4000,
    });
    await new Promise<void>((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", async (err) => {
        if (err.message === "SESSION_INVALID") {
          // Expired guest session: mint a fresh one and let socket.io retry.
          clearGuestToken();
          await getGuestToken().catch(() => {});
          return;
        }
        reject(new Error("Could not connect to the game server."));
      });
    });
    s.on("connect", () => void syncClock(s));
    void syncClock(s);
    socket = s;
    return s;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

function localGuest(): string | null {
  try {
    return window.localStorage.getItem("hps.guestToken");
  } catch {
    return null;
  }
}

/** Reconnect so a new sign-in (user token) is attached to the socket. */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function call<T = unknown>(s: GameSocket, event: keyof ClientToServerEvents, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const ack = (res: { ok: boolean; data?: T; error?: string }) => (res.ok ? resolve(res.data as T) : reject(new Error(res.error ?? "Request failed")));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyS = s as any;
    if (payload === undefined) anyS.emit(event, ack);
    else anyS.emit(event, payload, ack);
  });
}

export function newActionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
