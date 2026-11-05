import type {
  BluffView,
  CalibrationView,
  ContractView,
  CourtView,
  FinaleView,
  HostGameState,
  PhaseName,
  PlayerGameState,
  PlayerPrivateState,
  ProgressView,
  PublicGameState,
  ResultsView,
  Segment,
  Side,
  SpectatorGameState,
  VaultEntryView,
} from "@hps/shared";
import { CARD_INFO, crossExamTargets, playableCards, receiptTargets } from "./chaos";
import { legalActions } from "./engine";
import { finaleBallotComplete, finaleClassifyTargets, finaleSideOf, finaleVerdictVoters, HOST_ADVANCEABLE, phaseLabel, SKIPPABLE_PHASES } from "./phases";
import { computeClaim, CONTRACT_TEXT, describeContract, otherSide } from "./schedule";
import { computeStandings, totals } from "./scoring";
import type { ContractOffer, ContractState, Hearing, MatchState, VaultEntry } from "./types";
import { currentHearing, currentTurn, currentUnit, nameOf, promptView, SEGMENT_OF, speakerFor } from "./util";

const PHASE_ORDER: PhaseName[] = [
  "COURT_PREPARATION",
  "COURT_OPENING",
  "COURT_REBUTTAL",
  "COURT_CHALLENGE",
  "COURT_CLOSING",
  "COURT_VOTING",
  "COURT_REVEAL",
];

function vaultView(v: VaultEntry): VaultEntryView {
  return {
    id: v.id,
    playerId: v.playerId,
    promptQuestion: v.promptSnapshot,
    leftLabel: v.leftLabel,
    rightLabel: v.rightLabel,
    value: v.value,
    sourceLabel: v.sourceLabel,
    visibility: v.visibility,
  };
}

function evidenceViews(s: MatchState, ids: string[]): VaultEntryView[] {
  return ids.map((id) => s.vault.find((v) => v.id === id)).filter((v): v is VaultEntry => !!v).map(vaultView);
}

function hearingSides(h: Hearing): { A: Side; B: Side } {
  const a = h.swapped ? otherSide(h.sideA) : h.sideA;
  return { A: a, B: otherSide(a) };
}

function progress(s: MatchState): ProgressView {
  const cur = SEGMENT_OF[s.phase.name];
  const order: Segment[] = ["CALIBRATION", "CONTRACTS", "COURT", "BLUFF", "FINALE", "RESULTS"];
  const enabled: Record<Segment, boolean> = {
    CALIBRATION: s.config.segments.calibration,
    CONTRACTS: s.config.segments.contracts && s.config.contractsEnabled,
    COURT: s.court.hearings.length > 0,
    BLUFF: s.bluff.turns.length > 0,
    FINALE: s.config.segments.finale,
    RESULTS: true,
  };
  const labels: Record<Segment, string> = {
    CALIBRATION: "Read the Room",
    CONTRACTS: "Contracts",
    COURT: "Devil's Court",
    BLUFF: "Catch the Bluff",
    FINALE: "Final Verdict",
    RESULTS: "Results",
  };
  const detail = (seg: Segment): string => {
    switch (seg) {
      case "CALIBRATION": return `${Math.min(s.calibration.current + 1, s.config.calibrationRounds)} of ${s.config.calibrationRounds}`;
      case "COURT": return `${Math.min(s.court.current + 1, s.court.hearings.length)} of ${s.court.hearings.length}`;
      case "BLUFF": return `${Math.min(s.bluff.current + 1, s.bluff.turns.length)} of ${s.bluff.turns.length}`;
      default: return "";
    }
  };
  const curIdx = order.indexOf(cur);
  return {
    segments: order
      .filter((seg) => enabled[seg])
      .map((seg) => ({
        key: seg,
        label: labels[seg],
        status: order.indexOf(seg) < curIdx || s.status === "COMPLETED" ? "done" : seg === cur ? "current" : "upcoming",
        detail: detail(seg),
      })),
  };
}

