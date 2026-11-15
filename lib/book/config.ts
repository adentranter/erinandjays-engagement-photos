import "server-only";
import type { BookFormat } from "./layouts";

/**
 * Photo book settings, all from env so a new wedding (or a different book
 * size) needs no code change. See .env.example → "Photo books".
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

  const format: BookFormat = {
    label: process.env.BOOK_LABEL?.trim() || "Hardcover photo book · A4",
    widthMm: num("BOOK_WIDTH_MM", 210),
    heightMm: num("BOOK_HEIGHT_MM", 297),
    minPages: num("BOOK_MIN_PAGES", 24),
    maxPages: num("BOOK_MAX_PAGES", 300),
  };

  return {
    prodigiKey,
    /** "live" places real orders that get printed and billed */
    prodigiLive: process.env.PRODIGI_ENV?.trim() === "live",
    /** Shared secret in the callback URL Prodigi posts status updates to */
    prodigiCallbackSecret: process.env.PRODIGI_CALLBACK_SECRET?.trim() || null,
    sku: process.env.PRODIGI_BOOK_SKU?.trim() || "BOOK-FE-A4-P-HARD-G",
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
    format,
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
