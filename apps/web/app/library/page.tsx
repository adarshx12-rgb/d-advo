"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon as Check, PackageIcon as Package, PaletteIcon as Palette, ReceiptIcon as Receipt } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, cn, Skeleton } from "@hps/ui";
import { formatInr } from "@hps/shared";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { api, getUserToken } from "@/lib/session";

interface Library {
  ownership: { packIds: string[]; themeIds: string[]; streamerBranding: boolean };
  equippedTheme: string;
  themes: { id: string; name: string; description: string; owned: boolean }[];
  purchases: { id: string; productName: string; amountPaise: number; status: string; receiptNumber: string | null; createdAt: string; mode: string }[];
}

const PACK_NAMES: Record<string, string> = {
  base: "Base Game",
  "dark-humor": "Dark Humor",
  "friendship-destroyer": "Friendship Destroyer",
  dating: "Dating & Relationships",
  "anime-gaming": "Anime & Gaming",
};

export default function LibraryPage() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!getUserToken()) return setError("Sign in to see your library.");
    api<Library>("/api/library").then(setLib, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const equip = async (themeId: string) => {
    try {
      await api("/api/library/equip", { body: { themeId } });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-5xl space-y-8 px-4 pb-16">
        <h1 className="heading-1">Library</h1>
        {error && (
          <p role="alert" className="text-ink-soft">
            {error}{" "}
            {!getUserToken() && (
              <Link className="text-violet-bright underline" href="/account?next=/library">
                Sign in
              </Link>
            )}
          </p>
        )}
        {!lib && !error && (
          <div className="space-y-4" aria-label="Loading library">
            <Skeleton className="h-8 w-40" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="mt-8 h-8 w-48" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        )}
        {lib && (
          <>
            <section>
              <h2 className="flex items-center gap-2 heading-4">
                <Package className="size-6" /> Packs
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="owned-packs">
                {lib.ownership.packIds.map((id) => (
                  <li key={id} className="flex items-center justify-between rounded-xl border border-line bg-surface p-3">
                    <span className="font-semibold">{PACK_NAMES[id] ?? id}</span>
                    <Badge tone="teal">
                      <Check className="size-3" /> Owned
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 body-6 text-ink-faint">Turn packs on in the lobby of any room you host.</p>
            </section>

            <section>
              <h2 className="flex items-center gap-2 heading-4">
                <Palette className="size-6" /> Card themes
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {lib.themes.map((t) => (
                  <li key={t.id} className={cn("flex items-center justify-between gap-3 rounded-xl border bg-surface p-3", lib.equippedTheme === t.id ? "border-violet" : "border-line")}>
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="caption-5 text-ink-faint">{t.description}</div>
                    </div>
                    {lib.equippedTheme === t.id ? (
                      <Badge tone="violet">Equipped</Badge>
                    ) : t.owned ? (
                      <Button size="sm" variant="secondary" onClick={() => equip(t.id)}>
                        Equip
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/store/theme-${t.id}`}>View</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="flex items-center gap-2 heading-4">
                <Receipt className="size-6" /> Purchases
              </h2>
              {lib.purchases.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-line bg-surface p-6">
                  <p className="title-3">No purchases yet</p>
                  <p className="body-6 mt-2 text-ink-soft">The Base Game is already yours. Packs you buy show up here with their receipts.</p>
                  <Button asChild variant="secondary" className="mt-4">
                    <Link href="/store">Browse the store</Link>
                  </Button>
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                  <table className="w-full body-6">
                    <thead className="bg-surface text-left caption-5 text-ink-faint">
                      <tr>
                        <th className="p-3">Item</th>
                        <th className="p-3">Amount</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Receipt</th>
                        <th className="p-3">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lib.purchases.map((p) => (
                        <tr key={p.id} className="border-t border-line">
                          <td className="p-3 font-semibold">
                            {p.productName} {p.mode === "MOCK" && <Badge tone="amber">test</Badge>}
                          </td>
                          <td className="tabular p-3">{formatInr(p.amountPaise)}</td>
                          <td className="p-3">{p.status.toLowerCase()}</td>
                          <td className="p-3 font-mono caption-5">{p.receiptNumber ?? "—"}</td>
                          <td className="p-3 text-ink-faint">{new Date(p.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
