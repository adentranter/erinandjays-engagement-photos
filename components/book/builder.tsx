"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DESIGNS,
  FORMATS,
  LAYOUTS,
  designLayouts,
  designSpots,
  flatten,
  formatFor,
  pagesOf,
  redesign,
  withLayout,
  type BookFormat,
  type Design,
  type LayoutId,
  type Page,
} from "@/lib/book/layouts";
import { recentlyViewed } from "@/lib/recent-photos";
import { checkoutAction, priceBookAction, saveBookAction } from "@/app/book/actions";
import { LayoutIcon, PageView } from "./page-view";

/**
 * The photo book builder. People pick a size, then a design (a set of empty
 * pages), then fill the book one photo at a time: tap an empty spot, pick a
 * photo. Nothing is placed for them.
 */

export interface BuilderPhoto {
  id: string;
  album: "wedding" | "engagement";
  thumb: string;
  large: string;
  aspect: number;
  credit: string | null;
}

export interface SavedBook {
  id: string;
  sku: string | null;
  title: string;
  subtitle: string;
  photoIds: string[];
  layouts: string[];
  coverId: string | null;
}

interface Book {
  sku: string | null;
  title: string;
  subtitle: string;
  pages: Page[];
  coverId: string | null;
}

/** A place a photo can go: a spot on a page, or the cover. */
type Spot = { page: number; slot: number } | "cover";

type SaveState = "idle" | "saving" | "saved" | "error";
interface Price {
  key: string;
  priceCents: number;
  currency: string;
}

