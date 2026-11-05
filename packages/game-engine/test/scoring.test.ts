import { describe, expect, it } from "vitest";
import {
  addScore,
  assignTargets,
  buildBluffSchedule,
  buildCourtSchedule,
  computeClaim,
  computeStandings,
  finaleStancePredictionPoints,
  judgePredictionPoints,
  opinionPredictionPoints,
  seedFromString,
  tallyVerdict,
  underdogMultiplier,
} from "../src";
import { makeMatch, NOW } from "./helpers";

describe("Read the Room brackets", () => {
  it.each([
    [0, 100],
    [5, 80],
    [10, 80],
    [15, 60],
    [20, 60],
    [25, 40],
    [30, 40],
    [35, 0],
    [100, 0],
  ])("difference %i -> %i VP", (d, vp) => {
    expect(opinionPredictionPoints(d)).toBe(vp);
    expect(opinionPredictionPoints(-d)).toBe(vp);
  });
});

describe("judge prediction table", () => {
  it.each([
    [0, 40],
    [10, 40],
    [15, 30],
    [20, 30],
    [30, 20],
    [40, 10],
    [45, 0],
  ])("difference %i -> +%i VP", (d, vp) => expect(judgePredictionPoints(d)).toBe(vp));

  it("finale lead-investigator table tops out at 50", () => {
    expect(finaleStancePredictionPoints(0)).toBe(50);
    expect(finaleStancePredictionPoints(20)).toBe(35);
    expect(finaleStancePredictionPoints(50)).toBe(0);
  });
});

describe("Underdog Stakes", () => {
  it("is 1x when the non-debater can still catch the leader", () => {
    expect(underdogMultiplier(300, 350)).toBe(1);
  });
  it("is 1.5x when only being a debater would have kept them in contention", () => {
    expect(underdogMultiplier(200, 320)).toBe(1.5);
  });
  it("stays 1x when no seat could save them", () => {
    expect(underdogMultiplier(0, 500)).toBe(1);
  });
});

describe("target assignment", () => {
  it("is cyclic for three players and reverses in round two", () => {
    expect(assignTargets(["a", "b", "c"], 0)).toEqual({ a: "b", b: "c", c: "a" });
    expect(assignTargets(["a", "b", "c"], 1)).toEqual({ a: "c", b: "a", c: "b" });
  });
  it("never targets yourself and is a permutation for any size", () => {
    for (let n = 3; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      for (let r = 0; r < 5; r++) {
        const t = assignTargets(ids, r);
        expect(Object.entries(t).every(([k, v]) => k !== v)).toBe(true);
        expect(new Set(Object.values(t)).size).toBe(n);
      }
    }
  });
});

