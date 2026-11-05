import { describe, expect, it } from "vitest";
import {
  getPlayerGameState,
  getPublicGameState,
  getSpectatorGameState,
  legalActions,
  reduce,
  totals,
  type MatchState,
} from "../src";
import { act, autoplayStep, host, makeMatch, NOW, playToEnd, playUntil, timeout } from "./helpers";

function sumEvents(s: MatchState, pid: string) {
  return s.scoreEvents.filter((e) => e.playerId === pid).reduce((a, e) => a + e.amount, 0);
}

describe("full three-player match", () => {
  it("runs every segment in order and ends with standings", () => {
    let s = makeMatch(3);
    const seen: string[] = [];
    let now = NOW;
    for (let i = 0; i < 600 && s.phase.name !== "RESULTS"; i++) {
      if (seen[seen.length - 1] !== s.phase.name) seen.push(s.phase.name);
      ({ s, now } = autoplayStep(s, now));
    }
    expect(s.phase.name).toBe("RESULTS");
    expect(s.status).toBe("COMPLETED");
    const order = ["CALIBRATION_PROMPT", "CONTRACT_SELECTION", "COURT_PREPARATION", "BLUFF_PREPARATION", "FINALE_PREPARATION"];
    const idx = order.map((p) => seen.indexOf(p));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(s.calibration.rounds).toHaveLength(3);
    expect(s.court.hearings.every((h) => h.result)).toBe(true);
    expect(s.bluff.turns.every((t) => t.result)).toBe(true);
    expect(s.finale?.result).toBeTruthy();
    const pub = getPublicGameState(s, now);
    expect(pub.results?.standings).toHaveLength(3);
    for (const r of pub.results!.standings) expect(r.total).toBe(sumEvents(s, r.playerId));
  });

  it("is deterministic for the same seed and inputs", () => {
    const a = playToEnd(makeMatch(3, { seed: "same" }));
    const b = playToEnd(makeMatch(3, { seed: "same" }));
    expect(totals(a)).toEqual(totals(b));
    expect(a.scoreEvents.map((e) => e.id)).toEqual(b.scoreEvents.map((e) => e.id));
  });

  it("scores every player within the documented per-segment maxima", () => {
    const s = playToEnd(makeMatch(3, { seed: "bounds" }));
    for (const p of s.players) {
      const finale = s.scoreEvents.filter((e) => e.playerId === p.id && e.segment === "FINALE").reduce((a, e) => a + e.amount, 0);
      const seat = s.finale!.seats[p.id];
      const cap = seat === "DEBATER" ? 150 : 100 * (s.finale!.multipliers[p.id] ?? 1);
      expect(finale).toBeLessThanOrEqual(cap);
      expect(s.scoreEvents.filter((e) => e.playerId === p.id && e.type === "CONTRACT_SUCCESS").length).toBeLessThanOrEqual(1);
    }
  });

  it("runs a full six-player match with jurors and investigators", () => {
    const s = playToEnd(makeMatch(6, { seed: "six" }));
    expect(s.phase.name).toBe("RESULTS");
    const seats = Object.values(s.finale!.seats);
    expect(seats.filter((x) => x === "DEBATER")).toHaveLength(2);
    expect(seats).toContain("JUROR");
    expect(seats).toContain("INVESTIGATOR");
  });

  it("runs twelve players to completion", () => {
    expect(playToEnd(makeMatch(12, { seed: "twelve" })).phase.name).toBe("RESULTS");
  });
});

