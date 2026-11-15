import "server-only";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { emailConfig } from "@/lib/notify";
import { storeFiles } from "@/lib/processing/storage";
import { bookablePhotos, layOut } from "./books";
import { bookConfig } from "./config";
import { emailOrderPlaced } from "./email";
import { createOrder, spineWidthMm } from "./prodigi";
import { renderBookPdf, renderSpinePdf } from "./render";

/**
 * Turns paid books into Prodigi orders: render the print PDFs, store them
 * in UploadThing (Prodigi fetches them from there), then place the order.
 *
 * Same queue pattern as the media worker: `status = 'paid'` rows are
 * claimed with FOR UPDATE SKIP LOCKED, so several containers never place
 * the same order twice (and Prodigi's idempotency key backs that up).
 */

const POLL_MS = 30_000;
const MAX_ATTEMPTS = 3;
/** A render stuck this long (crash, redeploy) is picked up again. */
const STALE_MINUTES = 20;

const g = globalThis as unknown as { __bookWorker?: { started: boolean; wake?: () => void } };
const state = (g.__bookWorker ??= { started: false });

export function startBookWorker(): void {
  if (state.started) return;
  state.started = true;
  void loop();
}

/** Pick up a just-paid book without waiting for the poll. */
export function nudgeBookWorker(): void {
  state.wake?.();
}

async function loop(): Promise<void> {
  for (;;) {
    let id: string | null = null;
    try {
      id = await claim();
      if (id) await submit(id);
    } catch (err) {
      if (id) await fail(id, err);
      else console.error("[book] claim failed:", err);
    }
    if (!id) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        state.wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    }
  }
}

async function claim(): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "photo_books"
       SET "status" = 'rendering', "locked_at" = now(), "attempts" = "attempts" + 1
     WHERE "id" = (
       SELECT "id" FROM "photo_books"
        WHERE ("status" = 'paid'
               AND ("locked_at" IS NULL OR "locked_at" < now() - make_interval(mins => 2 * "attempts")))
           OR ("status" = 'rendering'
               AND "locked_at" < now() - make_interval(mins => ${STALE_MINUTES}::int))
        ORDER BY "paid_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id"::text AS "id"`;
  return rows[0]?.id ?? null;
}

async function submit(id: string): Promise<void> {
  const book = await db.photoBook.findUniqueOrThrow({ where: { id } });
  const cfg = bookConfig();
  const started = Date.now();

  let { pdfUrl, spineUrl } = book;
  const keys = [...book.fileKeys];

  if (!pdfUrl || !spineUrl) {
    // The layout was frozen at checkout; photos removed since then are skipped.
    const laid = layOut(book, await bookablePhotos());
    if (laid.pdfPages !== book.pageCount) {
      console.warn(`[book] ${id}: ${book.pageCount} pages priced, ${laid.pdfPages} now (photos removed since)`);
    }
    const pdf = await renderBookPdf({
      title: book.title,
      subtitle: book.subtitle,
      coverId: laid.coverId,
      pages: laid.pages,
      format: cfg.format,
    });
    const spinePath = await renderSpinePdf(book.title, await spineWidthMm(pdf.pages), cfg.format);
    try {
      const stored = await storeFiles([
        { path: pdf.path, name: `book-${id}.pdf`, type: "application/pdf" },
        { path: spinePath, name: `book-${id}.spine.pdf`, type: "application/pdf" },
      ]);
      pdfUrl = stored[0].url;
      spineUrl = stored[1].url;
      keys.push(...stored.map((s) => s.key));
      await db.photoBook.update({
        where: { id },
        data: { pdfUrl, spineUrl, fileKeys: keys, pageCount: pdf.pages },
      });
    } finally {
      await Promise.all([fs.rm(pdf.path, { force: true }), fs.rm(spinePath, { force: true })]);
    }
    console.log(`[book] ${id}: rendered ${pdf.pages} pages in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  const fresh = await db.photoBook.findUniqueOrThrow({ where: { id } });
  const addr = (fresh.shippingAddress ?? {}) as Record<string, string | null | undefined>;
  if (!addr.line1 || !addr.postal_code || !addr.city) throw new Error("Missing shipping address");

  const site = emailConfig().siteUrl;
  const order = await createOrder({
    bookId: id,
    pageCount: fresh.pageCount!,
    pdfUrl: pdfUrl!,
    spineUrl: spineUrl!,
    callbackUrl:
      site && cfg.prodigiCallbackSecret
        ? `${site}/api/book/prodigi?key=${encodeURIComponent(cfg.prodigiCallbackSecret)}`
        : null,
    recipient: {
      name: fresh.customerName || "Customer",
      email: fresh.customerEmail,
      phone: fresh.customerPhone,
      line1: addr.line1,
      line2: addr.line2 || null,
      city: addr.city,
      state: addr.state || null,
      postcode: addr.postal_code,
      country: addr.country || cfg.country,
    },
  });

  const placed = await db.photoBook.update({
    where: { id },
    data: { status: "submitted", prodigiOrderId: order.id, submittedAt: new Date(), lockedAt: null, error: null },
  });
  console.log(`[book] ${id}: Prodigi order ${order.id} placed`);
  await emailOrderPlaced(placed).catch((err) => console.error("[book] confirmation email failed:", err));
}

async function fail(id: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const row = await db.photoBook.findUnique({ where: { id }, select: { attempts: true } });
  const giveUp = (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
  console.error(`[book] ${id} failed${giveUp ? " (giving up — retry from the studio)" : ""}:`, message);
  await db.photoBook
    .update({
      where: { id },
      data: { status: giveUp ? "failed" : "paid", error: message.slice(0, 500), lockedAt: new Date() },
    })
    .catch(() => {});
}

/** Studio "retry": put a failed book back in the queue. */
export async function retryBook(id: string): Promise<void> {
  await db.photoBook.updateMany({
    where: { id, status: "failed" },
    data: { status: "paid", attempts: 0, error: null, lockedAt: null },
  });
  nudgeBookWorker();
}