function calibrationView(s: MatchState): CalibrationView | null {
  if (SEGMENT_OF[s.phase.name] !== "CALIBRATION") return null;
  const r = s.calibration.rounds[s.calibration.current];
  if (!r) return null;
  const revealed = r.revealed;
  let distribution: number[] | null = null;
  if (revealed) {
    distribution = new Array(11).fill(0);
    for (const o of Object.values(r.opinions)) distribution[Math.min(10, Math.floor(o.value / 10))]!++;
  }
  return {
    round: r.index + 1,
    totalRounds: s.config.calibrationRounds,
    prompt: promptView(r.prompt),
    targets: Object.entries(r.targets).map(([predictorId, targetId]) => ({ predictorId, targetId })),
    opinionsLocked: Object.keys(r.opinions),
    predictionsLocked: Object.keys(r.predictions),
    reveal: revealed
      ? Object.entries(r.targets).map(([predictorId, targetId]) => {
          const op = r.opinions[targetId]?.value ?? null;
          const pr = r.predictions[predictorId] ?? null;
          const ev = s.scoreEvents.find((e) => e.id === `cal:${r.index}:${predictorId}`);
          return {
            playerId: targetId,
            opinion: op,
            predictorId,
            prediction: pr,
            difference: op !== null && pr !== null ? Math.abs(op - pr) : null,
            points: ev?.amount ?? 0,
          };
        })
      : null,
    distribution,
  };
}

function tally(s: MatchState, unitKey: string, a: string, b: string): { A: number; B: number } {
  let A = 0;
  let B = 0;
  for (const sp of Object.values(s.spectators)) {
    if (sp.ballots[unitKey] === a) A++;
    else if (sp.ballots[unitKey] === b) B++;
  }
  return { A, B };
}

function courtView(s: MatchState): CourtView | null {
  const h = currentHearing(s);
  if (!h) return null;
  const idx = PHASE_ORDER.indexOf(s.phase.name);
  const sidesPublic = idx >= PHASE_ORDER.indexOf("COURT_OPENING");
  const res = h.result;
  return {
    hearingIndex: h.index,
    totalHearings: s.court.hearings.length,
    prompt: h.prompt ? promptView(h.prompt) : null,
    debaterA: h.debaterA,
    debaterB: h.debaterB,
    sides: sidesPublic ? hearingSides(h) : null,
    sidesSwapped: h.swapped,
    judges: h.judges,
    analystId: h.analystId,
    stancesLocked: Object.keys(h.stances),
    predictionsLocked: Object.keys(h.predictions),
    votesIn: Object.keys(h.verdicts).length + (h.analystCall ? 1 : 0),
    votesNeeded: h.judges.length + (h.analystId ? 1 : 0),
    evidence: evidenceViews(s, h.evidence),
    // Audience tallies are advisory and only shown once the bench has voted, so they cannot sway it.
    spectatorTally: res && s.config.audienceEnabled ? tally(s, `court:${h.index}`, h.debaterA, h.debaterB) : null,
    reveal: res
      ? {
          winnerId: res.winnerId,
          tiebreakUsed: res.tiebreakUsed,
          verdicts: h.judges.map((j) => ({ judgeId: j, winnerId: h.verdicts[j] ?? null })),
          stances: [h.debaterA, h.debaterB].map((p) => ({ playerId: p, value: h.stances[p] ?? null })),
          predictions: Object.entries(h.predictionTargets).map(([j, target]) => ({
            judgeId: j,
            targetId: target,
            value: h.predictions[j] ?? null,
            points: s.scoreEvents.find((e) => e.id === `court:${h.index}:predict:${j}`)?.amount ?? 0,
          })),
          analystCall: h.analystId ? { analystId: h.analystId, pickedId: h.analystCall, correct: h.analystCall === res.winnerId } : null,
        }
      : null,
  };
}

function bluffView(s: MatchState): BluffView | null {
  const t = currentTurn(s);
  if (!t) return null;
  const claimPublic = s.phase.name !== "BLUFF_PREPARATION";
  return {
    turnIndex: t.index,
    totalTurns: s.bluff.turns.length,
    speakerId: t.speakerId,
    investigators: t.investigators,
    prompt: t.prompt ? promptView(t.prompt) : null,
    claim: claimPublic ? t.claim : null,
    speakerLocked: t.genuine !== null,
    votesIn: Object.keys(t.votes).length,
    votesNeeded: t.investigators.length,
    evidence: evidenceViews(s, t.evidence),
    spectatorTally: t.result && s.config.audienceEnabled ? (() => {
      const x = tally(s, `bluff:${t.index}`, "HONEST", "BLUFF");
      return { HONEST: x.A, BLUFF: x.B };
    })() : null,
    reveal: t.result
      ? {
          role: t.role,
          genuine: t.genuine,
          claimed: t.claim ?? 0,
          votes: t.investigators.map((i) => ({ playerId: i, guess: t.votes[i] ?? null, correct: t.votes[i] === t.role })),
          speakerPoints: t.result.speakerPoints,
        }
      : null,
  };
}

