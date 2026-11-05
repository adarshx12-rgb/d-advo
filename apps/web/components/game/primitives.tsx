"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CatIcon as Cat, CrownIcon as Crown, DiceFiveIcon as Dices, EyeIcon as Eye, FlameIcon as Flame, GavelIcon as Gavel, GhostIcon as Ghost, RocketIcon as Rocket, SkullIcon as Skull, StarIcon as Star, MaskHappyIcon as VenetianMask, WifiHighIcon as Wifi, WifiSlashIcon as WifiOff, LightningIcon as Zap } from "@phosphor-icons/react/dist/ssr";
import type { Icon as LucideIcon } from "@phosphor-icons/react";
import { cn } from "@hps/ui";
import type { PhaseView, PlayerView, ProgressView } from "@hps/shared";
import { serverNow } from "@/lib/socket";
import type { ConnectionState } from "@/hooks/use-room";

/** B7 base curve, shared by every Motion animation. */
export const EASE = [0.22, 1, 0.36, 1] as const;

const AVATAR_ICONS: Record<string, LucideIcon> = {
  gavel: Gavel,
  mask: VenetianMask,
  flame: Flame,
  ghost: Ghost,
  crown: Crown,
  rocket: Rocket,
  cat: Cat,
  skull: Skull,
  star: Star,
  bolt: Zap,
  eye: Eye,
  dice: Dices,
};

const AVATAR_TINTS = ["#8b6cff", "#3fd6e8", "#f2b441", "#f0508c", "#2cc6a6", "#ff8a5c", "#b3e05a", "#e18bff"];

export function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length]!;
}

/** Sticker art lives in /public/art/avatars; ids map one to one. Unknown ids fall back to an icon chip. */
export function PlayerAvatar({ avatar, id, size = 40, dimmed, className }: { avatar: string; id: string; size?: number; dimmed?: boolean; className?: string }) {
  if (AVATAR_ICONS[avatar]) {
    return (
      <img
        src={`/art/avatars/${avatar}.webp`}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        className={cn("inline-block shrink-0 select-none object-contain drop-shadow-[0_2px_2px_rgb(0_0_0/0.18)]", dimmed && "opacity-40 grayscale", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const Icon = Star;
  const tint = tintFor(id);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full border-2", dimmed && "opacity-40 grayscale", className)}
      style={{ width: size, height: size, borderColor: tint, color: tint }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} weight="bold" />
    </span>
  );
}

export function AvatarPicker({ value, onChange, idSeed }: { value: string; onChange: (a: string) => void; idSeed: string }) {
  return (
    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-6 gap-2">
      {Object.keys(AVATAR_ICONS).map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          aria-label={a}
          onClick={() => onChange(a)}
          className={cn(
            "flex aspect-square items-center justify-center rounded-lg border-2 border-transparent transition-[border-color,background-color,transform] duration-300 ease-base hover:-rotate-3 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
            value === a && "-rotate-3 scale-105 border-dashed border-ink bg-highlight/40",
          )}
        >
          <PlayerAvatar avatar={a} id={idSeed + a} size={44} />
        </button>
      ))}
    </div>
  );
}

export function ScoreDisplay({ value, className, label = "VP" }: { value: number; className?: string; label?: string }) {
  return (
    <span className={cn("tabular inline-flex items-baseline gap-1", className)} aria-label={`${value} verdict points`}>
      <motion.span key={value} initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.3, ease: EASE }} className="heading-5">
        {value}
      </motion.span>
      <span className="caption-3 text-ink-faint">{label}</span>
    </span>
  );
}

export function PlayerCard({
  player,
  you,
  status,
  rank,
  highlight,
  compact,
}: {
  player: PlayerView;
  you?: boolean;
  status?: string | null;
  rank?: number;
  highlight?: "speaking" | "spotlight" | null;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors",
        highlight === "speaking" && "border-cyan/60 bg-cyan/8",
        highlight === "spotlight" && "border-amber/50 bg-amber/8",
        player.removed && "opacity-50",
      )}
      data-testid={`player-${player.name}`}
    >
      {rank !== undefined && <span className="tabular w-5 text-right body-4 text-ink-faint">{rank}</span>}
      <PlayerAvatar avatar={player.avatar} id={player.id} size={compact ? 32 : 38} dimmed={!player.connected} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{player.name}</span>
          {you && <span className="caption-3 text-violet-bright">(you)</span>}
          {!player.connected && !player.removed && <span className="caption-5 text-chaos">offline</span>}
        </div>
        {status && <div className="truncate caption-5 text-ink-faint">{status}</div>}
      </div>
      <ScoreDisplay value={player.score} />
    </div>
  );
}