describe("Read the Room", () => {
  it("hides opinions until reveal and scores by bracket", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const r = s.calibration.rounds[0]!;
    const [a, b, c] = s.players.map((p) => p.id) as [string, string, string];
    s = act(s, a, { type: "SUBMIT_OPINION", value: 70, keepPrivate: false }, now);
    s = act(s, b, { type: "SUBMIT_OPINION", value: 30, keepPrivate: false }, now);
    const pub = JSON.stringify(getPublicGameState(s, now));
    expect(pub).not.toContain('"opinion":70');
    expect(getPublicGameState(s, now).calibration!.opinionsLocked).toEqual([a, b]);
    // other players cannot see a's value in their own projection
    expect(getPlayerGameState(s, b, now).me.calibration!.myOpinion).toBe(30);
    expect(JSON.stringify(getPlayerGameState(s, b, now).me)).not.toContain("70");
    s = act(s, c, { type: "SUBMIT_OPINION", value: 50, keepPrivate: false }, now);
    expect(s.phase.name).toBe("CALIBRATION_PREDICTION");
    const targets = r.targets;
    // predictor of a predicts exactly 70, predictor of b is off by 15, predictor of c off by 40
    const valueFor: Record<string, number> = { [a]: 70, [b]: 45, [c]: 90 };
    for (const [pred, tgt] of Object.entries(targets)) s = act(s, pred, { type: "SUBMIT_PREDICTION", value: valueFor[tgt]! }, now);
    expect(s.phase.name).toBe("CALIBRATION_DISCUSSION");
    ({ s, now } = timeout(s));
    expect(s.phase.name).toBe("CALIBRATION_REVEAL");
    const pts = (tgt: string) => s.scoreEvents.find((e) => e.id === `cal:0:${Object.keys(targets).find((k) => targets[k] === tgt)}`)!.amount;
    expect(pts(a)).toBe(100);
    expect(pts(b)).toBe(60);
    expect(pts(c)).toBe(0);
    expect(getPublicGameState(s, now).calibration!.reveal).toHaveLength(3);
  });

  it("rejects repeated submissions", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const p = s.players[0]!.id;
    s = act(s, p, { type: "SUBMIT_OPINION", value: 40, keepPrivate: false }, now);
    expect(() => act(s, p, { type: "SUBMIT_OPINION", value: 60, keepPrivate: false }, now)).toThrow(/already locked/);
  });

  it("keeps private answers out of the vault but still scores them", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const [a, b, c] = s.players.map((p) => p.id) as [string, string, string];
    s = act(s, a, { type: "SUBMIT_OPINION", value: 20, keepPrivate: true }, now);
    s = act(s, b, { type: "SUBMIT_OPINION", value: 30, keepPrivate: false }, now);
    s = act(s, c, { type: "SUBMIT_OPINION", value: 40, keepPrivate: false }, now);
    expect(s.vault.some((v) => v.playerId === a)).toBe(false);
    expect(s.vault.filter((v) => v.visibility === "PRIVATE")).toHaveLength(2);
    ({ s } = playUntil(s, "CALIBRATION_REVEAL"));
    expect(s.vault.filter((v) => v.visibility === "EVIDENCE_ELIGIBLE")).toHaveLength(2);
    expect(s.scoreEvents.some((e) => e.id.startsWith("cal:0:"))).toBe(true);
  });

  it("idempotently ignores a replayed action id", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const p = s.players[0]!.id;
    const action = { kind: "PLAYER" as const, actorId: p, actionId: "dup-action-1", action: { type: "SUBMIT_OPINION" as const, value: 40, keepPrivate: false } };
    s = reduce(s, action, now).state;
    const again = reduce(s, action, now);
    expect(again.duplicate).toBe(true);
    expect(again.state).toBe(s);
  });
});

