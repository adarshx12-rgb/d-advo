import type { AvatarId, RoomSettings, RoomState, SensitiveTopic } from "@hps/shared";
import type { MatchState } from "@hps/game-engine";

export interface Member {
  /** Server-generated player id. Display names are never used as identifiers. */
  id: string;
  sessionId: string;
  userId: string | null;
  name: string;
  avatar: AvatarId;
  ready: boolean;
  sockets: Set<string>;
  disconnectedAt: number | null;
  consent: { adultContent: boolean; ageConfirmed: boolean; hiddenTopics: SensitiveTopic[] };
  joinedAt: number;
}

export interface Watcher {
  /** Signed spectator id (HMAC of the guest session). */
  id: string;
  sessionId: string;
  name: string;
  kind: "spectator" | "broadcast";
  sockets: Set<string>;
}

export interface RoomOwnership {
  packIds: string[];
  streamerBranding: boolean;
  hostUserId: string | null;
}

export class Room {
  readonly members = new Map<string, Member>();
  readonly watchers = new Map<string, Watcher>();
  readonly bannedSessions = new Set<string>();
  hostId: string | null = null;
  state: RoomState = "CREATED";
  match: MatchState | null = null;
  matchStartedAt: number | null = null;
  matchPersisted = false;
  timer: NodeJS.Timeout | null = null;
  ownership: RoomOwnership = { packIds: ["base"], streamerBranding: false, hostUserId: null };
  readonly memberTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    readonly code: string,
    readonly inviteKey: string,
    public settings: RoomSettings,
    readonly createdAt: number,
  ) {}

  get host(): Member | null {
    return this.hostId ? (this.members.get(this.hostId) ?? null) : null;
  }

  memberBySession(sessionId: string): Member | null {
    for (const m of this.members.values()) if (m.sessionId === sessionId) return m;
    return null;
  }

  connectedMembers(): Member[] {
    return [...this.members.values()].filter((m) => m.sockets.size > 0);
  }

  /** Adult content is live only if the host toggled a pack AND every player opted in and confirmed they are adults. */
  everyoneConsentsToAdult(): boolean {
    const ms = [...this.members.values()];
    return ms.length > 0 && ms.every((m) => m.consent.adultContent && m.consent.ageConfirmed);
  }

  blockedTopics(): SensitiveTopic[] {
    const set = new Set<SensitiveTopic>(this.settings.blockedTopics);
    for (const m of this.members.values()) for (const t of m.consent.hiddenTopics) set.add(t);
    return [...set];
  }

  inMatch(): boolean {
    return this.match !== null && this.match.status !== "COMPLETED";
  }
}