const PICKER: LayoutId[] = ["full", "framed", "duo", "trio", "quad", "blank"];
/** Pages added or removed together, so the book stays in spreads. */
const EXTRA_PAGES: LayoutId[] = ["full", "framed"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function money(cents: number, currency = "aud") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

const sameSpot = (a: Spot | null, b: Spot | null) =>
  a === b || (a !== null && b !== null && a !== "cover" && b !== "cover" && a.page === b.page && a.slot === b.slot);

export function BookBuilder({
  photos,
  saved,
  defaults,
  prices,
  canPrice,
  canOrder,
}: {
  photos: BuilderPhoto[];
  saved: SavedBook | null;
  defaults: { title: string; subtitle: string };
  /** Price of the smallest book in each size, by SKU (empty when unknown) */
  prices: Record<string, number>;
  /** Prodigi is set up, so the book can be priced */
  canPrice: boolean;
  /** Stripe is set up too, so it can be ordered */
  canOrder: boolean;
}) {
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);

  const [id, setId] = useState<string | null>(saved?.id ?? null);
  const [book, setBook] = useState<Book>(() => {
    const sku = formatFor(saved?.sku)?.sku ?? null;
    return {
      sku,
      title: saved?.title ?? defaults.title,
      subtitle: saved?.subtitle ?? defaults.subtitle,
      // Photos no longer in the galleries come back as empty spots.
      pages: sku && saved ? pagesOf(saved.layouts, saved.photoIds.map((p) => (byId.has(p) ? p : ""))) : [],
      coverId: saved?.coverId && byId.has(saved.coverId) ? saved.coverId : null,
    };
  });
  const format = formatFor(book.sku);
  const [setup, setSetup] = useState(!format || !book.pages.length);

  const [target, setTarget] = useState<Spot | null>(null); // picker open for this spot
  const [selected, setSelected] = useState<Spot | null>(null); // filled spot tapped
  const [moving, setMoving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(saved ? "saved" : "idle");
  const [price, setPrice] = useState<Price | null>(null);
  const [pricing, setPricing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------- saving ---------------- */

  const [version, setVersion] = useState(0);
  const latest = useRef({ book, id });
  latest.current = { book, id };
  const saving = useRef<Promise<string | null> | null>(null);
  const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; delay: number }>({ delay: 4000 });

  const saveNow = useCallback(async (): Promise<string | null> => {
    // One save at a time; a save that starts while another runs picks up the latest state.
    while (saving.current) await saving.current;
    const { book: b, id: current } = latest.current;
    clearTimeout(retry.current.timer);
    const run = (async () => {
      setSaveState("saving");
      const { layouts, spots } = flatten(b.pages);
      const res = await saveBookAction({
        id: current,
        sku: b.sku,
        title: b.title,
        subtitle: b.subtitle,
        photoIds: spots,
        layouts,
        coverId: b.coverId,
      }).catch(() => ({
        ok: false as const,
        error: "You seem to be offline — your changes will save when you're back",
      }));
      if (!res.ok) {
        setSaveState("error");
        setError(res.error);
        // Try again on our own, backing off to once a minute.
        retry.current.timer = setTimeout(() => void saveNowRef.current(), retry.current.delay);
        retry.current.delay = Math.min(retry.current.delay * 2, 60_000);
        return null;
      }
      retry.current.delay = 4000;
      setError(null);
      setId(res.value);
      latest.current.id = res.value;
      setSaveState("saved");
      return res.value;
    })();
    saving.current = run;
    try {
      return await run;
    } finally {
      saving.current = null;
    }
  }, []);
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  useEffect(() => () => clearTimeout(retry.current.timer), []);

  /** Apply an edit and save it shortly after. */
  const edit = useCallback((fn: (b: Book) => Book) => {
    setBook((b) => fn(b));
    setVersion((v) => v + 1);
    setSaveState("idle");
    setError(null);
  }, []);

  useEffect(() => {
    if (version === 0) return;
    const t = setTimeout(() => void saveNow(), 700);
    return () => clearTimeout(t);
  }, [version, saveNow]);

  /* ---------------- price ---------------- */

  const pageCount = book.pages.length;
  const priceKey = `${book.sku}:${pageCount}`;
  useEffect(() => {
    if (!canPrice || !id || setup || saveState !== "saved" || !pageCount) return;
    if (price?.key === priceKey) return;
    let live = true;
    const t = setTimeout(async () => {
      setPricing(true);
      const res = await priceBookAction(id);
      if (!live) return;
      setPricing(false);
      if (res.ok) setPrice({ key: priceKey, priceCents: res.value.priceCents, currency: res.value.currency });
      else setError(res.error);
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [canPrice, id, setup, saveState, pageCount, priceKey, price?.key]);

  /* ---------------- edits ---------------- */

  const photoAt = (spot: Spot): string | null => {
    if (spot === "cover") return book.coverId;
    return book.pages[spot.page]?.photos[spot.slot] || null;
  };

  /** Where a photo already sits in the book, if anywhere. */
  const placement = useMemo(() => {
    const m = new Map<string, number>();
    book.pages.forEach((p, i) => p.photos.forEach((x) => x && m.set(x, i)));
    return m;
  }, [book.pages]);

  const put = (pages: Page[], spot: { page: number; slot: number }, photo: string): Page[] =>
    pages.map((p, i) =>
      i === spot.page ? { ...p, photos: p.photos.map((x, k) => (k === spot.slot ? photo : x)) } : p
    );

  /** Put a photo in a spot. A photo already elsewhere in the book moves here. */
  const place = (spot: Spot, photo: string) => {
    edit((b) => {
      if (spot === "cover") return { ...b, coverId: photo };
      const pages = b.pages.map((p) => ({ ...p, photos: p.photos.map((x) => (x === photo ? "" : x)) }));
      return { ...b, pages: put(pages, spot, photo) };
    });
  };

  const clearSpot = (spot: Spot) => {
    edit((b) => (spot === "cover" ? { ...b, coverId: null } : { ...b, pages: put(b.pages, spot, "") }));
  };

  /** Swap two page spots (either may be empty). */
  const swap = (a: { page: number; slot: number }, c: { page: number; slot: number }) => {
    edit((b) => {
      const pa = b.pages[a.page]?.photos[a.slot] ?? "";
      const pc = b.pages[c.page]?.photos[c.slot] ?? "";
      return { ...b, pages: put(put(b.pages, a, pc), c, pa) };
    });
  };

  const done = () => {
    setSelected(null);
    setMoving(false);
  };

  const onSpot = (spot: { page: number; slot: number }) => {
    if (moving && selected && selected !== "cover") {
      if (!sameSpot(selected, spot)) swap(selected, spot);
      done();
      return;
    }
    setMoving(false);
    if (!photoAt(spot)) {
      setSelected(null);
      setTarget(spot);
    } else setSelected((s) => (sameSpot(s, spot) ? null : spot));
  };

  const setLayout = (pageIndex: number, layout: LayoutId) => {
    done();
    edit((b) => ({ ...b, pages: withLayout(b.pages, pageIndex, layout) }));
  };

  const addPages = () => {
    edit((b) => ({
      ...b,
      pages: [...b.pages, ...EXTRA_PAGES.map((layout) => ({ layout, photos: LAYOUTS[layout].slots.map(() => "") }))],
    }));
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  };

  const removePages = () => {
    done();
    edit((b) => ({ ...b, pages: b.pages.slice(0, -2) }));
  };

  /** Finish setup: new size and/or design. `design` null keeps the pages. */
  const applySetup = (sku: string, design: Design | null) => {
    edit((b) => ({ ...b, sku, pages: design ? redesign(b.pages, designLayouts(design)) : b.pages }));
    setPrice(null);
    setSetup(false);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (target) setTarget(null);
      else done();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  const order = async () => {
    setOrdering(true);
    setError(null);
    const bookId = (await saveNow()) ?? id;
    if (!bookId) {
      setOrdering(false);
      return;
    }
    const res = await checkoutAction(bookId);
    if (res.ok) window.location.href = res.value;
    else {
      setError(res.error);
      setOrdering(false);
    }
  };

  /* ---------------- setup ---------------- */

  if (setup || !format) {
    return (
      <Setup
        current={format}
        pages={book.pages}
        prices={prices}
        onDone={applySetup}
        onCancel={format && book.pages.length ? () => setSetup(false) : null}
      />
    );
  }

  /* ---------------- editor ---------------- */

  const pages = book.pages;
  // Cover on its own, then spreads: page 1 sits on the right, opposite the
  // inside of the cover; the last page faces the inside of the back cover.
  const spreads: Array<[number | null, number | null]> = [];
  if (pages.length) spreads.push([null, 0]);
  for (let i = 1; i < pages.length; i += 2) spreads.push([i, i + 1 < pages.length ? i + 1 : null]);

  const aspect = format.widthMm / format.heightMm;
  const spots = pages.reduce((n, p) => n + p.photos.length, 0);
  const filled = placement.size;
  const empty = spots - filled;
  const coverId = book.coverId ?? pages.flatMap((p) => p.photos).find(Boolean) ?? null;
  const cover = coverId ? byId.get(coverId) : undefined;
  const selectedPage = selected && selected !== "cover" ? selected : null;

  const pageCell = (index: number | null, side: "left" | "right") => {
    if (index === null) {
      return <div className="w-full bg-ink-raised/60" style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }} />;
    }
    const page = pages[index];
    return (
      <div className="group/page">
        <PageView
          page={page}
          pageNumber={index + 1}
          format={format}
          photos={byId}
          selectedSlot={selectedPage?.page === index ? selectedPage.slot : null}
          moving={moving}
          onSpot={(slot) => onSpot({ page: index, slot })}
        />
        <div className={`mt-2 flex items-center gap-1 ${side === "left" ? "justify-start" : "justify-end"} text-ivory-dim`}>
          <span className={`text-[10px] tracking-[0.2em] ${side === "left" ? "order-last ml-auto" : "mr-auto"}`}>{index + 1}</span>
          <div className="flex gap-0.5 opacity-60 transition-opacity group-hover/page:opacity-100 focus-within:opacity-100">
            {PICKER.map((l) => (
              <button
                key={l}
                type="button"
                title={LAYOUTS[l].label}
                aria-label={`${LAYOUTS[l].label} layout for page ${index + 1}`}
                aria-pressed={page.layout === l}
                onClick={() => setLayout(index, l)}
                className={`grid h-7 w-7 place-items-center rounded-sm transition-colors ${
                  page.layout === l ? "text-champagne" : "hover:text-ivory"
                }`}
              >
                <LayoutIcon id={l} aspect={aspect} />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const orderLabel = ordering
    ? "Opening checkout…"
    : empty
      ? `${plural(empty, "spot")} to fill`
      : pricing || !price
        ? "Pricing…"
        : `Order · ${money(price.priceCents, price.currency)}`;

  return (
    <div>
      <p className="mb-8 text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
        {format.label} · {pages.length} pages ·{" "}
        <button type="button" onClick={() => setSetup(true)} className="text-champagne underline-offset-4 hover:underline">
          Change size or design
        </button>
      </p>

      {/* Front cover — tap the photo to choose it, type the title on it */}
      <section aria-label="Cover" className="mx-auto w-full max-w-[min(340px,42vh)]">
        <div
          className="relative w-full overflow-hidden bg-ink-raised shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
          style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }}
        >
          <button
            type="button"
            onClick={() => {
              done();
              setTarget("cover");
            }}
            aria-label={cover ? "Change the cover photo" : "Choose a cover photo"}
            className="group absolute inset-0 block outline-none"
          >
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.large} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center border border-dashed border-ivory/25 group-hover:border-champagne">
                <span className="text-[10px] uppercase tracking-[0.3em] text-ivory-dim group-hover:text-champagne">
                  + Cover photo
                </span>
              </span>
            )}
            <span aria-hidden className="absolute inset-0 transition-shadow group-hover:shadow-[inset_0_0_0_2px_rgba(201,169,106,0.7)]" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-ink/80" />
          <div className="absolute inset-x-[7%] bottom-[7%] text-center">
            <input
              value={book.title}
              onChange={(e) => edit((b) => ({ ...b, title: e.target.value.slice(0, 80) }))}
              placeholder="Add a title"
              aria-label="Book title"
              className="w-full bg-transparent text-center font-display text-3xl font-light italic text-ivory placeholder:text-ivory/50 outline-none focus:underline focus:decoration-champagne/60 focus:underline-offset-8 sm:text-4xl"
            />
            <input
              value={book.subtitle}
              onChange={(e) => edit((b) => ({ ...b, subtitle: e.target.value.slice(0, 120) }))}
              placeholder="A line underneath"
              aria-label="Line under the title"
              className="mt-2 w-full bg-transparent text-center text-[10px] uppercase tracking-[0.3em] text-champagne placeholder:text-champagne/50 outline-none focus:underline focus:underline-offset-4"
            />
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] uppercase tracking-[0.3em] text-ivory-dim">
          {book.coverId ? "Tap the cover to change it" : cover ? "Cover · tap to choose a different photo" : "Tap to choose a cover"}
        </p>
      </section>

      {/* Spreads */}
      <div className="mx-auto mt-14 grid max-w-[1240px] grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
        {spreads.map(([l, r], i) => (
          <div key={i} className="mx-auto grid w-full max-w-[min(600px,72vh)] grid-cols-2 gap-[3px]">
            {pageCell(l, "left")}
            {pageCell(r, "right")}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-[1240px] flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={addPages}
          disabled={pages.length + 2 > format.maxPages}
          className="border border-champagne/60 px-5 py-3 text-[11px] uppercase tracking-[0.3em] text-ivory transition-colors hover:bg-champagne hover:text-ink disabled:opacity-40"
        >
          Add two pages
        </button>
        <button
          type="button"
          onClick={removePages}
          disabled={pages.length - 2 < format.minPages}
          className="border border-ivory/20 px-5 py-3 text-[11px] uppercase tracking-[0.3em] text-ivory-dim transition-colors hover:border-ivory/50 hover:text-ivory disabled:opacity-40 disabled:hover:border-ivory/20 disabled:hover:text-ivory-dim"
        >
          Remove last two
        </button>
      </div>
      {pages.length - 2 < format.minPages && (
        <p className="mt-3 text-center text-[10px] text-ivory-dim">{format.minPages} pages is the smallest book the printer makes</p>
      )}

      {/* Filled spot actions */}
      {selectedPage && (
        <div className="fixed inset-x-0 bottom-[84px] z-30 flex justify-center px-4" role="toolbar" aria-label="Photo actions">
          <div className="flex flex-wrap items-center justify-center gap-1 border border-champagne/40 bg-ink-raised/95 p-1.5 text-[11px] uppercase tracking-[0.2em] shadow-2xl backdrop-blur">
            {moving ? (
              <span className="px-3 py-2 text-ivory">Tap where it should go</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setTarget(selectedPage);
                    setSelected(null);
                  }}
                  className="px-3 py-2 text-ivory hover:text-champagne"
                >
                  Replace
                </button>
                <button type="button" onClick={() => setMoving(true)} className="px-3 py-2 text-ivory hover:text-champagne">
                  Move
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const p = photoAt(selectedPage);
                    if (p) edit((b) => ({ ...b, coverId: p }));
                    done();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="px-3 py-2 text-ivory hover:text-champagne"
                >
                  Use as cover
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearSpot(selectedPage);
                    done();
                  }}
                  className="px-3 py-2 text-ivory hover:text-champagne"
                >
                  Remove
                </button>
              </>
            )}
            <button type="button" onClick={done} className="px-3 py-2 text-ivory-dim hover:text-ivory">
              {moving ? "Cancel" : "Done"}
            </button>
          </div>
        </div>
      )}

      {/* Footer: progress, save state, price, order */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ivory/10 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ivory">
              {filled} of {spots} photos · {pages.length} pages
            </p>
            <p className="truncate text-[11px] text-ivory-dim" aria-live="polite">
              {error ??
                (saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? empty
                      ? "Saved · tap an empty spot to add a photo"
                      : "Saved"
                    : format.label)}
            </p>
          </div>
          {canOrder ? (
            <button
              type="button"
              onClick={order}
              disabled={ordering || empty > 0 || pricing || !price}
              className="shrink-0 bg-champagne px-5 py-3 text-[11px] uppercase tracking-[0.25em] text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {orderLabel}
            </button>
          ) : (
            <span className="shrink-0 text-right text-[11px] uppercase tracking-[0.2em] text-ivory-dim">
              {price && !pricing ? `${money(price.priceCents, price.currency)} · ordering opens soon` : "Ordering opens soon"}
            </span>
          )}
        </div>
        {price && !pricing && (
          <p className="-mt-2 pb-3 text-center text-[10px] text-ivory-dim">
            Printed in Australia and delivered to your door · price is exactly what the printer charges
          </p>
        )}
      </div>

      {target && (
        <PhotoPicker
          photos={photos}
          byId={byId}
          title={target === "cover" ? "Choose the cover photo" : `Choose a photo for page ${target.page + 1}`}
          current={photoAt(target)}
          placement={placement}
          onPick={(photo) => {
            place(target, photo);
            setTarget(null);
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup: size, then design                                            */
/* ------------------------------------------------------------------ */

function Setup({
  current,
  pages,
  prices,
  onDone,
  onCancel,
}: {
  current: BookFormat | null;
  pages: Page[];
  prices: Record<string, number>;
  onDone: (sku: string, design: Design | null) => void;
  onCancel: (() => void) | null;
}) {
  const [sku, setSku] = useState<string | null>(current?.sku ?? null);
  const hasPages = pages.length > 0;
  const placed = pages.reduce((n, p) => n + p.photos.filter(Boolean).length, 0);
  // "keep" = keep the pages already made; otherwise a design id.
  const [design, setDesign] = useState<string | null>(hasPages ? "keep" : null);
  const chosen = sku ? formatFor(sku) : null;
  const pickedDesign = DESIGNS.find((d) => d.id === design) ?? null;
  const ready = Boolean(chosen && design);

  const sizes = (["A4", "A5"] as const).flatMap((size) =>
    (["portrait", "landscape"] as const).map((orientation) => ({
      size,
      orientation,
      options: FORMATS.filter((f) => f.size === size && f.orientation === orientation),
    }))
  );

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <section aria-labelledby="size-h">
        <h2 id="size-h" className="text-center text-[11px] uppercase tracking-[0.4em] text-ivory-dim">
          1 · Choose a size
        </h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sizes.map(({ size, orientation, options }) => {
            const active = chosen?.size === size && chosen.orientation === orientation;
            const sample = options[0];
            const w = sample.widthMm / 297;
            const h = sample.heightMm / 297;
            const from = options.map((o) => prices[o.sku]).filter((p) => p !== undefined);
            return (
              <button
                key={`${size}-${orientation}`}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const keepCover = chosen && options.find((o) => o.cover === chosen.cover);
                  setSku((keepCover ?? options[0]).sku);
                }}
                className={`flex flex-col items-center border px-3 pb-4 pt-5 transition-colors ${
                  active ? "border-champagne bg-champagne/10" : "border-ivory/15 hover:border-ivory/40"
                }`}
              >
                <span className="grid h-24 w-full place-items-center">
                  <span
                    aria-hidden
                    className={`block border ${active ? "border-champagne bg-champagne/20" : "border-ivory/40 bg-ivory/5"}`}
                    style={{ width: `${w * 84}px`, height: `${h * 84}px` }}
                  />
                </span>
                <span className="mt-3 text-sm text-ivory">
                  {size} {orientation}
                </span>
                <span className="mt-1 text-[11px] text-ivory-dim">
                  {Math.round(sample.widthMm / 10)} × {Math.round(sample.heightMm / 10)} cm
                </span>
                {from.length > 0 && (
                  <span className="mt-1 text-[11px] text-champagne">from {money(Math.min(...from))}</span>
                )}
              </button>
            );
          })}
        </div>

        {chosen && (
          <div className="mt-4 flex justify-center gap-2" role="group" aria-label="Cover">
            {(["hardcover", "softcover"] as const).map((cover) => {
              const option = FORMATS.find(
                (f) => f.size === chosen.size && f.orientation === chosen.orientation && f.cover === cover
              );
              const price = option ? prices[option.sku] : undefined;
              return (
                <button
                  key={cover}
                  type="button"
                  disabled={!option}
                  aria-pressed={chosen.cover === cover}
                  onClick={() => option && setSku(option.sku)}
                  className={`border px-4 py-2 text-[11px] uppercase tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    chosen.cover === cover ? "border-champagne text-ivory" : "border-ivory/15 text-ivory-dim hover:border-ivory/40"
                  }`}
                >
                  {cover}
                  {price !== undefined && <span className="ml-2 normal-case tracking-normal text-champagne">{money(price)}</span>}
                  {!option && <span className="ml-1.5 normal-case tracking-normal">· not in this size</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="design-h" className={`mt-14 transition-opacity ${chosen ? "" : "pointer-events-none opacity-35"}`}>
        <h2 id="design-h" className="text-center text-[11px] uppercase tracking-[0.4em] text-ivory-dim">
          2 · Choose a design
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-center text-xs font-light text-ivory-dim">
          A design is a set of empty pages. You fill them one photo at a time, and can change any page later.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {hasPages && (
            <DesignCard
              active={design === "keep"}
              onClick={() => setDesign("keep")}
              name="Keep my pages"
              blurb={`${pages.length} pages · ${plural(placed, "photo")} placed`}
              layouts={pages.slice(0, 6).map((p) => p.layout)}
              aspect={chosen ? chosen.widthMm / chosen.heightMm : 0.7}
            />
          )}
          {DESIGNS.map((d) => (
            <DesignCard
              key={d.id}
              active={design === d.id}
              onClick={() => setDesign(d.id)}
              name={d.name}
              blurb={`${d.pages} pages · ${designSpots(d)} photos — ${d.blurb.toLowerCase()}`}
              layouts={designLayouts(d).slice(0, 6)}
              aspect={chosen ? chosen.widthMm / chosen.heightMm : 0.7}
            />
          ))}
        </div>
        {hasPages && pickedDesign && placed > 0 && (
          <p className="mt-4 text-center text-[11px] text-ivory-dim">
            {placed === 1 ? "The photo you\u2019ve placed carries" : `The ${placed} photos you\u2019ve placed carry`} across in order
            {placed > designSpots(pickedDesign) ? ` — the last ${placed - designSpots(pickedDesign)} won't fit` : ""}.
          </p>
        )}
      </section>

      <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-3 text-[11px] uppercase tracking-[0.3em] text-ivory-dim hover:text-ivory">
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!ready}
          onClick={() => chosen && onDone(chosen.sku, pickedDesign)}
          className="bg-champagne px-6 py-3 text-[11px] uppercase tracking-[0.3em] text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {hasPages ? "Done" : "Start my book"}
        </button>
      </div>
    </div>
  );
}

function DesignCard({
  active,
  onClick,
  name,
  blurb,
  layouts,
  aspect,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  blurb: string;
  layouts: LayoutId[];
  aspect: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex flex-col items-center border px-4 pb-5 pt-6 text-center transition-colors ${
        active ? "border-champagne bg-champagne/10" : "border-ivory/15 hover:border-ivory/40"
      }`}
    >
      <span aria-hidden className={`grid grid-cols-3 gap-1.5 ${active ? "text-champagne" : "text-ivory/50"}`}>
        {layouts.map((l, i) => (
          <LayoutIcon key={i} id={l} aspect={aspect} size={26} />
        ))}
      </span>
      <span className="mt-4 font-display text-2xl font-light italic text-ivory">{name}</span>
      <span className="mt-1 text-[11px] leading-relaxed text-ivory-dim">{blurb}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Photo picker: one photo for one spot                                */
/* ------------------------------------------------------------------ */

function PhotoPicker({
  photos,
  byId,
  title,
  current,
  placement,
  onPick,
  onClose,
}: {
  photos: BuilderPhoto[];
  byId: Map<string, BuilderPhoto>;
  title: string;
  current: string | null;
  /** Photo id → page index, for photos already in the book */
  placement: Map<string, number>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const albums = (["wedding", "engagement"] as const).filter((a) => photos.some((p) => p.album === a));
  const [album, setAlbum] = useState<(typeof albums)[number]>(albums[0] ?? "wedding");
  const [recent, setRecent] = useState<BuilderPhoto[]>([]);
  useEffect(() => {
    setRecent(
      recentlyViewed()
        .map((id) => byId.get(id))
        .filter((p): p is BuilderPhoto => Boolean(p))
        .slice(0, 24)
    );
  }, [byId]);
  const list = photos.filter((p) => p.album === album);

  const tile = (p: BuilderPhoto, className: string) => {
    const page = placement.get(p.id);
    const isCurrent = p.id === current;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => onPick(p.id)}
        aria-label={
          isCurrent ? "This photo (already here)" : page !== undefined ? `Move this photo here from page ${page + 1}` : "Use this photo"
        }
        className={`group relative overflow-hidden outline-none ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={p.thumb}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover transition-opacity ${page !== undefined && !isCurrent ? "opacity-40" : ""}`}
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 transition-shadow ${
            isCurrent
              ? "shadow-[inset_0_0_0_3px_var(--color-champagne)]"
              : "group-hover:shadow-[inset_0_0_0_3px_rgba(201,169,106,0.9)] group-focus-visible:shadow-[inset_0_0_0_3px_rgba(201,169,106,0.9)]"
          }`}
        />
        {page !== undefined && !isCurrent && (
          <span className="absolute bottom-1 left-1 bg-ink/80 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.15em] text-ivory">
            p.{page + 1}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative flex max-h-[80vh] flex-col border-t border-champagne/30 bg-ink-raised">
        <div className="flex items-center gap-4 px-4 pb-2 pt-4 sm:px-8">
          <p className="font-display text-xl font-light italic text-ivory sm:text-2xl">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[11px] uppercase tracking-[0.25em] text-ivory-dim hover:text-ivory"
          >
            Cancel
          </button>
        </div>
        {/* The scroller wraps the grid: a grid that scrolls itself inside a
            height-capped column gets its rows squashed and the tiles overlap. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-8">
          {recent.length > 0 && (
            <section aria-label="Recently viewed" className="pt-2">
              <h3 className="text-[10px] uppercase tracking-[0.3em] text-ivory-dim">Recently viewed</h3>
              <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-2">
                {recent.map((p) => tile(p, "h-20 w-20 shrink-0 sm:h-24 sm:w-24"))}
              </div>
            </section>
          )}
          <div className="sticky top-0 z-10 -mx-4 flex gap-5 bg-ink-raised px-4 py-3 text-[11px] uppercase tracking-[0.3em] sm:-mx-8 sm:px-8">
            {albums.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAlbum(a)}
                aria-pressed={album === a}
                className={album === a ? "text-ivory" : "text-ivory-dim hover:text-ivory"}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 lg:grid-cols-8">
            {list.map((p) => tile(p, "aspect-square"))}
          </div>
        </div>
      </div>
    </div>
  );
}
