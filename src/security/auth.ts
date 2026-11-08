import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PlatformError } from "../errors.ts";
import type { PlatformDatabase } from "../storage/database.ts";

const PASSWORD_BYTES = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x53);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export type AuthenticatedUser = { id: string; email: string; isOwner: boolean };

function publicUser(user: { id: string; email: string; isOwner?: boolean }) {
  return { id: user.id, email: user.email, isOwner: Boolean(user.isOwner) };
}

export class AuthService {
  private readonly database: PlatformDatabase;
  private readonly sessionTtlSeconds: number;
  private readonly now: () => number;
  private readonly inviteCode: string;

  constructor(
    database: PlatformDatabase,
    _bootstrapKey: string,
    sessionTtlSeconds: number,
    now: () => number = Date.now,
    inviteCode = "",
  ) {
    this.database = database;
    this.sessionTtlSeconds = sessionTtlSeconds;
    this.now = now;
    this.inviteCode = inviteCode;
  }

  private assertInvite(provided: unknown) {
    if (!this.inviteCode) return;
    const supplied = typeof provided === "string" ? provided : "";
    if (!supplied || supplied.length > 256) {
      throw new PlatformError("forbidden", "The invite code was not accepted.", 403);
    }
    const actual = createHash("sha256").update(supplied).digest();
    const expected = createHash("sha256").update(this.inviteCode).digest();
    if (!timingSafeEqual(actual, expected)) {
      throw new PlatformError("forbidden", "The invite code was not accepted.", 403);
    }
  }

  async register(emailInput: string, password: string, inviteCode?: unknown) {
    this.assertInvite(inviteCode);
    if (typeof emailInput !== "string" || emailInput.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      throw new PlatformError("invalid_request", "Enter a valid email address.", 400);
    }
    if (typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
      throw new PlatformError("invalid_request", "Password must be at least 12 characters and no more than 1 KB.", 400);
    }

    const salt = randomBytes(16);
    const user = {
      id: randomUUID(),
      email: emailInput.trim().toLowerCase(),
      passwordSalt: salt,
      passwordHash: scryptSync(password, salt, PASSWORD_BYTES),
      isOwner: false,
    };
    try {
      await this.database.createUser(user, this.now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed") || message.includes("duplicate key")) {
        throw new PlatformError("invalid_request", "An account with that email already exists.", 409);
      }
      throw error;
    }
    return publicUser(user);
  }

  async login(emailInput: string, password: string) {
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
    const user = await this.database.findUserByEmail(email);
    const actualHash = scryptSync(password.slice(0, 1024), user?.passwordSalt ?? DUMMY_SALT, PASSWORD_BYTES);
    const storedHash = user ? Buffer.from(user.passwordHash) : actualHash;
    const hashesMatch = user && actualHash.length === storedHash.length && timingSafeEqual(actualHash, storedHash);
    if (!user || !hashesMatch) {
      throw new PlatformError("unauthorized", "Email or password was not accepted.", 401);
    }

    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    await this.database.createSession(hashToken(token), user.id, now + this.sessionTtlSeconds * 1000, now);
    return { token, expiresAt: now + this.sessionTtlSeconds * 1000, user: publicUser(user) };
  }

  async authenticate(authorization: string | undefined, cookieToken = ""): Promise<AuthenticatedUser> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    const token = match?.[1] || cookieToken;
    if (!token) throw new PlatformError("unauthorized", "A valid bearer access token is required.", 401);
    const session = await this.database.findSession(hashToken(token), this.now());
    if (!session) throw new PlatformError("unauthorized", "The access token is invalid or expired.", 401);
    return { id: session.id, email: session.email, isOwner: Boolean(session.isOwner) };
  }

  async revoke(authorization: string | undefined, cookieToken = "") {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    const token = match?.[1] || cookieToken;
    if (token) await this.database.deleteSession(hashToken(token));
  }

  async exportAccount(userId: string) {
    return this.database.exportUser(userId);
  }

  async deleteAccount(userId: string) {
    await this.database.deleteUser(userId);
  }
}
