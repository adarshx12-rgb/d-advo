import type { ChaosCardType } from "@hps/shared";
import { secondsToMs } from "./config";
import { otherSide } from "./schedule";
import { EngineError, type MatchState, type PendingCompetitor, type VaultEntry } from "./types";
import { currentHearing, currentTurn, currentUnit, emit, nameOf, timeline, type Ctx } from "./util";

/** Server-defined priority for offensive cards played inside the same collection window. */
export const CARD_PRIORITY: Record<ChaosCardType, number> = {
  RECEIPTS: 3,
  CROSS_EXAMINATION: 2,
  SWITCH_SIDES: 1,
  OBJECTION: 0,
};

export const CARD_INFO: Record<ChaosCardType, { title: string; timing: string; effect: string }> = {
  SWITCH_SIDES: { title: "Switch Sides", timing: "During rebuttals", effect: "The debaters swap assigned sides for the rest of the hearing." },
  RECEIPTS: { title: "Receipts", timing: "Challenge / questioning window", effect: "Bring back one Previous Statement from someone in the spotlight." },
  OBJECTION: { title: "Objection", timing: "While a card is pending", effect: "Cancel the pending card. Cannot itself be countered." },
  CROSS_EXAMINATION: { title: "Cross-Examination", timing: "Challenge / questioning window", effect: "Ask one extra question; adds a short response timer." },
};

const EVIDENCE_PHASES = ["COURT_CHALLENGE", "BLUFF_DISCUSSION", "FINALE_INVESTIGATION"] as const;

export function cardWindowOpen(s: MatchState, card: ChaosCardType): boolean {
  if (!s.config.chaosEnabled || s.status !== "IN_GAME") return false;
  const name = s.phase.name;
  switch (card) {
    case "SWITCH_SIDES": {
      const h = currentHearing(s);
      return name === "COURT_REBUTTAL" && !!h && !h.swapped;
    }
    case "RECEIPTS":
    case "CROSS_EXAMINATION":
      return (EVIDENCE_PHASES as readonly string[]).includes(name);
    case "OBJECTION":
      return s.chaos.pending?.stage === "REACTION";
  }
}

function unitEvidence(s: MatchState): string[] | null {
  const h = currentHearing(s);
  if (h) return h.evidence;
  const t = currentTurn(s);
  if (t) return t.evidence;
  if (s.finale && s.phase.name.startsWith("FINALE")) return s.finale.evidence;
  return null;
}

export function receiptTargets(s: MatchState, pid: string): VaultEntry[] {
  const unit = currentUnit(s);
  const shown = unitEvidence(s) ?? [];
  if (!unit) return [];
  return s.vault.filter(
    (v) =>
      v.visibility === "EVIDENCE_ELIGIBLE" &&
      v.revealEligible &&
      v.playerId !== pid &&
      unit.spotlight.includes(v.playerId) &&
      !shown.includes(v.id),
  );
}

export function crossExamTargets(s: MatchState, pid: string): string[] {
  const unit = currentUnit(s);
  if (!unit) return [];
  return unit.spotlight.filter((id) => id !== pid);
}

function hasPlayedInUnit(s: MatchState, pid: string, unitKey: string): boolean {
  return (s.chaos.playedInUnit[unitKey] ?? []).includes(pid);
}

export function playableCards(s: MatchState, pid: string): ChaosCardType[] {
  const p = s.players.find((x) => x.id === pid);
  const unit = currentUnit(s);
  if (!p || p.removed || !unit || !s.config.chaosEnabled || s.status !== "IN_GAME") return [];
  if ((s.chaos.charges[pid] ?? 0) < 1 || hasPlayedInUnit(s, pid, unit.key)) return [];
  const pending = s.chaos.pending;
  const out: ChaosCardType[] = [];
  if (pending?.stage === "REACTION" && pending.playedBy !== pid) out.push("OBJECTION");
  const canCompete =
    !pending || (pending.stage === "COLLECTING" && pending.playedBy !== pid && !pending.competitors.some((c) => c.playedBy === pid));
  if (canCompete) {
    if (cardWindowOpen(s, "SWITCH_SIDES")) out.push("SWITCH_SIDES");
    if (cardWindowOpen(s, "RECEIPTS") && receiptTargets(s, pid).length > 0) out.push("RECEIPTS");
    if (cardWindowOpen(s, "CROSS_EXAMINATION") && crossExamTargets(s, pid).length > 0) out.push("CROSS_EXAMINATION");
  }
  return out;
}

