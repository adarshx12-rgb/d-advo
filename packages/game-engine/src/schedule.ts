import type { BluffRole, ContractType, Side } from "@hps/shared";
import { coin, nextInt, pick, shuffle, type RngHolder } from "./rng";
import type { BluffTurn, ContractOffer, Hearing, MatchState } from "./types";

/**
 * Read the Room targets. Round r uses a cyclic offset of (r mod (n-1)) + 1 over the seat order,
 * so nobody predicts themselves and, for three players, round 1 is A→B→C→A and round 2 reverses it.
 */
export function assignTargets(order: readonly string[], round: number): Record<string, string> {
  const n = order.length;
  if (n < 2) throw new Error("Need at least two players for targets");
  const offset = (round % (n - 1)) + 1;
  const out: Record<string, string> = {};
  order.forEach((pid, i) => {
    out[pid] = order[(i + offset) % n] as string;
  });
  return out;
}

function otherSide(side: Side): Side {
  return side === "FOR" ? "AGAINST" : "FOR";
}
export { otherSide };

/**
 * Devil's Court rotation.
 * Three players: (0v1, 2 judges) (1v2, 0 judges) (2v0, 1 judges) — each debates twice and judges once.
 * Larger lobbies: greedy fair pairing (fewest debates first, avoid repeat pairs); everyone else judges.
 * Seat order is shuffled per match by the seed, so position advantages rotate between matches.
 */
export function buildCourtSchedule(rng: RngHolder, order: readonly string[], hearings: number): Hearing[] {
  const n = order.length;
  const pairs: [string, string][] = [];
  if (n === 3) {
    pairs.push([order[0]!, order[1]!], [order[1]!, order[2]!], [order[2]!, order[0]!]);
  } else {
    const debates: Record<string, number> = Object.fromEntries(order.map((p) => [p, 0]));
    const used = new Set<string>();
    for (let h = 0; h < hearings; h++) {
      // rotate the tie-break position each hearing so early seats are not always preferred
      const rotated = order.map((_, i) => order[(i + h) % n]!);
      const sorted = [...rotated].sort((a, b) => debates[a]! - debates[b]!);
      let chosen: [string, string] | null = null;
      outer: for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = [sorted[i], sorted[j]].sort().join("|");
          if (!used.has(key)) {
            chosen = [sorted[i]!, sorted[j]!];
            break outer;
          }
        }
      }
      chosen ??= [sorted[0]!, sorted[1]!];
      used.add([...chosen].sort().join("|"));
      debates[chosen[0]]!++;
      debates[chosen[1]]!++;
      pairs.push(chosen);
    }
  }

  return pairs.slice(0, n === 3 ? 3 : hearings).map(([a, b], index) => {
    const judges = order.filter((p) => p !== a && p !== b);
    const predictionTargets: Record<string, string> = {};
    judges.forEach((j, ji) => {
      predictionTargets[j] = (index + ji) % 2 === 0 ? a : b;
    });
    return {
      index,
      debaterA: a,
      debaterB: b,
      judges,
      analystId: null,
      predictionTargets,
      sideA: coin(rng) ? "FOR" : "AGAINST",
      tiebreakSlot: coin(rng) ? "A" : "B",
      prompt: null,
      stances: {},
      predictions: {},
      verdicts: {},
      analystCall: null,
      swapped: false,
      evidence: [],
      receiptsResolved: [],
      result: null,
    } satisfies Hearing;
  });
}

/**
 * Catch the Bluff. Roles are committed here, at phase generation, never chosen by the speaker.
 * With 2+ turns there is always at least one HONEST and one BLUFF turn.
 */
export function buildBluffSchedule(rng: RngHolder, order: readonly string[], turns: number): BluffTurn[] {
  const n = order.length;
  const speakers: string[] = [];
  for (let t = 0; t < turns; t++) speakers.push(order[t % n]!);
  const roles: BluffRole[] = speakers.map(() => (coin(rng) ? "HONEST" : "BLUFF"));
  if (turns >= 2) {
    if (!roles.includes("HONEST")) roles[nextInt(rng, 0, turns - 1)] = "HONEST";
    if (!roles.includes("BLUFF")) {
      const honestIdx = roles.map((r, i) => (r === "HONEST" ? i : -1)).filter((i) => i >= 0);
      roles[pick(rng, honestIdx)] = "BLUFF";
    }
  }
  return speakers.map((speakerId, index) => ({
    index,
    speakerId,
    investigators: order.filter((p) => p !== speakerId),
    role: roles[index]!,
    fabricationOffset: nextInt(rng, 7, 12) * 5, // 35..60
    fabricationUp: coin(rng),
    prompt: null,
    genuine: null,
    claim: null,
    votes: {},
    evidence: [],
    result: null,
  }));
}