describe("Devil's Court", () => {
  it("judge prediction is scored on the locked stance, independent of the verdict", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "court" }), "COURT_PREPARATION");
    const h = s.court.hearings[0]!;
    const judge = h.judges[0]!;
    const target = h.predictionTargets[judge]!;
    const other = target === h.debaterA ? h.debaterB : h.debaterA;
    s = act(s, target, { type: "COURT_LOCK_STANCE", value: 80 }, now);
    // side is only revealed to a debater after they lock
    expect(getPlayerGameState(s, other, now).me.court!.mySide).toBeNull();
    expect(getPlayerGameState(s, target, now).me.court!.mySide).not.toBeNull();
    s = act(s, other, { type: "COURT_LOCK_STANCE", value: 10 }, now);
    s = act(s, judge, { type: "JUDGE_PREDICT", value: 65 }, now);
    expect(s.phase.name).toBe("COURT_OPENING");
    expect(getPublicGameState(s, now).court!.sides).not.toBeNull();
    // stances never appear publicly before the reveal
    expect(getPublicGameState(s, now).court!.reveal).toBeNull();
    ({ s, now } = playUntil(s, "COURT_VOTING"));
    s = act(s, judge, { type: "COURT_VERDICT", winnerId: other }, now);
    expect(s.phase.name).toBe("COURT_REVEAL");
    const ev = (id: string) => s.scoreEvents.find((e) => e.id === id)?.amount;
    expect(ev("court:0:win")).toBe(80);
    expect(s.scoreEvents.find((e) => e.id === "court:0:win")!.playerId).toBe(other);
    expect(ev("court:0:loss")).toBe(20);
    expect(ev(`court:0:verdict:${judge}`)).toBe(40);
    expect(ev(`court:0:predict:${judge}`)).toBe(30); // off by 15
    // judge never receives debater rewards for the same hearing
    expect(s.scoreEvents.filter((e) => e.playerId === judge && e.id.startsWith("court:0:") && (e.type === "COURT_WIN" || e.type === "COURT_LOSS"))).toHaveLength(0);
  });

  it("speakers can yield the floor early, and only the speaker", () => {
    let { s, now } = playUntil(makeMatch(3), "COURT_OPENING");
    const h = s.court.hearings[0]!;
    expect(() => act(s, h.debaterB, { type: "YIELD_FLOOR" }, now)).toThrow(/speaker/);
    s = act(s, h.debaterA, { type: "YIELD_FLOOR" }, now);
    expect(s.phase.name).toBe("COURT_OPENING");
    expect(s.phase.step).toBe(1);
  });

  it("rejects verdicts for non-debaters and from debaters", () => {
    const { s, now } = playUntil(makeMatch(3), "COURT_VOTING");
    const h = s.court.hearings[0]!;
    expect(() => act(s, h.debaterA, { type: "COURT_VERDICT", winnerId: h.debaterA }, now)).toThrow();
    expect(() => act(s, h.judges[0]!, { type: "COURT_VERDICT", winnerId: h.judges[0]! }, now)).toThrow(/debaters/);
  });
});

describe("Catch the Bluff", () => {
  it("keeps the role hidden from everyone but the speaker until reveal", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "bluff" }), "BLUFF_PREPARATION");
    const t = s.bluff.turns[0]!;
    expect(getPlayerGameState(s, t.speakerId, now).me.bluff!.instruction).toBeNull();
    s = act(s, t.speakerId, { type: "BLUFF_LOCK", value: 70 }, now);
    expect(s.phase.name).toBe("BLUFF_STATEMENT");
    const mine = getPlayerGameState(s, t.speakerId, now).me.bluff!;
    expect(mine.instruction!.role).toBe(t.role);
    for (const inv of t.investigators) {
      const st = getPlayerGameState(s, inv, now);
      expect(st.me.bluff!.instruction).toBeNull();
      expect(JSON.stringify(st)).not.toContain(`"role":"${t.role}"`);
    }
    const spec = getSpectatorGameState(s, "spec1", "Viewer", now);
    expect(JSON.stringify(spec)).not.toMatch(/"role":"(HONEST|BLUFF)"/);
    expect(spec.bluff!.claim).toBe(s.bluff.turns[0]!.claim);
  });

  it("scores investigators and the speaker", () => {
    for (const seed of ["b1", "b2", "b3", "b4", "b5", "b6"]) {
      let { s, now } = playUntil(makeMatch(3, { seed }), "BLUFF_VOTING");
      const t = s.bluff.turns[0]!;
      const [i1, i2] = t.investigators as [string, string];
      const wrong = t.role === "HONEST" ? "BLUFF" : "HONEST";
      s = act(s, i1, { type: "BLUFF_VOTE", guess: wrong }, now);
      s = act(s, i2, { type: "BLUFF_VOTE", guess: wrong }, now);
      expect(s.phase.name).toBe("BLUFF_REVEAL");
      const speaker = s.scoreEvents.find((e) => e.id === "bluff:0:speaker")!;
      expect(speaker.amount).toBe(t.role === "HONEST" ? 20 : 40);
      expect(s.scoreEvents.some((e) => e.type === "BLUFF_CORRECT" && e.id.startsWith("bluff:0"))).toBe(false);
    }
  });

  it("a caught bluffer earns 10 and correct investigators earn 30", () => {
    for (const seed of ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"]) {
      let { s, now } = playUntil(makeMatch(3, { seed }), "BLUFF_VOTING");
      const t = s.bluff.turns[0]!;
      if (t.role !== "BLUFF") continue;
      const [i1, i2] = t.investigators as [string, string];
      s = act(s, i1, { type: "BLUFF_VOTE", guess: "BLUFF" }, now);
      s = act(s, i2, { type: "BLUFF_VOTE", guess: "HONEST" }, now);
      expect(s.scoreEvents.find((e) => e.id === "bluff:0:speaker")!.amount).toBe(10);
      expect(s.scoreEvents.find((e) => e.id === `bluff:0:inv:${i1}`)!.amount).toBe(30);
      expect(s.scoreEvents.find((e) => e.id === `bluff:0:inv:${i2}`)).toBeUndefined();
      return;
    }
    throw new Error("no seed produced a first-turn bluff");
  });
});

