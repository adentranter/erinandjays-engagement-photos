import "server-only";
import Stripe from "stripe";
import { bookConfig } from "./config";

/**
 * Stripe takes the customer's payment (our price: Prodigi's cost plus
 * margin). We then pay Prodigi from our own account when the order is
 * placed. Test keys (sk_test_…) never move real money.
 */

const g = globalThis as unknown as { __stripe?: { key: string; client: Stripe } };

export function stripe(): Stripe {
  const key = bookConfig().stripeKey;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (g.__stripe?.key !== key) g.__stripe = { key, client: new Stripe(key) };
  return g.__stripe.client;
}