function finaleView(s: MatchState): FinaleView | null {
  const f = s.finale;
  if (!f || SEGMENT_OF[s.phase.name] !== "FINALE") return null;
  const sidesPublic = s.phase.name !== "FINALE_PREPARATION";
  const res = f.result;
  const sideA = f.sideA;
  return {
    prompt: f.prompt ? promptView(f.prompt) : null,
    debaterA: f.debaterA,
    debaterB: f.debaterB,
    seats: Object.entries(f.seats).map(([playerId, seat]) => ({ playerId, seat, multiplier: f.multipliers[playerId] ?? 1 })),
    sides: sidesPublic ? { A: sideA, B: otherSide(sideA) } : null,
    stancesLocked: Object.keys(f.stances),
    predictionsLocked: Object.keys(f.predictions),
    ballotsIn: Object.keys(f.seats).filter((id) => finaleBallotComplete(f, id)).length,
    ballotsNeeded: Object.keys(f.seats).length,
    evidence: evidenceViews(s, f.evidence),
    spectatorTally: res && s.config.audienceEnabled ? tally(s, "finale", f.debaterA, f.debaterB) : null,
    reveal: res
      ? {
          winnerId: res.winnerId,
          tiebreakUsed: res.tiebreakUsed,
          roles: [f.debaterA, f.debaterB].map((p) => ({ playerId: p, role: f.roles[p] ?? "HONEST", stance: f.stances[p] ?? null, side: finaleSideOf(f, p) })),
          verdicts: finaleVerdictVoters(f).map((p) => ({ playerId: p, winnerId: f.verdicts[p] ?? null })),
          classifications: Object.entries(f.classifications).flatMap(([pid, m]) =>
            Object.entries(m).map(([targetId, guess]) => ({ playerId: pid, targetId, guess, correct: guess === f.roles[targetId] })),
          ),
          predictions: Object.entries(f.predictionTargets).map(([pid, targetId]) => ({
            playerId: pid,
            targetId,
            value: f.predictions[pid] ?? null,
            points: s.scoreEvents.find((e) => e.id === `finale:predict:${pid}`)?.amount ?? 0,
          })),
          winnerCalls: Object.entries(f.winnerCalls).map(([pid, pick]) => ({ playerId: pid, pickedId: pick, correct: pick === res.winnerId })),
        }
      : null,
  };
}

function contractView(s: MatchState, o: ContractOffer, status: ContractState["status"]): ContractView {
  return {
    type: o.type,
    title: CONTRACT_TEXT[o.type].title,
    description: describeContract(s, o, (id) => nameOf(s, id)),
    targetPlayerId: o.targetPlayerId,
    status,
    reward: CONTRACT_TEXT[o.type].reward,
  };
}

function resultsView(s: MatchState): ResultsView | null {
  if (s.phase.name !== "RESULTS") return null;
  const standings = computeStandings(s);
  const winners = standings.filter((r) => r.rank === 1).map((r) => r.playerId);
  const awards: ResultsView["awards"] = [];
  const best = (fn: (pid: string) => number, title: string, reason: (n: number) => string) => {
    let top: { pid: string; n: number } | null = null;
    for (const r of standings) {
      const n = fn(r.playerId);
      if (n > 0 && (!top || n > top.n)) top = { pid: r.playerId, n };
    }
    if (top) awards.push({ title, playerId: top.pid, reason: reason(top.n) });
  };
  const sum = (pid: string, type: string) => s.scoreEvents.filter((e) => e.playerId === pid && e.type === type).reduce((a, e) => a + e.amount, 0);
  const count = (pid: string, type: string) => s.scoreEvents.filter((e) => e.playerId === pid && e.type === type && e.amount > 0).length;
  best((p) => sum(p, "OPINION_PREDICTION"), "Mind Reader", (n) => `${n} VP from reading the room`);
  best((p) => count(p, "COURT_WIN"), "Silver Tongue", (n) => `${n} courtroom ${n === 1 ? "win" : "wins"}`);
  best((p) => count(p, "BLUFF_ESCAPE"), "Poker Face", (n) => `Fooled everyone ${n === 1 ? "once" : `${n} times`}`);
  best((p) => count(p, "BLUFF_CORRECT"), "Lie Detector", (n) => `${n} spotlight ${n === 1 ? "read" : "reads"} correct`);
  best((p) => s.chaos.history.filter((h) => h.playedBy === p && h.outcome !== "OUTPRIORITIZED").length, "Agent of Chaos", (n) => `${n} ${n === 1 ? "card" : "cards"} played`);
  return {
    winners,
    standings,
    contracts: s.players.map((p) => {
      const c = s.contracts[p.id];
      return { playerId: p.id, contract: c?.selected ? contractView(s, c.selected, c.status) : null };
    }),
    awards,
    spectatorLeaders: Object.values(s.spectators)
      .filter((x) => x.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5)
      .map((x) => ({ name: x.name, points: x.points })),
  };
}

