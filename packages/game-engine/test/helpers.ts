import { SEED_PROMPTS, buildEligiblePool, safeFallbackPool, type PromptFilterContext } from "@hps/content";
import { defaultRoomSettings, type GameActionInput, type RoomSettings } from "@hps/shared";
import { buildMatchConfig, createMatch, legalActions, reduce, tick, type MatchState } from "../src";

export const NOW = 1_700_000_000_000;

export function filterCtx(): PromptFilterContext {
  return {
    ownedPackIds: ["base"],
    enabledPackIds: ["base"],
    nsfwByPack: { base: false, "dark-humor": false, "friendship-destroyer": false, dating: false, "anime-gaming": false },
    everyPlayerConsentsToAdult: false,
    blockedTopics: [],
    maxIntensity: 5,
    language: "en",
  };
}

export function makeMatch(
  n = 3,
  opts: { seed?: string; settings?: Partial<RoomSettings> } = {},
): MatchState {
  const settings = { ...defaultRoomSettings(), ...opts.settings };
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: ["Alex", "Ben", "Chris", "Dana", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lu"][i]!, avatar: "star" }));
  const cfg = buildMatchConfig(settings, n);
  const ctx = filterCtx();
  return createMatch({
    matchId: "m1",
    seed: opts.seed ?? "seed-1",
    hostId: "p1",
    players,
    config: cfg,
    pool: buildEligiblePool(SEED_PROMPTS, ctx),
    fallbackPool: safeFallbackPool(SEED_PROMPTS, ctx),
    now: NOW,
  }).state;
}

let aid = 0;
export function act(s: MatchState, pid: string, action: GameActionInput, now = NOW): MatchState {
  return reduce(s, { kind: "PLAYER", actorId: pid, actionId: `a-${++aid}-xxxxxxxx`, action }, now).state;
}

export function host(s: MatchState, command: "PAUSE" | "RESUME" | "SKIP_PROMPT" | "ADVANCE" | "END", now = NOW): MatchState {
  return reduce(s, { kind: "HOST", actorId: s.hostId, actionId: `h-${++aid}-xxxxxxxx`, command }, now).state;
}

/** Jump the clock to the next deadline and tick. */
export function timeout(s: MatchState): { s: MatchState; now: number } {
  const t = Math.max(s.phase.deadline ?? 0, s.chaos.pending?.resolvesAt ?? 0);
  return { s: tick(s, t).state, now: t };
}

export function phaseKey(s: MatchState): string {
  return `${s.phase.name}:${s.phase.step}:${s.calibration.current}:${s.court.current}:${s.bluff.current}`;
}

export interface Policy {
  value?: (s: MatchState, pid: string) => number;
  guess?: (s: MatchState, pid: string) => "HONEST" | "BLUFF";
  winner?: (s: MatchState, pid: string, a: string, b: string) => string;
}

/** A bot that performs every legal non-card action for every player, then yields/times out. */
export function autoplayStep(s: MatchState, now: number, policy: Policy = {}): { s: MatchState; now: number } {
  const value = policy.value ?? ((_s, pid) => (Number(pid.slice(1)) * 15) % 100);
  const guess = policy.guess ?? (() => "BLUFF" as const);
  const before = s.version;
  const key = phaseKey(s);
  outer: for (const p of s.players) {
    for (const l of legalActions(s, p.id)) {
      if (phaseKey(s) !== key) break outer;
      if (!legalActions(s, p.id).includes(l)) continue;
      const h = s.court.hearings[s.court.current];
      const f = s.finale;
      switch (l) {
        case "SUBMIT_OPINION": s = act(s, p.id, { type: "SUBMIT_OPINION", value: value(s, p.id), keepPrivate: false }, now); break;
        case "SUBMIT_PREDICTION": s = act(s, p.id, { type: "SUBMIT_PREDICTION", value: 50 }, now); break;
        case "SELECT_CONTRACT": s = act(s, p.id, { type: "SELECT_CONTRACT", offerId: s.contracts[p.id]!.offers[0]!.offerId }, now); break;
        case "COURT_LOCK_STANCE": s = act(s, p.id, { type: "COURT_LOCK_STANCE", value: value(s, p.id) }, now); break;
        case "JUDGE_PREDICT": s = act(s, p.id, { type: "JUDGE_PREDICT", value: 50 }, now); break;
        case "COURT_VERDICT": s = act(s, p.id, { type: "COURT_VERDICT", winnerId: policy.winner?.(s, p.id, h!.debaterA, h!.debaterB) ?? h!.debaterA }, now); break;
        case "ANALYST_CALL": s = act(s, p.id, { type: "ANALYST_CALL", winnerId: h!.debaterA }, now); break;
        case "BLUFF_LOCK": s = act(s, p.id, { type: "BLUFF_LOCK", value: value(s, p.id) }, now); break;
        case "BLUFF_VOTE": s = act(s, p.id, { type: "BLUFF_VOTE", guess: guess(s, p.id) }, now); break;
        case "FINALE_LOCK_STANCE": s = act(s, p.id, { type: "FINALE_LOCK_STANCE", value: value(s, p.id) === 50 ? 55 : value(s, p.id) }, now); break;
        case "FINALE_PREDICT": s = act(s, p.id, { type: "FINALE_PREDICT", value: 50 }, now); break;
        case "FINALE_VERDICT": s = act(s, p.id, { type: "FINALE_VERDICT", winnerId: policy.winner?.(s, p.id, f!.debaterA, f!.debaterB) ?? f!.debaterA }, now); break;
        case "FINALE_WINNER_CALL": s = act(s, p.id, { type: "FINALE_WINNER_CALL", winnerId: f!.debaterB }, now); break;
        case "FINALE_CLASSIFY":
          for (const t of f!.seats[p.id] === "DEBATER" ? [p.id === f!.debaterA ? f!.debaterB : f!.debaterA] : [f!.debaterA, f!.debaterB]) {
            if (!f!.classifications[p.id]?.[t]) s = act(s, p.id, { type: "FINALE_CLASSIFY", targetId: t, guess: "HONEST" }, now);
          }
          break;
        default: break;
      }
    }
  }
  if (s.version === before) return timeout(s);
  return { s, now };
}

export function playToEnd(s: MatchState, policy: Policy = {}, maxSteps = 500): MatchState {
  let now = NOW;
  for (let i = 0; i < maxSteps && s.phase.name !== "RESULTS"; i++) ({ s, now } = autoplayStep(s, now, policy));
  return s;
}

export function playUntil(s: MatchState, phase: MatchState["phase"]["name"], policy: Policy = {}, maxSteps = 500): { s: MatchState; now: number } {
  let now = NOW;
  for (let i = 0; i < maxSteps && s.phase.name !== phase; i++) ({ s, now } = autoplayStep(s, now, policy));
  if (s.phase.name !== phase) throw new Error(`never reached ${phase}, stuck at ${s.phase.name}`);
  return { s, now };
}
