"use client";

import { useEffect, useState } from "react";
import { CheckIcon as Check, EyeIcon as Eye, EyeSlashIcon as EyeOff, LockIcon as Lock, SealQuestionIcon as ShieldQuestion, SkipForwardIcon as SkipForward, HandPalmIcon as Hand } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, cn } from "@hps/ui";
import type { BluffRole, GameActionInput, LegalAction } from "@hps/shared";
import type { AnyGameState } from "@/hooks/use-room";
import { playSfx } from "@/lib/sfx";
import { SpectrumSlider } from "./slider";
import { LockedStamp, PlayerAvatar } from "./primitives";
import { nameOf, sideLabel } from "./util";

type Act = (a: GameActionInput) => Promise<unknown>;

/**
 * Renders a control for every action the server says is legal for this player right now,
 * plus a summary of what they have already locked in. The server is the only source of truth.
 */
export function ActionDock({ game, act }: { game: AnyGameState; act: Act }) {
  const me = game.me!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const legal = new Set<LegalAction>(me.legal);

  useEffect(() => setError(null), [game.phase.name, game.phase.enteredAt]);

  const run = async (a: GameActionInput) => {
    setBusy(true);
    setError(null);
    try {
      await act(a);
      if (a.type !== "REQUEST_SKIP" && a.type !== "YIELD_FLOOR") playSfx("LOCK");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prompt = game.calibration?.prompt ?? game.court?.prompt ?? game.bluff?.prompt ?? game.finale?.prompt ?? null;
  const left = prompt?.leftLabel ?? "0";
  const right = prompt?.rightLabel ?? "100";
  const widgets: React.ReactNode[] = [];

  if (legal.has("SUBMIT_OPINION")) widgets.push(<OpinionForm key="op" left={left} right={right} busy={busy} onSubmit={(value, keepPrivate) => run({ type: "SUBMIT_OPINION", value, keepPrivate })} />);
  if (legal.has("SUBMIT_PREDICTION"))
    widgets.push(
      <NumberForm key="pred" title={`Predict ${nameOf(game, me.calibration?.targetId)}'s answer`} cta="Lock prediction" tone="cyan" left={left} right={right} busy={busy} onSubmit={(value) => run({ type: "SUBMIT_PREDICTION", value })} />,
    );
  if (legal.has("SELECT_CONTRACT") && me.contractOffers)
    widgets.push(
      <div key="contracts" className="space-y-3">
        <h3 className="heading-5">Choose a secret contract</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {me.contractOffers.map((o) => (
            <button
              key={o.offerId}
              disabled={busy}
              onClick={() => run({ type: "SELECT_CONTRACT", offerId: o.offerId })}
              data-testid={`contract-${o.type}`}
              className="rounded-xl border border-teal/40 bg-teal/8 p-4 text-left transition-colors hover:bg-teal/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="heading-6 text-teal">{o.title}</span>
                <Badge tone="teal">+{o.reward} VP</Badge>
              </div>
              <p className="mt-1 body-6 text-ink-soft">{o.description}</p>
            </button>
          ))}
        </div>
      </div>,
    );
  if (legal.has("COURT_LOCK_STANCE"))
    widgets.push(<NumberForm key="cs" title="Lock your real stance" hint="Judges will try to predict this. Your side is assigned separately." cta="Lock stance" left={left} right={right} busy={busy} onSubmit={(value) => run({ type: "COURT_LOCK_STANCE", value })} />);
  if (legal.has("JUDGE_PREDICT"))
    widgets.push(
      <NumberForm key="jp" title={`Predict ${nameOf(game, me.court?.predictionTargetId)}'s real stance`} cta="Lock prediction" tone="cyan" left={left} right={right} busy={busy} onSubmit={(value) => run({ type: "JUDGE_PREDICT", value })} />,
    );
  if (legal.has("COURT_VERDICT") && game.court)
    widgets.push(<PickForm key="cv" title="Who argued better?" ids={[game.court.debaterA, game.court.debaterB]} game={game} busy={busy} testid="verdict" onPick={(id) => run({ type: "COURT_VERDICT", winnerId: id })} />);
  if (legal.has("ANALYST_CALL") && game.court)
    widgets.push(<PickForm key="ac" title="Analyst call: who will the bench pick?" ids={[game.court.debaterA, game.court.debaterB]} game={game} busy={busy} testid="analyst" onPick={(id) => run({ type: "ANALYST_CALL", winnerId: id })} />);
  if (legal.has("BLUFF_LOCK"))
    widgets.push(<NumberForm key="bl" title="Lock your genuine answer" hint="You will then be told whether to tell the truth or bluff." cta="Lock answer" left={left} right={right} busy={busy} onSubmit={(value) => run({ type: "BLUFF_LOCK", value })} />);
  if (legal.has("BLUFF_VOTE")) widgets.push(<RoleVote key="bv" title={`Is ${nameOf(game, game.bluff?.speakerId)} honest?`} busy={busy} onVote={(guess) => run({ type: "BLUFF_VOTE", guess })} />);
  if (legal.has("FINALE_LOCK_STANCE"))
    widgets.push(<NumberForm key="fs" title="Lock your real stance on the final question" hint="Anything except exactly 50. Your side may or may not match it." cta="Lock stance" left={left} right={right} busy={busy} disallow50 onSubmit={(value) => run({ type: "FINALE_LOCK_STANCE", value })} />);
  if (legal.has("FINALE_PREDICT"))
    widgets.push(<NumberForm key="fp" title={`Predict ${nameOf(game, me.finale?.predictionTargetId)}'s real stance`} cta="Lock prediction" tone="cyan" left={left} right={right} busy={busy} onSubmit={(value) => run({ type: "FINALE_PREDICT", value })} />);
  if (legal.has("FINALE_VERDICT") && game.finale)
    widgets.push(<PickForm key="fv" title="Final verdict: who argued better?" ids={[game.finale.debaterA, game.finale.debaterB]} game={game} busy={busy} testid="final-verdict" onPick={(id) => run({ type: "FINALE_VERDICT", winnerId: id })} />);
  if (legal.has("FINALE_WINNER_CALL") && game.finale)
    widgets.push(<PickForm key="fw" title="Call it: who wins the final?" ids={[game.finale.debaterA, game.finale.debaterB]} game={game} busy={busy} testid="winner-call" onPick={(id) => run({ type: "FINALE_WINNER_CALL", winnerId: id })} />);
  if (legal.has("FINALE_CLASSIFY") && me.finale) {
    const done = new Map(me.finale.myClassifications.map((c) => [c.targetId, c.guess]));
    widgets.push(
      <div key="fc" className="space-y-3">
        <h3 className="heading-5">Honest or bluffing?</h3>
        <p className="body-6 text-ink-soft">Decide whether each finalist is arguing for what they really believe.</p>
        {me.finale.classifyTargets.map((t) => (
          <div key={t} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-stage p-3">
            <span className="flex items-center gap-2 font-semibold">
              <PlayerAvatar avatar={game.players.find((p) => p.id === t)?.avatar ?? "star"} id={t} size={30} />
              {nameOf(game, t)}
            </span>
            <div className="flex gap-2">
              {(["HONEST", "BLUFF"] as const).map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={done.get(t) === g ? (g === "HONEST" ? "live" : "chaos") : "secondary"}
                  disabled={busy}
                  aria-pressed={done.get(t) === g}
                  onClick={() => run({ type: "FINALE_CLASSIFY", targetId: t, guess: g })}
                >
                  {g === "HONEST" ? "Honest" : "Bluffing"}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>,
    );
  }

  const secondary: React.ReactNode[] = [];
  if (legal.has("YIELD_FLOOR"))
    secondary.push(
      <Button key="yield" variant="secondary" disabled={busy} onClick={() => run({ type: "YIELD_FLOOR" })} data-testid="yield">
        <Hand /> I&apos;m done speaking
      </Button>,
    );
  if (legal.has("REQUEST_SKIP"))
    secondary.push(
      <Button key="skip" variant="ghost" size="sm" disabled={busy} onClick={() => run({ type: "REQUEST_SKIP" })} title="Anonymously ask to replace this prompt">
        <SkipForward /> Skip prompt ({me.skipRequestsLeft} left)
      </Button>,
    );

  return (
    <section aria-label="Your move" className="space-y-6" data-testid="action-dock">
      <PrivateSummary game={game} />
      {widgets.length > 0 ? widgets : <WaitingNote game={game} />}
      {secondary.length > 0 && <div className="flex flex-wrap items-center gap-2">{secondary}</div>}
      {error && (
        <p role="alert" className="rounded-lg border border-chaos/40 bg-chaos/10 px-3 py-2 body-6 text-chaos">
          {error}
        </p>
      )}
    </section>
  );
}

function WaitingNote({ game }: { game: AnyGameState }) {
  const me = game.me!;
  const text = me.hint ?? (game.phase.speakerId === me.playerId ? "You have the floor. Make your case out loud." : "Nothing to lock right now. Watch the stage.");
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-ink-soft" data-testid="waiting">
      {text}
    </p>
  );
}

/** What this player privately knows: their role, side, locked values, secret instruction. */
function PrivateSummary({ game }: { game: AnyGameState }) {
  const me = game.me!;
  const items: React.ReactNode[] = [];
  const seg = game.phase.segment;

  if (seg === "CALIBRATION" && me.calibration) {
    if (me.calibration.myOpinion !== null)
      items.push(<Fact key="o" icon={<Lock />} label="Your answer" value={`${me.calibration.myOpinion}${me.calibration.keptPrivate ? " (kept out of evidence)" : ""}`} />);
    if (me.calibration.targetId) items.push(<Fact key="t" icon={<Eye />} label="You predict" value={nameOf(game, me.calibration.targetId)} />);
    if (me.calibration.myPrediction !== null) items.push(<Fact key="p" icon={<Check />} label="Your prediction" value={String(me.calibration.myPrediction)} />);
  }
  if (seg === "COURT" && me.court) {
    const roleText = me.court.role === "DEBATER" ? `Debater ${me.court.slot}` : me.court.role === "JUDGE" ? "Judge" : "Analyst (no vote)";
    items.push(<Fact key="r" icon={<ShieldQuestion />} label="Your role" value={roleText} />);
    if (me.court.role === "DEBATER") items.push(<Fact key="s" icon={<Eye />} label="Your side" value={me.court.mySide ? sideLabel(me.court.mySide) : "Revealed after you lock"} highlight={!!me.court.mySide} />);
    if (me.court.myStance !== null) items.push(<Fact key="st" icon={<Lock />} label="Your real stance" value={String(me.court.myStance)} />);
    if (me.court.myPrediction !== null) items.push(<Fact key="pr" icon={<Check />} label="Your prediction" value={String(me.court.myPrediction)} />);
    if (me.court.myVerdict) items.push(<Fact key="v" icon={<Check />} label="Your verdict" value={nameOf(game, me.court.myVerdict)} />);
    if (me.court.myCall) items.push(<Fact key="c" icon={<Check />} label="Your call" value={nameOf(game, me.court.myCall)} />);
  }
  if (seg === "BLUFF" && me.bluff) {
    items.push(<Fact key="r" icon={<ShieldQuestion />} label="Your role" value={me.bluff.role === "SPEAKER" ? "Speaker" : "Investigator"} />);
    if (me.bluff.myGenuine !== null) items.push(<Fact key="g" icon={<Lock />} label="Your genuine answer" value={String(me.bluff.myGenuine)} />);
    if (me.bluff.instruction)
      items.push(
        <div key="i" className={cn("rounded-xl border-2 p-4", me.bluff.instruction.role === "BLUFF" ? "border-chaos bg-chaos/10" : "border-teal bg-teal/10")} data-testid="bluff-instruction">
          <div className="caption-3 text-ink-soft">Secret instruction</div>
          <div className={cn("heading-4", me.bluff.instruction.role === "BLUFF" ? "text-chaos" : "text-teal")}>
            {me.bluff.instruction.role === "BLUFF" ? "Bluff" : "Tell the truth"}
          </div>
          <p className="body-6 text-ink-soft">
            Publicly claim <strong className="tabular text-ink">{me.bluff.instruction.claim}</strong>
            {me.bluff.instruction.role === "BLUFF" ? " and defend it as if you meant it." : " — it is your real answer."}
          </p>
        </div>,
      );
    if (me.bluff.myVote) items.push(<Fact key="v" icon={<Check />} label="Your read" value={me.bluff.myVote === "HONEST" ? "Honest" : "Bluffing"} />);
  }
  if (seg === "FINALE" && me.finale) {
    const seatText = { DEBATER: `Finalist ${me.finale.slot ?? ""}`, LEAD_INVESTIGATOR: "Lead Investigator", JUROR: "Juror", INVESTIGATOR: "Investigator" }[me.finale.seat];
    items.push(<Fact key="seat" icon={<ShieldQuestion />} label="Your seat" value={seatText} />);
    if (me.finale.myStance !== null) items.push(<Fact key="st" icon={<Lock />} label="Your real stance" value={String(me.finale.myStance)} />);
    if (me.finale.mySide) items.push(<Fact key="side" icon={<Eye />} label="Assigned side" value={sideLabel(me.finale.mySide)} highlight />);
    if (me.finale.myRole)
      items.push(
        <Fact key="role" icon={me.finale.myRole === "BLUFF" ? <EyeOff /> : <Eye />} label="You are" value={me.finale.myRole === "BLUFF" ? "Arguing against your belief" : "Arguing what you believe"} highlight />,
      );
    if (me.finale.myPrediction !== null) items.push(<Fact key="p" icon={<Check />} label="Your prediction" value={String(me.finale.myPrediction)} />);
    if (me.finale.myVerdict) items.push(<Fact key="v" icon={<Check />} label="Your verdict" value={nameOf(game, me.finale.myVerdict)} />);
    if (me.finale.myWinnerCall) items.push(<Fact key="w" icon={<Check />} label="Your call" value={nameOf(game, me.finale.myWinnerCall)} />);
  }
  if (me.contract && game.phase.name !== "CONTRACT_SELECTION")
    items.push(
      <Fact key="contract" icon={<ShieldQuestion />} label={`Secret contract · ${me.contract.status.toLowerCase()}`} value={`${me.contract.title}: ${me.contract.description}`} tone="teal" />,
    );

  if (!items.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-label="Only you can see this">
      {items}
    </div>
  );
}

function Fact({ icon, label, value, highlight, tone }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean; tone?: "teal" }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-line bg-stage px-3 py-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-faint", highlight && "border-violet/50", tone === "teal" && "border-teal/40")}>
      {icon}
      <div className="min-w-0">
        <div className="caption-3 font-semibold text-ink-faint">{label}</div>
        <div className={cn("body-4", highlight && "text-violet-bright", tone === "teal" && "text-teal")}>{value}</div>
      </div>
    </div>
  );
}

function NumberForm({
  title,
  hint,
  cta,
  left,
  right,
  busy,
  tone,
  disallow50,
  onSubmit,
}: {
  title: string;
  hint?: string;
  cta: string;
  left: string;
  right: string;
  busy: boolean;
  tone?: "cyan";
  disallow50?: boolean;
  onSubmit: (v: number) => Promise<void>;
}) {
  const [v, setV] = useState(disallow50 ? 45 : 50);
  const [sent, setSent] = useState(false);
  const invalid = disallow50 && v === 50;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (invalid) return;
        await onSubmit(v);
        setSent(true);
      }}
    >
      <div>
        <h3 className="heading-5">{title}</h3>
        {hint && <p className="body-6 text-ink-soft">{hint}</p>}
      </div>
      <SpectrumSlider value={v} onChange={setV} leftLabel={left} rightLabel={right} label={title} tone={tone} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" variant={tone === "cyan" ? "live" : "primary"} disabled={busy || invalid} data-testid="lock">
          <Lock /> {cta}
        </Button>
        {invalid && <span className="body-6 text-chaos">Pick a side — 50 is not allowed here.</span>}
        <LockedStamp show={sent && busy} text="Locked" />
      </div>
    </form>
  );
}

