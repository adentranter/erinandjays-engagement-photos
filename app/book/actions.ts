"use server";

import { headers } from "next/headers";
import { currentOwnerHash } from "@/lib/guest";
import {
  bookablePhotos,
  getBook,
  priceBook,
  saveDraft,
  startCheckout,
  BookError,
  type DraftInput,
} from "@/lib/book/books";
import { bookConfig } from "@/lib/book/config";

/**
 * Builder actions. A book belongs to the browser that made it (the guest
 * cookie from middleware.ts) — there are no accounts.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function owner(): Promise<string> {
  const hash = await currentOwnerHash();
  if (!hash) throw new BookError("Please reload the page and try again");
  return hash;
}

/** Only our own messages reach the page; anything else is logged. */
function failure(err: unknown, fallback = "Couldn't save just now — your changes will retry"): { ok: false; error: string } {
  if (err instanceof BookError) return { ok: false, error: err.message };
  console.error("[book] action failed:", err);
  return { ok: false, error: fallback };
}

export async function saveBookAction(input: DraftInput): Promise<Result<string>> {
  try {
    return { ok: true, value: await saveDraft(await owner(), input) };
  } catch (err) {
    return failure(err);
  }
}

async function ownedBook(id: string) {
  const book = await getBook(id);
  if (!book || book.ownerTokenHash !== (await owner())) throw new BookError("This book couldn't be found — please reload the page");
  return book;
}

export async function priceBookAction(
  id: string
): Promise<Result<{ pageCount: number; priceCents: number; currency: string }>> {
  try {
    // Pricing only needs Prodigi, so the price shows before Stripe is set up.
    if (!bookConfig().prodigiKey) throw new BookError("Ordering isn't switched on yet");
    const price = await priceBook(await ownedBook(id), await bookablePhotos());
    return { ok: true, value: { pageCount: price.interiorPages, priceCents: price.priceCents, currency: price.currency } };
  } catch (err) {
    return failure(err, "Couldn't get a price from the printer — try again in a moment");
  }
}

async function origin(): Promise<string> {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (site) return site;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function checkoutAction(id: string): Promise<Result<string>> {
  try {
    if (bookConfig().missing.length) throw new BookError("Ordering isn't switched on yet");
    const url = await startCheckout(await ownedBook(id), await bookablePhotos(), await origin());
    return { ok: true, value: url };
  } catch (err) {
    return failure(err, "Checkout couldn't open — please try again");
  }
}
