import { randomBytes, randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  AVATARS,
  CATALOG,
  defaultRoomSettings,
  MIN_PLAYERS,
  PACK_IDS,
  roomSettingsSchema,
  sanitizeDisplayName,
  type AvatarId,
  type BrandingView,
  type ClientToServerEvents,
  type GameEventMessage,
  type PackAvailability,
  type PackId,
  type RoomSettings,
  type RoomView,
  type ServerToClientEvents,
  consentSchema,
  gameActionEnvelopeSchema,
  reportSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomSettingsPatchSchema,
  spectatorVoteSchema,
} from "@hps/shared";
import { buildEligiblePool, countByMode, safeFallbackPool, type PromptFilterContext } from "@hps/content";
import {
  buildMatchConfig,
  computeStandings,
  createMatch,
  EngineError,
  getHostGameState,
  getPlayerGameState,
  getPublicGameState,
  getSpectatorGameState,
  nextWakeAt,
  reduce,
  tick,
  type EngineAction,
  type MatchState,
} from "@hps/game-engine";
import type { AuthService } from "../auth";
import type { PaymentService } from "../payments/service";
import type { MatchSummary, Persistence } from "../persistence/types";
import { generateRoomCode } from "./codes";
import type { PromptService } from "./prompt-service";
import { Room, type Member, type Watcher } from "./room";

export class RoomError extends Error {}

export interface SocketData {
  sessionId: string;
  userId: string | null;
  roomCode: string | null;
  role: "player" | "spectator" | "broadcast" | null;
  memberId: string | null;
  watcherId: string | null;
}

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface ManagerOptions {
  reconnectWindowMs: number;
  timerScale: number;
  log?: (msg: string) => void;
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new RoomError(r.error.issues[0]?.message ?? "Invalid request.");
  return r.data;
}

