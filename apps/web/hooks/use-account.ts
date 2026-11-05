"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUserToken, setUserToken } from "@/lib/session";
import { resetSocket } from "@/lib/socket";

export interface Account {
  user: { id: string; email: string; displayName: string; role: "HOST" | "ADMIN" };
  ownership: { productIds: string[]; packIds: string[]; themeIds: string[]; streamerBranding: boolean };
  equippedTheme: string;
}

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getUserToken()) {
      setAccount(null);
      setLoading(false);
      return;
    }
    try {
      setAccount(await api<Account>("/api/auth/me"));
    } catch {
      setUserToken(null);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const on = () => void refresh();
    window.addEventListener("hps:auth", on);
    return () => window.removeEventListener("hps:auth", on);
  }, [refresh]);

  const signIn = async (mode: "login" | "register", email: string, password: string, displayName = "") => {
    const r = await api<{ token: string }>(`/api/auth/${mode}`, { body: { email, password, displayName }, auth: false });
    setUserToken(r.token);
    resetSocket();
  };
  const signOut = async () => {
    await api("/api/auth/logout", { body: {} }).catch(() => {});
    setUserToken(null);
    resetSocket();
  };
  return { account, loading, refresh, signIn, signOut };
}
