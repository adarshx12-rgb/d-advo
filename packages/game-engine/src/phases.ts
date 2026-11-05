import type { FinaleSeat, PhaseName, Segment, Side } from "@hps/shared";
import { secondsToMs } from "./config";
import { coin } from "./rng";
import { assignTargets, buildContractOffers, computeClaim, otherSide } from "./schedule";
import {
  addScore,
  finaleStancePredictionPoints,
  judgePredictionPoints,
  opinionPredictionPoints,
  POINTS,
  standingsOrder,
  totals,
  underdogMultiplier,
} from "./scoring";
import type { FinaleState, MatchState, VaultEntry } from "./types";
import {
  activeIds,
  currentHearing,
  currentTurn,
  emit,
  isWaitingOn,
  nameOf,
  pickPrompt,
  SEGMENT_OF,
  speakerFor,
  timeline,
  type Ctx,
} from "./util";

const SEGMENT_ORDER: Segment[] = ["CALIBRATION", "CONTRACTS", "COURT", "BLUFF", "FINALE", "RESULTS"];

const REVEAL_PHASES: PhaseName[] = ["CALIBRATION_REVEAL", "COURT_REVEAL", "BLUFF_REVEAL", "FINALE_REVEAL"];

export function isRevealPhase(name: PhaseName): boolean {
  return REVEAL_PHASES.includes(name);
}

/** Phases whose prompt can still be swapped because no answer has been revealed or argued yet. */
export const SKIPPABLE_PHASES: PhaseName[] = [
  "CALIBRATION_PROMPT",
  "CALIBRATION_SUBMISSION",
  "COURT_PREPARATION",
  "BLUFF_PREPARATION",
  "FINALE_PREPARATION",
];

/** Phases the host may end early by hand. */
export const HOST_ADVANCEABLE: PhaseName[] = [
  "CALIBRATION_PROMPT",
  "CALIBRATION_DISCUSSION",
  "CALIBRATION_REVEAL",
  "COURT_REVEAL",
  "BLUFF_REVEAL",
  "FINALE_REVEAL",
];

function durationSec(s: MatchState, name: PhaseName, step: number): number | null {
  const t = s.config.timers;
  if (s.config.manualProgression && isRevealPhase(name)) return null;
  switch (name) {
    case "CALIBRATION_PROMPT": return t.calibrationPrompt;
    case "CALIBRATION_SUBMISSION": return t.calibrationSubmission;
    case "CALIBRATION_PREDICTION": return t.calibrationPrediction;
    case "CALIBRATION_DISCUSSION": return t.calibrationDiscussion;
    case "CALIBRATION_REVEAL": return t.calibrationReveal;
    case "CONTRACT_SELECTION": return t.contractSelection;
    case "COURT_PREPARATION": return t.courtPreparation;
    case "COURT_OPENING": return t.courtOpening;
    case "COURT_REBUTTAL": return t.courtRebuttal;
    case "COURT_CHALLENGE": return t.courtChallenge;
    case "COURT_CLOSING": return t.courtClosing;
    case "COURT_VOTING": return t.courtVoting;
    case "COURT_REVEAL": return t.courtReveal;
    case "BLUFF_PREPARATION": return t.bluffPreparation;
    case "BLUFF_STATEMENT": return t.bluffStatement;
    case "BLUFF_DISCUSSION": return t.bluffDiscussion;
    case "BLUFF_VOTING": return t.bluffVoting;
    case "BLUFF_REVEAL": return t.bluffReveal;
    case "FINALE_PREPARATION": return t.finalePreparation;
    case "FINALE_DEBATE": return step < 2 ? t.finaleOpening : t.finaleRebuttal;
    case "FINALE_INVESTIGATION": return t.finaleInvestigation;
    case "FINALE_VOTING": return t.finaleVoting;
    case "FINALE_REVEAL": return t.finaleReveal;
    case "RESULTS":
    case "LOBBY":
      return null;
  }
}

