import { SiteFooter, SiteHeader } from "@/components/shell/site-header";

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: string[] }[] }) {
  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16">
        <article>
          <h1 className="heading-2">{title}</h1>
          <p className="caption-2 mt-4 text-ink-faint">Last updated {updated}</p>
          {sections.map((s) => (
            <section key={s.heading} className="mt-12">
              <h2 className="heading-5">{s.heading}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="body-3 mt-4 text-ink-soft">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
