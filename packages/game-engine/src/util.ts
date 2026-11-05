import type { GameEventMessage, PhaseName, Prompt, PromptMode, Segment, TimelineEntry } from "@hps/shared";
import { nextInt, pick } from "./rng";
import { EngineError, type BluffTurn, type Hearing, type MatchState } from "./types";

export interface Ctx {
  s: MatchState;
  now: number;
  events: GameEventMessage[];
}

export function nameOf(s: MatchState, id: string | null | undefined): string {
  if (!id) return "Someone";
  return s.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function activeIds(s: MatchState): string[] {
  return s.players.filter((p) => !p.removed).map((p) => p.id);
}

/** Players whose submission we wait for before ending a phase early. */
export function isWaitingOn(s: MatchState, id: string): boolean {
  const p = s.players.find((x) => x.id === id);
  return !!p && !p.removed && p.connected;
}

export function emit(ctx: Ctx, kind: GameEventMessage["kind"], text: string, data?: Record<string, unknown>): void {
  ctx.events.push({ kind, at: ctx.now, text, ...(data ? { data } : {}) });
}

export function timeline(ctx: Ctx, kind: TimelineEntry["kind"], text: string): void {
  ctx.s.counter++;
  ctx.s.timeline.push({ id: `t${ctx.s.counter}`, at: ctx.now, kind, text });
  if (ctx.s.timeline.length > 80) ctx.s.timeline.splice(0, ctx.s.timeline.length - 80);
}

export const SEGMENT_OF: Record<PhaseName, Segment> = {
  LOBBY: "CALIBRATION",
  CALIBRATION_PROMPT: "CALIBRATION",
  CALIBRATION_SUBMISSION: "CALIBRATION",
  CALIBRATION_PREDICTION: "CALIBRATION",
  CALIBRATION_DISCUSSION: "CALIBRATION",
  CALIBRATION_REVEAL: "CALIBRATION",
  CONTRACT_SELECTION: "CONTRACTS",
  COURT_PREPARATION: "COURT",
  COURT_OPENING: "COURT",
  COURT_REBUTTAL: "COURT",
  COURT_CHALLENGE: "COURT",
  COURT_CLOSING: "COURT",
  COURT_VOTING: "COURT",
  COURT_REVEAL: "COURT",
  BLUFF_PREPARATION: "BLUFF",
  BLUFF_STATEMENT: "BLUFF",
  BLUFF_DISCUSSION: "BLUFF",
  BLUFF_VOTING: "BLUFF",
  BLUFF_REVEAL: "BLUFF",
  FINALE_PREPARATION: "FINALE",
  FINALE_DEBATE: "FINALE",
  FINALE_INVESTIGATION: "FINALE",
  FINALE_VOTING: "FINALE",
  FINALE_REVEAL: "FINALE",
  RESULTS: "RESULTS",
};

export function currentHearing(s: MatchState): Hearing | null {
  return SEGMENT_OF[s.phase.name] === "COURT" ? (s.court.hearings[s.court.current] ?? null) : null;
}

export function currentTurn(s: MatchState): BluffTurn | null {
  return SEGMENT_OF[s.phase.name] === "BLUFF" ? (s.bluff.turns[s.bluff.current] ?? null) : null;
}

export interface Unit {
  key: string;
  label: string;
  /** Players whose previous statements can be cited / who can be cross-examined. */
  spotlight: string[];
}

export function currentUnit(s: MatchState): Unit | null {
  const h = currentHearing(s);
  if (h) return { key: `court:${h.index}`, label: `Hearing ${h.index + 1}`, spotlight: [h.debaterA, h.debaterB] };
  const t = currentTurn(s);
  if (t) return { key: `bluff:${t.index}`, label: `Spotlight ${t.index + 1}`, spotlight: [t.speakerId] };
  if (SEGMENT_OF[s.phase.name] === "FINALE" && s.finale) {
    return { key: "finale", label: "Final Verdict", spotlight: [s.finale.debaterA, s.finale.debaterB] };
  }
  return null;
}

/** Which debater currently holds the floor in a speaking step. */
export function speakerFor(s: MatchState): string | null {
  const { name, step } = s.phase;
  const h = currentHearing(s);
  if (h && (name === "COURT_OPENING" || name === "COURT_REBUTTAL" || name === "COURT_CLOSING")) {
    return step === 0 ? h.debaterA : h.debaterB;
  }
  if (name === "BLUFF_STATEMENT") return currentTurn(s)?.speakerId ?? null;
  if (name === "FINALE_DEBATE" && s.finale) return step % 2 === 0 ? s.finale.debaterA : s.finale.debaterB;
  return null;
}

/**
 * Random-mix prompt selection over the server-filtered pool. With randomMix on, each enabled pack
 * is equally likely regardless of size. Never repeats until the mode is exhausted; then repeats from
 * the same eligible pool; then falls back to stream-safe Base Game; otherwise a controlled error.
 */
export function pickPrompt(s: MatchState, mode: PromptMode, randomMix: boolean): Prompt {
  const ofMode = s.promptPool.filter((p) => p.mode === mode);
  let candidates = ofMode.filter((p) => !s.usedPromptIds.includes(p.id));
  if (candidates.length === 0) candidates = ofMode;
  if (candidates.length === 0) candidates = s.fallbackPool.filter((p) => p.mode === mode);
  if (candidates.length === 0) throw new EngineError("NO_PROMPTS", `No eligible ${mode.toLowerCase()} prompts for this room.`);
  let chosen: Prompt;
  if (randomMix) {
    const packs = [...new Set(candidates.map((p) => p.packId))].sort();
    const pack = packs[nextInt(s, 0, packs.length - 1)];
    chosen = pick(s, candidates.filter((p) => p.packId === pack));
  } else {
    chosen = pick(s, candidates);
  }
  s.usedPromptIds.push(chosen.id);
  return chosen;
}

export function promptView(p: Prompt) {
  return {
    id: p.id,
    packId: p.packId,
    question: p.question,
    leftLabel: p.leftLabel,
    rightLabel: p.rightLabel,
    mature: p.contentRating !== "SAFE" || !p.streamSafe,
  };
}
