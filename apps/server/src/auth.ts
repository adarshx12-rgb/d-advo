import { createHmac, randomBytes } from "node:crypto";
import { hashPassword, hashToken, verifyPassword } from "@hps/database/crypto";
import type { Persistence, UserRecord } from "./persistence/types";

const GUEST_TTL_MS = 30 * 24 * 3600 * 1000;
const USER_TTL_MS = 30 * 24 * 3600 * 1000;

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Guest sessions and host accounts. Tokens are random 256-bit values handed to the client once;
 * only their SHA-256 hashes are stored. Tokens travel in headers / the socket handshake, never in URLs.
 */
export class AuthService {
  constructor(
    private readonly db: Persistence,
    private readonly secret: string,
  ) {}

  async issueGuest(): Promise<{ token: string; sessionId: string }> {
    const token = randomBytes(32).toString("base64url");
    const sessionId = await this.db.createGuestSession(hashToken(token), new Date(Date.now() + GUEST_TTL_MS));
    return { token, sessionId };
  }

  async resolveGuest(token: unknown): Promise<string | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    return (await this.db.findGuestSession(hashToken(token)))?.id ?? null;
  }

  async register(emailRaw: string, password: string, displayNameRaw: string): Promise<{ token: string; user: UserRecord }> {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new AuthError(400, "Enter a valid email address.");
    if (password.length < 8 || password.length > 200) throw new AuthError(400, "Passwords need at least 8 characters.");
    const displayName = displayNameRaw.trim().slice(0, 40) || email.split("@")[0]!.slice(0, 40);
    try {
      const user = await this.db.createUser({ email, passwordHash: await hashPassword(password), displayName });
      return { token: await this.startSession(user.id), user };
    } catch (e) {
      if ((e as Error).message === "EMAIL_TAKEN") throw new AuthError(409, "An account with that email already exists.");
      throw e;
    }
  }

  async login(emailRaw: string, password: string): Promise<{ token: string; user: UserRecord }> {
    const user = await this.db.findUserByEmail(emailRaw.trim().toLowerCase());
    // same message either way: do not reveal which emails have accounts
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AuthError(401, "Email or password is incorrect.");
    return { token: await this.startSession(user.id), user };
  }

  async logout(token: string): Promise<void> {
    await this.db.deleteUserSession(hashToken(token));
  }

  async resolveUser(token: unknown): Promise<UserRecord | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    return this.db.findUserBySessionHash(hashToken(token));
  }

  private async startSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.db.createUserSession(userId, hashToken(token), new Date(Date.now() + USER_TTL_MS));
    return token;
  }

  /** Stable, unforgeable public id for a spectator derived from their guest session. */
  spectatorId(sessionId: string): string {
    return `s_${createHmac("sha256", this.secret).update(sessionId).digest("base64url").slice(0, 16)}`;
  }
}
