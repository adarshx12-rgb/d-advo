"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon as ArrowRight, UsersIcon as Users } from "@phosphor-icons/react/dist/ssr";
import { Button, cn, Input, Label } from "@hps/ui";
import type { AvatarId, ChaosCardType } from "@hps/shared";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { Reveal, StampReveal, TaglineReveal } from "@/components/shell/reveal";
import { AvatarPicker, Stamp, type StampId } from "@/components/game/primitives";
import { CARD_ART, CARD_COPY } from "@/components/game/util";
import { getProfile, saveProfile } from "@/lib/session";
import { call, getSocket } from "@/lib/socket";

const MODES = [
  {
    img: "/art/modes/read-the-room.webp",
    flag: "Round one",
    title: "Read the room",
    body: "Everyone answers a question on a 0 to 100 scale in private, then guesses where a friend landed. Nail it exactly and it is worth 100 points.",
  },
  {
    img: "/art/modes/devils-court.webp",
    flag: "Round two",
    title: "Devil's court",
    body: "Two debaters argue the side they were handed, not the one they believe. The bench scores the hearing and tries to guess their real stance.",
  },
  {
    img: "/art/modes/catch-the-bluff.webp",
    flag: "Round three",
    title: "Catch the bluff",
    body: "One speaker defends a number in front of everyone. It might be their honest answer, or one the game secretly told them to fake.",
  },
  {
    img: "/art/modes/finale.webp",
    flag: "The finale",
    title: "Final verdict",
    body: "The top two face off on one last question while the rest of the room investigates who is telling the truth.",
  },
];

const STAMPS: { id: StampId; label: string; rot: number }[] = [
  { id: "objection", label: "Objection", rot: -8 },
  { id: "sustained", label: "Sustained", rot: 5 },
  { id: "bluff", label: "Bluff", rot: -3 },
  { id: "honest", label: "Honest", rot: 7 },
  { id: "overruled", label: "Overruled", rot: -6 },
  { id: "evidence", label: "Evidence", rot: 4 },
  { id: "guilty", label: "Guilty", rot: -10 },
  { id: "not-guilty", label: "Not guilty", rot: 3 },
  { id: "verdict", label: "Verdict", rot: -4 },
];

const STEPS = [
  { n: "I", title: "The host opens court", body: "Pick a name, get a four letter case number, and put the broadcast view on a TV if there is one in the room." },
  { n: "II", title: "Witnesses take their seats", body: "Friends type the code on their phones. No app, no account, no download." },
  { n: "III", title: "The trial begins", body: "Opinions, hearings, bluffs, then a final verdict between the top two. About 20 minutes on default timers." },
];

const LETTERS = [
  { q: "How many of us do we need?", a: "Between 3 and 12. Three player matches are tuned so everyone debates twice, judges once and speaks once." },
  { q: "Does everyone need an account?", a: "No. Players only need a name and a sticker. The host signs in only to use packs they have bought." },
  { q: "Is it really free?", a: "Yes. The Base Game has 60 prompts and is fully playable forever. Extra packs and card themes are optional." },
  { q: "Can money buy a win?", a: "Never. Nothing for sale changes points, timers or Influence charges. Packs add questions; themes only change how cards look." },
  { q: "What about adult questions?", a: "Off by default. A host can switch them on per pack, and they only appear when every player opts in and confirms they are 18 or older." },
  { q: "Can I stream it?", a: "Yes. Add the broadcast view to OBS as a 1920 by 1080 browser source, add a delay if you like, and turn on streamer mode for stream safe prompts only." },
  { q: "Is the game listening to us?", a: "No. Hearings happen out loud in the room. No microphone audio is captured or stored." },
];

