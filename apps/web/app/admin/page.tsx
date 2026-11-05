"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Dialog, DialogContent, Input, Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@hps/ui";
import { PACK_IDS, SENSITIVE_TOPICS } from "@hps/shared";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { useAccount } from "@/hooks/use-account";
import { api } from "@/lib/session";

interface AdminPrompt {
  id: string;
  packId: string;
  mode: "SPECTRUM" | "DEBATE" | "BLUFF" | "FINALE";
  question: string;
  leftLabel: string;
  rightLabel: string;
  tags: string[];
  contentRating: "SAFE" | "MATURE";
  streamSafe: boolean;
  intensity: number;
  difficulty: number;
  enabled: boolean;
}
interface Report {
  id: string;
  kind: string;
  promptId: string | null;
  reason: string;
  status: string;
  createdAt: string;
}

const MODES = ["SPECTRUM", "DEBATE", "BLUFF", "FINALE"] as const;

export default function AdminPage() {
  const { account, loading } = useAccount();
  if (loading) return null;
  if (account?.user.role !== "ADMIN")
    return (
      <div className="grain min-h-dvh bg-stage">
        <SiteHeader />
        <main id="main" className="mx-auto max-w-6xl px-4">
          <p className="text-ink-soft">Not found.</p>
        </main>
        <SiteFooter />
      </div>
    );
  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pb-16">
        <h1 className="heading-1">Content admin</h1>
        <Tabs defaultValue="prompts" className="mt-4">
          <TabsList>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="packs">Packs</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="prompts" className="mt-4">
            <Prompts />
          </TabsContent>
          <TabsContent value="packs" className="mt-4">
            <Packs />
          </TabsContent>
          <TabsContent value="import" className="mt-4">
            <Import />
          </TabsContent>
          <TabsContent value="reports" className="mt-4">
            <Reports />
          </TabsContent>
        </Tabs>
      </main>
      <SiteFooter />
    </div>
  );
}

const select = "h-10 rounded-lg border border-line bg-stage px-2 body-6 text-ink";

function Prompts() {
  const [q, setQ] = useState("");
  const [pack, setPack] = useState("");
  const [mode, setMode] = useState("");
  const [rating, setRating] = useState("");
  const [list, setList] = useState<AdminPrompt[]>([]);
  const [editing, setEditing] = useState<AdminPrompt | "new" | null>(null);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ q, pack, mode, rating });
    api<{ prompts: AdminPrompt[] }>(`/api/admin/prompts?${qs}`).then((r) => setList(r.prompts));
  }, [q, pack, mode, rating]);
  useEffect(load, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search text, id or tag" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search" />
        <select className={select} value={pack} onChange={(e) => setPack(e.target.value)} aria-label="Pack">
          <option value="">All packs</option>
          {PACK_IDS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className={select} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
          <option value="">All modes</option>
          {MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select className={select} value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Rating">
          <option value="">Any rating</option>
          <option>SAFE</option>
          <option>MATURE</option>
        </select>
        <Button onClick={() => setEditing("new")}>New prompt</Button>
      </div>
      <p className="body-6 text-ink-faint">{list.length} prompts</p>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {list.slice(0, 200).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.question}</div>
              <div className="flex flex-wrap gap-2 caption-5 text-ink-faint">
                <span className="font-mono">{p.id}</span>
                <Badge>{p.mode}</Badge>
                {p.contentRating === "MATURE" && <Badge tone="chaos">18+</Badge>}
                {!p.streamSafe && <Badge tone="amber">not stream safe</Badge>}
                <span>intensity {p.intensity}</span>
                {p.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </div>
            <Switch
              checked={p.enabled}
              aria-label={`Enable ${p.id}`}
              onCheckedChange={async (on) => {
                await api(`/api/admin/prompts/${encodeURIComponent(p.id)}`, { method: "PATCH", body: { enabled: on } });
                load();
              }}
            />
            <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>
      <PromptEditor
        value={editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved) load();
        }}
      />
    </div>
  );
}

