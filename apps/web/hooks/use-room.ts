"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameActionInput,
  GameEventMessage,
  HostGameState,
  PlayerGameState,
  PublicGameState,
  RoomView,
  SpectatorGameState,
} from "@hps/shared";
import { call, getSocket, newActionId, type GameSocket } from "@/lib/socket";
import { playSfx } from "@/lib/sfx";

export type AnyGameState = PublicGameState & Partial<PlayerGameState> & Partial<HostGameState> & Partial<SpectatorGameState>;
export type JoinRole = "player" | "spectator" | "broadcast";
export type ConnectionState = "connecting" | "online" | "reconnecting" | "offline";

export interface JoinInfo {
  displayName?: string;
  avatar?: string;
  inviteKey?: string;
}

/**
 * Connects to a room and keeps the latest authorised snapshot. On any reconnect the hook re-joins
 * with the same guest session, so the server hands back the same seat and private state.
 */
export function useRoom(code: string, role: JoinRole) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [game, setGame] = useState<AnyGameState | null>(null);
  const [events, setEvents] = useState<GameEventMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const socketRef = useRef<GameSocket | null>(null);
  const joinRef = useRef<JoinInfo>({});
  const joinedRef = useRef(false);

  const join = useCallback(
    async (info: JoinInfo = joinRef.current) => {
      const s = socketRef.current;
      if (!s) return;
      joinRef.current = info;
      try {
        await call(s, "room:join", { code, as: role, ...info });
        joinedRef.current = true;
        setNeedsProfile(false);
        setFatal(null);
      } catch (e) {
        const msg = (e as Error).message;
        if (role === "player" && /name and an avatar/.test(msg)) setNeedsProfile(true);
        else setFatal(msg);
        throw e;
      }
    },
    [code, role],
  );

  useEffect(() => {
    let alive = true;
    let s: GameSocket | null = null;
    const onRoom = (r: RoomView) => alive && setRoom(r);
    const onState = (st: PublicGameState) => alive && setGame(st as AnyGameState);
    const onCleared = () => alive && setGame(null);
    const onEvent = (e: GameEventMessage) => {
      if (!alive) return;
      setEvents((prev) => [...prev.slice(-30), e]);
      playSfx(e.kind);
    };
    const onClosed = (p: { reason: string }) => alive && setFatal(p.reason);
    const onRemoved = (p: { reason: string }) => alive && setFatal(p.reason);
    const onConnect = () => {
      setConnection("online");
      if (joinedRef.current) void join().catch(() => {});
    };
    const onDisconnect = () => setConnection("reconnecting");

    (async () => {
      try {
        s = await getSocket();
        if (!alive) return;
        socketRef.current = s;
        s.on("room:updated", onRoom);
        s.on("game:state", onState);
        s.on("game:cleared", onCleared);
        s.on("game:event", onEvent);
        s.on("room:closed", onClosed);
        s.on("room:removed", onRemoved);
        s.on("connect", onConnect);
        s.on("disconnect", onDisconnect);
        setConnection(s.connected ? "online" : "reconnecting");
        await join({}).catch(() => {});
      } catch (e) {
        setConnection("offline");
        setFatal((e as Error).message);
      }
    })();

    return () => {
      alive = false;
      if (s) {
        s.off("room:updated", onRoom);
        s.off("game:state", onState);
        s.off("game:cleared", onCleared);
        s.off("game:event", onEvent);
        s.off("room:closed", onClosed);
        s.off("room:removed", onRemoved);
        s.off("connect", onConnect);
        s.off("disconnect", onDisconnect);
      }
    };
  }, [join]);

  const emit = useCallback(async <T,>(event: Parameters<typeof call>[1], payload?: unknown) => {
    const s = socketRef.current ?? (await getSocket());
    return call<T>(s, event, payload);
  }, []);

  const act = useCallback(
    (action: GameActionInput) => emit<{ version: number }>("game:action", { actionId: newActionId(), action }),
    [emit],
  );

  const leave = useCallback(async () => {
    joinedRef.current = false;
    await emit("room:leave").catch(() => {});
  }, [emit]);

  return { room, game, events, connection, needsProfile, fatal, join, emit, act, leave };
}
