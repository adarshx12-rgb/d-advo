import { describe, expect, it } from "vitest";
import { getPublicGameState, legalActions, playableCards, tick, type MatchState } from "../src";
import { act, autoplayStep, makeMatch, playToEnd, playUntil, timeout } from "./helpers";

function resolveCards(s: MatchState, now: number): { s: MatchState; now: number } {
  while (s.chaos.pending) {
    now = s.chaos.pending.resolvesAt;
    s = tick(s, now).state;
  }
  return { s, now };
}

describe("Chaos Card windows", () => {
  it("rejects cards outside their timing window", () => {
    const { s, now } = playUntil(makeMatch(3), "COURT_OPENING");
    const p = s.players[0]!.id;
    expect(playableCards(s, p)).toEqual([]);
    expect(() => act(s, p, { type: "PLAY_CARD", card: "SWITCH_SIDES" }, now)).toThrow(/rebuttals/);
    expect(() => act(s, p, { type: "PLAY_CARD", card: "OBJECTION" }, now)).toThrow(/no pending/);
  });

  it("Switch Sides resolves during rebuttals and swaps the debaters' sides", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "switch" }), "COURT_REBUTTAL");
    const h = s.court.hearings[0]!;
    const judge = h.judges[0]!;
    const before = getPublicGameState(s, now).court!.sides!;
    s = act(s, judge, { type: "PLAY_CARD", card: "SWITCH_SIDES" }, now);
    expect(s.chaos.pending?.stage).toBe("COLLECTING");
    ({ s, now } = resolveCards(s, now));
    const after = getPublicGameState(s, now).court!.sides!;
    expect(after.A).toBe(before.B);
    expect(after.B).toBe(before.A);
    expect(s.chaos.charges[judge]).toBe(2);
    expect(s.chaos.history.at(-1)!.outcome).toBe("RESOLVED");
    // one card per player per hearing
    expect(playableCards(s, judge)).toEqual([]);
  });

  it("Objection cancels a pending card, costs a charge, and cannot be countered", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "objection" }), "COURT_REBUTTAL");
    const h = s.court.hearings[0]!;
    const judge = h.judges[0]!;
    s = act(s, judge, { type: "PLAY_CARD", card: "SWITCH_SIDES" }, now);
    now = s.chaos.pending!.resolvesAt;
    s = tick(s, now).state; // collection -> reaction window
    expect(s.chaos.pending?.stage).toBe("REACTION");
    expect(playableCards(s, judge)).toEqual([]); // can't object to your own card
    s = act(s, h.debaterA, { type: "PLAY_CARD", card: "OBJECTION" }, now);
    expect(s.chaos.pending).toBeNull();
    expect(s.court.hearings[0]!.swapped).toBe(false);
    expect(s.chaos.charges[h.debaterA]).toBe(2);
    expect(s.chaos.charges[judge]).toBe(2);
    expect(s.chaos.history.map((x) => x.outcome)).toEqual(["CANCELLED", "RESOLVED"]);
    // nothing pending -> no counter-objection possible
    expect(() => act(s, h.debaterB, { type: "PLAY_CARD", card: "OBJECTION" }, now)).toThrow(/no pending/);
  });

  it("simultaneous plays resolve by server priority, not arrival order, and losers keep their charge", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "prio" }), "COURT_CHALLENGE");
    const h = s.court.hearings[0]!;
    const judge = h.judges[0]!;
    // debater A asks a cross-exam first; the judge's Receipts arrives later in the same window
    s = act(s, h.debaterA, { type: "PLAY_CARD", card: "CROSS_EXAMINATION", targetPlayerId: h.debaterB }, now);
    const target = getPublicGameState(s, now) && s.vault.find((v) => v.visibility === "EVIDENCE_ELIGIBLE" && (v.playerId === h.debaterA || v.playerId === h.debaterB))!;
    s = act(s, judge, { type: "PLAY_CARD", card: "RECEIPTS", targetEntryId: target.id }, now + 10);
    ({ s, now } = resolveCards(s, now));
    const outcomes = Object.fromEntries(s.chaos.history.map((x) => [x.card, x.outcome]));
    expect(outcomes.RECEIPTS).toBe("RESOLVED");
    expect(outcomes.CROSS_EXAMINATION).toBe("OUTPRIORITIZED");
    expect(s.chaos.charges[h.debaterA]).toBe(3);
    expect(s.court.hearings[0]!.evidence).toEqual([target.id]);
    expect(getPublicGameState(s, now).court!.evidence[0]!.value).toBe(target.value);
  });

  it("Cross-Examination extends the current window", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "xexam" }), "COURT_CHALLENGE");
    const h = s.court.hearings[0]!;
    const deadline = s.phase.deadline!;
    s = act(s, h.judges[0]!, { type: "PLAY_CARD", card: "CROSS_EXAMINATION", targetPlayerId: h.debaterA }, now);
    ({ s } = resolveCards(s, now));
    expect(s.phase.deadline).toBe(deadline + 20_000);
  });

  it("phase exit waits for a pending card so objections always get their window", () => {
    let { s } = playUntil(makeMatch(3, { seed: "defer" }), "COURT_CHALLENGE");
    const h = s.court.hearings[0]!;
    const now = s.phase.deadline! - 100;
    s = act(s, h.judges[0]!, { type: "PLAY_CARD", card: "CROSS_EXAMINATION", targetPlayerId: h.debaterA }, now);
    s = tick(s, now + 200).state; // deadline passed while still collecting
    expect(s.phase.name).toBe("COURT_CHALLENGE");
    expect(s.chaos.pending?.stage).toBe("COLLECTING");
    s = tick(s, now + 1_100).state; // collection over -> objection window, phase still held
    expect(s.phase.name).toBe("COURT_CHALLENGE");
    expect(s.chaos.pending?.stage).toBe("REACTION");
  });

  it("charges run out and cannot be refilled", () => {
    const s = playToEnd(makeMatch(3));
    for (const p of s.players) expect(s.chaos.charges[p.id]).toBeLessThanOrEqual(3);
  });

  it("are unavailable when Chaos Cards are disabled", () => {
    const { s, now } = playUntil(makeMatch(3, { settings: { chaosEnabled: false } }), "COURT_REBUTTAL");
    expect(playableCards(s, s.players[0]!.id)).toEqual([]);
    expect(() => act(s, s.players[0]!.id, { type: "PLAY_CARD", card: "SWITCH_SIDES" }, now)).toThrow(/off/);
  });

  it("Receipts only cites eligible statements from players in the spotlight", () => {
    const { s, now } = playUntil(makeMatch(3, { seed: "rcpt" }), "COURT_CHALLENGE");
    const h = s.court.hearings[0]!;
    const judgeEntry = s.vault.find((v) => v.playerId === h.judges[0]);
    expect(judgeEntry).toBeDefined();
    expect(() => act(s, h.debaterA, { type: "PLAY_CARD", card: "RECEIPTS", targetEntryId: judgeEntry!.id }, now)).toThrow(/not eligible/);
    const priv = s.vault.find((v) => v.visibility === "PRIVATE");
    if (priv) expect(() => act(s, h.judges[0]!, { type: "PLAY_CARD", card: "RECEIPTS", targetEntryId: priv.id }, now)).toThrow();
  });
});

