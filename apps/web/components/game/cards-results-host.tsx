"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { FastForwardIcon as FastForward, PauseIcon as Pause, PlayIcon as Play, PowerIcon as Power, SkipForwardIcon as SkipForward, SparkleIcon as Sparkles, TrophyIcon as Trophy } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, cn, Dialog, DialogContent } from "@hps/ui";
import type { ChaosCardType, GameActionInput, PublicGameState } from "@hps/shared";
import type { AnyGameState } from "@/hooks/use-room";
import { EASE, PlayerAvatar } from "./primitives";
import { CARD_ART, CARD_BACK, CARD_COPY, nameOf } from "./util";

/** The player's Influence hand. Cards only appear as playable when the server lists them as legal. */
export function CardTray({ game, act }: { game: AnyGameState; act: (a: GameActionInput) => Promise<unknown> }) {
  const me = game.me!;
  const [picking, setPicking] = useState<ChaosCardType | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!game.chaosEnabled) return null;

  const play = async (a: GameActionInput) => {
    setError(null);
    try {
      await act(a);
      setPicking(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const choose = (card: ChaosCardType) => {
    if (card === "RECEIPTS" || card === "CROSS_EXAMINATION") setPicking(card);
    else void play({ type: "PLAY_CARD", card });
  };

  return (
    <section aria-label="Chaos cards" className="space-y-2" data-testid="card-tray">
      <div className="flex items-center justify-between">
        <h3 className="caption-3 text-ink-faint">Chaos cards</h3>
        <span className="flex items-center gap-1 caption-3 text-ink-soft" aria-label={`${me.charges} influence charges left`}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className={cn("size-2.5 rotate-45", i < me.charges ? "bg-chaos" : "bg-surface-raised")} aria-hidden />
          ))}
          <span className="ml-1">{me.charges} influence</span>
        </span>
      </div>
      {/* A fanned hand of real cards. Playable cards lift and straighten on hover; the rest sit face down. */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {(Object.keys(CARD_COPY) as ChaosCardType[]).map((c, i) => {
          const can = me.playableCards.includes(c);
          const tilt = [-4, -1.5, 1.5, 4][i] ?? 0;
          return (
            <button
              key={c}
              disabled={!can}
              onClick={() => choose(c)}
              title={`${CARD_COPY[c].name}: ${CARD_COPY[c].blurb}`}
              aria-label={`${CARD_COPY[c].name}. ${CARD_COPY[c].blurb}${can ? "" : " Not playable right now."}`}
              data-testid={`card-${c}`}
              style={{ ["--tilt" as string]: `${tilt}deg` }}
              className={cn(
                "group relative rotate-[var(--tilt)] rounded-lg transition-[transform,filter,opacity] duration-300 ease-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan",
                can ? "hover:z-10 hover:-translate-y-3 hover:rotate-0 hover:scale-105" : "cursor-not-allowed opacity-50 grayscale",
              )}
            >
              <img src={can ? CARD_ART[c] : CARD_BACK} alt="" draggable={false} className="aspect-[5/7] w-full select-none object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/0.35)]" />
              <span className="caption-3 mt-1 block truncate text-center text-ink-soft">{CARD_COPY[c].name}</span>
            </button>
          );
        })}
      </div>
      {me.cardPlayedThisUnit && <p className="caption-5 text-ink-faint">You have already played a card in this part.</p>}
      {error && (
        <p role="alert" className="body-6 text-chaos">
          {error}
        </p>
      )}
      <Dialog open={picking !== null} onOpenChange={(o) => !o && setPicking(null)}>
        {picking === "RECEIPTS" && (
          <DialogContent title="Receipts" description="Choose a previous statement to put in front of the room.">
            <div className="space-y-2">
              {me.receiptTargets.length === 0 && <p className="text-ink-soft">No eligible statements right now.</p>}
              {me.receiptTargets.map((e) => (
                <button
                  key={e.id}
                  onClick={() => play({ type: "PLAY_CARD", card: "RECEIPTS", targetEntryId: e.id })}
                  className="w-full rounded-xl border border-amber/40 bg-amber/8 p-3 text-left hover:bg-amber/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  <div className="caption-3 text-amber">
                    {nameOf(game, e.playerId)} · {e.sourceLabel}
                  </div>
                  <div className="body-6">“{e.promptQuestion}” — {e.value}</div>
                </button>
              ))}
            </div>
          </DialogContent>
        )}
        {picking === "CROSS_EXAMINATION" && (
          <DialogContent title="Cross examination" description="Who must answer your direct question?">
            <div className="grid gap-2">
              {me.crossExamTargets.map((id) => (
                <Button key={id} variant="secondary" onClick={() => play({ type: "PLAY_CARD", card: "CROSS_EXAMINATION", targetPlayerId: id })}>
                  {nameOf(game, id)}
                </Button>
              ))}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

export function HostControls({ game, emit }: { game: AnyGameState; emit: (e: "host:pause" | "host:resume" | "host:skipPrompt" | "host:advance" | "host:end") => Promise<unknown> }) {
  const h = game.host;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!h) return null;
  const run = (e: Parameters<typeof emit>[0]) => emit(e).then(() => setError(null), (err: Error) => setError(err.message));
  return (
    <section aria-label="Host controls" className="space-y-2" data-testid="host-controls">
      <h3 className="caption-3 text-ink-faint">Host controls</h3>
      <div className="flex flex-wrap gap-2">
        {h.canPause && (
          <Button size="sm" variant="secondary" onClick={() => run("host:pause")}>
            <Pause /> Pause
          </Button>
        )}
        {h.canResume && (
          <Button size="sm" variant="live" onClick={() => run("host:resume")}>
            <Play /> Resume
          </Button>
        )}
        {h.canAdvance && (
          <Button size="sm" variant="secondary" onClick={() => run("host:advance")} data-testid="host-advance">
            <FastForward /> Next
          </Button>
        )}
        {h.canSkipPrompt && (
          <Button size="sm" variant="secondary" onClick={() => run("host:skipPrompt")}>
            <SkipForward /> Replace prompt
          </Button>
        )}
        {h.canEnd && (
          <Button size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>
            <Power /> End match
          </Button>
        )}
      </div>
      {error && <p className="body-6 text-chaos">{error}</p>}
      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <DialogContent title="End the match?" description="Scores so far become the final results. This cannot be undone.">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmEnd(false);
                void run("host:end");
              }}
            >
              End match
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const MODE_LABELS: Record<string, string> = { CALIBRATION: "Read the Room", CONTRACTS: "Contracts", COURT: "Court", BLUFF: "Bluff", FINALE: "Finale" };

export function ResultsScreen({ game, meId, size = "md", tagline }: { game: PublicGameState; meId?: string | null; size?: "md" | "xl"; tagline?: string | null }) {
  const r = game.results;
  if (!r) return null;
  return (
    <div className="space-y-6" data-testid="results">
      <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5, ease: EASE }} className="text-center">
        <Trophy className="mx-auto size-12 text-amber" aria-hidden />
        <h1 className={cn("mt-2", size === "xl" ? "heading-1" : "heading-2")} data-testid="winner">
          {r.winners.map((w) => nameOf(game, w)).join(" & ")} {r.winners.length > 1 ? "share the win" : "wins"}
        </h1>
        {tagline && <p className="mt-1 title-2 text-ink-soft">{tagline}</p>}
      </motion.div>

      <ol className="space-y-2">
        {r.standings.map((s, i) => {
          const p = game.players.find((x) => x.id === s.playerId);
          return (
            <motion.li
              key={s.playerId}
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.5, ease: EASE, delay: Math.min(0.06 * i, 0.4) }}
              className={cn("rounded-xl border bg-surface p-3", s.rank === 1 ? "border-amber" : "border-line", s.playerId === meId && "ring-1 ring-violet")}
            >
              <div className="flex items-center gap-3">
                <span className="tabular w-8 heading-4 text-ink-faint">{s.rank}</span>
                <PlayerAvatar avatar={p?.avatar ?? "star"} id={s.playerId} size={size === "xl" ? 56 : 40} />
                <div className="min-w-0 flex-1">
                  <div className={cn("font-semibold", size === "xl" && "heading-5")}>
                    {nameOf(game, s.playerId)} {s.sharedRank && <Badge>tied</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 caption-5 text-ink-faint">
                    {Object.entries(s.byMode)
                      .filter(([k, v]) => v > 0 && k !== "RESULTS")
                      .map(([k, v]) => (
                        <span key={k}>
                          {MODE_LABELS[k] ?? k} {v}
                        </span>
                      ))}
                  </div>
                </div>
                <span className="tabular heading-3">{s.total}</span>
              </div>
            </motion.li>
          );
        })}
      </ol>

      {r.awards.length > 0 && (
        <section className="grid gap-2 sm:grid-cols-2">
          {r.awards.map((a) => (
            <div key={a.title} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center gap-2 caption-3 text-amber">
                <Sparkles className="size-3.5" /> {a.title}
              </div>
              <div className="font-semibold">{nameOf(game, a.playerId)}</div>
              <div className="body-6 text-ink-faint">{a.reason}</div>
            </div>
          ))}
        </section>
      )}

      {r.contracts.some((c) => c.contract) && (
        <section className="space-y-2">
          <h2 className="heading-5 text-teal">Secret contracts revealed</h2>
          {r.contracts
            .filter((c) => c.contract)
            .map((c) => (
              <div key={c.playerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal/30 bg-teal/5 p-3 body-6">
                <span>
                  <strong>{nameOf(game, c.playerId)}</strong> — {c.contract!.title}: {c.contract!.description}
                </span>
                <Badge tone={c.contract!.status === "COMPLETED" ? "teal" : "neutral"}>{c.contract!.status === "COMPLETED" ? `+${c.contract!.reward}` : "failed"}</Badge>
              </div>
            ))}
        </section>
      )}

      {r.spectatorLeaders.length > 0 && (
        <section>
          <h2 className="caption-3 text-ink-faint">Top audience reads (just for fun)</h2>
          <p className="body-6 text-ink-soft">{r.spectatorLeaders.map((s) => `${s.name} (${s.points})`).join(" · ")}</p>
        </section>
      )}
    </div>
  );
}

/** Advisory audience voting for spectators. Never affects player scores. */
export function SpectatorVote({ game, emit }: { game: AnyGameState; emit: (e: "spectator:vote", p: unknown) => Promise<unknown> }) {
  const s = game.spectator;
  const [err, setErr] = useState<string | null>(null);
  if (!s?.canVote || !s.voteKind) return null;
  const choices: { id: string; label: string }[] =
    s.voteKind === "BLUFF"
      ? [
          { id: "HONEST", label: "Honest" },
          { id: "BLUFF", label: "Bluffing" },
        ]
      : (() => {
          const v = s.voteKind === "COURT" ? game.court : game.finale;
          return v ? [v.debaterA, v.debaterB].map((id) => ({ id, label: nameOf(game as PublicGameState, id) })) : [];
        })();
  return (
    <section className="space-y-2 rounded-xl border border-cyan/40 bg-cyan/5 p-4" aria-label="Audience vote" data-testid="spectator-vote">
      <h3 className="heading-6 text-cyan">Audience vote</h3>
      <p className="caption-5 text-ink-faint">For fun only — the audience never changes player scores.</p>
      <div className="flex gap-2">
        {choices.map((c) => (
          <Button
            key={c.id}
            variant={s.ballot === c.id ? "live" : "secondary"}
            aria-pressed={s.ballot === c.id}
            onClick={() =>
              emit("spectator:vote", { actionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, choice: c.id }).then(
                () => setErr(null),
                (e: Error) => setErr(e.message),
              )
            }
          >
            {c.label}
          </Button>
        ))}
      </div>
      {err && <p className="body-6 text-chaos">{err}</p>}
    </section>
  );
}
