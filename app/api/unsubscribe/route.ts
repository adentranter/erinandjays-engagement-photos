import { NextResponse, type NextRequest } from "next/server";
import { unsubscribe } from "@/lib/notify";

/** One-click unsubscribe (RFC 8058), used by mail apps' "Unsubscribe" button. */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const ok = await unsubscribe(token).catch(() => false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