/** Public state: safe for the broadcast overlay, spectators and as the base of every other projection. */
export function getPublicGameState(s: MatchState, now: number): PublicGameState {
  const t = totals(s);
  const pending = s.chaos.pending;
  const completed = s.phase.name === "RESULTS";
  const unit = currentUnit(s);
  return {
    matchId: s.matchId,
    version: s.version,
    status: s.status,
    serverNow: now,
    phase: {
      name: s.phase.name,
      segment: SEGMENT_OF[s.phase.name],
      label: phaseLabel(s),
      speakerId: speakerFor(s),
      enteredAt: s.phase.enteredAt,
      deadline: s.phase.deadline,
      paused: s.status === "PAUSED",
      pausedRemainingMs: s.phase.pausedRemainingMs,
    },
    progress: progress(s),
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      seat: p.seat,
      connected: p.connected,
      removed: p.removed,
      score: t[p.id] ?? 0,
      charges: s.chaos.charges[p.id] ?? 0,
    })),
    calibration: calibrationView(s),
    court: courtView(s),
    bluff: bluffView(s),
    finale: finaleView(s),
    pendingCard: pending
      ? {
          id: pending.playId,
          card: pending.card,
          playedBy: pending.playedBy,
          // During collection the card identity is shown only once it wins priority.
          targetLabel:
            pending.stage === "COLLECTING"
              ? null
              : pending.card === "RECEIPTS"
                ? `a previous statement from ${nameOf(s, s.vault.find((v) => v.id === pending.targetEntryId)?.playerId)}`
                : pending.card === "CROSS_EXAMINATION"
                  ? nameOf(s, pending.targetPlayerId)
                  : null,
          stage: pending.stage,
          resolvesAt: s.status === "PAUSED" ? now + pending.resolvesAt : pending.resolvesAt,
        }
      : null,
    cardHistory: s.chaos.history.slice(-20).map((h) => ({
      id: h.id,
      card: h.card,
      playedBy: h.playedBy,
      outcome: h.outcome,
      cancelledBy: h.cancelledBy,
      unitLabel: h.unitLabel,
      at: h.at,
      summary: h.summary || CARD_INFO[h.card].title,
    })),
    timeline: s.timeline.slice(-30),
    // Contract rewards stay anonymous until the results screen reveals every contract.
    scoreLines: s.scoreEvents.map((e) => ({
      id: e.id,
      playerId: e.playerId,
      type: e.type,
      amount: e.amount,
      segment: e.segment,
      label: e.type === "CONTRACT_SUCCESS" && !completed ? "Secret contract" : e.label,
    })),
    contractsActive: Object.values(s.contracts).filter((c) => c.status === "ACTIVE").length,
    results: resultsView(s),
    chaosEnabled: s.config.chaosEnabled,
    contractsEnabled: s.config.contractsEnabled,
    evidencePoolSize: unit ? s.vault.filter((v) => v.visibility === "EVIDENCE_ELIGIBLE" && unit.spotlight.includes(v.playerId)).length : 0,
  };
}

