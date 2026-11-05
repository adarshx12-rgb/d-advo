import { cn } from "@hps/ui";

export interface StoreProduct {
  id: string;
  kind: "CONTENT_PACK" | "COSMETIC_THEME" | "CREATOR" | "BUNDLE";
  name: string;
  tagline: string;
  description: string;
  pricePaise: number | null;
  packId: string | null;
  themeId: string | null;
  accent: string;
  owned: boolean;
  purchasable: boolean;
  published: boolean;
  preview: { id: string; mode: string; question: string; leftLabel: string; rightLabel: string }[];
  promptCounts: { safe: number; mature: number } | null;
}

export const ACCENT: Record<string, string> = {
  violet: "var(--color-violet)",
  cyan: "var(--color-cyan)",
  amber: "var(--color-amber)",
  rose: "var(--color-chaos)",
  teal: "var(--color-teal)",
};

export function Cover({ p, tall }: { p: Pick<StoreProduct, "name" | "accent" | "kind">; tall?: boolean }) {
  const c = ACCENT[p.accent] ?? ACCENT.violet;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-line", tall ? "h-56" : "h-32")} style={{ background: `color-mix(in oklab, ${c} 22%, var(--color-stage))` }} aria-hidden>
      <div className="absolute -right-6 -top-8 size-36 rounded-full border-[14px] opacity-40" style={{ borderColor: c }} />
      <div className="absolute bottom-3 left-4 right-4 heading-4" style={{ color: c }}>
        {p.name}
      </div>
    </div>
  );
}

