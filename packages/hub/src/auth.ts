/**
 * Server mode's login: one account, created once with the setup token; login sessions in a cookie;
 * and device tokens, one per computer that sends data (agents, Deuchan).
 *
 * - Passwords: scrypt (in Node), with a random salt, compared in constant time.
 * - Session and device tokens: 32 random bytes; only their SHA-256 is stored, so a copy of the database
 *   cannot be used to log in or to send data.
 * - Failed logins: at most a few per address in a window, then the address waits.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DeviceInfo } from "@mosaik/shared";
import type { Database } from "./db/database.ts";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
// scrypt needs 128 · N · r bytes; leave room
const MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

export const MIN_PASSWORD_LENGTH = 10;
export const SESSION_DAYS = 30;
export const SESSION_COOKIE = "mosaik_session";

const b64 = (data: Buffer) => data.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.keylen, { ...SCRYPT, maxmem: MAXMEM });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, b64(salt), b64(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A long random secret, with a prefix that says what it is. */
export const newToken = (prefix: string) => `${prefix}_${b64(randomBytes(32))}`;
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Compares two secrets in constant time. */
export function sameSecret(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

// Account

export interface Account {
  username: string;
  passwordHash: string;
}

export function getAccount(db: Database): Account | null {
  const row = db.prepare("SELECT username, password_hash FROM account WHERE id = 1").get() as
    { username: string; password_hash: string } | undefined;
  return row ? { username: row.username, passwordHash: row.password_hash } : null;
}

export async function createAccount(db: Database, username: string, password: string, now: number) {
  const hash = await hashPassword(password);
  db.prepare("INSERT INTO account (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)").run(
    username,
    hash,
    now,
  );
}

// Sessions

export function createSession(db: Database, now: number, userAgent: string | undefined): string {
  const token = newToken("mks");
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tokenHash(token), now, now + SESSION_DAYS * 86_400_000, now, userAgent?.slice(0, 200) ?? null);
  // Old sessions go away whenever a new one starts
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  return token;
}

/** Whether a session token is valid now; refreshes when it was last seen (at most once a minute). */
export function checkSession(db: Database, token: string, now: number): boolean {
  const hash = tokenHash(token);
  const row = db
    .prepare("SELECT expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?")
    .get(hash) as { expires_at: number; last_seen_at: number } | undefined;
  if (!row || row.expires_at <= now) return false;
  if (now - row.last_seen_at > 60_000) {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, hash);
  }
  return true;
}

export function deleteSession(db: Database, token: string): void {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
}

// Devices

export function listDevices(db: Database): DeviceInfo[] {
  return (
    db
      .prepare("SELECT name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at")
      .all() as { name: string; created_at: number; last_seen_at: number | null; revoked_at: number | null }[]
  ).map((row) => ({
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }));
}

export type CreateDeviceResult = { ok: true; token: string } | { ok: false; error: "device_exists" };

/** A new device and its token; the token is returned once and never stored. */
export function createDevice(db: Database, name: string, now: number): CreateDeviceResult {
  if (db.prepare("SELECT 1 FROM devices WHERE name = ?").get(name)) {
    return { ok: false, error: "device_exists" };
  }
  const token = newToken("mkd");
  db.prepare("INSERT INTO devices (name, token_hash, created_at) VALUES (?, ?, ?)").run(
    name,
    tokenHash(token),
    now,
  );
  return { ok: true, token };
}

/** Revokes a device: its token stops working. Its data stays. */
export function revokeDevice(db: Database, name: string, now: number): boolean {
  return (
    db.prepare("UPDATE devices SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL").run(now, name)
      .changes > 0
  );
}

/** The device a token belongs to, or null if it is unknown or revoked. */
export function deviceForToken(db: Database, token: string, now: number): string | null {
  const row = db
    .prepare("SELECT name, revoked_at FROM devices WHERE token_hash = ?")
    .get(tokenHash(token)) as { name: string; revoked_at: number | null } | undefined;
  if (!row || row.revoked_at !== null) return null;
  db.prepare("UPDATE devices SET last_seen_at = ? WHERE name = ?").run(now, row.name);
  return row.name;
}

// Failed logins

/** Counts failed logins per key (the client's address) in a sliding window. */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = 5, windowMs = 15 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (list.length > 0) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Milliseconds to wait before trying again, or 0. */
  blockedFor(key: string, now: number): number {
    const list = this.recent(key, now);
    return list.length >= this.max ? this.windowMs - (now - list[0]!) : 0;
  }

  fail(key: string, now: number): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

/** The value of one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}