function remainingMs(phase: PhaseView): number | null {
  if (phase.paused) return phase.pausedRemainingMs;
  if (phase.deadline === null) return null;
  return Math.max(0, phase.deadline - serverNow());
}

export function useRemaining(phase: PhaseView | undefined, delayMs = 0): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!phase) return null;
  const r = remainingMs(phase);
  return r === null ? null : Math.max(0, r + delayMs);
}

/** Countdown against the server deadline; total is the phase length used for the bar. */
export function CountdownTimer({ phase, className, delayMs = 0, large }: { phase: PhaseView; className?: string; delayMs?: number; large?: boolean }) {
  const ms = useRemaining(phase, delayMs);
  if (ms === null) {
    return (
      <div className={cn("body-4 text-ink-faint", className)} aria-label="Waiting for the host">
        {phase.paused ? "Paused" : "Host advances"}
      </div>
    );
  }
  const total = phase.deadline !== null ? Math.max(1, phase.deadline - phase.enteredAt) : ms;
  const secs = Math.ceil(ms / 1000);
  const frac = Math.min(1, ms / total);
  const urgent = secs <= 5 && !phase.paused;
  return (
    <div className={cn("flex items-center gap-3", className)} role="timer" aria-label={`${secs} seconds left${phase.paused ? ", paused" : ""}`}>
      <div className={cn("relative h-2 overflow-hidden rounded-full bg-surface-raised", large ? "w-56" : "w-24 sm:w-32")}>
        {/* B7: animate transform only, never width. */}
        <div
          className={cn("absolute inset-0 origin-left rounded-full transition-transform duration-300 ease-base", urgent ? "bg-chaos" : "bg-cyan")}
          style={{ transform: `scaleX(${frac})` }}
        />
      </div>
      <span className={cn("tabular", large ? "heading-2" : "heading-4", urgent ? "text-chaos" : "text-ink", phase.paused && "text-ink-faint")}>
        {phase.paused ? "II" : secs}
      </span>
    </div>
  );
}

/** The show's rundown: where we are in the match. Segment count comes from the server, never hardcoded. */
export function MatchProgress({ progress, className }: { progress: ProgressView; className?: string }) {
  return (
    <ol className={cn("flex items-center gap-1 overflow-x-auto", className)} aria-label="Match progress">
      {progress.segments.map((s) => (
        <li
          key={s.key}
          aria-current={s.status === "current" ? "step" : undefined}
          className={cn(
            "caption-3 flex shrink-0 items-center gap-2 rounded-full border border-transparent px-3 py-1 transition-colors duration-300 ease-base",
            s.status === "current" && "bg-ink text-ink-dark",
            s.status === "done" && "text-ink-faint",
            s.status === "upcoming" && "border-line text-ink-soft",
          )}
        >
          {s.label}
          {s.status === "current" && s.detail && <span className="tabular opacity-75">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const online = state === "online";
  return (
    <span className={cn("inline-flex items-center gap-2 caption-3", online ? "text-teal" : "text-chaos")} role="status" aria-live="polite">
      {online ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
      {online ? "Connected" : state === "connecting" ? "Connecting" : "Reconnecting…"}
    </span>
  );
}

/** Rubber stamp art in /public/art/stamps. */
export type StampId = "bluff" | "case-closed" | "evidence" | "guilty" | "honest" | "locked-in" | "not-guilty" | "objection" | "overruled" | "sustained" | "verdict";

export function Stamp({ id, label, className, rotate = -6 }: { id: StampId; label: string; className?: string; rotate?: number }) {
  return (
    <img
      src={`/art/stamps/${id}.webp`}
      alt={label}
      draggable={false}
      className={cn("animate-stamp pointer-events-none select-none", className)}
      style={{ ["--stamp-rot" as string]: `${rotate}deg` }}
    />
  );
}

/** Brief confirmation that lands like a rubber stamp when the player locks something in. */
export function LockedStamp({ show, text }: { show: boolean; text: string }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} role="status">
          <Stamp id="locked-in" label={text} className="h-10 w-auto" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
