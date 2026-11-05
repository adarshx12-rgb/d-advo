"use client";

import { useId } from "react";
import { cn } from "@hps/ui";

/**
 * The spectrum control used everywhere a 0–100 answer is given. A native range input underneath,
 * so keyboard (arrows, Page Up/Down, Home/End) and screen readers work without extra code.
 */
export function SpectrumSlider({
  value,
  onChange,
  leftLabel,
  rightLabel,
  disabled,
  marker,
  label,
  tone = "violet",
}: {
  value: number;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
  disabled?: boolean;
  /** An extra fixed marker, e.g. a public claim. */
  marker?: { value: number; label: string } | null;
  label: string;
  tone?: "violet" | "cyan" | "amber";
}) {
  const id = useId();
  const color = tone === "cyan" ? "var(--color-cyan)" : tone === "amber" ? "var(--color-amber)" : "var(--color-violet)";
  return (
    <div className="w-full">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="mb-2 flex items-end justify-between gap-4">
        <span className="max-w-[40%] body-4 text-ink-soft">{leftLabel}</span>
        <span className="tabular heading-2" style={{ color }} aria-hidden>
          {value}
        </span>
        <span className="max-w-[40%] text-right body-4 text-ink-soft">{rightLabel}</span>
      </div>
      <div className="relative">
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          disabled={disabled}
          aria-valuetext={`${value} out of 100, between ${leftLabel} and ${rightLabel}`}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            "h-12 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50",
            "[&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-surface-raised",
            "[&::-webkit-slider-thumb]:-mt-[10px] [&::-webkit-slider-thumb]:size-8 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-stage [&::-webkit-slider-thumb]:bg-[var(--thumb)]",
            "[&::-moz-range-track]:h-3 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-surface-raised",
            "[&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-stage [&::-moz-range-thumb]:bg-[var(--thumb)]",
          )}
          style={{ ["--thumb" as string]: color }}
        />
        {marker && (
          <div className="pointer-events-none absolute -bottom-4 -translate-x-1/2 text-center" style={{ left: `calc(${marker.value}% * 0.94 + 3%)` }}>
            <div className="mx-auto h-3 w-0.5 bg-amber" />
            <div className="whitespace-nowrap caption-3 font-semibold text-amber">
              {marker.label} {marker.value}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between caption-3 font-semibold text-ink-faint tabular" aria-hidden>
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}

/** A static position readout for already-locked or revealed values. */
export function SpectrumBar({ points, leftLabel, rightLabel }: { points: { value: number; label: string; color?: string }[]; leftLabel: string; rightLabel: string }) {
  return (
    <div className="w-full">
      <div className="relative h-3 rounded-full bg-surface-raised">
        {points.map((p, i) => (
          <div key={i} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.value}%` }} title={`${p.label}: ${p.value}`}>
            <div className="size-4 rounded-full border-2 border-stage" style={{ background: p.color ?? "var(--color-violet)" }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between caption-3 text-ink-faint">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}