describe("court rotation", () => {
  it("three players: everyone debates twice and judges once", () => {
    const rng = { rngState: seedFromString("x") };
    const hs = buildCourtSchedule(rng, ["a", "b", "c"], 3);
    expect(hs).toHaveLength(3);
    for (const p of ["a", "b", "c"]) {
      expect(hs.filter((h) => h.debaterA === p || h.debaterB === p)).toHaveLength(2);
      expect(hs.filter((h) => h.judges.includes(p))).toHaveLength(1);
    }
    expect(hs.map((h) => [h.debaterA, h.debaterB, h.judges[0]])).toEqual([
      ["a", "b", "c"],
      ["b", "c", "a"],
      ["c", "a", "b"],
    ]);
  });

  it("larger lobbies spread debates evenly without repeat pairs", () => {
    const rng = { rngState: seedFromString("y") };
    const ids = ["a", "b", "c", "d", "e", "f"];
    const hs = buildCourtSchedule(rng, ids, 3);
    const counts = ids.map((p) => hs.filter((h) => h.debaterA === p || h.debaterB === p).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(new Set(hs.map((h) => [h.debaterA, h.debaterB].sort().join())).size).toBe(3);
    for (const h of hs) expect(h.judges).toHaveLength(4);
  });

  it("split benches use the committed neutral tiebreaker", () => {
    expect(tallyVerdict({ j1: "a", j2: "b" }, "a", "b", "B")).toEqual({ winnerId: "b", loserId: "a", tiebreakUsed: true });
    expect(tallyVerdict({ j1: "a", j2: "a", j3: "b" }, "a", "b", "B")).toEqual({ winnerId: "a", loserId: "b", tiebreakUsed: false });
  });
});

describe("bluff assignment", () => {
  it("always has at least one honest and one bluff turn, across many seeds", () => {
    for (let i = 0; i < 200; i++) {
      const turns = buildBluffSchedule({ rngState: seedFromString(`s${i}`) }, ["a", "b", "c"], 3);
      const roles = turns.map((t) => t.role);
      expect(roles).toContain("HONEST");
      expect(roles).toContain("BLUFF");
      expect(turns.map((t) => t.speakerId).sort()).toEqual(["a", "b", "c"]);
      for (const t of turns) expect(t.investigators).toHaveLength(2);
    }
  });

  it("fabricated claims are materially different and on the 0–100 grid", () => {
    for (let g = 0; g <= 100; g += 5) {
      for (const up of [true, false]) {
        for (const off of [35, 60]) {
          const c = computeClaim({ role: "BLUFF", fabricationOffset: off, fabricationUp: up }, g, 35);
          expect(Math.abs(c - g)).toBeGreaterThanOrEqual(35);
          expect(c % 5).toBe(0);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("honest claims equal the locked answer", () => {
    expect(computeClaim({ role: "HONEST", fabricationOffset: 40, fabricationUp: true }, 65, 35)).toBe(65);
  });
});

describe("score ledger", () => {
  it("rejects duplicate score event ids", () => {
    const s = makeMatch();
    const ev = { id: "x", playerId: "p1", type: "COURT_WIN" as const, amount: 80, segment: "COURT" as const, label: "", detail: {} };
    expect(addScore(s, ev, NOW)).toBe(true);
    expect(addScore(s, ev, NOW)).toBe(false);
    expect(s.scoreEvents.filter((e) => e.id === "x")).toHaveLength(1);
  });

  it("rejects negative or fractional amounts", () => {
    const s = makeMatch();
    expect(() => addScore(s, { id: "y", playerId: "p1", type: "COURT_WIN", amount: -5, segment: "COURT", label: "", detail: {} }, NOW)).toThrow();
  });
});

describe("tiebreak sequence", () => {
  const base = { segment: "COURT" as const, label: "", detail: {}, at: NOW };
  it("breaks equal totals by successful predictions, then debate wins, then bluff reads, then shares", () => {
    const s = makeMatch();
    s.scoreEvents = [
      { ...base, id: "1", playerId: "p1", type: "OPINION_PREDICTION", amount: 100 },
      { ...base, id: "2", playerId: "p2", type: "COURT_WIN", amount: 80 },
      { ...base, id: "3", playerId: "p2", type: "COURT_LOSS", amount: 20 },
      { ...base, id: "4", playerId: "p3", type: "BLUFF_CORRECT", amount: 30 },
      { ...base, id: "5", playerId: "p3", type: "BLUFF_CORRECT", amount: 30 },
      { ...base, id: "6", playerId: "p3", type: "BLUFF_SPEAKER_COMPLETE", amount: 40 },
    ];
    const st = computeStandings(s);
    expect(st.map((r) => r.total)).toEqual([100, 100, 100]);
    expect(st.map((r) => r.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(st.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares the rank when every tiebreaker is equal", () => {
    const s = makeMatch();
    s.scoreEvents = [
      { ...base, id: "1", playerId: "p1", type: "COURT_WIN", amount: 80 },
      { ...base, id: "2", playerId: "p2", type: "COURT_WIN", amount: 80 },
    ];
    const st = computeStandings(s);
    expect(st[0]!.rank).toBe(1);
    expect(st[1]!.rank).toBe(1);
    expect(st[0]!.sharedRank && st[1]!.sharedRank).toBe(true);
    expect(st[2]!.rank).toBe(3);
  });
});
