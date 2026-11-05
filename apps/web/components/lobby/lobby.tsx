"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckIcon as Check, CopyIcon as Copy, CrownIcon as Crown, LockIcon as Lock, MonitorPlayIcon as MonitorPlay, ShieldWarningIcon as ShieldAlert, TelevisionIcon as Tv, UserSwitchIcon as UserMinus, ProhibitIcon as UserX } from "@phosphor-icons/react/dist/ssr";
import { Badge, Button, cn, Dialog, DialogContent, Switch } from "@hps/ui";
import {
  formatInr,
  MATCH_LENGTHS,
  MATCH_TYPES,
  SENSITIVE_TOPICS,
  type PackId,
  type RoomSettingsPatch,
  type RoomView,
} from "@hps/shared";
import { PlayerAvatar } from "@/components/game/primitives";

type Emit = <T>(event: "room:settings" | "player:ready" | "player:consent" | "host:start" | "host:kick" | "host:transfer", payload?: unknown) => Promise<T>;

const MATCH_TYPE_LABEL: Record<(typeof MATCH_TYPES)[number], string> = {
  FULL_SHOW: "Full show",
  OPINIONS_AND_COURT: "Opinions + Court",
  OPINIONS_AND_BLUFF: "Opinions + Bluff",
};
const LENGTH_LABEL: Record<(typeof MATCH_LENGTHS)[number], string> = { QUICK: "Quick", STANDARD: "Standard", LONG: "Long" };

