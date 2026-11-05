import type { MatchLength, MatchType, RoomSettings } from "@hps/shared";

/** All durations in seconds. Multiplied by `timerScale` when converted to ms. */
export interface TimerConfig {
  calibrationPrompt: number;
  calibrationSubmission: number;
  calibrationPrediction: number;
  calibrationDiscussion: number;
  calibrationReveal: number;
  contractSelection: number;
  courtPreparation: number;
  courtOpening: number;
  courtRebuttal: number;
  courtChallenge: number;
  courtClosing: number;
  courtVoting: number;
  courtReveal: number;
  bluffPreparation: number;
  bluffStatement: number;
  bluffDiscussion: number;
  bluffVoting: number;
  bluffReveal: number;
  finalePreparation: number;
  finaleOpening: number;
  finaleRebuttal: number;
  finaleInvestigation: number;
  finaleVoting: number;
  finaleReveal: number;
  /** Window in which simultaneous card plays compete by priority instead of arrival order. */
  cardCollect: number;
  /** Window in which an offensive card can be met with an Objection. */
  cardReaction: number;
  /** Extra time granted by Cross-Examination. */
  crossExamination: number;
}

export const DEFAULT_TIMERS: TimerConfig = {
  calibrationPrompt: 5,
  calibrationSubmission: 30,
  calibrationPrediction: 25,
  calibrationDiscussion: 20,
  calibrationReveal: 12,
  contractSelection: 25,
  // Court timings follow the spec exactly.
  courtPreparation: 15,
  courtOpening: 30,
  courtRebuttal: 20,
  courtChallenge: 20,
  courtClosing: 15,
  courtVoting: 15,
  courtReveal: 10,
  // Bluff: the spec's 10s preparation is too short to lock an answer AND read a secret instruction,
  // so preparation defaults to 15s. Everything else follows the spec.
  bluffPreparation: 15,
  bluffStatement: 30,
  bluffDiscussion: 30,
  bluffVoting: 15,
  bluffReveal: 10,
  finalePreparation: 25,
  finaleOpening: 40,
  finaleRebuttal: 30,
  finaleInvestigation: 40,
  finaleVoting: 25,
  finaleReveal: 15,
  cardCollect: 1,
  cardReaction: 6,
  crossExamination: 20,
};

export interface SegmentToggles {
  calibration: boolean;
  contracts: boolean;
  court: boolean;
  bluff: boolean;
  finale: boolean;
}

export interface MatchConfig {
  segments: SegmentToggles;
  calibrationRounds: number;
  courtHearings: number;
  bluffTurns: number;
  timers: TimerConfig;
  /** 1 in normal play. Tests and E2E use a small value to run matches quickly. */
  timerScale: number;
  chaosEnabled: boolean;
  contractsEnabled: boolean;
  startingCharges: number;
  manualProgression: boolean;
  audienceEnabled: boolean;
  maxSkipRequestsPerPlayer: number;
  /** Bluff fabrications differ from the genuine answer by at least this much. */
  minBluffDistance: number;
  /** Sample packs evenly instead of weighting by pack size. */
  randomMix: boolean;
}

const CALIBRATION_ROUNDS: Record<MatchLength, number> = { QUICK: 2, STANDARD: 3, LONG: 4 };
const LARGE_HEARINGS: Record<MatchLength, number> = { QUICK: 2, STANDARD: 3, LONG: 4 };
const LARGE_BLUFF_TURNS: Record<MatchLength, number> = { QUICK: 3, STANDARD: 4, LONG: 6 };

function segmentsFor(type: MatchType, contracts: boolean): SegmentToggles {
  return {
    calibration: true,
    contracts,
    court: type !== "OPINIONS_AND_BLUFF",
    bluff: type !== "OPINIONS_AND_COURT",
    finale: true,
  };
}

/**
 * Derives the match format from room settings and lobby size.
 * Three-player matches always use the spec's 3 hearings / 3 bluff turns so everyone
 * debates twice, judges once, speaks once and investigates twice.
 */
export function buildMatchConfig(
  settings: Pick<
    RoomSettings,
    "matchType" | "matchLength" | "chaosEnabled" | "contractsEnabled" | "progression" | "audienceEnabled" | "randomMix"
  >,
  playerCount: number,
  overrides: Partial<Pick<MatchConfig, "timerScale">> & { timers?: Partial<TimerConfig> } = {},
): MatchConfig {
  const three = playerCount === 3;
  return {
    segments: segmentsFor(settings.matchType, settings.contractsEnabled),
    calibrationRounds: CALIBRATION_ROUNDS[settings.matchLength],
    courtHearings: three ? 3 : LARGE_HEARINGS[settings.matchLength],
    bluffTurns: three ? 3 : Math.min(playerCount, LARGE_BLUFF_TURNS[settings.matchLength]),
    timers: { ...DEFAULT_TIMERS, ...(overrides.timers ?? {}) },
    timerScale: overrides.timerScale ?? 1,
    chaosEnabled: settings.chaosEnabled,
    contractsEnabled: settings.contractsEnabled,
    startingCharges: 3,
    manualProgression: settings.progression === "MANUAL",
    audienceEnabled: settings.audienceEnabled,
    maxSkipRequestsPerPlayer: 2,
    minBluffDistance: 35,
    randomMix: settings.randomMix,
  };
}

export function secondsToMs(config: MatchConfig, seconds: number): number {
  return Math.max(50, Math.round(seconds * 1000 * config.timerScale));
}
