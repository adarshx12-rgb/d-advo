"use client";

import { AnimatePresence, motion } from "motion/react";
import { FileTextIcon as FileText, GavelIcon as Gavel, ScalesIcon as Scale, TrophyIcon as Trophy } from "@phosphor-icons/react/dist/ssr";
import { Badge, cn } from "@hps/ui";
import type { PromptView, PublicGameState, VaultEntryView } from "@hps/shared";
import { CountdownTimer, EASE, PlayerAvatar, PlayerCard, Stamp, type StampId } from "./primitives";
import { SpectrumBar } from "./slider";
import { CARD_ART, CARD_COPY, nameOf, PHASE_HELP, sideLabel } from "./util";

/** Everything here is derived from the public projection only, so it is safe for spectators and streams. */
export function PromptCard({ prompt, size = "md" }: { prompt: PromptView; size?: "md" | "xl" }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-6", size === "xl" && "p-10")} data-testid="prompt">
      <div className="mb-2 flex items-center gap-2">
        {prompt.mature && <Badge tone="chaos">18+</Badge>}
      </div>
      <h2 className={cn("font-semibold leading-tight text-balance", size === "xl" ? "heading-2" : "heading-5 sm:heading-4")}>{prompt.question}</h2>
      <div className={cn("mt-4 flex justify-between gap-6 font-semibold text-ink-soft", size === "xl" ? "heading-5" : "body-6")}>
        <span>0 · {prompt.leftLabel}</span>
        <span className="text-right">{prompt.rightLabel} · 100</span>
      </div>
    </div>
  );
}

export function EvidenceList({ entries, game, size = "md" }: { entries: VaultEntryView[]; game: PublicGameState; size?: "md" | "xl" }) {
  if (!entries.length) return null;
  return (
    <section aria-label="Evidence" className="space-y-2">
      <h3 className={cn("flex items-center gap-2 text-amber", size === "xl" ? "heading-4" : "title-1")}>
        <FileText className="size-5" /> Previous statements
      </h3>
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="rounded-xl border border-amber/40 bg-amber/8 p-3"
            data-testid="evidence"
          >
            <div className="caption-3 text-amber">
              {nameOf(game, e.playerId)} · {e.sourceLabel}
            </div>
            <div className={cn("mt-0.5", size === "xl" ? "title-1" : "body-6")}>
              “{e.promptQuestion}” — answered <strong className="tabular">{e.value}</strong> ({e.value < 50 ? e.leftLabel : e.value > 50 ? e.rightLabel : "dead centre"})
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

function Debaters({ game, a, b, sides, tally, size }: { game: PublicGameState; a: string; b: string; sides: { A: string; B: string } | null; tally?: { A: number; B: number } | null; size: "md" | "xl" }) {
  const cell = (id: string, slot: "A" | "B") => {
    const speaking = game.phase.speakerId === id;
    return (
      <div className={cn("flex flex-1 items-center gap-3 rounded-xl border p-3 transition-colors", speaking ? "border-cyan bg-cyan/10" : "border-line bg-surface")}>
        <PlayerAvatar avatar={game.players.find((p) => p.id === id)?.avatar ?? "star"} id={id} size={size === "xl" ? 72 : 44} />
        <div className="min-w-0">
          <div className="caption-3 text-ink-faint">
            Debater {slot} {speaking && <span className="text-cyan">· speaking</span>}
          </div>
          <div className={cn("truncate font-semibold", size === "xl" ? "heading-4" : "title-2")}>{nameOf(game, id)}</div>
          <div className={cn("body-4", sides ? "text-violet-bright" : "text-ink-faint")}>{sides ? sideLabel(sides[slot] as "FOR" | "AGAINST") : "Side hidden"}</div>
          {tally && <div className="caption-5 text-ink-faint">Audience: {tally[slot]}</div>}
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row" aria-label="Debaters">
      {cell(a, "A")}
      <div className="flex items-center justify-center heading-5 text-ink-faint">vs</div>
      {cell(b, "B")}
    </div>
  );
}

function Locks({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="flex items-center gap-2 body-6 text-ink-soft" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("size-2.5 rounded-full", i < done ? "bg-teal" : "bg-surface-raised")} />
        ))}
      </div>
      {label}: {done}/{total}
    </div>
  );
}