function hintFor(s: MatchState, pid: string, legal: string[]): string | null {
  if (s.status === "PAUSED") return "The host paused the game.";
  if (s.status === "COMPLETED") return null;
  if (legal.some((l) => l !== "PLAY_CARD" && l !== "REQUEST_SKIP" && l !== "YIELD_FLOOR")) return null;
  const name = s.phase.name;
  const h = currentHearing(s);
  const t = currentTurn(s);
  switch (name) {
    case "CALIBRATION_PROMPT": return "Read the question. Answers open in a moment.";
    case "CALIBRATION_SUBMISSION":
    case "CALIBRATION_PREDICTION": return "Locked in. Waiting for everyone else.";
    case "CALIBRATION_DISCUSSION": return "All answers are locked. Talk it out — nothing can change now.";
    case "CONTRACT_SELECTION": return "Contract chosen. Waiting for the others.";
    case "COURT_PREPARATION": return h && (h.debaterA === pid || h.debaterB === pid) ? "Stance locked. Plan your argument for your assigned side." : "Prediction sealed. The debate starts shortly.";
    case "COURT_OPENING":
    case "COURT_REBUTTAL":
    case "COURT_CLOSING": return speakerFor(s) === pid ? null : `${nameOf(s, speakerFor(s))} has the floor.`;
    case "COURT_CHALLENGE": return "Challenge window: question the debaters out loud, or play a card.";
    case "COURT_VOTING": return h && (h.debaterA === pid || h.debaterB === pid) ? "The bench is deciding." : "Ballot in. Waiting for the bench.";
    case "BLUFF_PREPARATION": return t?.speakerId === pid ? null : `${nameOf(s, t?.speakerId)} is getting their secret instruction.`;
    case "BLUFF_STATEMENT": return t?.speakerId === pid ? null : "Listen closely. Questions come next.";
    case "BLUFF_DISCUSSION": return t?.speakerId === pid ? "Hold your story together." : "Ask questions out loud. Bring receipts if you have them.";
    case "BLUFF_VOTING": return t?.speakerId === pid ? "The investigators are deciding." : "Vote in. Waiting for the others.";
    case "FINALE_PREPARATION": return "Locked. The finale starts when everyone is ready.";
    case "FINALE_DEBATE": return `${nameOf(s, speakerFor(s))} has the floor.`;
    case "FINALE_INVESTIGATION": return "Question the finalists. Evidence and cross-examination are open.";
    case "FINALE_VOTING": return "Ballot complete. Waiting for the others.";
    default: return null;
  }
}

function privateState(s: MatchState, pid: string, now: number): PlayerPrivateState {
  const legal = legalActions(s, pid);
  const name = s.phase.name;
  const seg = SEGMENT_OF[name];
  const r = seg === "CALIBRATION" ? s.calibration.rounds[s.calibration.current] : undefined;
  const h = currentHearing(s);
  const t = currentTurn(s);
  const f = seg === "FINALE" ? s.finale : null;
  const c = s.contracts[pid];
  const unit = currentUnit(s);
  void now;

  let court: PlayerPrivateState["court"] = null;
  if (h) {
    const isDebater = pid === h.debaterA || pid === h.debaterB;
    const slot = pid === h.debaterA ? "A" : pid === h.debaterB ? "B" : null;
    const locked = h.stances[pid] !== undefined;
    const sides = hearingSides(h);
    court = {
      role: isDebater ? "DEBATER" : h.analystId === pid ? "ANALYST" : "JUDGE",
      slot,
      // A debater learns their side only after locking their real stance, so the stance stays honest.
      mySide: slot && (locked || name !== "COURT_PREPARATION") ? sides[slot] : null,
      myStance: h.stances[pid] ?? null,
      predictionTargetId: h.predictionTargets[pid] ?? null,
      myPrediction: h.predictions[pid] ?? null,
      myVerdict: h.verdicts[pid] ?? null,
      myCall: h.analystId === pid ? h.analystCall : null,
    };
  }

  let bluff: PlayerPrivateState["bluff"] = null;
  if (t) {
    const isSpeaker = t.speakerId === pid;
    bluff = {
      role: isSpeaker ? "SPEAKER" : "INVESTIGATOR",
      myGenuine: isSpeaker ? t.genuine : null,
      instruction:
        isSpeaker && (t.genuine !== null || name !== "BLUFF_PREPARATION")
          ? { role: t.role, claim: t.claim ?? (t.genuine !== null ? previewClaim(s, t.index) : 0) }
          : null,
      myVote: t.votes[pid] ?? null,
    };
  }

  let finale: PlayerPrivateState["finale"] = null;
  if (f) {
    const seat = f.seats[pid];
    if (seat) {
      const slot = pid === f.debaterA ? "A" : pid === f.debaterB ? "B" : null;
      const locked = f.stances[pid] !== undefined;
      const side = slot ? finaleSideOf(f, pid) : null;
      const role = slot && locked ? ((f.stances[pid]! > 50) === (side === "FOR") ? "HONEST" : "BLUFF") : null;
      finale = {
        seat,
        slot,
        myStance: f.stances[pid] ?? null,
        myRole: role,
        mySide: slot && (locked || name !== "FINALE_PREPARATION") ? side : null,
        predictionTargetId: f.predictionTargets[pid] ?? null,
        myPrediction: f.predictions[pid] ?? null,
        myVerdict: f.verdicts[pid] ?? null,
        myWinnerCall: f.winnerCalls[pid] ?? null,
        myClassifications: Object.entries(f.classifications[pid] ?? {}).map(([targetId, guess]) => ({ targetId, guess })),
        classifyTargets: finaleClassifyTargets(f, pid),
      };
    }
  }

  return {
    playerId: pid,
    isHost: s.hostId === pid,
    legal,
    hint: hintFor(s, pid, legal),
    calibration: r
      ? {
          myOpinion: r.opinions[pid]?.value ?? null,
          keptPrivate: r.opinions[pid]?.keepPrivate ?? false,
          targetId: r.targets[pid] ?? null,
          myPrediction: r.predictions[pid] ?? null,
        }
      : null,
    contractOffers: name === "CONTRACT_SELECTION" && c && !c.selected ? c.offers.map((o) => ({ ...contractView(s, o, "OFFERED"), offerId: o.offerId })) : null,
    contract: c?.selected ? contractView(s, c.selected, c.status) : null,
    court,
    bluff,
    finale,
    charges: s.chaos.charges[pid] ?? 0,
    cardPlayedThisUnit: unit ? (s.chaos.playedInUnit[unit.key] ?? []).includes(pid) : false,
    playableCards: playableCards(s, pid),
    receiptTargets: receiptTargets(s, pid).map(vaultView),
    crossExamTargets: crossExamTargets(s, pid),
    myVault: s.vault.filter((v) => v.playerId === pid).map(vaultView),
    skipRequestsLeft: Math.max(0, s.config.maxSkipRequestsPerPlayer - (s.skipRequests[pid] ?? 0)),
  };
}

