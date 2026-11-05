import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlayerGameState, PublicGameState } from "@hps/shared";
import { SpectrumSlider } from "@/components/game/slider";
import { ActionDock } from "@/components/game/action-dock";
import { StageContent } from "@/components/game/stage";
import { CardTray } from "@/components/game/cards-results-host";

afterEach(cleanup);

const players = [
  { id: "a", name: "Alex", avatar: "gavel", seat: 0, connected: true, removed: false, score: 0, charges: 3 },
  { id: "b", name: "Ben", avatar: "mask", seat: 1, connected: true, removed: false, score: 0, charges: 3 },
  { id: "c", name: "Chris", avatar: "flame", seat: 2, connected: true, removed: false, score: 0, charges: 3 },
];
const prompt = { id: "base:sp:01", packId: "base", question: "Pineapple on pizza?", leftLabel: "Crime", rightLabel: "Perfect", mature: false };

function baseState(over: Partial<PublicGameState> = {}): PublicGameState {
  return {
    matchId: "m",
    version: 1,
    status: "IN_GAME",
    serverNow: Date.now(),
    phase: { name: "CALIBRATION_SUBMISSION", segment: "CALIBRATION", label: "Submit", speakerId: null, enteredAt: Date.now(), deadline: Date.now() + 30_000, paused: false, pausedRemainingMs: null },
    progress: { segments: [] },
    players,
    calibration: { round: 0, totalRounds: 2, prompt, targets: [], opinionsLocked: [], predictionsLocked: [], reveal: null, distribution: null },
    court: null,
    bluff: null,
    finale: null,
    pendingCard: null,
    cardHistory: [],
    timeline: [],
    scoreLines: [],
    contractsActive: 0,
    results: null,
    chaosEnabled: true,
    contractsEnabled: true,
    evidencePoolSize: 0,
    ...over,
  };
}

function me(over: Partial<PlayerGameState["me"]> = {}): PlayerGameState["me"] {
  return {
    playerId: "a",
    isHost: true,
    legal: [],
    hint: null,
    calibration: null,
    contractOffers: null,
    contract: null,
    court: null,
    bluff: null,
    finale: null,
    charges: 3,
    cardPlayedThisUnit: false,
    playableCards: [],
    receiptTargets: [],
    crossExamTargets: [],
    myVault: [],
    skipRequestsLeft: 2,
    ...over,
  };
}

describe("SpectrumSlider", () => {
  it("is a labelled range in steps of 5 that reports changes", () => {
    const onChange = vi.fn();
    render(<SpectrumSlider value={50} onChange={onChange} leftLabel="Crime" rightLabel="Perfect" label="Your answer" />);
    const input = screen.getByLabelText("Your answer");
    expect(input).toHaveProperty("step", "5");
    expect(input.getAttribute("aria-valuetext")).toContain("50 out of 100");
    fireEvent.change(input, { target: { value: "65" } });
    expect(onChange).toHaveBeenCalledWith(65);
  });
});

describe("ActionDock", () => {
  it("renders the opinion form only when the server says it is legal, and sends the action", async () => {
    const act = vi.fn().mockResolvedValue({ version: 2 });
    const game = { ...baseState(), me: me({ legal: ["SUBMIT_OPINION"], calibration: { myOpinion: null, keptPrivate: false, targetId: "b", myPrediction: null } }) };
    render(<ActionDock game={game} act={act} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("lock"));
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith({ type: "SUBMIT_OPINION", value: 50, keepPrivate: true }));
  });

  it("shows a waiting note when there is nothing to do", () => {
    const game = { ...baseState(), me: me({ legal: [], hint: "Waiting for the others to lock in." }) };
    render(<ActionDock game={game} act={vi.fn()} />);
    expect(screen.getByTestId("waiting").textContent).toContain("Waiting for the others");
  });

  it("shows the bluff speaker their secret instruction", () => {
    const game = {
      ...baseState({ phase: { ...baseState().phase, name: "BLUFF_PREPARATION", segment: "BLUFF" }, calibration: null }),
      me: me({ bluff: { role: "SPEAKER", myGenuine: 20, instruction: { role: "BLUFF", claim: 75 }, myVote: null } }),
    };
    render(<ActionDock game={game} act={vi.fn()} />);
    expect(screen.getByTestId("bluff-instruction").textContent).toMatch(/Bluff.*75/);
  });

  it("surfaces server rejections as an alert", async () => {
    const act = vi.fn().mockRejectedValue(new Error("Too late — that phase has ended."));
    const game = { ...baseState(), me: me({ legal: ["SUBMIT_OPINION"] }) };
    render(<ActionDock game={game} act={act} />);
    fireEvent.click(screen.getByTestId("lock"));
    expect((await screen.findByRole("alert")).textContent).toContain("Too late");
  });
});

describe("StageContent", () => {
  it("shows lock progress without any private values", () => {
    render(<StageContent game={baseState({ calibration: { ...baseState().calibration!, opinionsLocked: ["a"] } })} />);
    expect(screen.getByTestId("prompt").textContent).toContain("Pineapple on pizza?");
    expect(screen.getByText(/Answers locked: 1\/3/)).toBeTruthy();
  });
});

describe("CardTray", () => {
  it("disables cards the server has not listed as playable", () => {
    const game = { ...baseState(), me: me({ playableCards: ["SWITCH_SIDES"] }) };
    render(<CardTray game={game} act={vi.fn()} />);
    expect((screen.getByTestId("card-SWITCH_SIDES") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("card-RECEIPTS") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("3 influence charges left")).toBeTruthy();
  });
});
