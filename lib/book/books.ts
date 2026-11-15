import "server-only";
import { Prisma, type PhotoBook } from "@prisma/client";
import type Stripe from "stripe";
import { db, hasDatabase } from "@/lib/db";
import { getAlbum } from "@/lib/media";
import type { Album } from "@/lib/gallery-types";
import { bookConfig, priceFor } from "./config";
import { FORMATS, formatFor, isLayoutId, pagesOf, type BookFormat, type Page } from "./layouts";
import { quoteBook, type ProdigiOrder } from "./prodigi";
import { stripe } from "./stripe";

export type BookRow = PhotoBook;

/** An error whose message is fine to show the person building the book. */
export class BookError extends Error {}

/** A photo that can go in a book, as the builder needs it. */
export interface BookPhoto {
  id: string;
  album: Album;
  thumb: string;
  large: string;
  /** width / height */
  aspect: number;
  credit: string | null;
  byPhotographer: boolean;
}

export async function bookablePhotos(): Promise<BookPhoto[]> {
  const albums: Album[] = ["wedding", "engagement"];
  const lists = await Promise.all(
    albums.map(async (album) =>
      (await getAlbum(album)).filter((m) => m.type !== "video").map(
        (m): BookPhoto => ({
          id: m.id,
          album,
          thumb: m.thumb,
          large: m.large,
          aspect: m.width && m.height ? m.width / m.height : 1.5,
          credit: m.credit,
          byPhotographer: m.role === "photographer",
        })
      )
    )
  );
  return lists.flat();
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** The book this browser is working on (a draft, or one mid-checkout). */
export async function getDraft(ownerHash: string | null): Promise<BookRow | null> {
  if (!ownerHash || !hasDatabase()) return null;
  return db.photoBook.findFirst({
    where: { ownerTokenHash: ownerHash, status: { in: ["draft", "checkout"] } },
    orderBy: { updatedAt: "desc" },
  });
}

/** Books this browser has paid for. */
export async function listOrders(ownerHash: string | null): Promise<BookRow[]> {
  if (!ownerHash || !hasDatabase()) return [];
  return db.photoBook.findMany({
    where: { ownerTokenHash: ownerHash, status: { notIn: ["draft", "checkout"] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Every paid book, for the studio. */
export async function listAllOrders(): Promise<BookRow[]> {
  if (!hasDatabase()) return [];
  return db.photoBook.findMany({
    where: { status: { notIn: ["draft", "checkout"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getBook(id: string): Promise<BookRow | null> {
  if (!isUuid(id) || !hasDatabase()) return null;
  return db.photoBook.findUnique({ where: { id } });
}

export interface DraftInput {
  id?: string | null;
  /** Book size (a Prodigi SKU from FORMATS) */
  sku: string | null;
  title: string;
  subtitle: string;
  /** Photo spots, page by page; "" for an empty one */
  photoIds: string[];
  layouts: string[];
  coverId: string | null;
}

function clean(input: DraftInput) {
  // Each photo goes in the book once; a repeat becomes an empty spot.
  const seen = new Set<string>();
  const spots = (input.photoIds ?? []).slice(0, 1500).map((raw) => {
    const id = String(raw ?? "");
    if (!id || seen.has(id)) return "";
    seen.add(id);
    return id;
  });
  return {
    sku: formatFor(input.sku)?.sku ?? null,
    title: String(input.title ?? "").slice(0, 80),
    subtitle: String(input.subtitle ?? "").slice(0, 120),
    photoIds: spots,
    layouts: (input.layouts ?? []).map(String).filter(isLayoutId).slice(0, 400),
    coverId: input.coverId ? String(input.coverId) : null,
  };
}

/**
 * Save the builder's state. Editing a book that's mid-checkout cancels
 * that checkout first, so nobody pays for a book that has since changed.
 */
export async function saveDraft(ownerHash: string, input: DraftInput): Promise<string> {
  const data = clean(input);
  const existing = input.id && isUuid(input.id) ? await getBook(input.id) : null;
  if (existing && existing.ownerTokenHash === ownerHash) {
    if (existing.status === "checkout") await cancelCheckout(existing);
    else if (existing.status !== "draft") throw new BookError("This book has already been ordered");
    await db.photoBook.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const row = await db.photoBook.create({ data: { ...data, ownerTokenHash: ownerHash }, select: { id: true } });
  return row.id;
}

async function cancelCheckout(book: BookRow): Promise<void> {
  if (book.stripeSessionId) {
    try {
      await stripe().checkout.sessions.expire(book.stripeSessionId);
    } catch (err) {
      // Already expired is fine; already *paid* is not.
      const session = await stripe().checkout.sessions.retrieve(book.stripeSessionId);
      if (session.payment_status === "paid") throw new BookError("This book has already been paid for");
      if (session.status === "open") throw err;
    }
  }
  await db.photoBook.updateMany({
    where: { id: book.id, status: "checkout" },
    data: { status: "draft", stripeSessionId: null },
  });
}

/* ------------------------------------------------------------------ */
/* Pages, pricing, checkout                                            */
/* ------------------------------------------------------------------ */

export interface Laid {
  format: BookFormat;
  pages: Page[];
  /** Spots with no photo (including photos since hidden or deleted) */
  empty: number;
  coverId: string | null;
  /** Interior pages + front and back cover: what Prodigi calls the page count */
  pdfPages: number;
}

/** Turn a saved book into its final pages, using only photos still public. */
export function layOut(book: Pick<BookRow, "sku" | "photoIds" | "layouts" | "coverId">, photos: BookPhoto[]): Laid {
  const format = formatFor(book.sku);
  if (!format) throw new BookError("Choose a size for your book first");
  const ok = new Set(photos.map((p) => p.id));
  const pages = pagesOf(
    book.layouts,
    book.photoIds.map((id) => (ok.has(id) ? id : ""))
  );
  const placed = pages.flatMap((p) => p.photos).filter(Boolean);
  const empty = pages.reduce((n, p) => n + p.photos.filter((x) => !x).length, 0);
  const coverId = book.coverId && ok.has(book.coverId) ? book.coverId : placed[0] ?? null;
  return { format, pages, empty, coverId, pdfPages: pages.length + 2 };
}

export interface PriceCheck {
  pageCount: number;
  interiorPages: number;
  costCents: number;
  priceCents: number;
  currency: string;
}

function checkPages(laid: Laid) {
  const { format, pages } = laid;
  if (pages.length < format.minPages) throw new BookError(`A book needs at least ${format.minPages} pages`);
  if (pages.length > format.maxPages) {
    throw new BookError(`That's ${pages.length} pages — the most this book can have is ${format.maxPages}`);
  }
}

export async function priceBook(book: BookRow, photos: BookPhoto[]): Promise<PriceCheck> {
  const cfg = bookConfig();
  const laid = layOut(book, photos);
  checkPages(laid);
  const quote = await quoteBook(laid.format.sku, laid.pdfPages);
  return {
    pageCount: laid.pdfPages,
    interiorPages: laid.pages.length,
    costCents: quote.totalCents,
    priceCents: priceFor(quote.totalCents, cfg),
    currency: quote.currency,
  };
}

/** Price of the smallest book in each size, for the size picker. Cached an hour. */
const fromPrices: { at: number; value: Promise<Record<string, number>> } = { at: 0, value: Promise.resolve({}) };
export function startingPrices(): Promise<Record<string, number>> {
  const cfg = bookConfig();
  if (!cfg.prodigiKey) return Promise.resolve({});
  if (Date.now() - fromPrices.at < 60 * 60 * 1000) return fromPrices.value;
  fromPrices.at = Date.now();
  fromPrices.value = (async () => {
    const entries = await Promise.all(
      FORMATS.map(async (f) => {
        try {
          const q = await quoteBook(f.sku, f.minPages + 2);
          return [f.sku, priceFor(q.totalCents, cfg)] as const;
        } catch (err) {
          console.warn(`[book] no starting price for ${f.sku}:`, err instanceof Error ? err.message : err);
          return null;
        }
      })
    );
    const out = Object.fromEntries(entries.filter((e): e is readonly [string, number] => Boolean(e)));
    if (!Object.keys(out).length) fromPrices.at = 0; // try again next time
    return out;
  })();
  return fromPrices.value;
}

/** Quote the book, freeze its layout and price, and open Stripe Checkout. */
export async function startCheckout(book: BookRow, photos: BookPhoto[], origin: string): Promise<string> {
  const cfg = bookConfig();
  if (book.status === "checkout") await cancelCheckout(book);
  const laid = layOut(book, photos);
  if (laid.empty) {
    throw new BookError(
      `${laid.empty} photo ${laid.empty === 1 ? "spot is" : "spots are"} still empty — fill ${laid.empty === 1 ? "it" : "them"} or change ${laid.empty === 1 ? "that page's" : "those pages'"} layout`
    );
  }
  const price = await priceBook(book, photos);
  const title = book.title.trim() || "Our photo book";

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    currency: cfg.currency.toLowerCase(),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: cfg.currency.toLowerCase(),
          unit_amount: price.priceCents,
          product_data: {
            name: `Photo book — ${title}`,
            description: `${laid.format.label} · ${price.interiorPages} pages · printed in Australia, delivered to your door`,
          },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: ["AU"] },
    phone_number_collection: { enabled: true },
    client_reference_id: book.id,
    metadata: { bookId: book.id },
    payment_intent_data: { metadata: { bookId: book.id } },
    // Quotes can move; don't hold this price open for a day.
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    success_url: `${origin}/book/${book.id}?paid=1`,
    cancel_url: `${origin}/book`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout link");

  await db.photoBook.update({
    where: { id: book.id },
    data: {
      status: "checkout",
      stripeSessionId: session.id,
      // Freeze exactly what was priced.
      layouts: laid.pages.map((p) => p.layout),
      photoIds: laid.pages.flatMap((p) => p.photos),
      coverId: laid.coverId,
      sku: laid.format.sku,
      pageCount: price.pageCount,
      costCents: price.costCents,
      priceCents: price.priceCents,
      currency: price.currency.toLowerCase(),
      shippingMethod: cfg.shippingMethod,
    },
  });
  return session.url;
}

/* ------------------------------------------------------------------ */
/* Stripe webhook                                                      */
/* ------------------------------------------------------------------ */

/** Returns the book id if this payment moved a book to "paid". */
export async function markPaid(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.payment_status !== "paid") return null;
  const shipping = session.collected_information?.shipping_details;
  const details = session.customer_details;
  const address = shipping?.address ?? details?.address ?? null;
  const paymentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const res = await db.photoBook.updateMany({
    where: { stripeSessionId: session.id, status: { in: ["checkout", "draft"] } },
    data: {
      status: "paid",
      paidAt: new Date(),
      stripePaymentId: paymentId,
      priceCents: session.amount_total ?? undefined,
      customerEmail: details?.email ?? null,
      customerPhone: details?.phone ?? null,
      customerName: shipping?.name ?? details?.name ?? null,
      shippingAddress: address ? ({ ...address } as Prisma.InputJsonObject) : Prisma.JsonNull,
      attempts: 0,
      error: null,
      lockedAt: null,
    },
  });
  if (!res.count) return null;
  const row = await db.photoBook.findUnique({ where: { stripeSessionId: session.id }, select: { id: true } });
  return row?.id ?? null;
}

export async function markExpired(session: Stripe.Checkout.Session): Promise<void> {
  await db.photoBook.updateMany({
    where: { stripeSessionId: session.id, status: "checkout" },
    data: { status: "draft", stripeSessionId: null },
  });
}

/* ------------------------------------------------------------------ */
/* Prodigi status updates                                              */
/* ------------------------------------------------------------------ */

/**
 * Apply an order update from Prodigi (callback or poll). Returns the book
 * when this update is the one that first gave it tracking, so the caller
 * can email the customer once.
 */
export async function applyProdigiUpdate(order: ProdigiOrder): Promise<{ book: BookRow; justShipped: boolean } | null> {
  const book = await db.photoBook.findUnique({ where: { prodigiOrderId: order.id } });
  if (!book) return null;

  const stage = order.status?.stage?.toLowerCase();
  const shipped = order.shipments?.find((s) => s.status?.toLowerCase() === "shipped");
  const tracking = order.shipments?.map((s) => s.tracking).find((t) => t?.url || t?.number);

  let status = book.status;
  if (stage === "cancelled") status = "cancelled";
  else if (shipped || stage === "complete") status = "shipped";
  else if (stage === "inprogress" && book.status === "submitted") status = "in_production";

  const issues = order.status?.issues?.map((i) => i.description || i.errorCode).filter(Boolean);
  const updated = await db.photoBook.update({
    where: { id: book.id },
    data: {
      status,
      trackingUrl: tracking?.url ?? book.trackingUrl,
      trackingNumber: tracking?.number ?? book.trackingNumber,
      error: issues?.length ? issues.join("; ").slice(0, 500) : book.error,
    },
  });
  const justShipped = status === "shipped" && book.status !== "shipped";
  return { book: updated, justShipped };
}