export function playCard(
  ctx: Ctx,
  pid: string,
  playId: string,
  input: { card: ChaosCardType; targetEntryId?: string | undefined; targetPlayerId?: string | undefined },
): void {
  const { s, now } = ctx;
  if (!s.config.chaosEnabled) throw new EngineError("CHAOS_DISABLED", "Chaos Cards are off in this room.");
  const unit = currentUnit(s);
  if (!unit) throw new EngineError("NO_WINDOW", "Cards can only be played during a hearing, spotlight turn or the finale.");
  if ((s.chaos.charges[pid] ?? 0) < 1) throw new EngineError("NO_CHARGES", "You have no Influence charges left.");
  if (hasPlayedInUnit(s, pid, unit.key)) throw new EngineError("ONE_PER_UNIT", `You already used a card in ${unit.label}.`);

  const pending = s.chaos.pending;
  if (input.card === "OBJECTION") {
    if (!pending || pending.stage !== "REACTION") throw new EngineError("NOTHING_TO_OBJECT", "There is no pending card to object to.");
    if (pending.playedBy === pid) throw new EngineError("OWN_CARD", "You cannot object to your own card.");
    s.chaos.charges[pid] = (s.chaos.charges[pid] ?? 0) - 1;
    (s.chaos.playedInUnit[unit.key] ??= []).push(pid);
    s.counter++;
    s.chaos.history.push({
      id: pending.playId,
      card: pending.card,
      playedBy: pending.playedBy,
      unitKey: pending.unitKey,
      unitLabel: unit.label,
      outcome: "CANCELLED",
      cancelledBy: pid,
      at: now,
      summary: `${nameOf(s, pending.playedBy)}'s ${pending.card.replace("_", " ").toLowerCase()} was overruled`,
    });
    s.chaos.history.push({
      id: playId,
      card: "OBJECTION",
      playedBy: pid,
      unitKey: unit.key,
      unitLabel: unit.label,
      outcome: "RESOLVED",
      cancelledBy: null,
      at: now,
      summary: `${nameOf(s, pid)} objected`,
    });
    s.chaos.pending = null;
    emit(ctx, "CARD_CANCELLED", `Objection! ${nameOf(s, pid)} cancels ${nameOf(s, pending.playedBy)}'s card`, { card: pending.card, by: pid });
    timeline(ctx, "CARD", `${nameOf(s, pid)} objected — ${nameOf(s, pending.playedBy)}'s card is cancelled`);
    return;
  }

  if (!cardWindowOpen(s, input.card)) throw new EngineError("WINDOW_CLOSED", `${CARD_INFO[input.card].title} can only be played ${CARD_INFO[input.card].timing.toLowerCase()}.`);
  if (input.card === "RECEIPTS") {
    if (!input.targetEntryId || !receiptTargets(s, pid).some((v) => v.id === input.targetEntryId)) {
      throw new EngineError("BAD_TARGET", "That statement is not eligible as evidence right now.");
    }
  }
  if (input.card === "CROSS_EXAMINATION") {
    if (!input.targetPlayerId || !crossExamTargets(s, pid).includes(input.targetPlayerId)) {
      throw new EngineError("BAD_TARGET", "You can only cross-examine someone in the spotlight.");
    }
  }

  const play: PendingCompetitor = {
    playId,
    card: input.card,
    playedBy: pid,
    targetEntryId: input.targetEntryId ?? null,
    targetPlayerId: input.targetPlayerId ?? null,
    receivedAt: now,
  };
  if (pending) {
    const canCompete =
      pending.stage === "COLLECTING" &&
      pending.unitKey === unit.key &&
      pending.playedBy !== pid &&
      !pending.competitors.some((c) => c.playedBy === pid);
    if (!canCompete) throw new EngineError("CARD_PENDING", "Another card is resolving. Wait for it to finish.");
    pending.competitors.push(play);
    return;
  }
  s.chaos.pending = {
    ...play,
    unitKey: unit.key,
    stage: "COLLECTING",
    resolvesAt: now + secondsToMs(s.config, s.config.timers.cardCollect),
    competitors: [],
  };
}