export function phaseLabel(s: MatchState): string {
  const { name, step } = s.phase;
  const sp = speakerFor(s);
  const h = currentHearing(s);
  const t = currentTurn(s);
  switch (name) {
    case "CALIBRATION_PROMPT": return `Read the Room — round ${s.calibration.current + 1}`;
    case "CALIBRATION_SUBMISSION": return "Lock your real opinion";
    case "CALIBRATION_PREDICTION": return "Predict your target";
    case "CALIBRATION_DISCUSSION": return "Answers locked — talk it out";
    case "CALIBRATION_REVEAL": return "The reveal";
    case "CONTRACT_SELECTION": return "Choose a secret contract";
    case "COURT_PREPARATION": return `Hearing ${(h?.index ?? 0) + 1} — preparation`;
    case "COURT_OPENING": return `Opening statement — ${nameOf(s, sp)}`;
    case "COURT_REBUTTAL": return `Rebuttal — ${nameOf(s, sp)}`;
    case "COURT_CHALLENGE": return "Challenge window";
    case "COURT_CLOSING": return `Closing — ${nameOf(s, sp)}`;
    case "COURT_VOTING": return "The bench decides";
    case "COURT_REVEAL": return "Verdict";
    case "BLUFF_PREPARATION": return `Spotlight ${(t?.index ?? 0) + 1} — ${nameOf(s, t?.speakerId)} prepares`;
    case "BLUFF_STATEMENT": return `${nameOf(s, sp)} makes their case`;
    case "BLUFF_DISCUSSION": return "Cross-questioning";
    case "BLUFF_VOTING": return "Honest or bluff?";
    case "BLUFF_REVEAL": return "The truth";
    case "FINALE_PREPARATION": return "Final Verdict — lock your positions";
    case "FINALE_DEBATE": return `${step < 2 ? "Final opening" : "Final rebuttal"} — ${nameOf(s, sp)}`;
    case "FINALE_INVESTIGATION": return "Evidence and questioning";
    case "FINALE_VOTING": return "Final ballots";
    case "FINALE_REVEAL": return "The final verdict";
    case "RESULTS": return "Results";
    case "LOBBY": return "Lobby";
  }
}

/* ------------------------------------------------------------------ */
/* Entering phases                                                     */
/* ------------------------------------------------------------------ */

export function enterPhase(ctx: Ctx, name: PhaseName, step = 0): void {
  const { s, now } = ctx;
  const secs = durationSec(s, name, step);
  s.phase = {
    name,
    step,
    enteredAt: now,
    deadline: secs === null ? null : now + secondsToMs(s.config, secs),
    pausedRemainingMs: null,
    yieldRequested: false,
  };
  onEnter(ctx);
  emit(ctx, "PHASE_CHANGED", phaseLabel(s), { phase: name, step });
}

function firstPhaseOf(seg: Segment): PhaseName {
  switch (seg) {
    case "CALIBRATION": return "CALIBRATION_PROMPT";
    case "CONTRACTS": return "CONTRACT_SELECTION";
    case "COURT": return "COURT_PREPARATION";
    case "BLUFF": return "BLUFF_PREPARATION";
    case "FINALE": return "FINALE_PREPARATION";
    case "RESULTS": return "RESULTS";
  }
}

function segmentEnabled(s: MatchState, seg: Segment): boolean {
  const g = s.config.segments;
  switch (seg) {
    case "CALIBRATION": return g.calibration && s.config.calibrationRounds > 0;
    case "CONTRACTS": return g.contracts && s.config.contractsEnabled && Object.values(s.contracts).length === 0;
    case "COURT": return g.court && s.court.hearings.length > 0;
    case "BLUFF": return g.bluff && s.bluff.turns.length > 0;
    case "FINALE": return g.finale;
    case "RESULTS": return true;
  }
}

function enterNextSegment(ctx: Ctx, after: Segment): void {
  const idx = SEGMENT_ORDER.indexOf(after);
  for (const seg of SEGMENT_ORDER.slice(idx + 1)) {
    if (segmentEnabled(ctx.s, seg)) {
      enterPhase(ctx, firstPhaseOf(seg));
      return;
    }
  }
}

export function startFirstPhase(ctx: Ctx): void {
  for (const seg of SEGMENT_ORDER) {
    if (segmentEnabled(ctx.s, seg)) {
      enterPhase(ctx, firstPhaseOf(seg));
      return;
    }
  }
}

