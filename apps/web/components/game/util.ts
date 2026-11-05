import type { ChaosCardType, PlayerView, PublicGameState, Side } from "@hps/shared";

export function nameOf(state: Pick<PublicGameState, "players">, id: string | null | undefined): string {
  if (!id) return "—";
  return state.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function playerOf(state: Pick<PublicGameState, "players">, id: string | null | undefined): PlayerView | undefined {
  return id ? state.players.find((p) => p.id === id) : undefined;
}

export function sideLabel(side: Side | null | undefined): string {
  return side === "FOR" ? "Arguing FOR" : side === "AGAINST" ? "Arguing AGAINST" : "Side hidden";
}

export const CARD_COPY: Record<ChaosCardType, { name: string; blurb: string; tone: "chaos" | "amber" | "cyan" | "violet" }> = {
  SWITCH_SIDES: { name: "Switch sides", blurb: "Both debaters must swap positions for the rest of this hearing.", tone: "chaos" },
  RECEIPTS: { name: "Receipts", blurb: "Bring up a debater's earlier answer as evidence for the room.", tone: "amber" },
  OBJECTION: { name: "Objection", blurb: "Cancel a card just played. Cannot itself be objected to.", tone: "violet" },
  CROSS_EXAMINATION: { name: "Cross examination", blurb: "Force a debater to answer one direct question before continuing.", tone: "cyan" },
};

/** Playing card art in /public/art/cards. */
export const CARD_ART: Record<ChaosCardType, string> = {
  SWITCH_SIDES: "/art/cards/switch-sides.webp",
  RECEIPTS: "/art/cards/receipts.webp",
  OBJECTION: "/art/cards/objection.webp",
  CROSS_EXAMINATION: "/art/cards/cross-examination.webp",
};
export const CARD_BACK = "/art/cards/back.webp";

export const PHASE_HELP: Partial<Record<string, string>> = {
  CALIBRATION_PROMPT: "Read the question. Answers stay private until the reveal.",
  CALIBRATION_SUBMISSION: "Place your honest answer on the spectrum.",
  CALIBRATION_PREDICTION: "Guess where your assigned player placed their answer. Closer is better.",
  CALIBRATION_DISCUSSION: "Talk it out. Nothing you say changes the locked numbers.",
  CALIBRATION_REVEAL: "Answers and predictions revealed.",
  CONTRACT_SELECTION: "Pick a secret objective. Only you will see it until the results.",
  COURT_PREPARATION: "Debaters lock their real stance. Judges predict it.",
  COURT_OPENING: "Debaters present their opening arguments.",
  COURT_REBUTTAL: "Debaters respond to each other.",
  COURT_CHALLENGE: "Judges may press the debaters.",
  COURT_CLOSING: "Final words before the bench decides.",
  COURT_VOTING: "Judges choose the more convincing debater.",
  COURT_REVEAL: "The verdict is in.",
  BLUFF_PREPARATION: "The speaker locks their genuine answer and receives a secret instruction.",
  BLUFF_STATEMENT: "The speaker defends the claimed number out loud.",
  BLUFF_DISCUSSION: "Investigators question the speaker.",
  BLUFF_VOTING: "Investigators decide: honest or bluffing?",
  BLUFF_REVEAL: "The truth comes out.",
  FINALE_PREPARATION: "Finalists lock their real stance on the final question.",
  FINALE_DEBATE: "The final debate. Some may be arguing against what they believe.",
  FINALE_INVESTIGATION: "Investigators size up who is honest.",
  FINALE_VOTING: "Cast your final ballots.",
  FINALE_REVEAL: "The final verdict and every hidden role.",
  RESULTS: "Final standings.",
};