function seatRank(s: MatchState, pid: string, unitKey: string): number {
  const n = s.players.length;
  const unitIndex = Number(unitKey.split(":")[1] ?? 0) || 0;
  const seat = s.players.find((p) => p.id === pid)?.seat ?? 0;
  return (seat - unitIndex + n * 10) % n;
}

/** Called when the pending card's timer elapses (or immediately before a forced phase exit). */
export function resolvePending(ctx: Ctx): void {
  const { s, now } = ctx;
  const pending = s.chaos.pending;
  if (!pending) return;
  const unit = currentUnit(s);
  const unitLabel = unit?.label ?? "";

  if (pending.stage === "COLLECTING") {
    const all: PendingCompetitor[] = [pending, ...pending.competitors];
    all.sort(
      (a, b) => CARD_PRIORITY[b.card] - CARD_PRIORITY[a.card] || seatRank(s, a.playedBy, pending.unitKey) - seatRank(s, b.playedBy, pending.unitKey),
    );
    const [winner, ...losers] = all;
    for (const l of losers) {
      s.chaos.history.push({ id: l.playId, card: l.card, playedBy: l.playedBy, unitKey: pending.unitKey, unitLabel, outcome: "OUTPRIORITIZED", cancelledBy: null, at: now, summary: `${nameOf(s, l.playedBy)}'s card was outranked (charge kept)` });
    }
    if (!winner || (s.chaos.charges[winner.playedBy] ?? 0) < 1) {
      s.chaos.pending = null;
      return;
    }
    s.chaos.charges[winner.playedBy] = (s.chaos.charges[winner.playedBy] ?? 0) - 1;
    (s.chaos.playedInUnit[pending.unitKey] ??= []).push(winner.playedBy);
    s.chaos.pending = {
      ...winner,
      unitKey: pending.unitKey,
      stage: "REACTION",
      resolvesAt: now + secondsToMs(s.config, s.config.timers.cardReaction),
      competitors: [],
    };
    const title = CARD_INFO[winner.card].title;
    emit(ctx, "CARD_PLAYED", `${nameOf(s, winner.playedBy)} plays ${title}`, { card: winner.card, by: winner.playedBy });
    timeline(ctx, "CARD", `${nameOf(s, winner.playedBy)} plays ${title} — objections are open`);
    return;
  }

  // REACTION elapsed without an objection: apply the effect.
  s.chaos.pending = null;
  let summary = "";
  switch (pending.card) {
    case "SWITCH_SIDES": {
      const h = currentHearing(s);
      if (h && !h.swapped) {
        h.swapped = true;
        const sideA = otherSide(h.sideA);
        summary = `Sides switched: ${nameOf(s, h.debaterA)} now argues ${sideA}, ${nameOf(s, h.debaterB)} argues ${otherSide(sideA)}`;
      }
      break;
    }
    case "RECEIPTS": {
      const entry = s.vault.find((v) => v.id === pending.targetEntryId);
      const list = unitEvidence(s);
      if (entry && list && !list.includes(entry.id)) {
        list.push(entry.id);
        const h = currentHearing(s);
        if (h) h.receiptsResolved.push({ playerId: pending.playedBy, entryId: entry.id });
        summary = `Previous statement: ${nameOf(s, entry.playerId)} put ${entry.value} on "${entry.promptSnapshot}"`;
        emit(ctx, "EVIDENCE_REVEALED", summary, { entryId: entry.id, playerId: entry.playerId });
        timeline(ctx, "EVIDENCE", summary);
      }
      break;
    }
    case "CROSS_EXAMINATION": {
      const extra = secondsToMs(s.config, s.config.timers.crossExamination);
      if (s.phase.deadline !== null) s.phase.deadline += extra;
      summary = `${nameOf(s, pending.playedBy)} cross-examines ${nameOf(s, pending.targetPlayerId)} — one question, short answer`;
      break;
    }
    case "OBJECTION":
      break;
  }
  s.chaos.history.push({ id: pending.playId, card: pending.card, playedBy: pending.playedBy, unitKey: pending.unitKey, unitLabel, outcome: "RESOLVED", cancelledBy: null, at: now, summary });
  emit(ctx, "CARD_RESOLVED", summary || `${CARD_INFO[pending.card].title} resolved`, { card: pending.card, by: pending.playedBy });
  if (pending.card !== "RECEIPTS") timeline(ctx, "CARD", summary);
}
