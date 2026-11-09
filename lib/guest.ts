import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Guests don't have accounts. Instead each browser gets a random, private
 * cookie the first time it visits /upload (see middleware.ts); uploads store
 * a hash of it, and the same browser can later rotate or delete them.
 * Clearing cookies or switching browser loses that link — the photographer
 * can still manage everything from /photographer.
 */

export const OWNER_COOKIE = "guest_owner";

export function hashOwner(token: string): string {
  return crypto.createHash("sha256").update(`guest-owner:${token}`).digest("hex");
}

function valid(token: string | undefined): token is string {
  return Boolean(token && /^[A-Za-z0-9_-]{20,100}$/.test(token));
}

/** Hash for the current request's guest cookie (server components/actions). */
export async function currentOwnerHash(): Promise<string | null> {
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  return valid(token) ? hashOwner(token) : null;
}

/** Same, from a raw Request (UploadThing middleware). */
export function ownerHashFromRequest(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${OWNER_COOKIE}=([^;]+)`));
  const token = match ? decodeURIComponent(match[1]) : undefined;
  return valid(token) ? hashOwner(token) : null;
}
