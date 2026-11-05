"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Label, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@hps/ui";
import { SiteFooter, SiteHeader } from "@/components/shell/site-header";
import { useAccount } from "@/hooks/use-account";

export default function AccountPage() {
  return (
    <div className="grain min-h-dvh bg-stage">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-md px-4 pb-16 pt-6">
        <Suspense>
          <AccountInner />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

function AccountInner() {
  const { account, loading, signIn, signOut } = useAccount();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading)
    return (
      <div className="rounded-2xl border border-line bg-surface p-6" aria-label="Loading account">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-6 h-10" />
        <Skeleton className="mt-4 h-10" />
        <Skeleton className="mt-6 h-10" />
      </div>
    );

  if (account)
    return (
      <section className="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h1 className="heading-3">Your account</h1>
        <p className="text-ink-soft" data-testid="signed-in-as">
          Signed in as <strong className="text-ink">{account.user.email}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/library">Library</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/branding">Branding</Link>
          </Button>
          <Button variant="danger" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </section>
    );

  const submit = (mode: "login" | "register") => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, email, password, displayName);
      if (next?.startsWith("/")) router.push(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fields = (mode: "login" | "register") => (
    <form onSubmit={submit(mode)} className="mt-4 space-y-3">
      {mode === "register" && (
        <div className="space-y-2">
          <Label htmlFor="dn">Display name</Label>
          <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={24} autoComplete="nickname" />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`email-${mode}`}>Email</Label>
        <Input id={`email-${mode}`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid={`email-${mode}`} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`pw-${mode}`}>Password</Label>
        <Input
          id={`pw-${mode}`}
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          data-testid={`password-${mode}`}
        />
      </div>
      {error && (
        <p role="alert" className="body-6 text-chaos">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy} data-testid={`submit-${mode}`}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h1 className="heading-3">Host account</h1>
      <p className="body-6 text-ink-soft">Players never need an account. Hosts sign in to keep purchases and branding.</p>
      <Tabs defaultValue="login" className="mt-4">
        <TabsList>
          <TabsTrigger value="login">Sign in</TabsTrigger>
          <TabsTrigger value="register" data-testid="tab-register">
            Create account
          </TabsTrigger>
        </TabsList>
        <TabsContent value="login">{fields("login")}</TabsContent>
        <TabsContent value="register">{fields("register")}</TabsContent>
      </Tabs>
    </section>
  );
}