describe("Final Verdict", () => {
  it("seats the top two as debaters and the third as Lead Investigator", () => {
    const { s } = playUntil(makeMatch(3, { seed: "fin" }), "FINALE_PREPARATION");
    const f = s.finale!;
    const seats = Object.values(f.seats);
    expect(seats.filter((x) => x === "DEBATER")).toHaveLength(2);
    expect(seats.filter((x) => x === "LEAD_INVESTIGATOR")).toHaveLength(1);
    const t = totals(s);
    const lead = Object.keys(f.seats).find((p) => f.seats[p] === "LEAD_INVESTIGATOR")!;
    for (const d of [f.debaterA, f.debaterB]) expect(t[d]!).toBeGreaterThanOrEqual(t[lead]! - 0);
  });

  it("requires a side and derives honest/bluff roles from the locked stance", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "fin2" }), "FINALE_PREPARATION");
    const f = s.finale!;
    expect(() => act(s, f.debaterA, { type: "FINALE_LOCK_STANCE", value: 50 }, now)).toThrow(/side/);
    const forValue = 80;
    s = act(s, f.debaterA, { type: "FINALE_LOCK_STANCE", value: forValue }, now);
    s = act(s, f.debaterB, { type: "FINALE_LOCK_STANCE", value: 20 }, now);
    const lead = Object.keys(f.seats).find((p) => f.seats[p] === "LEAD_INVESTIGATOR")!;
    s = act(s, lead, { type: "FINALE_PREDICT", value: 75 }, now);
    expect(s.phase.name).toBe("FINALE_DEBATE");
    const roleA = s.finale!.roles[f.debaterA];
    expect(roleA).toBe(f.sideA === "FOR" ? "HONEST" : "BLUFF");
    // roles stay private
    expect(JSON.stringify(getPlayerGameState(s, lead, now))).not.toMatch(/"myRole":"(HONEST|BLUFF)"/);
    expect(getPlayerGameState(s, f.debaterA, now).me.finale!.myRole).toBe(roleA);
  });

  it("scores the finale with no points for choosing your own verdict", () => {
    let { s, now } = playUntil(makeMatch(3, { seed: "fin3" }), "FINALE_VOTING");
    const f = s.finale!;
    const lead = Object.keys(f.seats).find((p) => f.seats[p] === "LEAD_INVESTIGATOR")!;
    s = act(s, lead, { type: "FINALE_VERDICT", winnerId: f.debaterA }, now);
    for (const t of [f.debaterA, f.debaterB]) s = act(s, lead, { type: "FINALE_CLASSIFY", targetId: t, guess: f.roles[t]! }, now);
    s = act(s, f.debaterA, { type: "FINALE_CLASSIFY", targetId: f.debaterB, guess: f.roles[f.debaterB]! }, now);
    s = act(s, f.debaterB, { type: "FINALE_CLASSIFY", targetId: f.debaterA, guess: f.roles[f.debaterA] === "HONEST" ? "BLUFF" : "HONEST" }, now);
    expect(s.phase.name).toBe("FINALE_REVEAL");
    const sum = (pid: string) => s.scoreEvents.filter((e) => e.playerId === pid && e.segment === "FINALE").reduce((a, e) => a + e.amount, 0);
    expect(sum(f.debaterA)).toBe(150);
    expect(sum(f.debaterB)).toBe(20);
    const m = f.multipliers[lead] ?? 1;
    const leadPrediction = s.scoreEvents.find((e) => e.id === `finale:predict:${lead}`)?.amount ?? 0;
    expect(sum(lead)).toBe(2 * Math.round(25 * m) + leadPrediction);
    expect(s.scoreEvents.some((e) => e.playerId === lead && e.type === "FINALE_VERDICT")).toBe(false);
  });
});