describe("contracts", () => {
  it("never offers Kingmaker in a three-player match (it would be self-determined)", () => {
    for (const seed of ["k1", "k2", "k3", "k4", "k5"]) {
      const { s } = playUntil(makeMatch(3, { seed }), "CONTRACT_SELECTION");
      for (const c of Object.values(s.contracts)) {
        expect(c.offers.length).toBeGreaterThan(0);
        expect(c.offers.length).toBeLessThanOrEqual(2);
        expect(c.offers.some((o) => o.type === "KINGMAKER")).toBe(false);
        expect(new Set(c.offers.map((o) => o.type)).size).toBe(c.offers.length);
      }
    }
  });

  it("only offers achievable contracts: designated hearing seats are real", () => {
    const { s } = playUntil(makeMatch(5, { seed: "seats" }), "CONTRACT_SELECTION");
    for (const [pid, c] of Object.entries(s.contracts)) {
      for (const o of c.offers) {
        if (o.hearingIndex !== null) expect(s.court.hearings[o.hearingIndex]!.judges).toContain(pid);
        if (o.bluffTurnIndex !== null) expect(s.bluff.turns[o.bluffTurnIndex]!.investigators).toContain(pid);
        if (o.type === "MIND_LINK") expect(s.court.hearings[o.hearingIndex!]!.predictionTargets[pid]).toBe(o.targetPlayerId);
      }
    }
  });

  it("does not offer Fact Checker when chaos is off, nor Skeptic without bluff", () => {
    const { s } = playUntil(makeMatch(3, { settings: { chaosEnabled: false, matchType: "OPINIONS_AND_COURT" } }), "CONTRACT_SELECTION");
    for (const c of Object.values(s.contracts)) for (const o of c.offers) expect(o.type).toBe("MIND_LINK");
  });

  it("completes Mind Link only through server-checked predictions", () => {
    for (const seed of ["ml1", "ml2", "ml3", "ml4", "ml5", "ml6", "ml7", "ml8"]) {
      let { s, now } = playUntil(makeMatch(3, { seed }), "CONTRACT_SELECTION");
      const entry = Object.entries(s.contracts).find(([, c]) => c.offers.some((o) => o.type === "MIND_LINK"));
      if (!entry) continue;
      const [pid, c] = entry;
      const offer = c.offers.find((o) => o.type === "MIND_LINK")!;
      s = act(s, pid, { type: "SELECT_CONTRACT", offerId: offer.offerId }, now);
      // the selected contract is private
      expect(JSON.stringify(getPublicGameState(s, now))).not.toContain("MIND_LINK");
      // play until the designated hearing's preparation, then predict exactly
      for (let i = 0; i < 400 && !(s.phase.name === "COURT_PREPARATION" && s.court.current === offer.hearingIndex); i++) {
        ({ s, now } = autoplayStep(s, now));
      }
      const h = s.court.hearings[offer.hearingIndex!]!;
      s = act(s, offer.targetPlayerId!, { type: "COURT_LOCK_STANCE", value: 65 }, now);
      s = act(s, pid, { type: "JUDGE_PREDICT", value: 70 }, now);
      const other = h.debaterA === offer.targetPlayerId ? h.debaterB : h.debaterA;
      if (legalActions(s, other).includes("COURT_LOCK_STANCE")) s = act(s, other, { type: "COURT_LOCK_STANCE", value: 30 }, now);
      ({ s, now } = playUntil(s, "COURT_REVEAL"));
      expect(s.contracts[pid]!.status).toBe("COMPLETED");
      expect(s.scoreEvents.find((e) => e.id === `contract:${pid}`)!.amount).toBe(30);
      // the public score line hides which contract it was until results
      expect(getPublicGameState(s, now).scoreLines.find((l) => l.id === `contract:${pid}`)!.label).toBe("Secret contract");
      return;
    }
    throw new Error("no seed offered Mind Link");
  });

  it("unselected contracts default to the first offer and unresolved ones fail at results", () => {
    let { s } = playUntil(makeMatch(3, { seed: "def" }), "CONTRACT_SELECTION");
    let now: number;
    ({ s, now } = timeout(s));
    for (const c of Object.values(s.contracts)) expect(c.selected).not.toBeNull();
    const done = playToEnd(s);
    for (const c of Object.values(done.contracts)) expect(["COMPLETED", "FAILED"]).toContain(c.status);
    const pub = getPublicGameState(done, now);
    expect(pub.results!.contracts.every((x) => x.contract !== null)).toBe(true);
  });
});
