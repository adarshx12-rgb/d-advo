"use client";

import type { AvatarId } from "@hps/shared";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

const GUEST_KEY = "hps.guestToken";
const USER_KEY = "hps.userToken";
const PROFILE_KEY = "hps.profile";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode); tokens then live for this tab only */
  }
}

let memoryGuest: string | null = null;
let pendingGuest: Promise<string> | null = null;

/** Returns this browser's guest token, creating a guest session on first use. Tokens never go in URLs. */
export async function getGuestToken(): Promise<string> {
  const existing = read(GUEST_KEY) ?? memoryGuest;
  if (existing) return existing;
  pendingGuest ??= (async () => {
    const res = await fetch(`${SERVER_URL}/api/session/guest`, { method: "POST" });
    if (!res.ok) throw new Error("Could not reach the game server.");
    const { guestToken } = (await res.json()) as { guestToken: string };
    memoryGuest = guestToken;
    write(GUEST_KEY, guestToken);
    return guestToken;
  })().finally(() => {
    pendingGuest = null;
  });
  return pendingGuest;
}

export function clearGuestToken() {
  memoryGuest = null;
  write(GUEST_KEY, null);
}

export function getUserToken(): string | null {
  return read(USER_KEY);
}
export function setUserToken(token: string | null) {
  write(USER_KEY, token);
  window.dispatchEvent(new Event("hps:auth"));
}

export interface SavedProfile {
  name: string;
  avatar: AvatarId;
}
export function getProfile(): SavedProfile | null {
  try {
    const raw = read(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as SavedProfile) : null;
  } catch {
    return null;
  }
}
export function saveProfile(p: SavedProfile) {
  write(PROFILE_KEY, JSON.stringify(p));
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const token = init.auth !== false ? getUserToken() : null;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
