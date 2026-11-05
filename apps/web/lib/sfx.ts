"use client";

import type { GameEventKind } from "@hps/shared";

/** Tiny synthesized cues (no audio files). Muted state persists per browser. */
const MUTE_KEY = "hps.muted";
let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
export function setMuted(m: boolean) {
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("hps:mute"));
}

const CUES: Partial<Record<GameEventKind | "LOCK" | "TICK", [number, number, OscillatorType][]>> = {
  PHASE_CHANGED: [[520, 0.06, "sine"]],
  LOCK: [[660, 0.05, "triangle"], [880, 0.07, "triangle"]],
  CARD_PLAYED: [[300, 0.08, "sawtooth"], [450, 0.1, "sawtooth"]],
  CARD_CANCELLED: [[420, 0.08, "square"], [210, 0.14, "square"]],
  EVIDENCE_REVEALED: [[740, 0.07, "triangle"], [990, 0.12, "triangle"]],
  WINNER_REVEALED: [[523, 0.09, "triangle"], [659, 0.09, "triangle"], [784, 0.18, "triangle"]],
  MATCH_COMPLETED: [[392, 0.12, "triangle"], [523, 0.12, "triangle"], [659, 0.12, "triangle"], [784, 0.3, "triangle"]],
  TICK: [[1200, 0.025, "sine"]],
};

export function playSfx(kind: GameEventKind | "LOCK" | "TICK") {
  if (typeof window === "undefined" || isMuted()) return;
  const cue = CUES[kind];
  if (!cue) return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur, type] of cue) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.85;
    }
  } catch {
    /* audio unavailable */
  }
}
