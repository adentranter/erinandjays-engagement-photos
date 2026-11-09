import { NextResponse, type NextRequest } from "next/server";

/**
 * Give each browser a private "guest owner" cookie before it uploads, so it
 * can manage its own uploads later (lib/guest.ts). Only set on /upload,
 * which is where guests upload from.
 */
const OWNER_COOKIE = "guest_owner";

export function middleware(req: NextRequest) {
  if (req.cookies.get(OWNER_COOKIE)) return NextResponse.next();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = NextResponse.next();
  res.cookies.set(OWNER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
  });
  return res;
}

export const config = { matcher: ["/upload"] };
