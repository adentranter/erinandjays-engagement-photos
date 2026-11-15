import "server-only";

/**
 * Photo book settings from env. See .env.example → "Photo books". Book
 * sizes live in lib/book/layouts.ts (FORMATS).
 */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name]?.trim() ? v : fallback;
}

export function bookConfig() {
  const prodigiKey = process.env.PRODIGI_API_KEY?.trim() || null;
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim() || null;
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
  const missing = [
    !prodigiKey && "PRODIGI_API_KEY",
    !stripeKey && "STRIPE_SECRET_KEY",
    !stripeWebhookSecret && "STRIPE_WEBHOOK_SECRET",
  ].filter(Boolean) as string[];

  return {
    prodigiKey,
    /** "live" places real orders that get printed and billed */
    prodigiLive: process.env.PRODIGI_ENV?.trim() === "live",
    /** Shared secret in the callback URL Prodigi posts status updates to */
    prodigiCallbackSecret: process.env.PRODIGI_CALLBACK_SECRET?.trim() || null,
    /** Budget | Standard | StandardPlus | Express | Overnight */
    shippingMethod: process.env.PRODIGI_SHIPPING?.trim() || "Standard",
    country: "AU",
    currency: "AUD",
    stripeKey,
    stripeWebhookSecret,
    /**
     * Our margin on top of Prodigi's quoted total. Zero for now: people pay
     * what the printer charges and nothing more.
     */
    marginPercent: num("BOOK_MARGIN_PERCENT", 0),
    marginFlatCents: Math.round(num("BOOK_MARGIN_FLAT", 0) * 100),
    missing,
  };
}

export type BookConfig = ReturnType<typeof bookConfig>;

/**
 * Customer price: Prodigi's total (print + shipping + tax) plus any margin.
 * At zero margin it's the exact cost to the cent; with a margin it's rounded
 * up to a whole dollar. GST-inclusive, since Prodigi's quote is.
 */
export function priceFor(costCents: number, cfg: BookConfig): number {
  if (!cfg.marginPercent && !cfg.marginFlatCents) return costCents;
  const raw = costCents * (1 + cfg.marginPercent / 100) + cfg.marginFlatCents;
  return Math.ceil(raw / 100) * 100;
}
