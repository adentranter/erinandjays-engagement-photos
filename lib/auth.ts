import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Photographer access is a single shared password (PHOTOGRAPHER_PASSWORD).
 * After login we set an HMAC cookie; rotating the password or SESSION_SECRET
 * signs everyone out.
 */

export const SESSION_COOKIE = "photographer_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret(): string | null {
  const password = process.env.PHOTOGRAPHER_PASSWORD;
  if (!password) return null;
  return `${process.env.SESSION_SECRET ?? ""}:${password}`;
}

function sign(value: string, key: string): string {
  return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function isPhotographerConfigured(): boolean {
  return secret() !== null;
}

export function checkPassword(attempt: string): boolean {
  const password = process.env.PHOTOGRAPHER_PASSWORD;
  if (!password) return false;
  // Compare digests so lengths always match.
  const h = (s: string) =>
    crypto.createHash("sha256").update(s).digest("base64url");
  return safeEqual(h(attempt), h(password));
}

export function sessionToken(): string | null {
  const key = secret();
  return key ? sign("photographer", key) : null;
}

/** Validate a raw cookie value (usable from route handlers with a Request). */
export function isValidSession(value: string | undefined | null): boolean {
  const expected = sessionToken();
  return Boolean(expected && value && safeEqual(value, expected));
}

export async function isPhotographer(): Promise<boolean> {
  const jar = await cookies();
  return isValidSession(jar.get(SESSION_COOKIE)?.value);
}

export async function startSession(): Promise<void> {
  const token = sessionToken();
  if (!token) return;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Read the session cookie straight off a Request's headers. */
export function sessionFromRequest(req: Request): boolean {
  const header = req.headers.get("cookie") ?? "";
  const match = header
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`));
  return isValidSession(match?.slice(SESSION_COOKIE.length + 1));
}
