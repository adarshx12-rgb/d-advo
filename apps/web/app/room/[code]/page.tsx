"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FlagIcon as Flag, SignOutIcon as LogOut, ArrowCounterClockwiseIcon as RotateCcw } from "@phosphor-icons/react/dist/ssr";
import { Button, Dialog, DialogContent, Input, Label, Skeleton } from "@hps/ui";
import type { AvatarId } from "@hps/shared";
import { useRoom } from "@/hooks/use-room";
import { Lobby } from "@/components/lobby/lobby";
import { ActionDock } from "@/components/game/action-dock";
import { CardTray, HostControls, ResultsScreen } from "@/components/game/cards-results-host";
import { AvatarPicker, ConnectionStatus, MatchProgress } from "@/components/game/primitives";
import { PendingCardBanner, PhaseHeader, Scoreboard, StageContent, Timeline } from "@/components/game/stage";
import { MuteToggle } from "@/components/shell/site-header";
import { getProfile, saveProfile, SERVER_URL } from "@/lib/session";

export default function RoomPage() {
  const { code: raw } = useParams<{ code: string }>();
  const code = String(raw).toUpperCase();
  const router = useRouter();
  const r = useRoom(code, "player");
  const { room, game, connection } = r;

  if (r.fatal && !room) {
    return (
      <Centered>
        <h1 className="heading-3">Can&apos;t join {code}</h1>
        <p className="mt-2 text-ink-soft" role="alert">
          {r.fatal}
        </p>
        <Button asChild className="mt-6">
          <Link href="/">Back home</Link>
        </Button>
      </Centered>
    );
  }
  if (r.needsProfile) return <ProfileGate code={code} onJoin={(info) => r.join(info)} />;
  if (!room)
    return (
      <main id="main" className="theme-court mx-auto grid min-h-dvh max-w-6xl gap-6 px-4 py-16 lg:grid-cols-[1fr_1.2fr]" aria-label={`Connecting to room ${code}`}>
        <div className="space-y-6">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
        <Skeleton className="h-[480px] rounded-2xl" />
      </main>
    );

  const meId = room.myId;
  const leave = async () => {
    await r.leave();
    router.push("/");
  };

  return (
    <div className="theme-court min-h-dvh" style={room.branding ? ({ ["--color-violet" as string]: room.branding.accentColor } as React.CSSProperties) : undefined}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          {room.branding?.logoUrl && <img src={`${SERVER_URL}${room.branding.logoUrl}`} alt="" className="h-8 w-auto" />}
          <span className="heading-6">
            Room <span className="text-violet-bright">{room.code}</span>
          </span>
          <ConnectionStatus state={connection} />
        </div>
        <div className="flex items-center gap-1">
          <MuteToggle />
          <Button variant="ghost" size="sm" onClick={leave} aria-label="Leave room">
            <LogOut /> <span className="hidden sm:inline">Leave</span>
          </Button>
        </div>
      </header>
      {r.fatal && (
        <p role="alert" className="mx-auto max-w-6xl px-4 body-6 text-chaos">
          {r.fatal}
        </p>
      )}

      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        {!game ? (
          <Lobby room={room} emit={r.emit} />
        ) : game.phase.name === "RESULTS" ? (
          <div className="mx-auto max-w-3xl space-y-6 pt-4">
            <ResultsScreen game={game} meId={meId} tagline={room.branding?.resultsTagline} />
            {game.me?.isHost && (
              <Button size="lg" className="w-full" onClick={() => r.emit("host:returnToLobby")} data-testid="back-to-lobby">
                <RotateCcw /> Back to the lobby
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <MatchProgress progress={game.progress} />
            <PendingCardBanner game={game} />
            <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
              <div className="space-y-6">
                <div className="rounded-2xl border border-line bg-surface/70 p-6">
                  <PhaseHeader game={game} />
                  <div className="mt-6">
                    <StageContent game={game} />
                  </div>
                </div>
                {game.me && (
                  <div className="rounded-2xl border border-violet/30 bg-surface p-6">
                    <ActionDock game={game} act={r.act} />
                  </div>
                )}
              </div>
              <aside className="space-y-6">
                {game.me && (
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <CardTray game={game} act={r.act} />
                  </div>
                )}
                {game.host && (
                  <div className="rounded-2xl border border-line bg-surface p-4">
                    <HostControls game={game} emit={(e) => r.emit(e)} />
                  </div>
                )}
                <div className="rounded-2xl border border-line bg-surface p-3">
                  <Scoreboard game={game} meId={meId} compact />
                </div>
                <div className="rounded-2xl border border-line bg-surface p-4">
                  <Timeline game={game} />
                </div>
                <ReportPrompt promptId={game.calibration?.prompt.id ?? game.court?.prompt?.id ?? game.bluff?.prompt?.id ?? game.finale?.prompt?.id ?? null} emit={r.emit} />
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="theme-court flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      {children}
    </main>
  );
}

function ProfileGate({ code, onJoin }: { code: string; onJoin: (info: { displayName: string; avatar: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>("star");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const p = getProfile();
    if (p) {
      setName(p.name);
      setAvatar(p.avatar);
    }
  }, []);
  return (
    <main id="main" className="theme-court flex min-h-dvh items-center justify-center px-4">
      <form
        className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Enter a display name.");
          saveProfile({ name: name.trim(), avatar });
          try {
            await onJoin({ displayName: name.trim(), avatar });
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h1 className="heading-3">
          Join room <span className="text-violet-bright">{code}</span>
        </h1>
        <div className="space-y-2">
          <Label htmlFor="gate-name">Display name</Label>
          <Input id="gate-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} data-testid="gate-name" />
        </div>
        <AvatarPicker value={avatar} onChange={(a) => setAvatar(a as AvatarId)} idSeed="gate" />
        {error && (
          <p role="alert" className="body-6 text-chaos">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" data-testid="gate-join">
          Join
        </Button>
      </form>
    </main>
  );
}

function ReportPrompt({ promptId, emit }: { promptId: string | null; emit: (e: "report:submit", p: unknown) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  if (!promptId) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => (setOpen(true), setDone(false))}>
        <Flag /> Report this prompt
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Report prompt" description="Tell us what is wrong. Reports go to the moderation team, not the room.">
          {done ? (
            <p className="text-teal">Thanks — the report was sent.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await emit("report:submit", { kind: "PROMPT", promptId, reason }).catch(() => {});
                setDone(true);
                setReason("");
              }}
            >
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                maxLength={500}
                rows={4}
                className="w-full rounded-lg border border-line bg-stage p-3 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                aria-label="Reason"
              />
              <Button type="submit">Send report</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