const PACK_NAMES: Record<PackId, string> = Object.fromEntries(
  PACK_IDS.map((id) => [id, CATALOG.find((c) => c.packId === id)?.name ?? id]),
) as Record<PackId, string>;

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private io: GameServer | null = null;

  constructor(
    private readonly db: Persistence,
    private readonly prompts: PromptService,
    private readonly payments: PaymentService,
    private readonly auth: AuthService,
    private readonly opts: ManagerOptions,
  ) {}

  attach(io: GameServer): void {
    this.io = io;
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */
  /* ---------------------------------------------------------------- */

  async createRoom(socket: GameSocket, input: unknown): Promise<{ code: string }> {
    const data = parse(roomCreateSchema, input);
    this.leave(socket, "left");
    const settings = roomSettingsSchema.parse({ ...defaultRoomSettings(), ...(data.settings ?? {}) });
    const code = generateRoomCode((c) => this.rooms.has(c));
    const room = new Room(code, randomBytes(9).toString("base64url"), settings, Date.now());
    this.rooms.set(code, room);
    const member = this.addMember(room, socket, data.displayName, data.avatar);
    room.hostId = member.id;
    room.state = "WAITING";
    await this.refreshOwnership(room);
    room.settings = this.sanitizeSettings(room, room.settings);
    this.broadcast(room);
    this.opts.log?.(`room ${code} created`);
    return { code };
  }

  async join(socket: GameSocket, input: unknown): Promise<{ code: string; role: string }> {
    const data = parse(roomJoinSchema, input);
    const room = this.rooms.get(data.code);
    if (!room || room.state === "CLOSED") throw new RoomError("No room with that code. Check the code and try again.");
    if (room.bannedSessions.has(socket.data.sessionId)) throw new RoomError("The host removed you from this room.");

    if (data.as !== "player") {
      if (data.as === "spectator" && !room.settings.audienceEnabled) throw new RoomError("The host turned spectators off for this room.");
      this.leave(socket, "left");
      const id = this.auth.spectatorId(socket.data.sessionId);
      const w: Watcher = room.watchers.get(socket.data.sessionId) ?? {
        id,
        sessionId: socket.data.sessionId,
        name: data.displayName ? sanitizeDisplayName(data.displayName) || "Viewer" : "Viewer",
        kind: data.as,
        sockets: new Set(),
      };
      w.sockets.add(socket.id);
      room.watchers.set(socket.data.sessionId, w);
      Object.assign(socket.data, { roomCode: room.code, role: data.as, watcherId: id, memberId: null });
      void socket.join(room.code);
      this.broadcast(room);
      return { code: room.code, role: data.as };
    }

    // Reconnect: the same guest session reclaims its seat.
    const existing = room.memberBySession(socket.data.sessionId);
    if (existing) {
      if (socket.data.roomCode && socket.data.roomCode !== room.code) this.leave(socket, "left");
      existing.sockets.add(socket.id);
      if (existing.disconnectedAt !== null) {
        existing.disconnectedAt = null;
        const t = room.memberTimers.get(existing.id);
        if (t) clearTimeout(t);
        room.memberTimers.delete(existing.id);
        if (room.match) this.dispatch(room, { kind: "CONNECTION", playerId: existing.id, connected: true });
      }
      if (socket.data.userId && !existing.userId) existing.userId = socket.data.userId;
      Object.assign(socket.data, { roomCode: room.code, role: "player", memberId: existing.id, watcherId: null });
      void socket.join(room.code);
      if (existing.id === room.hostId) await this.refreshOwnership(room);
      this.broadcast(room);
      return { code: room.code, role: "player" };
    }

    if (room.settings.inviteOnly && data.inviteKey !== room.inviteKey) throw new RoomError("This room is invite-only. Ask the host for the invite link.");
    if (room.inMatch()) throw new RoomError("A match is in progress. Join as a spectator or wait for the next one.");
    if (room.members.size >= room.settings.maxPlayers) throw new RoomError("This room is full.");
    if (!data.displayName || !data.avatar) throw new RoomError("Choose a name and an avatar first.");
    this.leave(socket, "left");
    this.addMember(room, socket, data.displayName, data.avatar);
    if (room.state === "CREATED") room.state = "WAITING";
    this.broadcast(room);
    return { code: room.code, role: "player" };
  }

  private addMember(room: Room, socket: GameSocket, rawName: string, avatar: AvatarId): Member {
    const name = this.uniqueName(room, sanitizeDisplayName(rawName) || "Player");
    const m: Member = {
      id: `p_${randomUUID().slice(0, 12)}`,
      sessionId: socket.data.sessionId,
      userId: socket.data.userId,
      name,
      avatar: (AVATARS as readonly string[]).includes(avatar) ? avatar : "star",
      ready: false,
      sockets: new Set([socket.id]),
      disconnectedAt: null,
      consent: { adultContent: false, ageConfirmed: false, hiddenTopics: [] },
      joinedAt: Date.now(),
    };
    room.members.set(m.id, m);
    Object.assign(socket.data, { roomCode: room.code, role: "player", memberId: m.id, watcherId: null });
    void socket.join(room.code);
    return m;
  }

  /** Names are display-only, but duplicates confuse votes, so suffix them. */
  private uniqueName(room: Room, name: string, exceptId?: string): string {
    const taken = new Set([...room.members.values()].filter((m) => m.id !== exceptId).map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 50; i++) {
      const candidate = `${name.slice(0, 17)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name.slice(0, 14)} ${randomBytes(2).toString("hex")}`;
  }

  leave(socket: GameSocket, reason: "left" | "kicked"): void {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    Object.assign(socket.data, { roomCode: null, role: null, memberId: null, watcherId: null });
    void socket.leave(code);
    if (!room) return;
    const w = room.watchers.get(socket.data.sessionId);
    if (w) {
      w.sockets.delete(socket.id);
      if (w.sockets.size === 0) room.watchers.delete(socket.data.sessionId);
    }
    const m = room.memberBySession(socket.data.sessionId);
    if (m) this.removeMember(room, m, reason);
    else this.broadcast(room);
  }

  private removeMember(room: Room, m: Member, reason: "left" | "kicked" | "timeout"): void {
    room.members.delete(m.id);
    const t = room.memberTimers.get(m.id);
    if (t) clearTimeout(t);
    room.memberTimers.delete(m.id);
    for (const sid of m.sockets) {
      const s = this.io?.sockets.sockets.get(sid);
      if (s) {
        if (reason === "kicked") s.emit("room:removed", { reason: "The host removed you from the room." });
        Object.assign(s.data, { roomCode: null, role: null, memberId: null, watcherId: null });
        void s.leave(room.code);
      }
    }
    if (room.match) this.dispatch(room, { kind: "REMOVE_PLAYER", playerId: m.id });
    if (room.members.size === 0) {
      this.closeRoom(room, "Everyone left the room.");
      return;
    }
    if (room.hostId === m.id) {
      const next = room.connectedMembers()[0] ?? [...room.members.values()][0]!;
      void this.setHost(room, next.id);
      return;
    }
    this.broadcast(room);
  }

  private closeRoom(room: Room, reason: string): void {
    if (room.timer) clearTimeout(room.timer);
    for (const t of room.memberTimers.values()) clearTimeout(t);
    room.state = "CLOSED";
    this.io?.to(room.code).emit("room:closed", { reason });
    for (const w of room.watchers.values()) {
      for (const sid of w.sockets) {
        const s = this.io?.sockets.sockets.get(sid);
        if (s) Object.assign(s.data, { roomCode: null, role: null, memberId: null, watcherId: null });
      }
    }
    this.io?.socketsLeave(room.code);
    this.rooms.delete(room.code);
    this.opts.log?.(`room ${room.code} closed`);
  }

  private async setHost(room: Room, memberId: string): Promise<void> {
    room.hostId = memberId;
    if (room.match) this.dispatch(room, { kind: "SET_HOST", playerId: memberId });
    await this.refreshOwnership(room);
    if (!room.inMatch()) room.settings = this.sanitizeSettings(room, room.settings);
    this.broadcast(room);
  }

  /** Packs are host-owned: everyone in the room can use what the host owns. */
  async refreshOwnership(room: Room): Promise<void> {
    const userId = room.host?.userId ?? null;
    const own = await this.payments.ownership(userId);
    room.ownership = { packIds: own.packIds, streamerBranding: own.streamerBranding, hostUserId: userId };
    await this.refreshBranding(room);
  }

  private sanitizeSettings(room: Room, s: RoomSettings): RoomSettings {
    const owned = room.ownership.packIds;
    const enabled = s.enabledPacks.filter((p) => owned.includes(p) && this.prompts.packEnabled(p));
    return {
      ...s,
      enabledPacks: enabled.length ? enabled : ["base"],
      nsfwByPack: { ...s.nsfwByPack, base: false },
      maxPlayers: Math.max(s.maxPlayers, Math.min(12, room.members.size)),
    };
  }

  private requireMember(socket: GameSocket): { room: Room; member: Member } {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    const member = room && socket.data.memberId ? room.members.get(socket.data.memberId) : undefined;
    if (!room || !member) throw new RoomError("You are not in a room.");
    return { room, member };
  }

  private requireHost(socket: GameSocket): { room: Room; member: Member } {
    const r = this.requireMember(socket);
    if (r.room.hostId !== r.member.id) throw new RoomError("Only the host can do that.");
    return r;
  }

  async updateSettings(socket: GameSocket, input: unknown): Promise<void> {
    const { room } = this.requireHost(socket);
    const { patch: parsed } = parse(z.object({ patch: roomSettingsPatchSchema }), input);
    // Zod applies field defaults even in a partial schema, so keep only the keys the client actually sent.
    const sent = new Set(Object.keys(((input as { patch?: object }).patch ?? {}) as object));
    const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k)));
    if (room.inMatch()) throw new RoomError("Settings are locked while a match is running.");
    await this.refreshOwnership(room);
    const next = roomSettingsSchema.parse({ ...room.settings, ...patch });
    const unowned = next.enabledPacks.filter((p) => !room.ownership.packIds.includes(p));
    if (unowned.length) throw new RoomError(`You do not own ${unowned.map((p) => PACK_NAMES[p]).join(", ")}. Buy it in the store to enable it.`);
    if (next.nsfwByPack.base) throw new RoomError("Base Game is always stream-safe.");
    if (next.maxPlayers < room.members.size) throw new RoomError(`There are already ${room.members.size} players in the room.`);
    room.settings = this.sanitizeSettings(room, next);
    this.broadcast(room);
  }

  setReady(socket: GameSocket, ready: boolean): void {
    const { room, member } = this.requireMember(socket);
    if (room.inMatch()) throw new RoomError("The match has already started.");
    member.ready = ready;
    this.broadcast(room);
  }

  setProfile(socket: GameSocket, name: string, avatar: AvatarId): void {
    const { room, member } = this.requireMember(socket);
    if (room.inMatch()) throw new RoomError("You can change your name between matches.");
    member.name = this.uniqueName(room, sanitizeDisplayName(name) || member.name, member.id);
    member.avatar = avatar;
    this.broadcast(room);
  }

  setConsent(socket: GameSocket, input: unknown): void {
    const { room, member } = this.requireMember(socket);
    const c = parse(consentSchema, input);
    if (c.adultContent && !c.ageConfirmed) throw new RoomError("Confirm you are 18 or older to opt into adult content.");
    member.consent = { adultContent: c.adultContent, ageConfirmed: c.ageConfirmed, hiddenTopics: c.hiddenTopics };
    // Withdrawing consent or hiding a topic mid-match takes effect from the next prompt.
    if (room.match && room.inMatch()) this.dispatch(room, { kind: "UPDATE_POOL", pool: this.buildPool(room).pool });
    this.broadcast(room);
  }

  /* ---------------------------------------------------------------- */
  /* Content                                                            */
  /* ---------------------------------------------------------------- */

  private filterContext(room: Room): PromptFilterContext {
    return {
      ownedPackIds: room.ownership.packIds as PackId[],
      enabledPackIds: room.settings.enabledPacks,
      nsfwByPack: room.settings.nsfwByPack,
      everyPlayerConsentsToAdult: room.everyoneConsentsToAdult(),
      blockedTopics: room.blockedTopics(),
      maxIntensity: room.settings.maxIntensity,
      language: room.settings.language,
    };
  }

  buildPool(room: Room) {
    const ctx = this.filterContext(room);
    const all = this.prompts.available();
    return { pool: buildEligiblePool(all, ctx), fallback: safeFallbackPool(all, ctx) };
  }

  startBlockers(room: Room): string[] {
    const out: string[] = [];
    const members = [...room.members.values()];
    const connected = members.filter((m) => m.sockets.size > 0);
    if (connected.length < MIN_PLAYERS) out.push(`Need at least ${MIN_PLAYERS} connected players (${connected.length} now).`);
    const notReady = members.filter((m) => !m.ready || m.sockets.size === 0);
    if (notReady.length) out.push(`Waiting for ${notReady.map((m) => m.name).join(", ")} to be ready.`);
    if (members.length > room.settings.maxPlayers) out.push("Too many players for the room size.");
    const { pool, fallback } = this.buildPool(room);
    const counts = countByMode(pool.length ? pool : fallback);
    const needed: (keyof typeof counts)[] = ["SPECTRUM", "FINALE"];
    if (room.settings.matchType !== "OPINIONS_AND_BLUFF") needed.push("DEBATE");
    if (room.settings.matchType !== "OPINIONS_AND_COURT") needed.push("BLUFF");
    const missing = needed.filter((m) => counts[m] === 0 && countByMode(fallback)[m] === 0);
    if (missing.length) out.push("Your topic filters leave no prompts for some rounds. Unhide a topic or enable Base Game.");
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Match lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  async start(socket: GameSocket): Promise<void> {
    const { room, member } = this.requireHost(socket);
    if (room.inMatch()) throw new RoomError("A match is already running.");
    await this.refreshOwnership(room);
    room.settings = this.sanitizeSettings(room, room.settings);
    const blockers = this.startBlockers(room);
    if (blockers.length) throw new RoomError(blockers[0]!);
    room.state = "STARTING";
    const players = [...room.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar }));
    const { pool, fallback } = this.buildPool(room);
    const config = buildMatchConfig(room.settings, players.length, { timerScale: this.opts.timerScale });
    const now = Date.now();
    try {
      const res = createMatch({
        matchId: `m_${randomUUID()}`,
        seed: randomBytes(16).toString("hex"),
        hostId: member.id,
        players,
        config,
        pool,
        fallbackPool: fallback,
        now,
      });
      room.match = res.state;
      room.matchStartedAt = now;
      room.matchPersisted = false;
      room.state = "IN_GAME";
      this.afterChange(room, res.events);
    } catch (e) {
      room.state = "WAITING";
      throw e instanceof EngineError ? new RoomError(e.message) : e;
    }
  }

  hostCommand(socket: GameSocket, command: "PAUSE" | "RESUME" | "SKIP_PROMPT" | "ADVANCE" | "END"): void {
    const { room, member } = this.requireHost(socket);
    if (!room.match) throw new RoomError("No match is running.");
    this.dispatch(room, { kind: "HOST", actorId: member.id, actionId: `host-${randomUUID()}`, command }, true);
  }

  returnToLobby(socket: GameSocket): void {
    const { room } = this.requireHost(socket);
    if (room.inMatch()) throw new RoomError("End the match first.");
    if (room.timer) clearTimeout(room.timer);
    room.match = null;
    room.state = "WAITING";
    for (const m of room.members.values()) m.ready = false;
    this.io?.to(room.code).emit("game:cleared");
    this.broadcast(room);
  }

  async kick(socket: GameSocket, playerId: string): Promise<void> {
    const { room, member } = this.requireHost(socket);
    if (playerId === member.id) throw new RoomError("You cannot remove yourself. Transfer host first.");
    const target = room.members.get(playerId);
    if (!target) throw new RoomError("That player is not in the room.");
    room.bannedSessions.add(target.sessionId);
    this.removeMember(room, target, "kicked");
  }

  async transferHost(socket: GameSocket, playerId: string): Promise<void> {
    const { room } = this.requireHost(socket);
    const target = room.members.get(playerId);
    if (!target) throw new RoomError("That player is not in the room.");
    await this.setHost(room, target.id);
  }

  gameAction(socket: GameSocket, input: unknown): { version: number } {
    const { room, member } = this.requireMember(socket);
    if (!room.match) throw new RoomError("No match is running.");
    const env = parse(gameActionEnvelopeSchema, input);
    const state = this.dispatch(room, { kind: "PLAYER", actorId: member.id, actionId: `${member.id}:${env.actionId}`, action: env.action }, true);
    return { version: state.version };
  }

  spectatorVote(socket: GameSocket, input: unknown): void {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    const w = room?.watchers.get(socket.data.sessionId);
    if (!room || !w || w.kind !== "spectator") throw new RoomError("Only spectators can cast audience votes.");
    if (!room.match) throw new RoomError("No match is running.");
    const v = parse(spectatorVoteSchema, input);
    this.dispatch(room, { kind: "SPECTATOR_VOTE", spectatorId: w.id, spectatorName: w.name, actionId: `${w.id}:${v.actionId}`, choice: v.choice }, true);
  }

  async report(socket: GameSocket, input: unknown): Promise<void> {
    const r = parse(reportSchema, input);
    const code = socket.data.roomCode;
    await this.db.createReport({ kind: r.kind, promptId: r.promptId ?? null, roomCode: code, playerId: r.playerId ?? null, reason: r.reason });
  }

  async requestState(socket: GameSocket): Promise<void> {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    if (!room) throw new RoomError("You are not in a room.");
    if (socket.data.memberId === room.hostId && !room.inMatch()) {
      await this.refreshOwnership(room);
      room.settings = this.sanitizeSettings(room, room.settings);
    }
    this.sendTo(room, socket);
  }

  handleDisconnect(socket: GameSocket): void {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    if (!room) return;
    const w = room.watchers.get(socket.data.sessionId);
    if (w) {
      w.sockets.delete(socket.id);
      if (w.sockets.size === 0) room.watchers.delete(socket.data.sessionId);
    }
    const m = room.memberBySession(socket.data.sessionId);
    if (m) {
      m.sockets.delete(socket.id);
      if (m.sockets.size === 0) {
        m.disconnectedAt = Date.now();
        if (room.match && room.inMatch()) {
          this.dispatch(room, { kind: "CONNECTION", playerId: m.id, connected: false });
          // Nobody left to play: hold the clock until someone returns.
          if (room.connectedMembers().length === 0 && room.match.status === "IN_GAME" && room.hostId) {
            this.dispatch(room, { kind: "HOST", actorId: room.hostId, actionId: `autopause-${randomUUID()}`, command: "PAUSE" });
          }
        }
        // Limited reconnection window, then the seat is released.
        room.memberTimers.set(
          m.id,
          setTimeout(() => {
            room.memberTimers.delete(m.id);
            const still = room.members.get(m.id);
            if (still && still.sockets.size === 0) this.removeMember(room, still, "timeout");
          }, this.opts.reconnectWindowMs),
        );
      }
    }
    this.broadcast(room);
  }

  /* ---------------------------------------------------------------- */
  /* Engine plumbing                                                    */
  /* ---------------------------------------------------------------- */

  private dispatch(room: Room, action: EngineAction, throwErrors = false): MatchState {
    if (!room.match) throw new RoomError("No match is running.");
    try {
      const res = reduce(room.match, action, Date.now());
      if (res.duplicate) return room.match;
      room.match = res.state;
      this.afterChange(room, res.events);
      return res.state;
    } catch (e) {
      if (e instanceof EngineError) {
        if (throwErrors) throw new RoomError(e.message);
        return room.match;
      }
      throw e;
    }
  }

  private afterChange(room: Room, events: GameEventMessage[]): void {
    const match = room.match;
    if (!match) return;
    room.state = match.status === "PAUSED" ? "PAUSED" : match.status === "COMPLETED" ? "COMPLETED" : "IN_GAME";
    for (const e of events) this.io?.to(room.code).emit("game:event", e);
    this.broadcast(room);
    this.schedule(room);
    if (match.status === "COMPLETED" && !room.matchPersisted) {
      room.matchPersisted = true;
      void this.persist(room, match).catch((err) => this.opts.log?.(`failed to save match ${match.matchId}: ${(err as Error).message}`));
    }
  }

  private schedule(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const match = room.match;
    if (!match) return;
    const wake = nextWakeAt(match);
    if (wake === null) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      if (!room.match || !this.rooms.has(room.code)) return;
      const res = tick(room.match, Date.now());
      if (res.changed) {
        room.match = res.state;
        this.afterChange(room, res.events);
      } else {
        this.schedule(room);
      }
    }, Math.max(0, wake - Date.now()) + 5);
  }

  /** Sends every socket in the room exactly the projection its role allows. */
  broadcast(room: Room): void {
    if (!this.io) return;
    for (const m of room.members.values()) for (const sid of m.sockets) this.sendTo(room, this.io.sockets.sockets.get(sid));
    for (const w of room.watchers.values()) for (const sid of w.sockets) this.sendTo(room, this.io.sockets.sockets.get(sid));
  }

  private sendTo(room: Room, socket: GameSocket | undefined): void {
    if (!socket) return;
    socket.emit("room:updated", this.roomView(room, socket));
    const match = room.match;
    if (!match) return;
    const now = Date.now();
    const { memberId, role } = socket.data;
    if (role === "player" && memberId && match.players.some((p) => p.id === memberId)) {
      socket.emit("game:state", memberId === room.hostId ? getHostGameState(match, memberId, now) : getPlayerGameState(match, memberId, now));
    } else if (role === "spectator") {
      const w = room.watchers.get(socket.data.sessionId);
      socket.emit("game:state", getSpectatorGameState(match, w?.id ?? "unknown", w?.name ?? "Viewer", now));
    } else {
      socket.emit("game:state", getPublicGameState(match, now));
    }
  }

  roomView(room: Room, socket: GameSocket): RoomView {
    const me = socket.data.memberId ? room.members.get(socket.data.memberId) : undefined;
    const isHost = !!me && me.id === room.hostId;
    const members = [...room.members.values()];
    const blockers = room.inMatch() ? [] : this.startBlockers(room);
    if (!room.inMatch() && room.state !== "COMPLETED") room.state = blockers.length ? (members.length ? "WAITING" : "CREATED") : "READY";
    const anyToggled = Object.entries(room.settings.nsfwByPack).some(([id, on]) => on && room.settings.enabledPacks.includes(id as PackId));
    const packs: PackAvailability[] = PACK_IDS.filter((id) => this.prompts.packEnabled(id)).map((id) => {
      const product = CATALOG.find((c) => c.packId === id);
      const counts = this.prompts.counts(id);
      return {
        packId: id,
        name: PACK_NAMES[id],
        owned: room.ownership.packIds.includes(id),
        pricePaise: product?.pricePaise ?? null,
        enabled: room.settings.enabledPacks.includes(id),
        nsfw: room.settings.nsfwByPack[id],
        hasMatureContent: counts.mature > 0,
        safePromptCount: counts.safe,
        maturePromptCount: counts.mature,
      };
    });
    return {
      code: room.code,
      state: room.state,
      settings: room.settings,
      hostId: room.hostId,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        isHost: m.id === room.hostId,
        ready: m.ready,
        connected: m.sockets.size > 0,
      })),
      spectatorCount: [...room.watchers.values()].filter((w) => w.kind === "spectator").length,
      packs,
      adultContent: {
        anyPackToggled: anyToggled,
        consentedCount: members.filter((m) => m.consent.adultContent && m.consent.ageConfirmed).length,
        playerCount: members.length,
        active: anyToggled && room.everyoneConsentsToAdult(),
      },
      canStart: isHost && !room.inMatch() && blockers.length === 0,
      startBlockers: blockers,
      branding: this.brandingCache.get(room.code) ?? null,
      matchActive: room.inMatch(),
      inviteKey: isHost ? room.inviteKey : null,
      myConsent: me ? { ...me.consent } : null,
      myId: me?.id ?? null,
      myRole: (socket.data.role ?? "player") as RoomView["myRole"],
    };
  }

  /* ---------------------------------------------------------------- */
  /* Branding                                                           */
  /* ---------------------------------------------------------------- */

  private brandingCache = new Map<string, BrandingView>();

  /** Called by the HTTP layer after a host saves branding, and on ownership refresh. */
  async refreshBranding(room: Room): Promise<void> {
    const uid = room.ownership.hostUserId;
    if (!uid || !room.ownership.streamerBranding) {
      this.brandingCache.delete(room.code);
      return;
    }
    const b = await this.db.getBranding(uid);
    if (!b) {
      this.brandingCache.delete(room.code);
      return;
    }
    this.brandingCache.set(room.code, {
      logoUrl: b.logoData ? `/api/branding/logo/${uid}?v=${b.logoData.length}` : null,
      accentColor: b.accentColor,
      secondaryColor: b.secondaryColor,
      lobbyHeader: b.lobbyHeader,
      resultsTagline: b.resultsTagline,
    });
  }

  async onBrandingChanged(userId: string): Promise<void> {
    for (const room of this.rooms.values()) {
      if (room.ownership.hostUserId === userId) {
        await this.refreshBranding(room);
        this.broadcast(room);
      }
    }
  }

  async onOwnershipChanged(userId: string): Promise<void> {
    for (const room of this.rooms.values()) {
      if (room.host?.userId === userId) {
        await this.refreshOwnership(room);
        if (!room.inMatch()) room.settings = this.sanitizeSettings(room, room.settings);
        this.broadcast(room);
      }
    }
  }

  publicRooms(): { code: string; name: string; players: number; maxPlayers: number }[] {
    return [...this.rooms.values()]
      .filter((r) => r.settings.visibility === "PUBLIC" && !r.settings.inviteOnly && !r.inMatch() && r.state !== "CLOSED")
      .map((r) => ({ code: r.code, name: r.settings.roomName, players: r.members.size, maxPlayers: r.settings.maxPlayers }));
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                         */
  /* ---------------------------------------------------------------- */

  private async persist(room: Room, s: MatchState): Promise<void> {
    const standings = computeStandings(s);
    const summary: MatchSummary = {
      matchId: s.matchId,
      roomCode: room.code,
      hostUserId: room.ownership.hostUserId,
      seed: s.seed,
      config: s.config,
      settings: room.settings,
      startedAt: new Date(room.matchStartedAt ?? s.createdAt),
      completedAt: new Date(),
      players: s.players.map((p) => {
        const row = standings.find((r) => r.playerId === p.id);
        return { playerId: p.id, displayName: p.name, seat: p.seat, finalScore: row?.total ?? 0, finalRank: row?.rank ?? null, sharedRank: row?.sharedRank ?? false };
      }),
      rounds: [
        ...s.calibration.rounds.map((r) => ({ segment: "CALIBRATION", index: r.index, promptId: r.prompt.id })),
        ...s.court.hearings.filter((h) => h.prompt).map((h) => ({ segment: "COURT", index: h.index, promptId: h.prompt!.id })),
        ...s.bluff.turns.filter((t) => t.prompt).map((t) => ({ segment: "BLUFF", index: t.index, promptId: t.prompt!.id })),
        ...(s.finale?.prompt ? [{ segment: "FINALE", index: 0, promptId: s.finale.prompt.id }] : []),
      ],
      timeline: s.timeline.map((t) => ({ kind: t.kind, text: t.text, at: new Date(t.at) })),
      scoreEvents: s.scoreEvents.map((e) => ({ eventKey: e.id, playerId: e.playerId, type: e.type, amount: e.amount, segment: e.segment, label: e.label, detail: e.detail, at: new Date(e.at) })),
      predictions: s.calibration.rounds.flatMap((r) =>
        Object.entries(r.predictions).map(([predictorId, value]) => ({
          roundIndex: r.index,
          predictorId,
          targetId: r.targets[predictorId]!,
          value,
          points: s.scoreEvents.find((e) => e.id === `cal:${r.index}:${predictorId}`)?.amount ?? 0,
        })),
      ),
      debates: [
        ...s.court.hearings.filter((h) => h.result && h.prompt).map((h) => ({
          hearing: h.index,
          promptId: h.prompt!.id,
          debaterAId: h.debaterA,
          debaterBId: h.debaterB,
          sideA: h.sideA,
          swapped: h.swapped,
          winnerId: h.result!.winnerId,
          tiebreak: h.result!.tiebreakUsed,
          votes: Object.entries(h.verdicts).map(([voterId, winnerId]) => ({ voterId, winnerId })),
        })),
        ...(s.finale?.result && s.finale.prompt
          ? [{
              hearing: -1,
              promptId: s.finale.prompt.id,
              debaterAId: s.finale.debaterA,
              debaterBId: s.finale.debaterB,
              sideA: s.finale.sideA,
              swapped: false,
              winnerId: s.finale.result.winnerId,
              tiebreak: s.finale.result.tiebreakUsed,
              votes: Object.entries(s.finale.verdicts).map(([voterId, winnerId]) => ({ voterId, winnerId })),
            }]
          : []),
      ],
      bluffs: s.bluff.turns.filter((t) => t.result && t.prompt).map((t) => ({
        turn: t.index,
        speakerId: t.speakerId,
        role: t.role,
        claimed: t.claim ?? 0,
        promptId: t.prompt!.id,
        votes: Object.entries(t.votes).map(([voterId, guess]) => ({ voterId, guess, correct: guess === t.role })),
      })),
      contracts: Object.entries(s.contracts).filter(([, c]) => c.selected).map(([playerId, c]) => ({ playerId, type: c.selected!.type, status: c.status })),
      cardPlays: s.chaos.history.map((h) => ({ id: `${s.matchId}:${h.id}`, playerId: h.playedBy, card: h.card, unitKey: h.unitKey, outcome: h.outcome, at: new Date(h.at) })),
    };
    await this.db.saveMatchResult(summary);
  }

  shutdown(): void {
    for (const room of this.rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      for (const t of room.memberTimers.values()) clearTimeout(t);
    }
  }
}
