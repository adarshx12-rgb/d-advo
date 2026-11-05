import type { GameActionInput, LegalAction, Prompt } from "@hps/shared";
import { playableCards, playCard, resolvePending } from "./chaos";
import type { MatchConfig } from "./config";
import {
  addVault,
  advance,
  dropPrivateVault,
  finaleClassifyTargets,
  finaleVerdictVoters,
  HOST_ADVANCEABLE,
  isPhaseComplete,
  selectContract,
  SKIPPABLE_PHASES,
  startFirstPhase,
  enterPhase,
} from "./phases";
import { seedFromString, shuffle } from "./rng";
import { buildBluffSchedule, buildCourtSchedule } from "./schedule";
import { EngineError, type EngineAction, type EngineResult, type MatchState } from "./types";
import { currentHearing, currentTurn, emit, nameOf, pickPrompt, speakerFor, timeline, type Ctx } from "./util";

export interface CreateMatchInput {
  matchId: string;
  seed: string;
  hostId: string;
  players: { id: string; name: string; avatar: string }[];
  config: MatchConfig;
  pool: Prompt[];
  fallbackPool: Prompt[];
  now: number;
}

const MAX_ACTION_IDS = 1000;

export function createMatch(input: CreateMatchInput): EngineResult {
  if (input.players.length < 3) throw new EngineError("TOO_FEW_PLAYERS", "At least three players are needed.");
  if (input.players.length > 12) throw new EngineError("TOO_MANY_PLAYERS", "At most twelve players can play.");
  const s: MatchState = {
    matchId: input.matchId,
    seed: input.seed,
    rngState: seedFromString(input.seed),
    version: 0,
    status: "IN_GAME",
    hostId: input.hostId,
    config: input.config,
    createdAt: input.now,
    players: [],
    phase: { name: "LOBBY", step: 0, enteredAt: input.now, deadline: null, pausedRemainingMs: null, yieldRequested: false },
    calibration: { rounds: [], current: 0 },
    contracts: {},
    court: { hearings: [], current: 0 },
    bluff: { turns: [], current: 0 },
    finale: null,
    vault: [],
    chaos: { charges: {}, pending: null, history: [], playedInUnit: {} },
    scoreEvents: [],
    timeline: [],
    promptPool: input.pool,
    fallbackPool: input.fallbackPool,
    usedPromptIds: [],
    skipRequests: {},
    spectators: {},
    processedActionIds: [],
    counter: 0,
  };
  // Seat order is shuffled per match so rotation advantages move between matches.
  const seated = shuffle(s, input.players);
  s.players = seated.map((p, seat) => ({ ...p, seat, connected: true, removed: false }));
  const order = s.players.map((p) => p.id);
  for (const id of order) s.chaos.charges[id] = input.config.chaosEnabled ? input.config.startingCharges : 0;
  if (input.config.segments.court) s.court.hearings = buildCourtSchedule(s, order, input.config.courtHearings);
  if (input.config.segments.bluff) s.bluff.turns = buildBluffSchedule(s, order, input.config.bluffTurns);

  const ctx: Ctx = { s, now: input.now, events: [] };
  timeline(ctx, "SYSTEM", "The show begins");
  startFirstPhase(ctx);
  s.version = 1;
  return { state: s, events: ctx.events };
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                       */
/* ------------------------------------------------------------------ */

export function legalActions(s: MatchState, pid: string): LegalAction[] {
  const p = s.players.find((x) => x.id === pid);
  if (!p || p.removed || s.status !== "IN_GAME") return [];
  const out: LegalAction[] = [];
  const name = s.phase.name;
  const h = currentHearing(s);
  const t = currentTurn(s);
  const f = s.finale;
  switch (name) {
    case "CALIBRATION_SUBMISSION": {
      const r = s.calibration.rounds[s.calibration.current];
      if (r && r.opinions[pid] === undefined) out.push("SUBMIT_OPINION");
      break;
    }
    case "CALIBRATION_PREDICTION": {
      const r = s.calibration.rounds[s.calibration.current];
      if (r && r.targets[pid] && r.predictions[pid] === undefined) out.push("SUBMIT_PREDICTION");
      break;
    }
    case "CONTRACT_SELECTION": {
      const c = s.contracts[pid];
      if (c && !c.selected && c.offers.length > 0) out.push("SELECT_CONTRACT");
      break;
    }
    case "COURT_PREPARATION":
      if (h) {
        if ((pid === h.debaterA || pid === h.debaterB) && h.stances[pid] === undefined) out.push("COURT_LOCK_STANCE");
        if (h.predictionTargets[pid] && h.predictions[pid] === undefined) out.push("JUDGE_PREDICT");
      }
      break;
    case "COURT_VOTING":
      if (h) {
        if (h.judges.includes(pid) && !h.verdicts[pid]) out.push("COURT_VERDICT");
        if (h.analystId === pid && !h.analystCall) out.push("ANALYST_CALL");
      }
      break;
    case "BLUFF_PREPARATION":
      if (t && t.speakerId === pid && t.genuine === null) out.push("BLUFF_LOCK");
      break;
    case "BLUFF_VOTING":
      if (t && t.investigators.includes(pid) && !t.votes[pid]) out.push("BLUFF_VOTE");
      break;
    case "FINALE_PREPARATION":
      if (f) {
        if ((pid === f.debaterA || pid === f.debaterB) && f.stances[pid] === undefined) out.push("FINALE_LOCK_STANCE");
        if (f.predictionTargets[pid] && f.predictions[pid] === undefined) out.push("FINALE_PREDICT");
      }
      break;
    case "FINALE_VOTING":
      if (f) {
        if (finaleVerdictVoters(f).includes(pid) && !f.verdicts[pid]) out.push("FINALE_VERDICT");
        if (f.seats[pid] === "INVESTIGATOR" && !f.winnerCalls[pid]) out.push("FINALE_WINNER_CALL");
        const cls = f.classifications[pid] ?? {};
        if (finaleClassifyTargets(f, pid).some((x) => !cls[x])) out.push("FINALE_CLASSIFY");
      }
      break;
    default:
      break;
  }
  if (speakerFor(s) === pid) out.push("YIELD_FLOOR");
  if (playableCards(s, pid).length > 0) out.push("PLAY_CARD");
  if (SKIPPABLE_PHASES.includes(name) && (s.skipRequests[pid] ?? 0) < s.config.maxSkipRequestsPerPlayer) out.push("REQUEST_SKIP");
  return out;
}

function require(cond: unknown, code: string, message: string): asserts cond {
  if (!cond) throw new EngineError(code, message);
}

/* ------------------------------------------------------------------ */
/* Player actions                                                       */
/* ------------------------------------------------------------------ */

function applyPlayerAction(ctx: Ctx, pid: string, actionId: string, a: GameActionInput): void {
  const { s } = ctx;
  require(s.status === "IN_GAME", s.status === "PAUSED" ? "PAUSED" : "COMPLETED", s.status === "PAUSED" ? "The game is paused." : "The match is over.");
  const player = s.players.find((p) => p.id === pid);
  require(player && !player.removed, "NOT_A_PLAYER", "You are not playing in this match.");
  const legal = legalActions(s, pid);
  const h = currentHearing(s);
  const t = currentTurn(s);
  const f = s.finale;

  if (a.type !== "PLAY_CARD") {
    require(legal.includes(a.type), "ILLEGAL_ACTION", illegalReason(s, a.type));
  }

  switch (a.type) {
    case "SUBMIT_OPINION": {
      const r = s.calibration.rounds[s.calibration.current]!;
      r.opinions[pid] = { value: a.value, keepPrivate: a.keepPrivate };
      // Private answers are scored but never stored in the vault, so they can never return as evidence.
      if (!a.keepPrivate) {
        addVault(ctx, {
          id: `v:cal:${r.index}:${pid}`,
          playerId: pid,
          promptId: r.prompt.id,
          promptSnapshot: r.prompt.question,
          leftLabel: r.prompt.leftLabel,
          rightLabel: r.prompt.rightLabel,
          value: a.value,
          sourceLabel: `Read the Room, round ${r.index + 1}`,
          sourceRound: `cal:${r.index}`,
        });
      }
      break;
    }
    case "SUBMIT_PREDICTION":
      s.calibration.rounds[s.calibration.current]!.predictions[pid] = a.value;
      break;
    case "SELECT_CONTRACT": {
      const c = s.contracts[pid]!;
      require(c.offers.some((o) => o.offerId === a.offerId), "BAD_OFFER", "That contract was not offered to you.");
      selectContract(s, pid, a.offerId);
      break;
    }
    case "COURT_LOCK_STANCE":
      h!.stances[pid] = a.value;
      addVault(ctx, {
        id: `v:court:${h!.index}:${pid}`,
        playerId: pid,
        promptId: h!.prompt!.id,
        promptSnapshot: h!.prompt!.question,
        leftLabel: h!.prompt!.leftLabel,
        rightLabel: h!.prompt!.rightLabel,
        value: a.value,
        sourceLabel: `Real stance, hearing ${h!.index + 1}`,
        sourceRound: `court:${h!.index}`,
      });
      break;
    case "JUDGE_PREDICT":
      h!.predictions[pid] = a.value;
      break;
    case "COURT_VERDICT":
      require(a.winnerId === h!.debaterA || a.winnerId === h!.debaterB, "BAD_TARGET", "Pick one of the two debaters.");
      h!.verdicts[pid] = a.winnerId;
      break;
    case "ANALYST_CALL":
      require(a.winnerId === h!.debaterA || a.winnerId === h!.debaterB, "BAD_TARGET", "Pick one of the two debaters.");
      h!.analystCall = a.winnerId;
      break;
    case "YIELD_FLOOR":
      if (s.chaos.pending) s.phase.yieldRequested = true;
      else advance(ctx);
      break;
    case "BLUFF_LOCK":
      t!.genuine = a.value;
      addVault(ctx, {
        id: `v:bluff:${t!.index}:${pid}`,
        playerId: pid,
        promptId: t!.prompt!.id,
        promptSnapshot: t!.prompt!.question,
        leftLabel: t!.prompt!.leftLabel,
        rightLabel: t!.prompt!.rightLabel,
        value: a.value,
        sourceLabel: `Spotlight ${t!.index + 1} (real answer)`,
        sourceRound: `bluff:${t!.index}`,
      });
      break;
    case "BLUFF_VOTE":
      t!.votes[pid] = a.guess;
      break;
    case "FINALE_LOCK_STANCE":
      require(a.value !== 50, "PICK_A_SIDE", "The finale needs a side: choose anything except 50.");
      f!.stances[pid] = a.value;
      addVault(ctx, {
        id: `v:finale:${pid}`,
        playerId: pid,
        promptId: f!.prompt!.id,
        promptSnapshot: f!.prompt!.question,
        leftLabel: f!.prompt!.leftLabel,
        rightLabel: f!.prompt!.rightLabel,
        value: a.value,
        sourceLabel: "Final Verdict (real stance)",
        sourceRound: "finale",
      });
      break;
    case "FINALE_PREDICT":
      f!.predictions[pid] = a.value;
      break;
    case "FINALE_VERDICT":
      require(a.winnerId === f!.debaterA || a.winnerId === f!.debaterB, "BAD_TARGET", "Pick one of the two finalists.");
      f!.verdicts[pid] = a.winnerId;
      break;
    case "FINALE_WINNER_CALL":
      require(a.winnerId === f!.debaterA || a.winnerId === f!.debaterB, "BAD_TARGET", "Pick one of the two finalists.");
      f!.winnerCalls[pid] = a.winnerId;
      break;
    case "FINALE_CLASSIFY": {
      require(finaleClassifyTargets(f!, pid).includes(a.targetId), "BAD_TARGET", "You cannot classify that player.");
      const cls = (f!.classifications[pid] ??= {});
      require(!cls[a.targetId], "ALREADY_SUBMITTED", "You already classified that player.");
      cls[a.targetId] = a.guess;
      break;
    }
    case "PLAY_CARD":
      playCard(ctx, pid, actionId, { card: a.card, targetEntryId: a.targetEntryId, targetPlayerId: a.targetPlayerId });
      break;
    case "REQUEST_SKIP":
      s.skipRequests[pid] = (s.skipRequests[pid] ?? 0) + 1;
      replacePrompt(ctx, "A player asked to skip this prompt");
      break;
  }
}

function illegalReason(s: MatchState, type: string): string {
  if (s.status === "PAUSED") return "The game is paused.";
  switch (type) {
    case "SUBMIT_OPINION":
    case "SUBMIT_PREDICTION":
    case "COURT_LOCK_STANCE":
    case "JUDGE_PREDICT":
    case "BLUFF_LOCK":
    case "FINALE_LOCK_STANCE":
    case "FINALE_PREDICT":
      return "That answer is already locked or it is not your turn to answer.";
    case "COURT_VERDICT":
    case "BLUFF_VOTE":
    case "FINALE_VERDICT":
    case "FINALE_WINNER_CALL":
    case "FINALE_CLASSIFY":
    case "ANALYST_CALL":
      return "You cannot vote right now, or your ballot is already in.";
    case "YIELD_FLOOR":
      return "Only the speaker holding the floor can finish early.";
    case "REQUEST_SKIP":
      return "Prompts can only be skipped before answers are revealed, and you have used your skips.";
    default:
      return "That action is not available right now.";
  }
}

/** Swap the active prompt for a fresh eligible one and clear answers given to the old one. */
function replacePrompt(ctx: Ctx, reason: string): void {
  const { s } = ctx;
  require(SKIPPABLE_PHASES.includes(s.phase.name), "NOT_SKIPPABLE", "This prompt can no longer be skipped.");
  const name = s.phase.name;
  if (name === "CALIBRATION_PROMPT" || name === "CALIBRATION_SUBMISSION") {
    dropPrivateVault(s, `cal:${s.calibration.current}`);
    s.calibration.rounds[s.calibration.current]!.opinions = {};
    enterPhase(ctx, "CALIBRATION_PROMPT"); // re-enter: picks a new prompt, same targets rotation
  } else if (name === "COURT_PREPARATION") {
    const h = currentHearing(s)!;
    dropPrivateVault(s, `court:${h.index}`);
    h.stances = {};
    h.predictions = {};
    enterPhase(ctx, "COURT_PREPARATION");
  } else if (name === "BLUFF_PREPARATION") {
    const t = currentTurn(s)!;
    dropPrivateVault(s, `bluff:${t.index}`);
    t.genuine = null;
    enterPhase(ctx, "BLUFF_PREPARATION");
  } else if (name === "FINALE_PREPARATION") {
    const f = s.finale!;
    dropPrivateVault(s, "finale");
    const used = f.prompt?.id;
    // keep seats; only the proposition changes
    f.prompt = pickPrompt(s, "FINALE", s.config.randomMix);
    f.stances = {};
    f.predictions = {};
    if (used) emit(ctx, "PHASE_CHANGED", "New finale proposition");
  }
  timeline(ctx, "SYSTEM", `${reason}. New prompt incoming.`);
}

/* ------------------------------------------------------------------ */
/* Reducer                                                              */
/* ------------------------------------------------------------------ */

export function reduce(state: MatchState, action: EngineAction, now: number): EngineResult & { duplicate?: boolean } {
  if ("actionId" in action && state.processedActionIds.includes(action.actionId)) {
    return { state, events: [], duplicate: true }; // idempotent: replays are acknowledged, not re-applied
  }
  const s = structuredClone(state);
  const ctx: Ctx = { s, now, events: [] };

  switch (action.kind) {
    case "PLAYER":
      applyPlayerAction(ctx, action.actorId, action.actionId, action.action);
      break;
    case "SPECTATOR_VOTE":
      applySpectatorVote(ctx, action.spectatorId, action.spectatorName, action.choice);
      break;
    case "HOST":
      applyHost(ctx, action.actorId, action.command);
      break;
    case "CONNECTION": {
      const p = s.players.find((x) => x.id === action.playerId);
      if (p && !p.removed) p.connected = action.connected;
      break;
    }
    case "REMOVE_PLAYER": {
      const p = s.players.find((x) => x.id === action.playerId);
      if (p && !p.removed) {
        p.removed = true;
        p.connected = false;
        timeline(ctx, "SYSTEM", `${p.name} left the show`);
      }
      break;
    }
    case "SET_HOST":
      s.hostId = action.playerId;
      break;
    case "UPDATE_POOL":
      s.promptPool = action.pool;
      break;
  }
  if ("actionId" in action) {
    s.processedActionIds.push(action.actionId);
    if (s.processedActionIds.length > MAX_ACTION_IDS) s.processedActionIds.splice(0, s.processedActionIds.length - MAX_ACTION_IDS);
  }
  settle(ctx);
  s.version++;
  return { state: s, events: ctx.events };
}

/** Advance any phase whose exit condition is satisfied (early completion, a deferred yield). */
function settle(ctx: Ctx): void {
  const { s } = ctx;
  for (let guard = 0; guard < 20; guard++) {
    if (s.status !== "IN_GAME" || s.chaos.pending) return;
    if (s.phase.yieldRequested) {
      advance(ctx);
      continue;
    }
    if (isPhaseComplete(s)) {
      advance(ctx);
      continue;
    }
    return;
  }
}

function applySpectatorVote(ctx: Ctx, spectatorId: string, name: string, choice: string): void {
  const { s } = ctx;
  require(s.config.audienceEnabled, "AUDIENCE_OFF", "Audience voting is off in this room.");
  require(s.status === "IN_GAME", "NOT_OPEN", "Voting is not open.");
  let unitKey: string | null = null;
  let valid: string[] = [];
  const h = currentHearing(s);
  const t = currentTurn(s);
  if (s.phase.name === "COURT_VOTING" && h) {
    unitKey = `court:${h.index}`;
    valid = [h.debaterA, h.debaterB];
  } else if (s.phase.name === "BLUFF_VOTING" && t) {
    unitKey = `bluff:${t.index}`;
    valid = ["HONEST", "BLUFF"];
  } else if (s.phase.name === "FINALE_VOTING" && s.finale) {
    unitKey = "finale";
    valid = [s.finale.debaterA, s.finale.debaterB];
  }
  require(unitKey, "NOT_OPEN", "There is nothing to vote on right now.");
  require(valid.includes(choice), "BAD_CHOICE", "That is not a valid choice.");
  const rec = (s.spectators[spectatorId] ??= { id: spectatorId, name, points: 0, ballots: {} });
  rec.name = name;
  rec.ballots[unitKey] = choice; // one active ballot per question; re-voting replaces it
}

function applyHost(ctx: Ctx, actorId: string, command: "PAUSE" | "RESUME" | "SKIP_PROMPT" | "ADVANCE" | "END"): void {
  const { s, now } = ctx;
  require(actorId === s.hostId, "NOT_HOST", "Only the host can do that.");
  switch (command) {
    case "PAUSE":
      require(s.status === "IN_GAME", "NOT_RUNNING", "The game is not running.");
      s.status = "PAUSED";
      s.phase.pausedRemainingMs = s.phase.deadline === null ? null : Math.max(0, s.phase.deadline - now);
      s.phase.deadline = null;
      if (s.chaos.pending) s.chaos.pending.resolvesAt = Math.max(0, s.chaos.pending.resolvesAt - now); // store remaining
      emit(ctx, "PAUSED", "The host paused the game");
      timeline(ctx, "SYSTEM", "Paused by the host");
      break;
    case "RESUME":
      require(s.status === "PAUSED", "NOT_PAUSED", "The game is not paused.");
      s.status = "IN_GAME";
      s.phase.deadline = s.phase.pausedRemainingMs === null ? null : now + s.phase.pausedRemainingMs;
      s.phase.pausedRemainingMs = null;
      if (s.chaos.pending) s.chaos.pending.resolvesAt = now + s.chaos.pending.resolvesAt;
      emit(ctx, "RESUMED", "The game resumed");
      timeline(ctx, "SYSTEM", "Resumed");
      break;
    case "SKIP_PROMPT":
      require(s.status === "IN_GAME", "NOT_RUNNING", "Resume the game first.");
      replacePrompt(ctx, "The host skipped the prompt");
      break;
    case "ADVANCE":
      require(s.status === "IN_GAME", "NOT_RUNNING", "Resume the game first.");
      require(HOST_ADVANCEABLE.includes(s.phase.name), "NOT_ADVANCEABLE", "This phase ends on its own when everyone has acted.");
      require(!s.chaos.pending, "CARD_PENDING", "Wait for the pending card to resolve.");
      advance(ctx);
      break;
    case "END":
      require(s.status !== "COMPLETED", "COMPLETED", "The match is already over.");
      s.status = "IN_GAME";
      s.chaos.pending = null;
      timeline(ctx, "SYSTEM", "The host ended the show early");
      enterPhase(ctx, "RESULTS");
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Time                                                                 */
/* ------------------------------------------------------------------ */

/** Earliest moment the server must call tick() again, or null if nothing is scheduled. */
export function nextWakeAt(s: MatchState): number | null {
  if (s.status !== "IN_GAME") return null;
  const times: number[] = [];
  if (s.chaos.pending) times.push(s.chaos.pending.resolvesAt);
  if (s.phase.deadline !== null) times.push(s.phase.deadline);
  return times.length ? Math.min(...times) : null;
}

/**
 * Processes every timer that has elapsed by `now`: pending card stages, then phase deadlines.
 * Phase exits are deferred while a card is resolving so objections always get their window.
 */
export function tick(state: MatchState, now: number): EngineResult & { changed: boolean } {
  if (state.status !== "IN_GAME") return { state, events: [], changed: false };
  const due = nextWakeAt(state);
  if (due === null || due > now) return { state, events: [], changed: false };
  const s = structuredClone(state);
  const ctx: Ctx = { s, now, events: [] };
  for (let guard = 0; guard < 50; guard++) {
    if (s.status !== "IN_GAME") break;
    const pending = s.chaos.pending;
    if (pending && pending.resolvesAt <= now) {
      resolvePending(ctx);
      continue;
    }
    if (!pending && s.phase.deadline !== null && s.phase.deadline <= now) {
      advance(ctx);
      continue;
    }
    if (!pending && (s.phase.yieldRequested || isPhaseComplete(s))) {
      advance(ctx);
      continue;
    }
    break;
  }
  s.version++;
  return { state: s, events: ctx.events, changed: true };
}

export { nameOf };
