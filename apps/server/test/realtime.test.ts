import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningServer } from "../src/server";
import type { MemoryPersistence } from "../src/persistence/memory";
import { bootServer, lobbyOfThree, startBot, TestClient } from "./harness";

let server: RunningServer & { mem: MemoryPersistence };
const clients: TestClient[] = [];

beforeAll(async () => {
  server = await bootServer();
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function lobby() {
  const l = await lobbyOfThree(server.url);
  clients.push(...l.all);
  return l;
}

describe("rooms", () => {
  it("three people join a room, ready up and the start button unlocks only then", async () => {
    const host = await new TestClient(server.url, "Host").connect();
    clients.push(host);
    const { code } = await host.call<{ code: string }>("room:create", { displayName: "Host", avatar: "gavel" });
    expect(code).toMatch(/^[A-Z]{4}$/);
    await host.waitFor(() => !!host.room);
    expect(host.room!.canStart).toBe(false);
    expect(host.room!.inviteKey).toBeTruthy();
    await expect(host.call("host:start")).rejects.toThrow(/at least 3/);

    const p2 = await new TestClient(server.url, "P2").connect();
    const p3 = await new TestClient(server.url, "P3").connect();
    clients.push(p2, p3);
    await p2.call("room:join", { code, displayName: "P2", avatar: "mask" });
    await p3.call("room:join", { code, displayName: "<b>P3</b>", avatar: "flame" });
    await p3.waitFor(() => p3.room?.members.length === 3);
    expect(p3.room!.members.map((m) => m.name)).toContain("bP3/b"); // markup stripped
    expect(p3.room!.inviteKey).toBeNull(); // only the host sees the invite key
    expect(new Set(p3.room!.members.map((m) => m.id)).size).toBe(3);
    for (const c of [host, p2, p3]) await c.call("player:ready", { ready: true });
    await host.waitFor(() => host.room?.canStart === true);
    await expect(p2.call("host:start")).rejects.toThrow(/Only the host/);
  });

  it("rejects unknown codes and duplicate display names get a suffix", async () => {
    const a = await new TestClient(server.url, "A").connect();
    clients.push(a);
    await expect(a.call("room:join", { code: "ZZZZ", displayName: "A", avatar: "star" })).rejects.toThrow(/No room/);
    const { code } = await a.call<{ code: string }>("room:create", { displayName: "Sam", avatar: "star" });
    const b = await new TestClient(server.url, "B").connect();
    clients.push(b);
    await b.call("room:join", { code, displayName: "sam", avatar: "star" });
    await b.waitFor(() => b.room?.members.length === 2);
    expect(b.room!.members.map((m) => m.name)).toEqual(["Sam", "sam 2"]);
  });

  it("invite-only rooms need the invite key", async () => {
    const h = await new TestClient(server.url, "H").connect();
    clients.push(h);
    const { code } = await h.call<{ code: string }>("room:create", { displayName: "H", avatar: "star", settings: { inviteOnly: true } });
    await h.waitFor(() => !!h.room?.inviteKey);
    const x = await new TestClient(server.url, "X").connect();
    clients.push(x);
    await expect(x.call("room:join", { code, displayName: "X", avatar: "star" })).rejects.toThrow(/invite-only/);
    await x.call("room:join", { code, displayName: "X", avatar: "star", inviteKey: h.room!.inviteKey });
  });

  it("host can kick a player, who cannot rejoin", async () => {
    const { code, host, chris } = await lobby();
    const chrisId = chris.room!.myId!;
    await host.call("host:kick", { playerId: chrisId });
    await host.waitFor(() => host.room?.members.length === 2);
    await expect(chris.call("room:join", { code, displayName: "Chris", avatar: "flame" })).rejects.toThrow(/removed/);
  });

  it("rejects connections without a valid guest session", async () => {
    const c = new TestClient(server.url, "bad");
    await expect(c.connect("not-a-real-token-but-long-enough")).rejects.toThrow(/SESSION_INVALID/);
    c.close();
  });
});

describe("a full match over sockets", () => {
  it("starts, plays every segment, and produces consistent final standings", async () => {
    const { host, all } = await lobby();
    const spectator = await new TestClient(server.url, "Viewer").connect();
    clients.push(spectator);
    await spectator.call("room:join", { code: host.room!.code, displayName: "Viewer", as: "spectator" });

    await host.call("host:start");
    for (const c of all) await c.waitFor(() => !!c.state?.me, 5000, "player state");
    // each player gets their own private view
    expect(new Set(all.map((c) => c.state!.me!.playerId)).size).toBe(3);
    expect(host.state!.me!.isHost).toBe(true);
    expect("host" in host.state!).toBe(true);
    expect("host" in all[1]!.state!).toBe(false);

    // spectators never receive private state
    let leaked = false;
    spectator.socket.on("game:state", (s) => {
      const txt = JSON.stringify(s);
      if ("me" in s || /"instruction"|"myStance"|"myOpinion"|"offerId"|"myRole"/.test(txt)) leaked = true;
      if (s.bluff && !s.bluff.reveal && /"role":"(HONEST|BLUFF)"/.test(txt)) leaked = true;
    });

    const stops = all.map((c) => startBot(c));
    await host.waitFor(() => host.state?.phase.name === "RESULTS", 60_000, "results");
    stops.forEach((s) => s());

    const results = host.state!.results!;
    expect(results.standings).toHaveLength(3);
    for (const row of results.standings) {
      const fromLines = host.state!.scoreLines.filter((l) => l.playerId === row.playerId).reduce((a, l) => a + l.amount, 0);
      expect(row.total).toBe(fromLines);
    }
    expect(leaked).toBe(false);
    expect(host.events).toContain("MATCH_COMPLETED");
    await host.waitFor(() => server.mem.matches.length > 0, 3000, "persisted match");
    const saved = server.mem.matches.at(-1)!;
    expect(saved.players).toHaveLength(3);
    expect(saved.debates.length).toBe(4); // 3 hearings + the finale
    expect(saved.bluffs.length).toBe(3);

    await host.call("host:returnToLobby");
    await host.waitFor(() => host.room?.state !== "COMPLETED" && host.state === null);
    expect(host.room!.members.every((m) => !m.ready)).toBe(true);
  }, 90_000);
});

describe("cards, reconnects and host controls", () => {
  it("accepts a legal card, rejects an illegal one, and resolves through the reaction window", async () => {
    const { host, all } = await lobby();
    await host.call("host:start");
    const stops = all.map((c) => startBot(c, { yieldFloor: false }));
    // Play until the first rebuttal, where Switch Sides is legal.
    await host.waitFor(() => host.state?.phase.name === "COURT_REBUTTAL", 30_000, "rebuttal");
    stops.forEach((s) => s());
    const judge = all.find((c) => c.state!.court!.judges.includes(c.state!.me!.playerId))!;
    await expect(judge.act({ type: "PLAY_CARD", card: "RECEIPTS", targetEntryId: "nope" })).rejects.toThrow(/challenge/i);
    await judge.waitFor(() => judge.state!.me!.playableCards.includes("SWITCH_SIDES"));
    await judge.act({ type: "PLAY_CARD", card: "SWITCH_SIDES" });
    await host.waitFor(() => host.state!.pendingCard?.stage === "REACTION", 5000, "reaction window");
    await host.waitFor(() => host.state!.cardHistory.some((h) => h.card === "SWITCH_SIDES" && h.outcome === "RESOLVED"), 5000, "resolved");
    expect(host.state!.court!.sidesSwapped).toBe(true);
    expect(host.state!.players.find((p) => p.id === judge.state!.me!.playerId)!.charges).toBe(2);
    await host.call("host:end");
  }, 60_000);

  it("a player who disconnects mid-match reconnects into the same seat with their private state", async () => {
    const { code, host, ben, all } = await lobby();
    await host.call("host:start");
    await ben.waitFor(() => ben.state?.phase.name === "CALIBRATION_SUBMISSION", 10_000, "submission");
    await ben.act({ type: "SUBMIT_OPINION", value: 35, keepPrivate: false });
    const benId = ben.state!.me!.playerId;
    const token = ben.guestToken;
    ben.close();
    await host.waitFor(() => host.state!.players.find((p) => p.id === benId)?.connected === false, 5000, "ben offline");

    const again = await new TestClient(server.url, "Ben").connect(token);
    clients.push(again);
    await again.call("room:join", { code, as: "player" });
    await again.waitFor(() => !!again.state?.me, 5000, "rejoined state");
    expect(again.state!.me!.playerId).toBe(benId);
    expect(again.state!.me!.calibration?.myOpinion ?? again.state!.me!.calibration).toBeDefined();
    await host.waitFor(() => host.state!.players.find((p) => p.id === benId)?.connected === true, 5000, "ben online");
    void all;
    await host.call("host:end");
  }, 30_000);

  it("host can pause and resume; non-hosts cannot", async () => {
    const { host, ben } = await lobby();
    await host.call("host:start");
    await host.waitFor(() => !!host.state);
    await expect(ben.call("host:pause")).rejects.toThrow(/Only the host/);
    await host.call("host:pause");
    await ben.waitFor(() => ben.state?.phase.paused === true);
    expect(ben.state!.phase.deadline).toBeNull();
    await host.call("host:resume");
    await ben.waitFor(() => ben.state?.phase.paused === false);
    await host.call("host:end");
  });

  it("spectators vote once per question and only see advisory tallies after the bench decides", async () => {
    const { host, all } = await lobby();
    const viewer = await new TestClient(server.url, "Viewer").connect();
    clients.push(viewer);
    await viewer.call("room:join", { code: host.room!.code, displayName: "Viewer", as: "spectator" });
    await host.call("host:start");
    const stops = all.map((c) => startBot(c, { skip: ["COURT_VERDICT"] }));
    await viewer.waitFor(() => viewer.state?.phase.name === "COURT_VOTING", 30_000, "court voting");
    const court = viewer.state!.court!;
    expect(court.spectatorTally).toBeNull(); // hidden while the bench is voting
    const spec = viewer.state as unknown as { spectator: { canVote: boolean; voteKind: string } };
    expect(spec.spectator.canVote).toBe(true);
    expect(spec.spectator.voteKind).toBe("COURT");
    await viewer.call("spectator:vote", { actionId: "vote-aaaaaaaa", choice: court.debaterA });
    await viewer.call("spectator:vote", { actionId: "vote-bbbbbbbb", choice: court.debaterB }); // replaces, never adds
    await expect(viewer.call("spectator:vote", { actionId: "vote-cccccccc", choice: "someone-else" })).rejects.toThrow(/valid/);
    // players cannot cast audience votes
    await expect(host.call("spectator:vote", { actionId: "vote-dddddddd", choice: court.debaterA })).rejects.toThrow(/spectators/);
    const judge = all.find((c) => c.state!.court!.judges.includes(c.state!.me!.playerId))!;
    await judge.act({ type: "COURT_VERDICT", winnerId: court.debaterA });
    await viewer.waitFor(() => viewer.state?.phase.name === "COURT_REVEAL", 5000, "reveal");
    expect(viewer.state!.court!.spectatorTally).toEqual({ A: 0, B: 1 });
    // the advisory audience never overrides the judge in the default ruleset
    expect(viewer.state!.court!.reveal!.winnerId).toBe(court.debaterA);
    stops.forEach((s) => s());
    await host.call("host:end");
  }, 60_000);
});
