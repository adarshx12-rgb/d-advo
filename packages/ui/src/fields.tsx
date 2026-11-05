import * as React from "react";
import { cn } from "./cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "body-3 h-11 w-full rounded-md border border-ink/25 bg-surface px-3 text-ink transition-colors duration-300 ease-base placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-40 aria-[invalid=true]:border-chaos",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("title-4 text-ink-soft", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "violet" | "cyan" | "amber" | "chaos" | "teal" }) {
  const tones = {
    neutral: "bg-surface-raised text-ink-soft border-line",
    violet: "bg-violet/15 text-violet-bright border-violet/40",
    cyan: "bg-cyan/10 text-cyan border-cyan/40",
    amber: "bg-amber/15 text-amber border-amber/40",
    chaos: "bg-chaos/15 text-chaos border-chaos/40",
    teal: "bg-teal/15 text-teal border-teal/40",
  } as const;
  return <span className={cn("caption-3 inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 [&_svg]:size-3", tones[tone], className)} {...props} />;
}

/** B9: loading states are skeletons shaped like the real layout, never spinners. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-raised", className)} {...props} />;
}
