import Link from "next/link";
import { Button } from "@hps/ui";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { Stamp } from "@/components/game/primitives";

export default function NotFound() {
  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 py-24">
        <p className="kicker tabular text-chaos">Case no. 404</p>
        <div className="relative mt-4 max-w-3xl">
          <h1 className="headline-xl">
            This page
            <br />
            was thrown
            <br />
            out of court
          </h1>
          <Stamp id="overruled" label="Overruled" rotate={-12} className="absolute -right-4 top-1/3 hidden w-56 sm:block md:-right-40 md:w-72" />
        </div>
        <p className="deck mt-8 max-w-xl text-ink-soft">The link may be old, or the room it pointed to has closed. Rooms only last while someone is playing.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/">Back to the front page</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/store">Browse packs</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
