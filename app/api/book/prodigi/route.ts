import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applyProdigiUpdate } from "@/lib/book/books";
import { bookConfig } from "@/lib/book/config";
import { emailShipped } from "@/lib/book/email";
import { getOrder, type ProdigiOrder } from "@/lib/book/prodigi";

/**
 * Prodigi order callbacks (CloudEvents: status changes and shipments).
 * Prodigi doesn't sign callbacks, so the URL carries a shared secret, and
 * we re-read the order from Prodigi's API rather than trusting the body.
 */
export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

export async function POST(req: NextRequest) {
  const expected = bookConfig().prodigiCallbackSecret;
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!expected || !sameSecret(key, expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const event = (await req.json().catch(() => null)) as { subject?: string; data?: ProdigiOrder } | null;
  const orderId = event?.data?.id ?? event?.subject;
  if (!orderId) return NextResponse.json({ error: "No order id" }, { status: 400 });

  const order = await getOrder(orderId);
  const result = await applyProdigiUpdate(order);
  if (result?.justShipped) {
    await emailShipped(result.book).catch((err) => console.error("[book] shipped email failed:", err));
  }
  return NextResponse.json({ ok: true });
}