/** The number a speaker must claim. Honest = their locked answer; bluff = a materially different one. */
export function computeClaim(turn: Pick<BluffTurn, "role" | "fabricationOffset" | "fabricationUp">, genuine: number, minDistance: number): number {
  if (turn.role === "HONEST") return genuine;
  const offset = Math.max(turn.fabricationOffset, minDistance);
  const up = genuine + offset;
  const down = genuine - offset;
  let claim: number;
  if (turn.fabricationUp) claim = up <= 100 ? up : down >= 0 ? down : genuine >= 50 ? 0 : 100;
  else claim = down >= 0 ? down : up <= 100 ? up : genuine >= 50 ? 0 : 100;
  // snap to the 5-step grid and guarantee the minimum distance
  claim = Math.round(claim / 5) * 5;
  if (Math.abs(claim - genuine) < minDistance) claim = genuine >= 50 ? 0 : 100;
  return claim;
}

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

export const CONTRACT_TEXT: Record<ContractType, { title: string; reward: number }> = {
  MIND_LINK: { title: "Mind Link", reward: 30 },
  SKEPTIC: { title: "Skeptic", reward: 30 },
  KINGMAKER: { title: "Kingmaker", reward: 30 },
  FACT_CHECKER: { title: "Fact Checker", reward: 30 },
};

/**
 * Offers up to two contracts per player. Only contracts that are achievable with the configured match
 * (segments enabled, cards enabled, the holder actually has the designated seat) are ever offered.
 */
export function buildContractOffers(s: MatchState, rng: RngHolder): Record<string, ContractOffer[]> {
  const out: Record<string, ContractOffer[]> = {};
  const reservedAnalyst = new Set<number>();
  const active = s.players.filter((p) => !p.removed);
  const large = active.length >= 4;

  for (const p of active) {
    const cands: ContractOffer[] = [];
    const judged = s.config.segments.court ? s.court.hearings.filter((h) => h.judges.includes(p.id)) : [];
    if (judged.length > 0) {
      const h = pick(rng, judged);
      cands.push({ offerId: "", type: "MIND_LINK", targetPlayerId: h.predictionTargets[p.id] ?? null, hearingIndex: h.index, bluffTurnIndex: null });
      if (s.config.chaosEnabled) {
        const h2 = pick(rng, judged);
        cands.push({ offerId: "", type: "FACT_CHECKER", targetPlayerId: null, hearingIndex: h2.index, bluffTurnIndex: null });
      }
      if (large) {
        const open = judged.filter((h3) => h3.judges.length >= 2 && !reservedAnalyst.has(h3.index));
        if (open.length > 0) {
          const h3 = pick(rng, open);
          cands.push({ offerId: "", type: "KINGMAKER", targetPlayerId: null, hearingIndex: h3.index, bluffTurnIndex: null });
        }
      }
    }
    if (s.config.segments.bluff) {
      const turns = s.bluff.turns.filter((t) => t.investigators.includes(p.id));
      if (turns.length > 0) {
        const t = pick(rng, turns);
        cands.push({ offerId: "", type: "SKEPTIC", targetPlayerId: t.speakerId, hearingIndex: null, bluffTurnIndex: t.index });
      }
    }
    const chosen = shuffle(rng, cands).slice(0, 2);
    chosen.forEach((c, i) => {
      c.offerId = `${p.id}:offer:${i}`;
      if (c.type === "KINGMAKER" && c.hearingIndex !== null) reservedAnalyst.add(c.hearingIndex);
    });
    out[p.id] = chosen;
  }
  return out;
}

export function describeContract(s: MatchState, offer: ContractOffer, nameOf: (id: string) => string): string {
  const hearing = offer.hearingIndex !== null ? `hearing ${offer.hearingIndex + 1}` : "";
  switch (offer.type) {
    case "MIND_LINK":
      return `As judge in ${hearing}, predict ${nameOf(offer.targetPlayerId ?? "")}'s locked stance within 10.`;
    case "FACT_CHECKER":
      return `As judge in ${hearing}, successfully bring up a Previous Statement from one of the debaters with Receipts.`;
    case "KINGMAKER":
      return `Sit out the vote in ${hearing} as the Analyst and correctly call the winner.`;
    case "SKEPTIC":
      return `Correctly classify ${nameOf(offer.targetPlayerId ?? "")}'s spotlight turn (turn ${(offer.bluffTurnIndex ?? 0) + 1}) as honest or a bluff.`;
  }
}
