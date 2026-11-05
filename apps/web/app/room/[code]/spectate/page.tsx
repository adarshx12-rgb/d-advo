"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EyeIcon as Eye } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, Skeleton } from "@hps/ui";
import { useRoom } from "@/hooks/use-room";
import { ResultsScreen, SpectatorVote } from "@/components/game/cards-results-host";
import { ConnectionStatus, MatchProgress, PlayerAvatar } from "@/components/game/primitives";
import { PendingCardBanner, PhaseHeader, Scoreboard, StageContent, Timeline } from "@/components/game/stage";

export default function SpectatePage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = String(raw).toUpperCase();
  const { room, game, connection, fatal, emit } = useRoom(code, "spectator");

  if (fatal && !room)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p role="alert" className="text-ink-soft">
          {fatal}
        </p>
        <Button asChild>
          <Link href="/">Home</Link>
        </Button>
      </main>
    );

  return (
    <div className="theme-court min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 heading-6">
          <Eye className="size-5 text-cyan" /> Watching {code}
        </span>
        <span className="flex items-center gap-3">
          {game?.spectator && <Badge tone="cyan">{game.spectator.points} audience pts</Badge>}
          <ConnectionStatus state={connection} />
        </span>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-12">
        {!room ? (
          <Skeleton className="h-64 rounded-2xl" aria-label="Connecting" />
        ) : !game ? (
          <section className="rounded-2xl border border-line bg-surface p-6">
            <h1 className="heading-3">The show hasn&apos;t started</h1>
            <p className="mt-1 text-ink-soft">You will see the stage here as soon as the host starts.</p>
            <ul className="mt-4 flex flex-wrap gap-3">
              {room.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3">
                  <PlayerAvatar avatar={m.avatar} id={m.id} size={28} /> {m.name}
                </li>
              ))}
            </ul>
          </section>
        ) : game.phase.name === "RESULTS" ? (
          <div className="mx-auto max-w-3xl">
            <ResultsScreen game={game} />
          </div>
        ) : (
          <div className="space-y-4">
            <MatchProgress progress={game.progress} />
            <PendingCardBanner game={game} />
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4 rounded-2xl border border-line bg-surface/70 p-6">
                <PhaseHeader game={game} />
                <StageContent game={game} />
                <SpectatorVote game={game} emit={(e, p) => emit(e, p)} />
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-line bg-surface p-3">
                  <Scoreboard game={game} compact />
                </div>
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <Timeline game={game} />
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