/** Leave the current phase/step. Callers must ensure no card is pending. */
export function advance(ctx: Ctx): void {
  const { s } = ctx;
  const { name, step } = s.phase;
  onExit(ctx);
  switch (name) {
    case "CALIBRATION_PROMPT": return enterPhase(ctx, "CALIBRATION_SUBMISSION");
    case "CALIBRATION_SUBMISSION": return enterPhase(ctx, "CALIBRATION_PREDICTION");
    case "CALIBRATION_PREDICTION": return enterPhase(ctx, "CALIBRATION_DISCUSSION");
    case "CALIBRATION_DISCUSSION": return enterPhase(ctx, "CALIBRATION_REVEAL");
    case "CALIBRATION_REVEAL":
      if (s.calibration.current + 1 < s.config.calibrationRounds) {
        s.calibration.current++;
        return enterPhase(ctx, "CALIBRATION_PROMPT");
      }
      return enterNextSegment(ctx, "CALIBRATION");
    case "CONTRACT_SELECTION": return enterNextSegment(ctx, "CONTRACTS");
    case "COURT_PREPARATION": return enterPhase(ctx, "COURT_OPENING", 0);
    case "COURT_OPENING": return step === 0 ? enterPhase(ctx, "COURT_OPENING", 1) : enterPhase(ctx, "COURT_REBUTTAL", 0);
    case "COURT_REBUTTAL": return step === 0 ? enterPhase(ctx, "COURT_REBUTTAL", 1) : enterPhase(ctx, "COURT_CHALLENGE");
    case "COURT_CHALLENGE": return enterPhase(ctx, "COURT_CLOSING", 0);
    case "COURT_CLOSING": return step === 0 ? enterPhase(ctx, "COURT_CLOSING", 1) : enterPhase(ctx, "COURT_VOTING");
    case "COURT_VOTING": return enterPhase(ctx, "COURT_REVEAL");
    case "COURT_REVEAL":
      if (s.court.current + 1 < s.court.hearings.length) {
        s.court.current++;
        return enterPhase(ctx, "COURT_PREPARATION");
      }
      return enterNextSegment(ctx, "COURT");
    case "BLUFF_PREPARATION": return enterPhase(ctx, "BLUFF_STATEMENT");
    case "BLUFF_STATEMENT": return enterPhase(ctx, "BLUFF_DISCUSSION");
    case "BLUFF_DISCUSSION": return enterPhase(ctx, "BLUFF_VOTING");
    case "BLUFF_VOTING": return enterPhase(ctx, "BLUFF_REVEAL");
    case "BLUFF_REVEAL":
      if (s.bluff.current + 1 < s.bluff.turns.length) {
        s.bluff.current++;
        return enterPhase(ctx, "BLUFF_PREPARATION");
      }
      return enterNextSegment(ctx, "BLUFF");
    case "FINALE_PREPARATION": return enterPhase(ctx, "FINALE_DEBATE", 0);
    case "FINALE_DEBATE": return step < 3 ? enterPhase(ctx, "FINALE_DEBATE", step + 1) : enterPhase(ctx, "FINALE_INVESTIGATION");
    case "FINALE_INVESTIGATION": return enterPhase(ctx, "FINALE_VOTING");
    case "FINALE_VOTING": return enterPhase(ctx, "FINALE_REVEAL");
    case "FINALE_REVEAL": return enterPhase(ctx, "RESULTS");
    case "RESULTS":
    case "LOBBY":
      return;
  }
}

function addVault(ctx: Ctx, e: Omit<VaultEntry, "matchId" | "createdAt" | "visibility" | "revealEligible">): void {
  const { s, now } = ctx;
  s.vault = s.vault.filter((v) => v.id !== e.id);
  s.vault.push({ ...e, matchId: s.matchId, createdAt: now, visibility: "PRIVATE", revealEligible: true });
}

function promoteVault(s: MatchState, sourceRound: string, to: VaultEntry["visibility"]): void {
  for (const v of s.vault) if (v.sourceRound === sourceRound && v.visibility === "PRIVATE") v.visibility = to;
}

export function dropPrivateVault(s: MatchState, sourceRound: string): void {
  s.vault = s.vault.filter((v) => !(v.sourceRound === sourceRound && v.visibility === "PRIVATE"));
}

export { addVault };

