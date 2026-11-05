"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { PublicGameState, RoomView } from "@hps/shared";
import { useRoom } from "@/hooks/use-room";
import { SERVER_URL } from "@/lib/session";
import { ResultsScreen } from "@/components/game/cards-results-host";
import { MatchProgress, PlayerAvatar } from "@/components/game/primitives";
import { PendingCardBanner, PhaseHeader, Scoreboard, StageContent, Timeline } from "@/components/game/stage";

/**
 * 1920×1080 stage for a TV or an OBS browser source. Receives only the public projection.
 * When the host sets a broadcast delay, snapshots are buffered and shown that many seconds late,
 * so the stream never reveals anything sooner than the players in the room see it.
 */
function useDelayed<T>(value: T, delayMs: number): T {
  const [shown, setShown] = useState(value);
  const queue = useRef<{ at: number; v: T }[]>([]);
  useEffect(() => {
    if (delayMs <= 0) {
      queue.current = [];
      setShown(value);
      return;
    }
    queue.current.push({ at: Date.now() + delayMs, v: value });
  }, [value, delayMs]);
  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      let last: { at: number; v: T } | undefined;
      while (queue.current[0] && queue.current[0].at <= now) last = queue.current.shift();
      if (last) setShown(last.v);
    }, 200);
    return () => clearInterval(t);
  }, [delayMs]);
  return shown;
}

export default function BroadcastPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = String(raw).toUpperCase();
  const live = useRoom(code, "broadcast");
  const delayMs = (live.room?.settings.streamDelaySeconds ?? 0) * 1000;
  const game = useDelayed<PublicGameState | null>(live.game, delayMs);
  const room = useDelayed<RoomView | null>(live.room, delayMs);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const accent = room?.branding?.accentColor;
  return (
    <div className="fixed inset-0 overflow-hidden bg-stage-deep">
      <div
        className="theme-court absolute left-1/2 top-1/2 origin-center"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, ...(accent ? { ["--color-violet" as string]: accent } : {}) }}
        data-testid="broadcast-stage"
      >
        <div className="flex h-full flex-col p-16">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {room?.branding?.logoUrl && <img src={`${SERVER_URL}${room.branding.logoUrl}`} alt="" className="h-16 w-auto" />}
              <span className="heading-3">Hybrid Party Show</span>
            </div>
            <div className="text-right">
              <div className="title-2 text-ink-faint">Join at this site with code</div>
              <div className="heading-1 text-violet-bright">{code}</div>
            </div>
          </header>

          {!room ? (
            <div className="m-auto heading-4 text-ink-faint">{live.fatal ?? "Connecting…"}</div>
          ) : !game ? (
            <div className="m-auto text-center">
              <div className="heading-1">{room.branding?.lobbyHeader ?? room.settings.roomName}</div>
              <div className="mt-4 heading-4 text-ink-soft">Waiting for players · {room.members.length} in the room</div>
              <div className="mt-10 flex flex-wrap justify-center gap-6">
                {room.members.map((m) => (
                  <div key={m.id} className="flex flex-col items-center gap-2">
                    <PlayerAvatar avatar={m.avatar} id={m.id} size={96} />
                    <span className="heading-5">{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : game.phase.name === "RESULTS" ? (
            <div className="mx-auto mt-6 w-[1100px]">
              <ResultsScreen game={game} size="xl" tagline={room.branding?.resultsTagline} />
            </div>
          ) : (
            <div className="mt-8 flex min-h-0 flex-1 flex-col gap-6">
              <MatchProgress progress={game.progress} className="body-3" />
              <PendingCardBanner game={game} />
              <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-10">
                <div className="min-h-0 space-y-6 overflow-hidden">
                  <PhaseHeader game={game} size="xl" delayMs={delayMs} />
                  <StageContent game={game} size="xl" />
                </div>
                <aside className="min-h-0 space-y-6 overflow-hidden title-1">
                  <Scoreboard game={game} />
                  <Timeline game={game} limit={6} />
                </aside>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
