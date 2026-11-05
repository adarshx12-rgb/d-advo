"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/ssr";
import { Badge, Skeleton } from "@hps/ui";
import { formatInr } from "@hps/shared";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { api } from "@/lib/session";
import { Cover, type StoreProduct } from "@/components/shell/store-shared";

const SECTIONS: { kind: StoreProduct["kind"]; title: string; blurb: string }[] = [
  { kind: "CONTENT_PACK", title: "Content packs", blurb: "New prompts for every mode. Bought once by a host, playable by everyone in their rooms." },
  { kind: "COSMETIC_THEME", title: "Card themes", blurb: "Purely cosmetic. They never change scores, timers or odds." },
  { kind: "CREATOR", title: "Creator tools", blurb: "For hosts who stream." },
];

export default function StorePage() {
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [mode, setMode] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ products: StoreProduct[]; mode: string }>("/api/store/products").then(
      (r) => {
        setProducts(r.products);
        setMode(r.mode);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <h1 className="heading-1">Store</h1>
        <p className="body-3 mt-4 max-w-[680px] text-ink-soft">The Base Game is free forever and fully playable. Nothing here buys points, extra influence, or an advantage of any kind.</p>
        {mode === "MOCK" && (
          <p className="mt-3 inline-block rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 body-6 text-amber">Test payment mode. Purchases are simulated and never charge a card.</p>
        )}
        {error && <p role="alert" className="body-6 mt-4 text-chaos">Could not load the store. {error}</p>}
        {!products && !error && (
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading products">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="rounded-2xl border border-line bg-surface p-3">
                <Skeleton className="h-32 rounded-xl" />
                <Skeleton className="mt-3 h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </div>
            ))}
          </div>
        )}
        {products &&
          SECTIONS.map((s) => {
            const items = products.filter((p) => p.kind === s.kind && p.published);
            if (!items.length) return null;
            return (
              <section key={s.kind} className="mt-16">
                <h2 className="heading-4">{s.title}</h2>
                <p className="mb-4 body-6 text-ink-faint">{s.blurb}</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => (
                    <ProductTile key={p.id} p={p} />
                  ))}
                </div>
              </section>
            );
          })}
      </main>
      <SiteFooter />
    </div>
  );
}

function ProductTile({ p }: { p: StoreProduct }) {
  return (
    <Link
      href={`/store/${p.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 transition-[border-color,transform] duration-300 ease-base hover:-translate-y-0.5 hover:border-ink-faint active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      data-testid={`product-${p.id}`}
    >
      <Cover p={p} />
      <div className="flex-1 px-1">
        <div className="font-semibold">{p.name}</div>
        <div className="body-6 text-ink-faint">{p.tagline}</div>
      </div>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="tabular heading-5">{p.pricePaise === 0 ? "Free" : formatInr(p.pricePaise)}</span>
        {p.owned ? (
          <Badge tone="teal">
            <Check className="size-3" /> Owned
          </Badge>
        ) : p.promptCounts ? (
          <Badge>{p.promptCounts.safe + p.promptCounts.mature} prompts</Badge>
        ) : null}
      </div>
    </Link>
  );
}