function onEnter(ctx: Ctx): void {
  const { s } = ctx;
  const name = s.phase.name;
  switch (name) {
    case "CALIBRATION_PROMPT": {
      const r = s.calibration.current;
      const order = [...s.players].filter((p) => !p.removed).sort((a, b) => a.seat - b.seat).map((p) => p.id);
      const targets = assignTargets(order, r);
      s.calibration.rounds[r] = {
        index: r,
        prompt: pickPrompt(s, "SPECTRUM", s.config.randomMix),
        targets,
        opinions: {},
        predictions: {},
        revealed: false,
      };
      timeline(ctx, "PHASE", `Read the Room, round ${r + 1}`);
      break;
    }
    case "CALIBRATION_REVEAL":
      scoreCalibration(ctx);
      break;
    case "CONTRACT_SELECTION": {
      const offers = buildContractOffers(s, s);
      for (const [pid, list] of Object.entries(offers)) {
        s.contracts[pid] = { offers: list, selected: null, status: "OFFERED" };
      }
      timeline(ctx, "CONTRACT", "Secret contracts are on the table");
      break;
    }
    case "COURT_PREPARATION": {
      const h = s.court.hearings[s.court.current]!;
      h.prompt = pickPrompt(s, "DEBATE", s.config.randomMix);
      timeline(ctx, "PHASE", `Hearing ${h.index + 1}: ${nameOf(s, h.debaterA)} vs ${nameOf(s, h.debaterB)}`);
      break;
    }
    case "COURT_OPENING":
      if (s.phase.step === 0) {
        const h = s.court.hearings[s.court.current]!;
        timeline(ctx, "PHASE", `${nameOf(s, h.debaterA)} argues ${h.sideA}, ${nameOf(s, h.debaterB)} argues ${otherSide(h.sideA)}`);
      }
      break;
    case "COURT_VOTING":
      emit(ctx, "PHASE_CHANGED", "Debate closed. Voting is open.");
      break;
    case "COURT_REVEAL":
      scoreHearing(ctx);
      break;
    case "BLUFF_PREPARATION": {
      const t = s.bluff.turns[s.bluff.current]!;
      t.prompt = pickPrompt(s, "BLUFF", s.config.randomMix);
      timeline(ctx, "PHASE", `Spotlight on ${nameOf(s, t.speakerId)}`);
      break;
    }
    case "BLUFF_STATEMENT": {
      const t = s.bluff.turns[s.bluff.current]!;
      // Timeout rule: a speaker who never locked an answer is treated as answering 50 (not stored as evidence).
      const genuine = t.genuine ?? 50;
      t.claim = computeClaim(t, genuine, s.config.minBluffDistance);
      timeline(ctx, "PHASE", `${nameOf(s, t.speakerId)} claims ${t.claim}`);
      break;
    }
    case "BLUFF_VOTING":
      break;
    case "BLUFF_REVEAL":
      scoreBluff(ctx);
      break;
    case "FINALE_PREPARATION":
      setupFinale(ctx);
      break;
    case "FINALE_DEBATE":
      if (s.phase.step === 0 && s.finale) {
        const f = s.finale;
        timeline(ctx, "PHASE", `Final Verdict: ${nameOf(s, f.debaterA)} (${f.sideA}) vs ${nameOf(s, f.debaterB)} (${otherSide(f.sideA)})`);
      }
      break;
    case "FINALE_REVEAL":
      scoreFinale(ctx);
      break;
    case "RESULTS":
      finishMatch(ctx);
      break;
    default:
      break;
  }
}

