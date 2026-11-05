import type { ScoreEventType, Segment, StandingRow } from "@hps/shared";
import type { MatchState, ScoreEvent } from "./types";

/* ------------------------------------------------------------------ */
/* Rule tables                                                         */
/* ------------------------------------------------------------------ */

export const POINTS = {
  courtWin: 80,
  courtLoss: 20,
  judgeVerdict: 40,
  analystCall: 40,
  contract: 30,
  bluffCorrect: 30,
  bluffHonestComplete: 20,
  bluffEscape: 40,
  bluffCaught: 10,
  finaleWin: 100,
  finaleLoss: 20,
  finaleDebaterClassify: 50,
  finaleWinnerCall: 50,
  finaleJurorVerdict: 50,
  /** Per debater; a non-debater classifies both, so 2 x 25 = 50 max. */
  finaleInvestigatorClassify: 25,
} as const;

/** Read the Room: smallest applicable bracket wins. */
export function opinionPredictionPoints(difference: number): number {
  const d = Math.abs(difference);
  if (d === 0) return 100;
  if (d <= 10) return 80;
  if (d <= 20) return 60;
  if (d <= 30) return 40;
  return 0;
}

/** Devil's Court judge prediction bonus (on top of the 40 VP verdict reward). */
export function judgePredictionPoints(difference: number): number {
  const d = Math.abs(difference);
  if (d <= 10) return 40;
  if (d <= 20) return 30;
  if (d <= 30) return 20;
  if (d <= 40) return 10;
  return 0;
}

/**
 * Final Verdict — three-player Lead Investigator stance prediction.
 * Replaces "predict the winner" because the Lead Investigator also casts the verdict,
 * and nobody may score for an outcome they decide. Same shape as the judge table, scaled to 50.
 */
export function finaleStancePredictionPoints(difference: number): number {
  const d = Math.abs(difference);
  if (d <= 10) return 50;
  if (d <= 20) return 35;
  if (d <= 30) return 20;
  if (d <= 40) return 10;
  return 0;
}

/**
 * Underdog Stakes (documented fairness rule): a non-debater in the finale whose best case (100 VP)
 * cannot reach the leader's guaranteed floor (+20 as a losing debater), but who *could* have as a
 * debater (150 VP), plays with a 1.5x multiplier on all finale rewards. This keeps the third player
 * in mathematical contention purely on account of not being seated as a debater.
 */
export function underdogMultiplier(playerScore: number, leaderScore: number): number {
  const leaderFloor = leaderScore + POINTS.finaleLoss;
  if (playerScore + 100 >= leaderFloor) return 1;
  if (playerScore + 150 >= leaderFloor) return 1.5;
  return 1;
}

/* ------------------------------------------------------------------ */
/* Event ledger                                                         */
/* ------------------------------------------------------------------ */

export function addScore(
  s: MatchState,
  ev: Omit<ScoreEvent, "at"> & { at?: number },
  now: number,
): boolean {
  if (s.scoreEvents.some((e) => e.id === ev.id)) return false; // replay-safe: never double count
  if (!s.players.some((p) => p.id === ev.playerId)) return false;
  if (!Number.isInteger(ev.amount) || ev.amount < 0) throw new Error(`Invalid score amount ${ev.amount}`);
  s.scoreEvents.push({ ...ev, at: ev.at ?? now });
  return true;
}

export function totalFor(s: MatchState, playerId: string): number {
  return s.scoreEvents.filter((e) => e.playerId === playerId).reduce((a, e) => a + e.amount, 0);
}

export function totals(s: MatchState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of s.players) out[p.id] = 0;
  for (const e of s.scoreEvents) out[e.playerId] = (out[e.playerId] ?? 0) + e.amount;
  return out;
}

const SUCCESSFUL_PREDICTION_TYPES: ScoreEventType[] = ["OPINION_PREDICTION", "JUDGE_PREDICTION", "ANALYST_CALL"];

function countEvents(events: ScoreEvent[], pid: string, pred: (e: ScoreEvent) => boolean): number {
  return events.filter((e) => e.playerId === pid && pred(e)).length;
}

/**
 * Final ranking. Tiebreak sequence (spec §14):
 * 1. most successful predictions, 2. most debate victories, 3. most successful bluff classifications,
 * 4. otherwise a shared rank.
 */
export function computeStandings(s: MatchState): StandingRow[] {
  const t = totals(s);
  const rows: StandingRow[] = s.players.map((p) => {
    const ev = s.scoreEvents;
    const byMode: Record<Segment, number> = { CALIBRATION: 0, CONTRACTS: 0, COURT: 0, BLUFF: 0, FINALE: 0, RESULTS: 0 };
    for (const e of ev) if (e.playerId === p.id) byMode[e.segment] += e.amount;
    return {
      playerId: p.id,
      rank: 0,
      total: t[p.id] ?? 0,
      byMode,
      successfulPredictions: countEvents(
        ev,
        p.id,
        (e) =>
          (SUCCESSFUL_PREDICTION_TYPES.includes(e.type) && e.amount > 0 && e.detail.correct !== false) ||
          (e.type === "FINALE_INVESTIGATION" && e.detail.kind === "prediction" && e.amount > 0),
      ),
      debateWins: countEvents(ev, p.id, (e) => e.type === "COURT_WIN" || (e.type === "FINALE_DEBATE" && e.detail.won === true)),
      bluffCorrect: countEvents(ev, p.id, (e) => e.type === "BLUFF_CORRECT" || (e.type === "FINALE_CLASSIFY" && e.amount > 0)),
      bluffEscapes: countEvents(ev, p.id, (e) => e.type === "BLUFF_ESCAPE"),
      contractsCompleted: countEvents(ev, p.id, (e) => e.type === "CONTRACT_SUCCESS"),
      cardsUsed: s.chaos.history.filter((h) => h.playedBy === p.id && h.outcome !== "OUTPRIORITIZED").length,
      sharedRank: false,
    };
  });

  const key = (r: StandingRow) => [r.total, r.successfulPredictions, r.debateWins, r.bluffCorrect];
  const cmp = (a: StandingRow, b: StandingRow) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (kb[i] ?? 0) - (ka[i] ?? 0);
    return 0;
  };
  const seatOf = (id: string) => s.players.find((p) => p.id === id)?.seat ?? 0;
  rows.sort((a, b) => cmp(a, b) || seatOf(a.playerId) - seatOf(b.playerId));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (prev && cmp(prev, r) === 0) {
      r.rank = prev.rank;
      r.sharedRank = true;
      prev.sharedRank = true;
    } else {
      r.rank = i + 1;
    }
  });
  return rows;
}

/** Standings mid-match (used to seat the finale). Ties broken by the same sequence, then by seat. */
export function standingsOrder(s: MatchState): string[] {
  return computeStandings(s).map((r) => r.playerId);
}
