"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftIcon as ArrowLeft, CheckIcon as Check, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button } from "@hps/ui";
import { formatInr } from "@hps/shared";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { BuyButton } from "@/components/shell/checkout";
import { api } from "@/lib/session";
import { Cover, type StoreProduct } from "@/components/shell/store-shared";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<StoreProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ product: StoreProduct }>(`/api/store/products/${id}`).then(
      (r) => setP(r.product),
      (e: Error) => setError(e.message),
    );
  }, [id]);
  useEffect(load, [load]);

  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-5xl px-4 pb-16">
        <Link href="/store" className="inline-flex items-center gap-1 body-6 text-ink-soft hover:text-ink">
          <ArrowLeft className="size-4" /> Store
        </Link>
        {error && <p role="alert" className="mt-6 text-chaos">{error}</p>}
        {p && (
          <div className="mt-4 grid gap-8 md:grid-cols-[1fr_1.1fr]">
            <Cover p={p} tall />
            <div>
              <h1 className="heading-2" data-testid="product-name">
                {p.name}
              </h1>
              <p className="title-2 text-ink-soft">{p.tagline}</p>
              <p className="mt-4 text-ink-soft">{p.description}</p>
              {p.promptCounts && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge>{p.promptCounts.safe} everyday prompts</Badge>
                  {p.promptCounts.mature > 0 && <Badge tone="chaos">{p.promptCounts.mature} optional 18+ prompts (off by default)</Badge>}
                </div>
              )}
              <div className="mt-6 flex items-center gap-4">
                <span className="tabular heading-2">{p.pricePaise === 0 ? "Free" : formatInr(p.pricePaise)}</span>
              </div>
              <div className="mt-4">
                {p.owned ? (
                  <div className="space-y-2">
                    <Badge tone="teal" className="body-6">
                      <Check className="size-4" /> You own this
                    </Badge>
                    <div>
                      <Button asChild variant="secondary">
                        <Link href={p.kind === "CREATOR" ? "/branding" : p.kind === "COSMETIC_THEME" ? "/library" : "/"}>
                          {p.kind === "CREATOR" ? "Set up branding" : p.kind === "COSMETIC_THEME" ? "Equip in library" : "Host a room with it"}
                        </Link>
                      </Button>
                    </div>
                  </div>
                ) : p.purchasable ? (
                  <BuyButton productId={p.id} label={`Buy for ${formatInr(p.pricePaise)}`} onPurchased={load} />
                ) : (
                  <p className="text-ink-faint">Not on sale yet.</p>
                )}
              </div>
              <p className="mt-6 flex items-start gap-2 body-6 text-ink-faint">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                {p.kind === "CONTENT_PACK"
                  ? "Owned by your account. When you host, everyone in your room can play these prompts — they don't need to buy it."
                  : p.kind === "COSMETIC_THEME"
                    ? "Cosmetic only. It changes how cards look, nothing about how the game plays."
                    : "Applies to rooms you host and their broadcast view."}
              </p>
            </div>
          </div>
        )}
        {p && p.preview.length > 0 && (
          <section className="mt-10">
            <h2 className="heading-4">Sample prompts</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {p.preview.map((q) => (
                <li key={q.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="caption-3 text-ink-faint">{q.mode.toLowerCase()}</div>
                  <div className="mt-1 font-semibold">{q.question}</div>
                  <div className="mt-2 flex justify-between caption-5 text-ink-faint">
                    <span>{q.leftLabel}</span>
                    <span>{q.rightLabel}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