export function Lobby({ room, emit }: { room: RoomView; emit: Emit }) {
  const me = room.members.find((m) => m.id === room.myId);
  const isHost = !!me?.isHost;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const patch = (p: RoomSettingsPatch) => run(emit("room:settings", { patch: p }));
  const s = room.settings;

  const copyLink = async () => {
    const url = `${window.location.origin}/room/${room.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <section className="space-y-6">
        {room.branding?.lobbyHeader && <p className="heading-5" style={{ color: room.branding.accentColor }}>{room.branding.lobbyHeader}</p>}
        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="caption-3 text-ink-faint">Room code</div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="heading-1" data-testid="room-code">
              {room.code}
            </div>
            <Button variant="secondary" size="sm" onClick={copyLink}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy invite link"}
            </Button>
          </div>
          {isHost && room.inviteKey && s.inviteOnly && (
            <p className="mt-2 body-6 text-ink-soft">
              Invite-only. Share key <code className="rounded bg-stage px-2 py-0.5 font-mono">{room.inviteKey}</code> with friends.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/room/${room.code}/broadcast`} target="_blank">
                <Tv /> Broadcast view
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/room/${room.code}/spectate`} target="_blank">
                <MonitorPlay /> Spectate
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="heading-5">
              Players <span className="tabular text-ink-faint">{room.members.length}/{s.maxPlayers}</span>
            </h2>
            {room.spectatorCount > 0 && <Badge tone="cyan">{room.spectatorCount} watching</Badge>}
          </div>
          <ul className="space-y-1" data-testid="member-list">
            {room.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-raised/50">
                <PlayerAvatar avatar={m.avatar} id={m.id} size={36} dimmed={!m.connected} />
                <span className="flex-1 truncate font-semibold">
                  {m.name} {m.id === room.myId && <span className="caption-5 text-violet-bright">(you)</span>}
                  {m.isHost && <Crown className="ml-1 inline size-4 text-amber" aria-label="host" />}
                </span>
                {m.ready ? <Badge tone="teal">Ready</Badge> : <Badge>Not ready</Badge>}
                {isHost && m.id !== room.myId && (
                  <span className="flex">
                    <Button variant="ghost" size="icon" aria-label={`Make ${m.name} host`} title="Make host" onClick={() => run(emit("host:transfer", { playerId: m.id }))}>
                      <UserMinus />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${m.name}`} title="Remove from room" onClick={() => run(emit("host:kick", { playerId: m.id }))}>
                      <UserX />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="lg" variant={me?.ready ? "secondary" : "primary"} className="flex-1" onClick={() => run(emit("player:ready", { ready: !me?.ready }))} data-testid="ready">
              {me?.ready ? "Not ready" : "I'm ready"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setConsentOpen(true)} data-testid="content-prefs">
              <ShieldAlert /> Content
            </Button>
          </div>
          {isHost && (
            <div className="mt-3 space-y-2">
              <Button size="lg" variant="live" className="w-full" disabled={!room.canStart} onClick={() => run(emit("host:start"))} data-testid="start">
                Start the show
              </Button>
              {room.startBlockers.length > 0 && (
                <ul className="space-y-0.5 body-6 text-ink-faint" data-testid="start-blockers">
                  {room.startBlockers.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!isHost && <p className="mt-3 text-center body-6 text-ink-faint">Waiting for the host to start.</p>}
          {error && (
            <p role="alert" className="mt-3 body-6 text-chaos">
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-6">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-1 heading-5">Content packs</h2>
          <p className="mb-3 body-6 text-ink-faint">Packs owned by the host are available to everyone in this room. Adult prompts stay off unless a pack&apos;s 18+ switch is on and every player opts in.</p>
          <ul className="space-y-2">
            {room.packs.map((p) => {
              const enabled = s.enabledPacks.includes(p.packId);
              return (
                <li key={p.packId} className={cn("rounded-xl border p-3", enabled ? "border-violet/50 bg-violet/6" : "border-line")} data-testid={`pack-${p.packId}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-semibold">
                        {p.name}
                        {!p.owned && (
                          <Badge>
                            <Lock className="size-3" /> {formatInr(p.pricePaise)}
                          </Badge>
                        )}
                      </div>
                      <div className="caption-5 text-ink-faint">
                        {p.safePromptCount} prompts{p.hasMatureContent ? ` · ${p.maturePromptCount} adult` : ""}
                      </div>
                    </div>
                    {p.owned ? (
                      <label className="flex items-center gap-2 body-6 text-ink-soft">
                        Use
                        <Switch
                          checked={enabled}
                          disabled={!isHost || p.packId === "base"}
                          aria-label={`Use ${p.name}`}
                          onCheckedChange={(on) => patch({ enabledPacks: on ? [...s.enabledPacks, p.packId] : s.enabledPacks.filter((x) => x !== p.packId) })}
                          data-testid={`pack-toggle-${p.packId}`}
                        />
                      </label>
                    ) : (
                      isHost && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/store/pack-${p.packId}`}>Unlock</Link>
                        </Button>
                      )
                    )}
                  </div>
                  {p.owned && p.hasMatureContent && enabled && (
                    <label className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 body-6">
                      <span className="text-ink-soft">
                        18+ prompts <span className="text-ink-faint">(every player must opt in)</span>
                      </span>
                      <Switch
                        tone="chaos"
                        checked={s.nsfwByPack[p.packId]}
                        disabled={!isHost}
                        aria-label={`Allow 18+ prompts from ${p.name}`}
                        onCheckedChange={(on) => patch({ nsfwByPack: { ...s.nsfwByPack, [p.packId as PackId]: on } as typeof s.nsfwByPack })}
                        data-testid={`nsfw-${p.packId}`}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          {room.adultContent.anyPackToggled && (
            <p className={cn("mt-3 rounded-lg px-3 py-2 body-6", room.adultContent.active ? "bg-chaos/10 text-chaos" : "bg-surface-raised text-ink-soft")} data-testid="adult-status">
              {room.adultContent.active
                ? "Adult prompts are active: every player opted in and confirmed they are 18+."
                : `Adult prompts are off until everyone opts in (${room.adultContent.consentedCount}/${room.adultContent.playerCount}).`}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="mb-3 heading-5">Show settings</h2>
          <fieldset disabled={!isHost} className="space-y-4">
            <Segmented label="Match" value={s.matchType} options={MATCH_TYPES.map((v) => ({ v, l: MATCH_TYPE_LABEL[v] }))} onChange={(v) => patch({ matchType: v })} />
            <Segmented label="Length" value={s.matchLength} options={MATCH_LENGTHS.map((v) => ({ v, l: LENGTH_LABEL[v] }))} onChange={(v) => patch({ matchLength: v })} />
            <Segmented
              label="Pacing"
              value={s.progression}
              options={[
                { v: "AUTO" as const, l: "Timed" },
                { v: "MANUAL" as const, l: "Host advances" },
              ]}
              onChange={(v) => patch({ progression: v })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="Chaos cards" checked={s.chaosEnabled} onChange={(v) => patch({ chaosEnabled: v })} />
              <Toggle label="Secret contracts" checked={s.contractsEnabled} onChange={(v) => patch({ contractsEnabled: v })} />
              <Toggle label="Audience voting" checked={s.audienceEnabled} onChange={(v) => patch({ audienceEnabled: v })} />
              <Toggle label="Streamer mode" hint="Only prompts safe for streams" checked={s.streamerMode} onChange={(v) => patch({ streamerMode: v })} />
              <Toggle label="Public room" checked={s.visibility === "PUBLIC"} onChange={(v) => patch({ visibility: v ? "PUBLIC" : "PRIVATE" })} />
              <Toggle label="Invite only" checked={s.inviteOnly} onChange={(v) => patch({ inviteOnly: v })} />
            </div>
            <label className="flex items-center justify-between gap-3 body-6">
              <span className="font-semibold text-ink-soft">Broadcast delay</span>
              <select
                value={s.streamDelaySeconds}
                onChange={(e) => patch({ streamDelaySeconds: Number(e.target.value) })}
                className="h-9 rounded-lg border border-line bg-stage px-2 text-ink"
              >
                {[0, 5, 10, 30, 60].map((v) => (
                  <option key={v} value={v}>
                    {v === 0 ? "None" : `${v}s`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 body-6">
              <span className="font-semibold text-ink-soft">Max intensity</span>
              <select value={s.maxIntensity} onChange={(e) => patch({ maxIntensity: Number(e.target.value) })} className="h-9 rounded-lg border border-line bg-stage px-2 text-ink">
                {[1, 2, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>
                    {v} {v === 1 ? "(gentlest)" : v === 5 ? "(anything)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="mb-2 body-4 text-ink-soft">Blocked topics for this room</div>
              <div className="flex flex-wrap gap-2">
                {SENSITIVE_TOPICS.map((t) => {
                  const on = s.blockedTopics.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patch({ blockedTopics: on ? s.blockedTopics.filter((x) => x !== t) : [...s.blockedTopics, t] })}
                      className={cn("rounded-full border px-2 py-1 caption-3 disabled:opacity-50", on ? "border-chaos bg-chaos/15 text-chaos" : "border-line text-ink-soft hover:text-ink")}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          </fieldset>
          {!isHost && <p className="mt-3 caption-5 text-ink-faint">Only the host can change settings.</p>}
        </div>
      </section>

      <ConsentDialog open={consentOpen} onOpenChange={setConsentOpen} room={room} emit={emit} />
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-2 body-4 text-ink-soft" id={`seg-${label}`}>
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-stage p-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={cn("rounded-lg px-3 py-2 body-4 transition-colors disabled:cursor-not-allowed", value === o.v ? "bg-violet text-ink-dark" : "text-ink-soft hover:text-ink")}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
      <span>
        <span className="block body-4">{label}</span>
        {hint && <span className="block caption-5 text-ink-faint">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function ConsentDialog({ open, onOpenChange, room, emit }: { open: boolean; onOpenChange: (o: boolean) => void; room: RoomView; emit: Emit }) {
  const c = room.myConsent ?? { adultContent: false, ageConfirmed: false, hiddenTopics: [] };
  const [adult, setAdult] = useState(c.adultContent);
  const [age, setAge] = useState(c.ageConfirmed);
  const [hidden, setHidden] = useState<string[]>(c.hiddenTopics);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Your content preferences" description="These apply only while you are in this room. Hidden topics are removed for everyone without saying who asked.">
        <div className="space-y-4">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block font-semibold">Allow 18+ prompts</span>
              <span className="block body-6 text-ink-faint">Only used if the host turns them on for a pack and everyone agrees.</span>
            </span>
            <Switch tone="chaos" checked={adult} onCheckedChange={setAdult} aria-label="Allow adult prompts" data-testid="consent-adult" />
          </label>
          {adult && (
            <label className="flex items-start gap-2 body-6">
              <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-chaos)]" data-testid="consent-age" />I confirm I am 18 or older.
            </label>
          )}
          <div>
            <div className="mb-2 body-4">Topics I&apos;d rather skip</div>
            <div className="flex flex-wrap gap-2">
              {SENSITIVE_TOPICS.map((t) => {
                const on = hidden.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setHidden(on ? hidden.filter((x) => x !== t) : [...hidden, t])}
                    className={cn("rounded-full border px-2 py-1 caption-3", on ? "border-chaos bg-chaos/15 text-chaos" : "border-line text-ink-soft")}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          {error && <p className="body-6 text-chaos">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              data-testid="consent-save"
              onClick={async () => {
                try {
                  await emit("player:consent", { adultContent: adult, ageConfirmed: adult && age, hiddenTopics: hidden });
                  onOpenChange(false);
                  setError(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