function onExit(ctx: Ctx): void {
  const { s } = ctx;
  switch (s.phase.name) {
    case "CONTRACT_SELECTION":
      // Timeout rule: anyone who did not choose receives their first offer.
      for (const [pid, c] of Object.entries(s.contracts)) {
        if (!c.selected && c.offers.length > 0) selectContract(s, pid, c.offers[0]!.offerId);
      }
      break;
    case "FINALE_PREPARATION":
      deriveFinaleRoles(s);
      break;
    case "COURT_VOTING":
    case "BLUFF_VOTING":
    case "FINALE_VOTING":
      emit(ctx, "VOTING_CLOSED", "Voting closed");
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Contracts                                                            */
/* ------------------------------------------------------------------ */

export function selectContract(s: MatchState, pid: string, offerId: string): void {
  const c = s.contracts[pid];
  if (!c) return;
  const offer = c.offers.find((o) => o.offerId === offerId);
  if (!offer) return;
  c.selected = offer;
  c.status = "ACTIVE";
  if (offer.type === "KINGMAKER" && offer.hearingIndex !== null) {
    const h = s.court.hearings[offer.hearingIndex];
    if (h && h.judges.includes(pid) && h.judges.length >= 2 && h.analystId === null) {
      h.judges = h.judges.filter((j) => j !== pid);
      h.analystId = pid;
    } else {
      c.status = "FAILED"; // seat was no longer available; never grant an impossible contract
    }
  }
}

function resolveContract(ctx: Ctx, pid: string, success: boolean, why: string): void {
  const c = ctx.s.contracts[pid];
  if (!c || c.status !== "ACTIVE") return;
  c.status = success ? "COMPLETED" : "FAILED";
  if (success) {
    const seg = SEGMENT_OF[ctx.s.phase.name];
    addScore(
      ctx.s,
      {
        id: `contract:${pid}`, // one contract reward per player per match
        playerId: pid,
        type: "CONTRACT_SUCCESS",
        amount: POINTS.contract,
        segment: seg,
        label: `Contract complete: ${why}`,
        detail: { contract: c.selected?.type ?? "" },
      },
      ctx.now,
    );
    // Public event: never says whose contract it was.
    emit(ctx, "CONTRACT_RESOLVED", "A secret contract was completed");
    timeline(ctx, "CONTRACT", "A secret contract was just completed");
  }
}

/* ------------------------------------------------------------------ */
/* Scoring hooks                                                        */
/* ------------------------------------------------------------------ */

function scoreCalibration(ctx: Ctx): void {
  const { s, now } = ctx;
  const round = s.calibration.rounds[s.calibration.current]!;
  round.revealed = true;
  for (const [predictor, target] of Object.entries(round.targets)) {
    const op = round.opinions[target];
    const pred = round.predictions[predictor];
    if (op === undefined || pred === undefined) continue;
    const diff = Math.abs(op.value - pred);
    addScore(
      s,
      {
        id: `cal:${round.index}:${predictor}`,
        playerId: predictor,
        type: "OPINION_PREDICTION",
        amount: opinionPredictionPoints(diff),
        segment: "CALIBRATION",
        label: `Read ${nameOf(s, target)} (off by ${diff})`,
        detail: { round: round.index, target, difference: diff },
      },
      now,
    );
  }
  promoteVault(s, `cal:${round.index}`, "EVIDENCE_ELIGIBLE");
  emit(ctx, "SCORES_UPDATED", "Read the Room scored");
  timeline(ctx, "REVEAL", `Round ${round.index + 1} revealed`);
}

function tallyVerdict(
  votes: Record<string, string>,
  a: string,
  b: string,
  tiebreakSlot: "A" | "B",
): { winnerId: string; loserId: string; tiebreakUsed: boolean } {
  let va = 0;
  let vb = 0;
  for (const w of Object.values(votes)) {
    if (w === a) va++;
    else if (w === b) vb++;
  }
  if (va === vb) {
    const winnerId = tiebreakSlot === "A" ? a : b;
    return { winnerId, loserId: winnerId === a ? b : a, tiebreakUsed: true };
  }
  return va > vb ? { winnerId: a, loserId: b, tiebreakUsed: false } : { winnerId: b, loserId: a, tiebreakUsed: false };
}

export { tallyVerdict };

function scoreHearing(ctx: Ctx): void {
  const { s, now } = ctx;
  const h = s.court.hearings[s.court.current]!;
  const res = tallyVerdict(h.verdicts, h.debaterA, h.debaterB, h.tiebreakSlot);
  h.result = res;
  const k = `court:${h.index}`;
  addScore(s, { id: `${k}:win`, playerId: res.winnerId, type: "COURT_WIN", amount: POINTS.courtWin, segment: "COURT", label: `Won hearing ${h.index + 1}`, detail: { hearing: h.index, tiebreak: res.tiebreakUsed } }, now);
  addScore(s, { id: `${k}:loss`, playerId: res.loserId, type: "COURT_LOSS", amount: POINTS.courtLoss, segment: "COURT", label: `Argued hearing ${h.index + 1}`, detail: { hearing: h.index } }, now);
  for (const j of h.judges) {
    if (h.verdicts[j]) {
      addScore(s, { id: `${k}:verdict:${j}`, playerId: j, type: "JUDGE_VERDICT", amount: POINTS.judgeVerdict, segment: "COURT", label: `Judged hearing ${h.index + 1}`, detail: { hearing: h.index } }, now);
    }
  }
  // Prediction rewards are based on the target's independently locked stance — never on the verdict.
  for (const [j, target] of Object.entries(h.predictionTargets)) {
    const pred = h.predictions[j];
    const stance = h.stances[target];
    if (pred === undefined || stance === undefined) continue;
    const diff = Math.abs(pred - stance);
    addScore(s, { id: `${k}:predict:${j}`, playerId: j, type: "JUDGE_PREDICTION", amount: judgePredictionPoints(diff), segment: "COURT", label: `Read ${nameOf(s, target)}'s real stance (off by ${diff})`, detail: { hearing: h.index, target, difference: diff } }, now);
  }
  if (h.analystId) {
    const correct = h.analystCall === res.winnerId;
    if (h.analystCall) {
      addScore(s, { id: `${k}:analyst:${h.analystId}`, playerId: h.analystId, type: "ANALYST_CALL", amount: POINTS.analystCall, segment: "COURT", label: `Analysed hearing ${h.index + 1}`, detail: { hearing: h.index, correct } }, now);
    }
  }
  promoteVault(s, k, "EVIDENCE_ELIGIBLE");

  // Contracts designated to this hearing
  for (const [pid, c] of Object.entries(s.contracts)) {
    const o = c.selected;
    if (!o || c.status !== "ACTIVE" || o.hearingIndex !== h.index) continue;
    if (o.type === "MIND_LINK") {
      const pred = h.predictions[pid];
      const stance = o.targetPlayerId ? h.stances[o.targetPlayerId] : undefined;
      resolveContract(ctx, pid, pred !== undefined && stance !== undefined && Math.abs(pred - stance) <= 10, "Mind Link");
    } else if (o.type === "KINGMAKER") {
      resolveContract(ctx, pid, h.analystId === pid && h.analystCall === res.winnerId, "Kingmaker");
    } else if (o.type === "FACT_CHECKER") {
      const ok = h.receiptsResolved.some((r) => {
        const entry = s.vault.find((v) => v.id === r.entryId);
        return r.playerId === pid && !!entry && (entry.playerId === h.debaterA || entry.playerId === h.debaterB);
      });
      resolveContract(ctx, pid, ok, "Fact Checker");
    }
  }
  emit(ctx, "WINNER_REVEALED", `${nameOf(s, res.winnerId)} wins hearing ${h.index + 1}`, { winnerId: res.winnerId });
  timeline(ctx, "VERDICT", `${nameOf(s, res.winnerId)} wins hearing ${h.index + 1}${res.tiebreakUsed ? " (split bench, tiebreaker)" : ""}`);
  scoreSpectators(ctx, `court:${h.index}`, res.winnerId);
}

function scoreBluff(ctx: Ctx): void {
  const { s, now } = ctx;
  const t = s.bluff.turns[s.bluff.current]!;
  const k = `bluff:${t.index}`;
  let correctCount = 0;
  let votesCast = 0;
  for (const inv of t.investigators) {
    const guess = t.votes[inv];
    if (!guess) continue;
    votesCast++;
    if (guess === t.role) {
      correctCount++;
      addScore(s, { id: `${k}:inv:${inv}`, playerId: inv, type: "BLUFF_CORRECT", amount: POINTS.bluffCorrect, segment: "BLUFF", label: `Read ${nameOf(s, t.speakerId)}'s spotlight`, detail: { turn: t.index } }, now);
    }
  }
  let speakerPoints = 0;
  let escaped = false;
  if (t.role === "HONEST") {
    if (t.genuine !== null) {
      speakerPoints = POINTS.bluffHonestComplete;
      addScore(s, { id: `${k}:speaker`, playerId: t.speakerId, type: "BLUFF_SPEAKER_COMPLETE", amount: speakerPoints, segment: "BLUFF", label: "Told the truth", detail: { turn: t.index } }, now);
    }
  } else if (votesCast > 0 && correctCount === 0) {
    speakerPoints = POINTS.bluffEscape;
    escaped = true;
    addScore(s, { id: `${k}:speaker`, playerId: t.speakerId, type: "BLUFF_ESCAPE", amount: speakerPoints, segment: "BLUFF", label: "Bluffed everyone", detail: { turn: t.index } }, now);
  } else {
    speakerPoints = votesCast === 0 ? POINTS.bluffHonestComplete : POINTS.bluffCaught;
    addScore(s, { id: `${k}:speaker`, playerId: t.speakerId, type: votesCast === 0 ? "BLUFF_SPEAKER_COMPLETE" : "BLUFF_CAUGHT", amount: speakerPoints, segment: "BLUFF", label: votesCast === 0 ? "Bluffed to an empty room" : "Caught bluffing", detail: { turn: t.index } }, now);
  }
  t.result = { speakerPoints, escaped };
  promoteVault(s, k, "EVIDENCE_ELIGIBLE");
  for (const [pid, c] of Object.entries(s.contracts)) {
    const o = c.selected;
    if (!o || c.status !== "ACTIVE" || o.type !== "SKEPTIC" || o.bluffTurnIndex !== t.index) continue;
    resolveContract(ctx, pid, t.votes[pid] === t.role, "Skeptic");
  }
  emit(ctx, "WINNER_REVEALED", `${nameOf(s, t.speakerId)} was ${t.role === "HONEST" ? "honest" : "bluffing"}`, { role: t.role });
  timeline(ctx, "REVEAL", `${nameOf(s, t.speakerId)} was ${t.role === "HONEST" ? "telling the truth" : "bluffing"}`);
  scoreSpectators(ctx, k, t.role);
}

function setupFinale(ctx: Ctx): void {
  const { s } = ctx;
  const order = standingsOrder(s).filter((id) => !s.players.find((p) => p.id === id)?.removed);
  const [a, b, ...rest] = order;
  if (!a || !b) return;
  const seats: Record<string, FinaleSeat> = { [a]: "DEBATER", [b]: "DEBATER" };
  if (rest.length === 1) {
    seats[rest[0]!] = "LEAD_INVESTIGATOR";
  } else {
    // Alternate by standing so jurors and investigators are mixed fairly.
    rest.forEach((pid, i) => (seats[pid] = i % 2 === 0 ? "JUROR" : "INVESTIGATOR"));
  }
  const t = totals(s);
  const leader = Math.max(...Object.values(t));
  const multipliers: Record<string, number> = {};
  for (const pid of order) multipliers[pid] = seats[pid] === "DEBATER" ? 1 : underdogMultiplier(t[pid] ?? 0, leader);

  // Seat A/B randomly so the leader does not always open.
  const swap = coin(s);
  const debaterA = swap ? b : a;
  const debaterB = swap ? a : b;
  const predictionTargets: Record<string, string> = {};
  for (const pid of rest) if (seats[pid] === "LEAD_INVESTIGATOR") predictionTargets[pid] = coin(s) ? debaterA : debaterB;

  const f: FinaleState = {
    prompt: pickPrompt(s, "FINALE", s.config.randomMix),
    debaterA,
    debaterB,
    seats,
    multipliers,
    sideA: coin(s) ? "FOR" : "AGAINST",
    tiebreakSlot: coin(s) ? "A" : "B",
    stances: {},
    roles: {},
    predictionTargets,
    predictions: {},
    verdicts: {},
    winnerCalls: {},
    classifications: {},
    evidence: [],
    result: null,
  };
  s.finale = f;
  const boosted = Object.entries(multipliers).filter(([, m]) => m > 1).map(([pid]) => nameOf(s, pid));
  timeline(ctx, "PHASE", `Final Verdict: ${nameOf(s, a)} and ${nameOf(s, b)} take the floor`);
  if (boosted.length) timeline(ctx, "SYSTEM", `Underdog Stakes: ${boosted.join(", ")} play for 1.5x finale points`);
}

export function finaleSideOf(f: FinaleState, pid: string): Side {
  return pid === f.debaterA ? f.sideA : otherSide(f.sideA);
}

function deriveFinaleRoles(s: MatchState): void {
  const f = s.finale;
  if (!f) return;
  for (const d of [f.debaterA, f.debaterB]) {
    const stance = f.stances[d];
    const side = finaleSideOf(f, d);
    // Timeout rule: no locked stance -> treated as honest.
    if (stance === undefined) f.roles[d] = "HONEST";
    else f.roles[d] = (stance > 50) === (side === "FOR") ? "HONEST" : "BLUFF";
  }
}

export function finaleVerdictVoters(f: FinaleState): string[] {
  return Object.entries(f.seats)
    .filter(([, seat]) => seat === "LEAD_INVESTIGATOR" || seat === "JUROR")
    .map(([pid]) => pid);
}

export function finaleClassifyTargets(f: FinaleState, pid: string): string[] {
  const seat = f.seats[pid];
  if (!seat) return [];
  if (seat === "DEBATER") return [pid === f.debaterA ? f.debaterB : f.debaterA];
  return [f.debaterA, f.debaterB];
}

function scoreFinale(ctx: Ctx): void {
  const { s, now } = ctx;
  const f = s.finale;
  if (!f) return;
  const res = tallyVerdict(f.verdicts, f.debaterA, f.debaterB, f.tiebreakSlot);
  f.result = res;
  const m = (pid: string, base: number) => Math.round(base * (f.multipliers[pid] ?? 1));
  addScore(s, { id: "finale:win", playerId: res.winnerId, type: "FINALE_DEBATE", amount: POINTS.finaleWin, segment: "FINALE", label: "Won the Final Verdict", detail: { won: true, tiebreak: res.tiebreakUsed } }, now);
  addScore(s, { id: "finale:loss", playerId: res.loserId, type: "FINALE_DEBATE", amount: POINTS.finaleLoss, segment: "FINALE", label: "Argued the Final Verdict", detail: { won: false } }, now);

  for (const [pid, seat] of Object.entries(f.seats)) {
    const cls = f.classifications[pid] ?? {};
    for (const target of finaleClassifyTargets(f, pid)) {
      const guess = cls[target];
      if (!guess) continue;
      const correct = guess === f.roles[target];
      const base = seat === "DEBATER" ? POINTS.finaleDebaterClassify : POINTS.finaleInvestigatorClassify;
      addScore(s, { id: `finale:classify:${pid}:${target}`, playerId: pid, type: "FINALE_CLASSIFY", amount: correct ? m(pid, base) : 0, segment: "FINALE", label: `Called ${nameOf(s, target)}'s secret role`, detail: { target, correct } }, now);
    }
    if (seat === "LEAD_INVESTIGATOR") {
      const target = f.predictionTargets[pid];
      const pred = f.predictions[pid];
      const stance = target ? f.stances[target] : undefined;
      if (target && pred !== undefined && stance !== undefined) {
        const diff = Math.abs(pred - stance);
        addScore(s, { id: `finale:predict:${pid}`, playerId: pid, type: "FINALE_INVESTIGATION", amount: m(pid, finaleStancePredictionPoints(diff)), segment: "FINALE", label: `Read ${nameOf(s, target)}'s final stance (off by ${diff})`, detail: { kind: "prediction", target, difference: diff } }, now);
      }
    }
    if (seat === "JUROR" && f.verdicts[pid]) {
      addScore(s, { id: `finale:juror:${pid}`, playerId: pid, type: "FINALE_VERDICT", amount: m(pid, POINTS.finaleJurorVerdict), segment: "FINALE", label: "Served on the final jury", detail: {} }, now);
    }
    if (seat === "INVESTIGATOR" && f.winnerCalls[pid]) {
      const correct = f.winnerCalls[pid] === res.winnerId;
      addScore(s, { id: `finale:call:${pid}`, playerId: pid, type: "FINALE_INVESTIGATION", amount: correct ? m(pid, POINTS.finaleWinnerCall) : 0, segment: "FINALE", label: "Called the final winner", detail: { kind: "prediction", correct } }, now);
    }
  }
  promoteVault(s, "finale", "REVEALED");
  emit(ctx, "WINNER_REVEALED", `${nameOf(s, res.winnerId)} wins the Final Verdict`, { winnerId: res.winnerId });
  timeline(ctx, "VERDICT", `${nameOf(s, res.winnerId)} wins the Final Verdict`);
  scoreSpectators(ctx, "finale", res.winnerId);
}

function scoreSpectators(ctx: Ctx, unitKey: string, correctChoice: string): void {
  for (const sp of Object.values(ctx.s.spectators)) {
    if (sp.ballots[unitKey] === correctChoice) sp.points += 10;
  }
}

function finishMatch(ctx: Ctx): void {
  const { s } = ctx;
  for (const [pid, c] of Object.entries(s.contracts)) {
    if (c.status === "ACTIVE") resolveContract(ctx, pid, false, "");
  }
  s.chaos.pending = null;
  s.status = "COMPLETED";
  emit(ctx, "MATCH_COMPLETED", "The show is over");
  timeline(ctx, "SYSTEM", "Final standings are in");
}

/* ------------------------------------------------------------------ */
/* Completion checks                                                    */
/* ------------------------------------------------------------------ */

/** True when every player we are waiting on has acted, so the phase can end before its timer. */
export function isPhaseComplete(s: MatchState): boolean {
  const name = s.phase.name;
  const waiting = (ids: string[], done: (id: string) => boolean) => ids.filter((id) => isWaitingOn(s, id)).every(done);
  switch (name) {
    case "CALIBRATION_SUBMISSION": {
      const r = s.calibration.rounds[s.calibration.current]!;
      return waiting(activeIds(s), (id) => r.opinions[id] !== undefined);
    }
    case "CALIBRATION_PREDICTION": {
      const r = s.calibration.rounds[s.calibration.current]!;
      return waiting(Object.keys(r.targets), (id) => r.predictions[id] !== undefined);
    }
    case "CONTRACT_SELECTION":
      return waiting(Object.keys(s.contracts), (id) => s.contracts[id]!.selected !== null || s.contracts[id]!.offers.length === 0);
    case "COURT_PREPARATION": {
      const h = currentHearing(s)!;
      return waiting([h.debaterA, h.debaterB], (id) => h.stances[id] !== undefined) && waiting(Object.keys(h.predictionTargets), (id) => h.predictions[id] !== undefined);
    }
    case "COURT_VOTING": {
      const h = currentHearing(s)!;
      return waiting(h.judges, (id) => h.verdicts[id] !== undefined) && (!h.analystId || !isWaitingOn(s, h.analystId) || h.analystCall !== null);
    }
    case "BLUFF_PREPARATION": {
      const t = currentTurn(s)!;
      return waiting([t.speakerId], () => t.genuine !== null);
    }
    case "BLUFF_VOTING": {
      const t = currentTurn(s)!;
      return waiting(t.investigators, (id) => t.votes[id] !== undefined);
    }
    case "FINALE_PREPARATION": {
      const f = s.finale!;
      return waiting([f.debaterA, f.debaterB], (id) => f.stances[id] !== undefined) && waiting(Object.keys(f.predictionTargets), (id) => f.predictions[id] !== undefined);
    }
    case "FINALE_VOTING": {
      const f = s.finale!;
      return waiting(Object.keys(f.seats), (id) => finaleBallotComplete(f, id));
    }
    default:
      return false;
  }
}

export function finaleBallotComplete(f: FinaleState, id: string): boolean {
  const seat = f.seats[id];
  if (!seat) return true;
  const cls = f.classifications[id] ?? {};
  if (!finaleClassifyTargets(f, id).every((t) => cls[t] !== undefined)) return false;
  if ((seat === "JUROR" || seat === "LEAD_INVESTIGATOR") && !f.verdicts[id]) return false;
  if (seat === "INVESTIGATOR" && !f.winnerCalls[id]) return false;
  return true;
}
