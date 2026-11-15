import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { bookConfig } from "@/lib/book/config";
import { markExpired, markPaid } from "@/lib/book/books";
import { stripe } from "@/lib/book/stripe";
import { nudgeBookWorker } from "@/lib/book/worker";

/**
 * Stripe webhook. Point an endpoint at /api/book/stripe for
 * checkout.session.completed and checkout.session.expired, and put its
 * signing secret in STRIPE_WEBHOOK_SECRET.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = bookConfig().stripeWebhookSecret;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "Not configured" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (err) {
    console.warn("[book] bad Stripe signature:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const id = await markPaid(event.data.object);
      if (id) {
        console.log(`[book] ${id} paid`);
        nudgeBookWorker();
      }
      break;
    }
    case "checkout.session.expired":
      await markExpired(event.data.object);
      break;
  }
  return NextResponse.json({ received: true });
}
