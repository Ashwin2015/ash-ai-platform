import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { PlatformError } from "../errors.ts";
import type { PlatformDatabase } from "../storage/database.ts";

const PASSWORD_BYTES = 64;
const DUMMY_SALT = Buffer.alloc(16, 0x53);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function secureStringEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export type AuthenticatedUser = { id: string; email: string };

export class AuthService {
  private readonly database: PlatformDatabase;
  private readonly bootstrapKey: string;
  private readonly inviteCode: string;
  private readonly sessionTtlSeconds: number;
  private readonly now: () => number;

  constructor(
    database: PlatformDatabase,
    bootstrapKey: string,
    sessionTtlSeconds: number,
    now: () => number = Date.now,
    inviteCode = "",
  ) {
    this.database = database;
    this.bootstrapKey = bootstrapKey;
    this.inviteCode = inviteCode;
    this.sessionTtlSeconds = sessionTtlSeconds;
    this.now = now;
  }

  private accessAllowed(provided: string) {
    const candidates = [this.inviteCode, this.bootstrapKey].filter(Boolean);
    return candidates.some((expected) => provided && secureStringEqual(provided, expected));
  }

  async register(bootstrapKey: string, emailInput: string, password: string, inviteCode = "") {
    if (!this.accessAllowed(inviteCode) && !this.accessAllowed(bootstrapKey)) {
      throw new PlatformError("forbidden", "Account registration is not authorized.", 403);
    }
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
    return { id: user.id, email: user.email };
  }

  async login(emailInput: string, password: string) {
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
    const user = await this.database.findUserByEmail(email);
    const actualHash = scryptSync(password.slice(0, 1024), user?.passwordSalt ?? DUMMY_SALT, PASSWORD_BYTES);
    if (!user || !timingSafeEqual(actualHash, Buffer.from(user.passwordHash))) {
      throw new PlatformError("unauthorized", "Email or password was not accepted.", 401);
    }

    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    await this.database.createSession(hashToken(token), user.id, now + this.sessionTtlSeconds * 1000, now);
    return { token, expiresAt: now + this.sessionTtlSeconds * 1000, user: { id: user.id, email: user.email } };
  }

  async authenticate(authorization: string | undefined, cookieToken = ""): Promise<AuthenticatedUser> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    const token = match?.[1] || cookieToken;
    if (!token) throw new PlatformError("unauthorized", "A valid bearer access token is required.", 401);
    const session = await this.database.findSession(hashToken(token), this.now());
    if (!session) throw new PlatformError("unauthorized", "The access token is invalid or expired.", 401);
    return { id: session.id, email: session.email };
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