/** A news photo cropped straight into a ruled frame, with an italic caption underneath. */
function ModePhoto({ src, caption, ratio }: { src: string; caption: string; ratio: string }) {
  return (
    <figure className="mt-4">
      <div className={cn("relative overflow-hidden border border-rule bg-ink", ratio)}>
        <Image src={src} alt="" fill sizes="(min-width: 1024px) 640px, 92vw" className="scale-[1.08] object-cover grayscale" />
      </div>
      <figcaption className="caption-2 mt-2 border-b border-rule/25 pb-2 font-text italic text-ink-faint">{caption}</figcaption>
    </figure>
  );
}

export default function HomePage() {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>("gavel");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<{ field: "name" | "code" | "general"; text: string } | null>(null);

  useEffect(() => {
    const p = getProfile();
    if (p) {
      setName(p.name);
      setAvatar(p.avatar);
    }
  }, []);

  const requireName = () => {
    if (name.trim()) return true;
    setError({ field: "name", text: "Enter a display name first." });
    nameRef.current?.focus();
    return false;
  };

  const create = async () => {
    if (!requireName()) return;
    setBusy("create");
    setError(null);
    try {
      saveProfile({ name: name.trim(), avatar });
      const s = await getSocket();
      const { code } = await call<{ code: string }>(s, "room:create", { displayName: name.trim(), avatar });
      router.push(`/room/${code}`);
    } catch (e) {
      setError({ field: "general", text: (e as Error).message });
      setBusy(null);
    }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setError({ field: "code", text: "Case numbers are four letters." });
    if (!requireName()) return;
    setBusy("join");
    setError(null);
    try {
      saveProfile({ name: name.trim(), avatar });
      const s = await getSocket();
      await call(s, "room:join", { code: c, displayName: name.trim(), avatar, as: "player" });
      router.push(`/room/${c}`);
    } catch (err) {
      setError({ field: "general", text: (err as Error).message });
      setBusy(null);
    }
  };

  const toSummons = (focus: "name" | "code") => {
    document.getElementById("play")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => (focus === "code" ? codeRef : nameRef).current?.focus({ preventScroll: true }), 500);
  };

  return (
    <div className="grain min-h-dvh overflow-x-clip bg-stage">
      <SiteHeader />
      <main id="main">
        {/* ================= Hero: the courtroom ================= */}
        <section className="theme-court relative isolate flex min-h-[calc(100svh-7rem)] items-end overflow-hidden sm:items-center">
          {/* Desktop: the photo fills the right three quarters so the empty chair sits clear of the headline. */}
          <div className="absolute inset-y-0 right-0 -z-10 hidden w-full sm:block lg:w-[78%]">
            <Image src="/art/scene/courtroom-hero.webp" alt="An empty judge's chair lit by light through a tall courtroom window, the gallery full" fill priority sizes="(min-width: 1024px) 78vw, 100vw" className="object-cover object-center" />
          </div>
          <Image src="/art/scene/courtroom-hero-tall.webp" alt="An empty judge's chair lit by light through a tall courtroom window, the gallery full" fill priority sizes="100vw" className="-z-10 object-cover object-top sm:hidden" />
          {/* Darken the left (desktop) or bottom (phone) so the headline reads; the window and prism stay clear. */}
          <div className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-stage from-20% via-stage/70 via-40% to-transparent to-65% sm:block" aria-hidden />
          <div className="absolute inset-0 -z-10 bg-gradient-to-t from-stage via-stage/70 to-transparent sm:hidden" aria-hidden />

          <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-40 sm:py-24 lg:pb-48">
            <Reveal>
              <p className="kicker text-ink-soft">Tonight&apos;s top story · Live party game</p>
              <h1 className="headline-hero mt-4 max-w-[36rem] text-ink lg:text-[clamp(3rem,5.6vw,5.5rem)]">
                Say what you think.
                <br />
                <span className="text-chaos">Defend</span> what you don&apos;t.
              </h1>
              <p className="deck mt-6 max-w-[30rem] text-ink-soft">
                Guess how your friends really feel, argue sides you were handed, and catch whoever is bluffing. Everyone plays on their own phone while the stage goes on your TV.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => toSummons("name")}>
                  Host a free room <ArrowRight />
                </Button>
                <Button size="lg" variant="secondary" className="border-ink/60 bg-transparent hover:bg-ink/10" onClick={() => toSummons("code")}>
                  Join with a code
                </Button>
              </div>
              <p className="caption-2 mt-6 text-ink-soft">Free Base Game with 60 prompts. No account needed to play.</p>
            </Reveal>
          </div>
        </section>

        {/* ================= Tonight's edition: the paper lands on the hero's edge ================= */}
        <section className="relative z-10 mx-auto max-w-6xl px-4 pt-16 lg:-mt-36 lg:pt-0" aria-label="Tonight's edition">
          <Reveal>
            <figure className="relative mx-auto max-w-[920px] -rotate-[1.2deg]">
              <div className="overflow-hidden shadow-[0_2px_0_rgb(0_0_0/0.05),0_30px_60px_-20px_rgb(20_16_10/0.55)]">
                <Image src="/art/paper/front-page.webp" alt="Front page of The Daily Verdict: The bench is empty. You're the judge." width={1536} height={1024} sizes="(min-width: 1024px) 920px, 92vw" className="h-auto w-full" />
              </div>
              <img src="/art/props/tape.webp" alt="" aria-hidden className="absolute -top-4 left-[12%] w-28 -rotate-[8deg] opacity-90 sm:w-36" />
              <img src="/art/props/tape.webp" alt="" aria-hidden className="absolute -top-4 right-[12%] w-28 rotate-[6deg] opacity-90 sm:w-36" />
              <Stamp id="objection" label="Objection" rotate={-12} className="absolute -bottom-6 -left-3 w-36 sm:-bottom-10 sm:-left-10 sm:w-64" />
              <img src="/art/avatars/cat.webp" alt="" aria-hidden className="absolute -right-3 top-1/3 w-16 rotate-12 sm:-right-10 sm:w-28" />
              <img src="/art/avatars/flame.webp" alt="" aria-hidden className="absolute -right-2 top-[58%] hidden w-20 -rotate-6 sm:-right-14 sm:block" />
            </figure>
          </Reveal>

          {/* Fact box, set like a newspaper sidebar: three columns split by rules. */}
          <Reveal delay={0.1}>
            <div className="mx-auto mt-20 max-w-[920px]">
              <div className="rule-double" aria-hidden />
              <dl className="grid grid-cols-3 divide-x divide-rule/25">
                {[
                  ["3 to 12", "Players in the room"],
                  ["20", "Minutes a match"],
                  ["1", "Phone each, no app"],
                ].map(([n, l]) => (
                  <div key={l} className="flex flex-col-reverse px-3 py-6 text-center sm:px-6">
                    <dt className="kicker mt-2 text-ink-faint">{l}</dt>
                    <dd className="headline-md text-ink">{n}</dd>
                  </div>
                ))}
              </dl>
              <div className="rule-thin" aria-hidden />
            </div>
          </Reveal>
        </section>

        {/* ================= The clerk's desk: one composed summons ================= */}
        <section className="desk relative mt-24 overflow-hidden py-24 sm:py-32" aria-labelledby="summons-title">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal>
              <p className="kicker text-center text-[#b9b2a2]">The clerk&apos;s desk</p>
              <h2 className="headline-lg mt-4 text-center text-[#f4f1ea]">Take the stand</h2>
            </Reveal>

            <div className="relative mx-auto mt-16 max-w-[640px]">
              {/* Sticky note stuck to the top corner of the summons */}
              <div className="relative z-20 mx-auto mb-[-2.5rem] w-56 rotate-[5deg] sm:absolute sm:-right-36 sm:-top-10 sm:mb-0 sm:w-60 lg:-right-52">
                <img src="/art/props/sticky-note.webp" alt="" aria-hidden className="w-full drop-shadow-[0_10px_12px_rgb(0_0_0/0.45)]" />
                <div className="absolute inset-0 flex flex-col justify-center px-7 pb-8 pt-4">
                  <p className="kicker text-[#141414]">Note from the clerk</p>
                  <p className="prose-text mt-2 text-[#141414]">A TV is optional, but it makes the reveals feel like a real broadcast.</p>
                </div>
              </div>

              <Reveal>
                <section id="play" aria-label="Play" className="relative z-10 -rotate-[0.6deg] bg-surface px-6 py-10 shadow-[0_40px_70px_-25px_rgb(0_0_0/0.8)] sm:px-12">
                  {/* Legal document frame */}
                  <div className="pointer-events-none absolute inset-3 border-[3px] border-double border-rule/70" aria-hidden />
                  <div className="relative">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="kicker text-ink-faint">Official summons</p>
                      <p className="kicker tabular text-ink-faint">Case no. {code.length === 4 ? code : "____"}</p>
                    </div>
                    <div className="rule-double mt-3" aria-hidden />
                    <h3 id="summons-title" className="headline-md mt-6">
                      You are hereby
                      <br />
                      summoned to play
                    </h3>
                    <p className="prose-text mt-3 text-ink-soft">Write your name, pick a sticker, then open a new case or answer one with its four letter number.</p>

                    <div className="mt-8 space-y-2">
                      <Label htmlFor="name" className="kicker text-ink">
                        Name of the accused
                      </Label>
                      <Input
                        id="name"
                        ref={nameRef}
                        value={name}
                        maxLength={24}
                        required
                        aria-invalid={error?.field === "name"}
                        aria-describedby={error?.field === "name" ? "name-error" : undefined}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="What should everyone call you?"
                        autoComplete="nickname"
                        className="rounded-none border-0 border-b-2 border-rule bg-transparent px-0 font-serif text-xl focus-visible:border-chaos focus-visible:ring-0"
                        data-testid="name-input"
                      />
                      {error?.field === "name" && (
                        <p id="name-error" role="alert" className="caption-2 text-chaos">
                          {error.text}
                        </p>
                      )}
                    </div>
                    <div className="mt-8 space-y-2">
                      <span className="kicker text-ink">Pick your sticker</span>
                      <AvatarPicker value={avatar} onChange={(a) => setAvatar(a as AvatarId)} idSeed="home" />
                    </div>

                    <Button size="lg" className="mt-8 w-full" onClick={create} disabled={busy !== null} data-testid="create-room">
                      <Users /> {busy === "create" ? "Opening court" : "Host a new room"}
                    </Button>

                    <div className="kicker my-8 flex items-center gap-3 text-ink-faint">
                      <span className="h-px flex-1 bg-rule/30" /> or answer an existing case <span className="h-px flex-1 bg-rule/30" />
                    </div>

                    <form onSubmit={join} className="flex gap-2" noValidate>
                      <Label htmlFor="code" className="sr-only">
                        Room code
                      </Label>
                      <Input
                        id="code"
                        ref={codeRef}
                        value={code}
                        aria-invalid={error?.field === "code"}
                        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                        placeholder="ABCD"
                        className="tabular h-12 text-xl tracking-[0.4em]"
                        autoCapitalize="characters"
                        data-testid="code-input"
                      />
                      <Button type="submit" size="lg" variant="secondary" disabled={busy !== null} data-testid="join-room">
                        Join <ArrowRight />
                      </Button>
                    </form>
                    {error && error.field !== "name" && (
                      <p role="alert" className="caption-2 mt-4 text-chaos" data-testid="home-error">
                        {error.text}
                      </p>
                    )}
                  </div>
                </section>
              </Reveal>

              {/* Evidence tag tied to the bottom edge */}
              <div className="relative z-20 mx-auto mt-[-1.5rem] w-64 -rotate-[10deg] sm:absolute sm:-bottom-10 sm:-left-44 sm:mt-0 sm:w-72 lg:-left-60">
                <img src="/art/props/evidence-tag.webp" alt="" aria-hidden className="w-full drop-shadow-[0_10px_12px_rgb(0_0_0/0.45)]" />
                <div className="absolute left-[30%] right-[10%] top-[42%] space-y-1">
                  <p className="kicker text-[#141414]">Exhibit A</p>
                  <p className="caption-2 leading-tight text-[#46443f]">60 free prompts</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= Section B: the rounds, set as a broadsheet page ================= */}
        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="modes-title">
          <Reveal>
            <div className="flex items-end justify-between gap-4 border-b-4 border-rule pb-3">
              <h2 id="modes-title" className="headline-lg">
                The rounds
              </h2>
              <p className="kicker hidden text-right text-ink-faint sm:block">
                Section B
                <br />
                Four ways to read the room
              </p>
            </div>
            <div className="rule-thin mt-1" aria-hidden />
          </Reveal>

          <div className="mt-10 grid gap-y-12 lg:grid-cols-12">
            {/* Lead story */}
            <Reveal className="lg:col-span-7 lg:pr-8">
              <article>
                <p className="kicker text-chaos">{MODES[0]!.flag}</p>
                <h3 className="headline-lg mt-2">{MODES[0]!.title}</h3>
                <ModePhoto src={MODES[0]!.img} caption="Exhibit 1: someone is holding their phone a little too close." ratio="aspect-[16/10]" />
                <p className="prose-text mt-6 text-ink first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:font-display first-letter:text-7xl first-letter:leading-[0.8] first-letter:text-chaos sm:columns-2 sm:gap-8">
                  {MODES[0]!.body} Answers lock before anyone talks, so the arguing that follows is pure theatre: nothing said out loud changes the numbers already on the record.
                </p>
              </article>
            </Reveal>

            {/* Second story, split from the lead by a column rule */}
            <Reveal delay={0.08} className="lg:col-span-5 lg:border-l lg:border-rule/25 lg:pl-8">
              <article>
                <p className="kicker text-chaos">{MODES[1]!.flag}</p>
                <h3 className="headline-md mt-2">{MODES[1]!.title}</h3>
                <ModePhoto src={MODES[1]!.img} caption="The defence rests. On the coffee table." ratio="aspect-[4/3]" />
                <p className="prose-text mt-6 text-ink-soft">{MODES[1]!.body}</p>
              </article>
            </Reveal>

            {/* Lower row: two stories side by side */}
            <div className="grid gap-y-12 border-t border-rule/25 pt-10 sm:grid-cols-2 lg:col-span-12">
              {MODES.slice(2).map((m, i) => (
                <Reveal key={m.title} delay={i * 0.08} className={cn(i === 0 ? "sm:pr-8" : "sm:border-l sm:border-rule/25 sm:pl-8")}>
                  <article className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
                    <ModePhoto src={m.img} caption={i === 0 ? "Exhibit 3: the poker face." : "Exhibit 4: nobody breathes."} ratio="aspect-[4/3]" />
                    <div>
                      <p className="kicker text-chaos">{m.flag}</p>
                      <h3 className="headline-sm mt-2">{m.title}</h3>
                      <p className="prose-text mt-3 text-ink-soft">{m.body}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ================= After hours (cinematic band) ================= */}
        <section className="theme-court relative isolate overflow-hidden py-32 sm:py-48" aria-label="What the game is about">
          <Image src="/art/scene/courtroom-empty.webp" alt="" fill sizes="100vw" className="-z-10 object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-stage/90 via-stage/55 to-stage/10" aria-hidden />
          <div className="mx-auto max-w-6xl px-4">
            <p className="kicker text-ink-soft">After hours</p>
            <TaglineReveal className="mt-6" lines={["Everyone has opinions.", "Few can defend", "the ones they", "were handed."]} />
          </div>
        </section>

        {/* ================= Chaos cards ================= */}
        <section className="grain border-y border-rule/20 bg-stage-deep py-24" aria-labelledby="cards-title">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal>
              <p className="kicker text-chaos">Influence</p>
              <h2 id="cards-title" className="headline-lg mt-4 max-w-3xl">
                Three charges.
                <br />
                Four cards.
              </h2>
              <p className="deck mt-4 max-w-xl text-ink-soft">Spend a charge to make debaters switch sides, drag an old answer back as evidence, or shut down someone else&apos;s card.</p>
            </Reveal>
            <ul className="mt-16 grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
              {(Object.keys(CARD_COPY) as ChaosCardType[]).map((c, i) => (
                <Reveal key={c} delay={i * 0.06}>
                  <li className="group">
                    <div className={cn("transition-transform duration-500 ease-base group-hover:-translate-y-3 group-hover:rotate-0", ["-rotate-6", "-rotate-2", "rotate-2", "rotate-6"][i])}>
                      <Image src={CARD_ART[c]} alt={`${CARD_COPY[c].name} card`} width={640} height={900} sizes="(min-width: 768px) 260px, 45vw" className="h-auto w-full drop-shadow-[0_18px_24px_rgb(20_20_20/0.25)]" />
                    </div>
                    <h3 className="headline-sm mt-6">{CARD_COPY[c].name}</h3>
                    <p className="caption-2 mt-2 text-ink-soft">{CARD_COPY[c].blurb}</p>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= Verdict stamps ================= */}
        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="stamps-title">
          <Reveal>
            <p className="kicker text-chaos">Rulings</p>
            <h2 id="stamps-title" className="headline-lg mt-4">
              Every round ends
              <br />
              in a verdict
            </h2>
          </Reveal>
          <div className="mt-12 grid grid-cols-2 items-center gap-x-6 gap-y-10 sm:grid-cols-3">
            {STAMPS.map((s, i) => (
              <StampReveal key={s.id} id={s.id} label={s.label} rotate={s.rot} delay={i * 0.07} />
            ))}
          </div>
        </section>

        {/* ================= Order of proceedings ================= */}
        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="how-title">
          <Reveal>
            <h2 id="how-title" className="headline-lg">
              Order of proceedings
            </h2>
          </Reveal>
          <div className="rule-double mt-8" aria-hidden />
          <ol className="grid md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.08}>
                <li className={cn("h-full py-8 md:px-8", i > 0 && "border-t border-line md:border-l md:border-t-0", i === 0 && "md:pl-0")}>
                  <span className="headline-lg text-chaos">{s.n}</span>
                  <h3 className="heading-4 mt-4">{s.title}</h3>
                  <p className="prose-text mt-3 text-ink-soft">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ================= Letters to the editor (FAQ) ================= */}
        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="faq-title">
          <Reveal>
            <h2 id="faq-title" className="headline-lg">
              Letters to the editor
            </h2>
          </Reveal>
          <div className="rule-double mt-8" aria-hidden />
          <div className="mt-2 columns-1 gap-10 md:columns-2 [column-rule:1px_solid_var(--color-line)]">
            {LETTERS.map((f) => (
              <details key={f.q} className="group mb-2 break-inside-avoid border-b border-line py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                  <span className="heading-6 font-serif">{f.q}</span>
                  <span aria-hidden className="tabular title-2 text-chaos transition-transform duration-500 ease-base group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="prose-text mt-3 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ================= Closing argument ================= */}
        <section className="mx-auto max-w-6xl px-4 pb-8 pt-16">
          <Reveal>
            <div className="paper relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
              <p className="kicker text-chaos">Closing argument</p>
              <h2 className="headline-lg mt-4 max-w-3xl">
                Court is in session
                <br />
                whenever you are
              </h2>
              <p className="deck mt-4 max-w-xl text-ink-soft">The Base Game is free and stays free. Nothing anyone buys changes the score.</p>
              <Button size="lg" className="mt-8" onClick={() => toSummons("name")}>
                Host a free room <ArrowRight />
              </Button>
              <Stamp id="case-closed" label="Case closed" rotate={-12} className="absolute -bottom-6 -right-6 hidden w-64 opacity-90 md:block" />
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