function PromptEditor({ value, onClose }: { value: AdminPrompt | "new" | null; onClose: (saved: boolean) => void }) {
  const blank: Omit<AdminPrompt, "id"> = { packId: "base", mode: "SPECTRUM", question: "", leftLabel: "", rightLabel: "", tags: [], contentRating: "SAFE", streamSafe: true, intensity: 2, difficulty: 2, enabled: true };
  const [f, setF] = useState<Omit<AdminPrompt, "id">>(blank);
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (value && value !== "new") {
      setF(value);
      setTags(value.tags.join(", "));
    } else {
      setF(blank);
      setTags("");
    }
    setError(null);
  }, [value]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, tags: tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) };
    try {
      if (value === "new") await api("/api/admin/prompts", { body });
      else if (value) await api(`/api/admin/prompts/${encodeURIComponent(value.id)}`, { method: "PUT", body });
      onClose(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent title={value === "new" ? "New prompt" : "Edit prompt"} className="max-w-2xl">
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <select className={select} value={f.packId} onChange={(e) => setF({ ...f, packId: e.target.value })} aria-label="Pack">
              {PACK_IDS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select className={select} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as AdminPrompt["mode"] })} aria-label="Mode">
              {MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              className={select}
              value={f.contentRating}
              onChange={(e) => setF({ ...f, contentRating: e.target.value as AdminPrompt["contentRating"], streamSafe: e.target.value === "MATURE" ? false : f.streamSafe })}
              aria-label="Rating"
            >
              <option>SAFE</option>
              <option>MATURE</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pq">Question</Label>
            <Input id="pq" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pl">0 label</Label>
              <Input id="pl" value={f.leftLabel} onChange={(e) => setF({ ...f, leftLabel: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pr">100 label</Label>
              <Input id="pr" value={f.rightLabel} onChange={(e) => setF({ ...f, rightLabel: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pt">Tags (comma separated; mature prompts need one of: {SENSITIVE_TOPICS.join(", ")})</Label>
            <Input id="pt" value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-4 body-6">
            <label className="flex items-center gap-2">
              Intensity
              <input type="number" min={1} max={5} value={f.intensity} onChange={(e) => setF({ ...f, intensity: Number(e.target.value) })} className="h-9 w-16 rounded-lg border border-line bg-stage px-2" />
            </label>
            <label className="flex items-center gap-2">
              Stream safe <Switch checked={f.streamSafe} disabled={f.contentRating === "MATURE"} onCheckedChange={(v) => setF({ ...f, streamSafe: v })} />
            </label>
          </div>
          {error && <p className="body-6 text-chaos">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Packs() {
  const [packs, setPacks] = useState<{ id: string; name: string; enabled: boolean; counts: { safe: number; mature: number } }[]>([]);
  const load = useCallback(() => {
    api<{ packs: typeof packs }>("/api/admin/packs").then((r) => setPacks(r.packs));
  }, []);
  useEffect(load, [load]);
  return (
    <ul className="space-y-2">
      {packs.map((p) => (
        <li key={p.id} className="flex items-center justify-between rounded-xl border border-line bg-surface p-3">
          <div>
            <div className="font-semibold">{p.name}</div>
            <div className="caption-5 text-ink-faint">
              {p.counts.safe} safe · {p.counts.mature} mature
            </div>
          </div>
          <Switch
            checked={p.enabled}
            disabled={p.id === "base"}
            aria-label={`Enable ${p.name}`}
            onCheckedChange={async (on) => {
              await api(`/api/admin/packs/${p.id}`, { method: "PATCH", body: { enabled: on } });
              load();
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function Import() {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [data, setData] = useState("");
  const [result, setResult] = useState<{ valid: unknown[]; errors: { row: number; message: string }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="body-6 text-ink-faint">
        CSV columns: packId, mode, question, leftLabel, rightLabel, tags (separated by ;), contentRating, streamSafe, intensity. Rows are validated before anything is written.
      </p>
      <select className={select} value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")} aria-label="Format">
        <option value="csv">CSV</option>
        <option value="json">JSON</option>
      </select>
      <textarea
        value={data}
        onChange={(e) => setData(e.target.value)}
        rows={10}
        className="w-full rounded-xl border border-line bg-stage p-3 font-mono caption-5 text-ink"
        aria-label="Import data"
      />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={async () => setResult(await api("/api/admin/prompts/validate", { body: { format, data } }))}>
          Validate
        </Button>
        <Button
          disabled={!result || result.errors.length > 0 || result.valid.length === 0}
          onClick={async () => {
            try {
              const r = await api<{ imported: number }>("/api/admin/prompts/import", { body: { format, data } });
              setMsg(`Imported ${r.imported} prompts.`);
              setResult(null);
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Import
        </Button>
      </div>
      {result && (
        <div className="body-6">
          <p className="text-teal">{result.valid.length} valid rows</p>
          {result.errors.map((e) => (
            <p key={e.row} className="text-chaos">
              Row {e.row}: {e.message}
            </p>
          ))}
        </div>
      )}
      {msg && <p className="body-6">{msg}</p>}
    </div>
  );
}

function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const load = useCallback(() => {
    api<{ reports: Report[] }>("/api/admin/reports").then((r) => setReports(r.reports));
  }, []);
  useEffect(load, [load]);
  if (!reports.length)
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="title-3">No reports in the queue</p>
        <p className="body-6 mt-2 text-ink-soft">When a player reports a prompt from inside a match, it lands here with their reason.</p>
      </div>
    );
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Badge tone={r.status === "OPEN" ? "amber" : "neutral"}>{r.status}</Badge> <span className="font-mono caption-5 text-ink-faint">{r.promptId ?? r.kind}</span>
              <p className="mt-1 body-6">{r.reason}</p>
            </div>
            <div className="flex gap-1">
              {(["REVIEWED", "ACTIONED", "DISMISSED"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/api/admin/reports/${r.id}`, { method: "PATCH", body: { status: s } });
                    load();
                  }}
                >
                  {s.toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