/** The claim a bluff speaker will have to make, shown to them as soon as they lock. */
function previewClaim(s: MatchState, turnIndex: number): number {
  const t = s.bluff.turns[turnIndex]!;
  if (t.genuine === null) return 0;
  return computeClaimFor(s, t);
}

function computeClaimFor(s: MatchState, t: MatchState["bluff"]["turns"][number]): number {
  return computeClaim(t, t.genuine ?? 50, s.config.minBluffDistance);
}

export function getPlayerGameState(s: MatchState, pid: string, now: number): PlayerGameState {
  return { ...getPublicGameState(s, now), me: privateState(s, pid, now) };
}

export function getHostGameState(s: MatchState, pid: string, now: number): HostGameState {
  const base = getPlayerGameState(s, pid, now);
  return {
    ...base,
    host: {
      canPause: s.status === "IN_GAME",
      canResume: s.status === "PAUSED",
      canSkipPrompt: s.status === "IN_GAME" && SKIPPABLE_PHASES.includes(s.phase.name),
      canAdvance: s.status === "IN_GAME" && HOST_ADVANCEABLE.includes(s.phase.name) && !s.chaos.pending,
      canEnd: s.status !== "COMPLETED",
    },
  };
}

export function getSpectatorGameState(s: MatchState, spectatorId: string, name: string, now: number): SpectatorGameState {
  const base = getPublicGameState(s, now);
  const rec = s.spectators[spectatorId];
  let voteKind: SpectatorGameState["spectator"]["voteKind"] = null;
  let unitKey: string | null = null;
  if (s.phase.name === "COURT_VOTING") {
    voteKind = "COURT";
    unitKey = `court:${s.court.current}`;
  } else if (s.phase.name === "BLUFF_VOTING") {
    voteKind = "BLUFF";
    unitKey = `bluff:${s.bluff.current}`;
  } else if (s.phase.name === "FINALE_VOTING") {
    voteKind = "FINALE";
    unitKey = "finale";
  }
  return {
    ...base,
    spectator: {
      id: spectatorId,
      name,
      points: rec?.points ?? 0,
      ballot: unitKey ? (rec?.ballots[unitKey] ?? null) : null,
      canVote: s.config.audienceEnabled && s.status === "IN_GAME" && voteKind !== null,
      voteKind,
    },
  };
}