/** Phase-specific public content: prompt, who is up, locks progress, reveals. */
export function StageContent({ game, size = "md" }: { game: PublicGameState; size?: "md" | "xl" }) {
  const { phase } = game;
  const help = PHASE_HELP[phase.name];
  const active = game.players.filter((p) => !p.removed).length;
  return (
    <div className="space-y-6">
      {game.calibration && phase.segment === "CALIBRATION" && (
        <>
          <PromptCard prompt={game.calibration.prompt} size={size} />
          {phase.name === "CALIBRATION_SUBMISSION" && <Locks label="Answers locked" done={game.calibration.opinionsLocked.length} total={active} />}
          {phase.name === "CALIBRATION_PREDICTION" && <Locks label="Predictions locked" done={game.calibration.predictionsLocked.length} total={game.calibration.targets.length} />}
          {game.calibration.reveal && (
            <div className="space-y-2" data-testid="calibration-reveal">
              {game.calibration.reveal.map((r) => (
                <div key={r.playerId} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {nameOf(game, r.playerId)} answered <span className="tabular text-violet-bright">{r.opinion ?? "—"}</span>
                    </span>
                    <span className="body-6 text-ink-soft">
                      {nameOf(game, r.predictorId)} guessed <span className="tabular">{r.prediction ?? "—"}</span>
                      {r.difference !== null && <> (off by {r.difference})</>} · <strong className="text-teal">+{r.points}</strong>
                    </span>
                  </div>
                  {r.opinion !== null && (
                    <div className="mt-2">
                      <SpectrumBar
                        leftLabel={game.calibration!.prompt.leftLabel}
                        rightLabel={game.calibration!.prompt.rightLabel}
                        points={[
                          { value: r.opinion, label: "Answer", color: "var(--color-violet)" },
                          ...(r.prediction !== null ? [{ value: r.prediction, label: "Prediction", color: "var(--color-cyan)" }] : []),
                        ]}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {phase.name === "CONTRACT_SELECTION" && (
        <div className="rounded-2xl border border-teal/40 bg-teal/8 p-6 text-center">
          <h2 className={cn("text-teal", size === "xl" ? "heading-1" : "heading-3")}>Secret contracts</h2>
          <p className="mt-2 text-ink-soft">Each player is choosing a hidden objective. They are revealed at the end.</p>
        </div>
      )}

      {game.court && phase.segment === "COURT" && (
        <>
          <div className="flex items-center gap-2 body-4 text-ink-soft">
            <Gavel className="size-4" /> Hearing {game.court.hearingIndex + 1} of {game.court.totalHearings} · Judges: {game.court.judges.map((j) => nameOf(game, j)).join(", ")}
            {game.court.analystId && <> · Analyst: {nameOf(game, game.court.analystId)}</>}
          </div>
          {game.court.prompt && <PromptCard prompt={game.court.prompt} size={size} />}
          <Debaters game={game} a={game.court.debaterA} b={game.court.debaterB} sides={game.court.sides} tally={game.court.spectatorTally} size={size} />
          {game.court.sidesSwapped && <Badge tone="chaos">Sides switched</Badge>}
          {phase.name === "COURT_VOTING" && <Locks label="Verdicts in" done={game.court.votesIn} total={game.court.votesNeeded} />}
          <EvidenceList entries={game.court.evidence} game={game} size={size} />
          {game.court.reveal && (
            <RevealBanner stamp="verdict" title={`${nameOf(game, game.court.reveal.winnerId)} wins the hearing`} sub={game.court.reveal.tiebreakUsed ? "Split bench — decided by the tiebreak draw." : undefined}>
              <ul className="space-y-1 body-6 text-ink-soft">
                {game.court.reveal.stances.map((s) => (
                  <li key={s.playerId}>
                    {nameOf(game, s.playerId)}&apos;s real stance: <strong className="tabular text-ink">{s.value ?? "not locked"}</strong>
                  </li>
                ))}
                {game.court.reveal.predictions.map((p) => (
                  <li key={p.judgeId + p.targetId}>
                    {nameOf(game, p.judgeId)} predicted {nameOf(game, p.targetId)} at <span className="tabular">{p.value ?? "—"}</span> · <strong className="text-teal">+{p.points}</strong>
                  </li>
                ))}
                {game.court.reveal.analystCall && (
                  <li>
                    Analyst {nameOf(game, game.court.reveal.analystCall.analystId)} called {nameOf(game, game.court.reveal.analystCall.pickedId)} —{" "}
                    {game.court.reveal.analystCall.correct ? "correct" : "wrong"}
                  </li>
                )}
              </ul>
            </RevealBanner>
          )}
        </>
      )}

      {game.bluff && phase.segment === "BLUFF" && (
        <>
          <div className="body-4 text-ink-soft">
            Turn {game.bluff.turnIndex + 1} of {game.bluff.totalTurns} · Speaker: {nameOf(game, game.bluff.speakerId)}
          </div>
          {game.bluff.prompt && <PromptCard prompt={game.bluff.prompt} size={size} />}
          {game.bluff.claim !== null && (
            <div className="flex items-center gap-4 rounded-2xl border border-amber/40 bg-amber/8 p-4">
              <Scale className="size-8 text-amber" />
              <div>
                <div className="caption-3 text-amber">{nameOf(game, game.bluff.speakerId)} claims</div>
                <div className={cn("tabular", size === "xl" ? "heading-1" : "heading-1")} data-testid="bluff-claim">
                  {game.bluff.claim}
                </div>
              </div>
            </div>
          )}
          {phase.name === "BLUFF_PREPARATION" && <p className="text-ink-soft">{game.bluff.speakerLocked ? "The speaker has their instruction." : "The speaker is locking their genuine answer…"}</p>}
          {phase.name === "BLUFF_VOTING" && <Locks label="Reads in" done={game.bluff.votesIn} total={game.bluff.votesNeeded} />}
          <EvidenceList entries={game.bluff.evidence} game={game} size={size} />
          {game.bluff.reveal && (
            <RevealBanner
              title={game.bluff.reveal.role === "BLUFF" ? `${nameOf(game, game.bluff.speakerId)} was bluffing` : `${nameOf(game, game.bluff.speakerId)} told the truth`}
              tone={game.bluff.reveal.role === "BLUFF" ? "chaos" : "teal"}
              stamp={game.bluff.reveal.role === "BLUFF" ? "bluff" : "honest"}
              sub={`Real answer: ${game.bluff.reveal.genuine ?? "not locked"} · Claimed: ${game.bluff.reveal.claimed}`}
            >
              <ul className="space-y-1 body-6 text-ink-soft">
                {game.bluff.reveal.votes.map((v) => (
                  <li key={v.playerId}>
                    {nameOf(game, v.playerId)} read {v.guess === "BLUFF" ? "bluffing" : v.guess === "HONEST" ? "honest" : "nothing"} — {v.correct ? <span className="text-teal">correct</span> : "wrong"}
                  </li>
                ))}
              </ul>
            </RevealBanner>
          )}
        </>
      )}

      {game.finale && phase.segment === "FINALE" && (
        <>
          <div className="flex items-center gap-2 heading-5 text-amber">
            <Trophy className="size-6" /> Final verdict
          </div>
          {game.finale.prompt && <PromptCard prompt={game.finale.prompt} size={size} />}
          <Debaters game={game} a={game.finale.debaterA} b={game.finale.debaterB} sides={game.finale.sides} tally={game.finale.spectatorTally} size={size} />
          <div className="flex flex-wrap gap-2">
            {game.finale.seats
              .filter((s) => s.seat !== "DEBATER")
              .map((s) => (
                <Badge key={s.playerId} tone={s.seat === "LEAD_INVESTIGATOR" ? "amber" : s.seat === "JUROR" ? "violet" : "cyan"}>
                  {nameOf(game, s.playerId)} · {s.seat.replace("_", " ").toLowerCase()}
                </Badge>
              ))}
            {game.finale.seats
              .filter((s) => s.multiplier > 1)
              .map((s) => (
                <Badge key={`m${s.playerId}`} tone="chaos">
                  {nameOf(game, s.playerId)} · underdog stakes ×{s.multiplier}
                </Badge>
              ))}
          </div>
          {phase.name === "FINALE_VOTING" && <Locks label="Ballots in" done={game.finale.ballotsIn} total={game.finale.ballotsNeeded} />}
          <EvidenceList entries={game.finale.evidence} game={game} size={size} />
          {game.finale.reveal && (
            <RevealBanner stamp="case-closed" title={`${nameOf(game, game.finale.reveal.winnerId)} wins the final`} sub={game.finale.reveal.tiebreakUsed ? "Decided by the tiebreak draw." : undefined}>
              <ul className="space-y-1 body-6 text-ink-soft">
                {game.finale.reveal.roles.map((r) => (
                  <li key={r.playerId}>
                    {nameOf(game, r.playerId)} believed <span className="tabular">{r.stance ?? "—"}</span>, argued {r.side.toLowerCase()} —{" "}
                    <strong className={r.role === "BLUFF" ? "text-chaos" : "text-teal"}>{r.role === "BLUFF" ? "bluffing" : "honest"}</strong>
                  </li>
                ))}
              </ul>
            </RevealBanner>
          )}
        </>
      )}

      {phase.name !== "RESULTS" && help && size === "md" && <p className="body-6 text-ink-faint">{help}</p>}
    </div>
  );
}

function RevealBanner({ title, sub, tone = "violet", stamp, children }: { title: string; sub?: string; tone?: "violet" | "chaos" | "teal"; stamp?: StampId; children?: React.ReactNode }) {
  const c = tone === "chaos" ? "border-chaos text-chaos" : tone === "teal" ? "border-teal text-teal" : "border-violet text-violet-bright";
  return (
    <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease: EASE }} className={cn("relative overflow-hidden rounded-xl border-2 bg-surface p-6", c)} data-testid="reveal">
      {stamp && <Stamp id={stamp} label={stamp.replace("-", " ")} rotate={-8} className="absolute -right-2 top-2 h-16 w-auto opacity-90 sm:h-20" />}
      <div className="headline-sm max-w-[75%]">{title}</div>
      {sub && <div className="body-6 text-ink-soft">{sub}</div>}
      {children && <div className="mt-3">{children}</div>}
    </motion.div>
  );
}

export function PendingCardBanner({ game }: { game: PublicGameState }) {
  const p = game.pendingCard;
  return (
    <AnimatePresence>
      {p && (
        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          exit={{ y: -16, opacity: 0 }}
          className="flex items-center gap-3 rounded-xl border-2 border-chaos bg-chaos/12 px-3 py-2"
          role="status"
          aria-live="assertive"
          data-testid="pending-card"
        >
          <img src={CARD_ART[p.card]} alt="" aria-hidden className="h-14 w-auto -rotate-6 drop-shadow-md" />
          <span className="headline-sm text-chaos">{CARD_COPY[p.card].name}</span>
          <span className="body-6 text-ink-soft">
            played by {nameOf(game, p.playedBy)}
            {p.targetLabel ? ` · ${p.targetLabel}` : ""} · {p.stage === "COLLECTING" ? "resolving…" : "Objection window open"}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Scoreboard({ game, meId, compact }: { game: PublicGameState; meId?: string | null; compact?: boolean }) {
  const sorted = [...game.players].sort((a, b) => b.score - a.score || a.seat - b.seat);
  return (
    <section aria-label="Scoreboard" className="space-y-0.5">
      {sorted.map((p, i) => (
        <PlayerCard key={p.id} player={p} you={p.id === meId} rank={i + 1} compact={compact} highlight={game.phase.speakerId === p.id ? "speaking" : null} status={game.chaosEnabled ? `${p.charges} influence` : null} />
      ))}
    </section>
  );
}

export function Timeline({ game, limit = 8 }: { game: PublicGameState; limit?: number }) {
  const items = game.timeline.slice(-limit).reverse();
  if (!items.length) return null;
  return (
    <section aria-label="Match timeline">
      <h3 className="mb-2 caption-3 text-ink-faint">Timeline</h3>
      <ol className="space-y-2 body-6">
        {items.map((t) => (
          <li key={t.id} className="flex gap-2">
            <span
              aria-hidden
              className={cn("mt-2 size-2 shrink-0 rounded-full", t.kind === "CARD" ? "bg-chaos" : t.kind === "EVIDENCE" ? "bg-amber" : t.kind === "REVEAL" || t.kind === "VERDICT" ? "bg-violet" : "bg-surface-hover")}
            />
            <span>{t.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PhaseHeader({ game, delayMs = 0, size = "md" }: { game: PublicGameState; delayMs?: number; size?: "md" | "xl" }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="caption-3 text-violet-bright">{game.progress.segments.find((s) => s.status === "current")?.label}</div>
        <h1 className={cn("", size === "xl" ? "heading-1" : "heading-4 sm:heading-3")} data-testid="phase-label" data-phase={game.phase.name}>
          {game.phase.label}
        </h1>
      </div>
      <CountdownTimer phase={game.phase} delayMs={delayMs} large={size === "xl"} />
    </div>
  );
}
