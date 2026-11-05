"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { UploadSimpleIcon as Upload } from "@phosphor-icons/react/dist/ssr";
import { Button, Input, Label } from "@hps/ui";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { api, getUserToken, SERVER_URL } from "@/lib/session";

interface BrandingResponse {
  unlocked: boolean;
  branding: { accentColor: string; secondaryColor: string; lobbyHeader: string | null; resultsTagline: string | null; logoUrl: string | null } | null;
}

export default function BrandingPage() {
  const [data, setData] = useState<BrandingResponse | null>(null);
  const [form, setForm] = useState({ accentColor: "#8b6cff", secondaryColor: "#3fd6e8", lobbyHeader: "", resultsTagline: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    if (!getUserToken()) return setMsg({ ok: false, text: "Sign in to manage branding." });
    api<BrandingResponse>("/api/branding").then((r) => {
      setData(r);
      if (r.branding)
        setForm({ accentColor: r.branding.accentColor, secondaryColor: r.branding.secondaryColor, lobbyHeader: r.branding.lobbyHeader ?? "", resultsTagline: r.branding.resultsTagline ?? "" });
    });
  }, []);
  useEffect(load, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/branding", { method: "PUT", body: { ...form, lobbyHeader: form.lobbyHeader || null, resultsTagline: form.resultsTagline || null } });
      setMsg({ ok: true, text: "Saved. Rooms you host update right away." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  const upload = async (file: File) => {
    if (file.size > 512 * 1024) return setMsg({ ok: false, text: "Logos must be under 512 KB." });
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    try {
      await api("/api/branding/logo", { body: { dataBase64: btoa(bin) } });
      setMsg({ ok: true, text: "Logo uploaded." });
      load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-2xl px-4 pb-16">
        <h1 className="heading-1">Streamer branding</h1>
        {data && !data.unlocked && (
          <div className="mt-4 rounded-xl border border-line bg-surface p-6">
            <p className="text-ink-soft">Add your logo, colours and custom lobby text to rooms you host and their broadcast view.</p>
            <Button asChild className="mt-3">
              <Link href="/store/creator-streamer-branding">Unlock Streamer Branding</Link>
            </Button>
          </div>
        )}
        {data?.unlocked && (
          <form onSubmit={save} className="mt-4 space-y-4 rounded-2xl border border-line bg-surface p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {(["accentColor", "secondaryColor"] as const).map((k) => (
                <div key={k} className="space-y-2">
                  <Label htmlFor={k}>{k === "accentColor" ? "Accent colour" : "Secondary colour"}</Label>
                  <div className="flex gap-2">
                    <input type="color" aria-label={`${k} picker`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="h-11 w-14 rounded-lg border border-line bg-stage" />
                    <Input id={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} pattern="#[0-9a-fA-F]{6}" />
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lh">Lobby header</Label>
              <Input id="lh" maxLength={60} value={form.lobbyHeader} onChange={(e) => setForm({ ...form, lobbyHeader: e.target.value })} placeholder="Friday Night Court" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rt">Results tagline</Label>
              <Input id="rt" maxLength={80} value={form.resultsTagline} onChange={(e) => setForm({ ...form, resultsTagline: e.target.value })} placeholder="Thanks for playing — see you next week" />
            </div>
            <div className="space-y-2">
              <span className="body-4 text-ink-soft">Logo (PNG, JPEG or WebP, max 512 KB)</span>
              <div className="flex items-center gap-3">
                {data.branding?.logoUrl && <img src={`${SERVER_URL}${data.branding.logoUrl}`} alt="Current logo" className="h-12 w-auto rounded border border-line" />}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 body-4 hover:bg-surface-raised">
                  <Upload className="size-4" /> Upload
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                </label>
              </div>
            </div>
            <Button type="submit">Save branding</Button>
          </form>
        )}
        {msg && (
          <p role="status" className={`caption-2 mt-4 ${msg.ok ? "text-teal" : "text-chaos"}`}>
            {msg.text}
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