function OpinionForm({ left, right, busy, onSubmit }: { left: string; right: string; busy: boolean; onSubmit: (v: number, keepPrivate: boolean) => Promise<void> }) {
  const [v, setV] = useState(50);
  const [priv, setPriv] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit(v, priv);
      }}
    >
      <h3 className="heading-5">Your honest answer</h3>
      <SpectrumSlider value={v} onChange={setV} leftLabel={left} rightLabel={right} label="Your honest answer" />
      <label className="flex cursor-pointer items-start gap-2 body-6 text-ink-soft">
        <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-violet)]" />
        <span>
          Keep this out of evidence. It still scores, but it can never be brought up with <em>Receipts</em> later.
        </span>
      </label>
      <Button type="submit" size="lg" disabled={busy} data-testid="lock">
        <Lock /> Lock answer
      </Button>
    </form>
  );
}

function PickForm({ title, ids, game, busy, testid, onPick }: { title: string; ids: string[]; game: AnyGameState; busy: boolean; testid: string; onPick: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <h3 className="heading-5">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {ids.map((id, i) => (
          <button
            key={id}
            disabled={busy}
            onClick={() => onPick(id)}
            data-testid={`${testid}-${i === 0 ? "A" : "B"}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-stage p-4 text-left transition-colors hover:border-violet hover:bg-violet/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
          >
            <PlayerAvatar avatar={game.players.find((p) => p.id === id)?.avatar ?? "star"} id={id} size={44} />
            <div>
              <div className="caption-3 text-ink-faint">Debater {i === 0 ? "A" : "B"}</div>
              <div className="title-2">{nameOf(game, id)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoleVote({ title, busy, onVote }: { title: string; busy: boolean; onVote: (g: BluffRole) => void }) {
  return (
    <div className="space-y-3">
      <h3 className="heading-5">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant="live" disabled={busy} onClick={() => onVote("HONEST")} data-testid="vote-honest">
          Honest
        </Button>
        <Button size="lg" variant="chaos" disabled={busy} onClick={() => onVote("BLUFF")} data-testid="vote-bluff">
          Bluffing
        </Button>
      </div>
    </div>
  );
}