describe("host controls", () => {
  it("pauses and resumes with the remaining time preserved", () => {
    let { s } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const remaining = s.phase.deadline! - NOW;
    s = host(s, "PAUSE", NOW);
    expect(s.status).toBe("PAUSED");
    expect(s.phase.deadline).toBeNull();
    expect(() => act(s, s.players[0]!.id, { type: "SUBMIT_OPINION", value: 10, keepPrivate: false })).toThrow(/paused/);
    s = host(s, "RESUME", NOW + 60_000);
    expect(s.phase.deadline).toBe(NOW + 60_000 + remaining);
  });

  it("only the host can use host commands", () => {
    const s = makeMatch();
    expect(() => reduce(s, { kind: "HOST", actorId: "p2", actionId: "nothost-1", command: "PAUSE" }, NOW)).toThrow(/host/);
  });

  it("skipping a prompt swaps it and clears answers", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const old = s.calibration.rounds[0]!.prompt.id;
    s = act(s, s.players[0]!.id, { type: "SUBMIT_OPINION", value: 10, keepPrivate: false }, now);
    s = host(s, "SKIP_PROMPT", now);
    expect(s.calibration.rounds[0]!.prompt.id).not.toBe(old);
    expect(s.calibration.rounds[0]!.opinions).toEqual({});
    expect(s.vault).toHaveLength(0);
  });

  it("players get a limited number of anonymous skips", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const p = s.players[1]!.id;
    s = act(s, p, { type: "REQUEST_SKIP" }, now);
    s = act(s, p, { type: "REQUEST_SKIP" }, now);
    expect(legalActions(s, p)).not.toContain("REQUEST_SKIP");
    expect(s.timeline.some((t) => t.text.includes(s.players[1]!.name))).toBe(false);
  });

  it("ending early jumps to results", () => {
    const s = host(makeMatch(), "END");
    expect(s.phase.name).toBe("RESULTS");
    expect(s.status).toBe("COMPLETED");
  });
});

describe("disconnects", () => {
  it("does not wait on disconnected players and times them out", () => {
    let { s, now } = playUntil(makeMatch(3), "CALIBRATION_SUBMISSION");
    const [a, b, c] = s.players.map((p) => p.id) as [string, string, string];
    s = reduce(s, { kind: "CONNECTION", playerId: c, connected: false }, now).state;
    s = act(s, a, { type: "SUBMIT_OPINION", value: 10, keepPrivate: false }, now);
    s = act(s, b, { type: "SUBMIT_OPINION", value: 20, keepPrivate: false }, now);
    expect(s.phase.name).toBe("CALIBRATION_PREDICTION");
    s = reduce(s, { kind: "CONNECTION", playerId: c, connected: true }, now).state;
    expect(legalActions(s, c)).toContain("SUBMIT_PREDICTION");
  });
});
