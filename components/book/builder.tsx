"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LAYOUTS,
  flow,
  layoutBook,
  relayoutAfter,
  relayoutFrom,
  type BookFormat,
  type LayoutId,
  type Page,
  type PhotoShape,
} from "@/lib/book/layouts";
import { checkoutAction, priceBookAction, saveBookAction } from "@/app/book/actions";
import { LayoutIcon, PageView } from "./page-view";

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
  title: string;
  subtitle: string;
  photoIds: string[];
  layouts: string[];
  coverId: string | null;
}

interface Book {
  title: string;
  subtitle: string;
  photoIds: string[];
  layouts: LayoutId[];
  coverId: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";
interface Price {
  pageCount: number;
  priceCents: number;
  currency: string;
}

const PICKER: LayoutId[] = ["full", "framed", "duo", "trio", "quad", "blank"];

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function BookBuilder({
  photos,
  format,
  saved,
  starter,
  canOrder,
}: {
  photos: BuilderPhoto[];
  format: BookFormat;
  saved: SavedBook | null;
  starter: { title: string; subtitle: string; photoIds: string[]; coverId: string | null };
  canOrder: boolean;
}) {
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const shapesOf = useCallback(
    (ids: string[]): PhotoShape[] => ids.flatMap((id) => (byId.has(id) ? [{ id, aspect: byId.get(id)!.aspect }] : [])),
    [byId]
  );

  const [id, setId] = useState<string | null>(saved?.id ?? null);
  const [book, setBook] = useState<Book>(() => {
    const base = saved ?? { ...starter, layouts: [] as string[] };
    const shapes = shapesOf(base.photoIds);
    return {
      title: base.title,
      subtitle: base.subtitle,
      photoIds: shapes.map((s) => s.id),
      layouts: saved?.layouts.length ? relayoutAfter(shapes, saved.layouts, saved.layouts.length, format) : layoutBook(shapes, format),
      coverId: base.coverId,
    };
  });
  const pages: Page[] = useMemo(() => flow(shapesOf(book.photoIds), book.layouts, format), [book, shapesOf, format]);
  const coverId = book.coverId && byId.has(book.coverId) ? book.coverId : book.photoIds[0] ?? null;

  const [selected, setSelected] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [drawer, setDrawer] = useState(false);
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
      const res = await saveBookAction({ id: current, ...b }).catch(() => ({
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

  // With ordering on, save the starter book straight away so it has a price.
  useEffect(() => {
    if (canOrder && !saved) void saveNow();
  }, [canOrder, saved, saveNow]);

  /* ---------------- price ---------------- */

  const pageCount = pages.length;
  useEffect(() => {
    if (!canOrder || !id || saveState !== "saved") return;
    if (price?.pageCount === pageCount) return;
    let live = true;
    const t = setTimeout(async () => {
      setPricing(true);
      const res = await priceBookAction(id);
      if (!live) return;
      setPricing(false);
      if (res.ok) setPrice(res.value);
      else setError(res.error);
    }, 500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [canOrder, id, saveState, pageCount, price?.pageCount]);

  /* ---------------- edits ---------------- */

  const pageOf = useCallback(
    (photoId: string) => pages.findIndex((p) => p.photos.includes(photoId)),
    [pages]
  );

  const removePhoto = (photoId: string) => {
    const at = pageOf(photoId);
    edit((b) => {
      const ids = b.photoIds.filter((x) => x !== photoId);
      return {
        ...b,
        photoIds: ids,
        layouts: relayoutAfter(shapesOf(ids), b.layouts, Math.max(0, at), format),
        coverId: b.coverId === photoId ? null : b.coverId,
      };
    });
    setSelected(null);
    setSwapping(false);
  };

  const addPhotos = (add: string[]) => {
    edit((b) => {
      const fresh = add.filter((x) => !b.photoIds.includes(x));
      if (!fresh.length) return b;
      const ids = [...b.photoIds, ...fresh];
      // Re-lay from the last page with photos on it, so a half-empty page fills up.
      const current = flow(shapesOf(b.photoIds), b.layouts, format);
      let last = current.length - 1;
      while (last > 0 && !current[last].photos.length) last--;
      return { ...b, photoIds: ids, layouts: relayoutAfter(shapesOf(ids), b.layouts, Math.max(0, last), format) };
    });
  };

  const togglePhoto = (photoId: string) => {
    if (book.photoIds.includes(photoId)) removePhoto(photoId);
    else addPhotos([photoId]);
  };

  const swap = (a: string, b: string) => {
    edit((bk) => {
      const ids = [...bk.photoIds];
      const i = ids.indexOf(a);
      const j = ids.indexOf(b);
      if (i < 0 || j < 0) return bk;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      return { ...bk, photoIds: ids };
    });
  };

  const setLayout = (pageIndex: number, layout: LayoutId) => {
    edit((b) => ({ ...b, layouts: relayoutFrom(shapesOf(b.photoIds), b.layouts, pageIndex, layout, format) }));
  };

  const onPhoto = (photoId: string) => {
    if (swapping && selected && selected !== photoId) {
      swap(selected, photoId);
      setSwapping(false);
      setSelected(null);
      return;
    }
    setSwapping(false);
    setSelected((s) => (s === photoId ? null : photoId));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawer) setDrawer(false);
      else {
        setSwapping(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

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

  /* ---------------- layout ---------------- */

  // Cover on its own, then spreads: page 1 sits on the right, opposite the
  // inside of the cover; the last page faces the inside of the back cover.
  const spreads: Array<[number | null, number | null]> = [];
  if (pages.length) spreads.push([null, 0]);
  for (let i = 1; i < pages.length; i += 2) spreads.push([i, i + 1 < pages.length ? i + 1 : null]);

  const aspect = format.widthMm / format.heightMm;
  const photoCount = book.photoIds.length;
  const tooMany = pages.length > format.maxPages;

  const pageCell = (index: number | null, side: "left" | "right") => {
    if (index === null) {
      return <div className="w-full bg-ink-raised/60" style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }} />;
    }
    const page = pages[index];
    return (
      <div className="group/page">
        <PageView
          page={page}
          format={format}
          photos={byId}
          selectedId={selected}
          swapping={swapping}
          onPhoto={onPhoto}
        />
        <div
          className={`mt-2 flex items-center gap-1 ${side === "left" ? "justify-start" : "justify-end"} text-ivory-dim`}
        >
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

  return (
    <div>
      {/* Front cover — type the title straight onto it */}
      <section aria-label="Cover" className="mx-auto w-full max-w-[min(340px,42vh)]">
        <div
          className="relative w-full overflow-hidden bg-ink-raised shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
          style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }}
        >
          {coverId && byId.get(coverId) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={byId.get(coverId)!.large} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-ink/80" />
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
          Cover · tap a photo below and choose &ldquo;Use as cover&rdquo;
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
      <div className="mx-auto mt-10 max-w-[1240px]">
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="border border-champagne/60 px-5 py-3 text-[11px] uppercase tracking-[0.3em] text-ivory transition-colors hover:bg-champagne hover:text-ink"
          >
            Add photos
          </button>
          <button
            type="button"
            onClick={() => edit((b) => ({ ...b, layouts: layoutBook(shapesOf(b.photoIds), format) }))}
            className="border border-ivory/20 px-5 py-3 text-[11px] uppercase tracking-[0.3em] text-ivory-dim transition-colors hover:border-ivory/50 hover:text-ivory"
          >
            Re-arrange pages for me
          </button>
        </div>
      </div>

      {/* Selected photo actions */}
      {selected && (
        <div className="fixed inset-x-0 bottom-[84px] z-30 flex justify-center px-4" role="toolbar" aria-label="Photo actions">
          <div className="flex flex-wrap items-center justify-center gap-1 border border-champagne/40 bg-ink-raised/95 p-1.5 text-[11px] uppercase tracking-[0.2em] shadow-2xl backdrop-blur">
            {swapping ? (
              <span className="px-3 py-2 text-ivory">Tap another photo to swap</span>
            ) : (
              <>
                <button type="button" onClick={() => setSwapping(true)} className="px-3 py-2 text-ivory hover:text-champagne">
                  Swap
                </button>
                <button
                  type="button"
                  onClick={() => {
                    edit((b) => ({ ...b, coverId: selected }));
                    setSelected(null);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="px-3 py-2 text-ivory hover:text-champagne"
                >
                  Use as cover
                </button>
                <button type="button" onClick={() => removePhoto(selected)} className="px-3 py-2 text-ivory hover:text-champagne">
                  Remove
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="Done"
              onClick={() => {
                setSwapping(false);
                setSelected(null);
              }}
              className="px-3 py-2 text-ivory-dim hover:text-ivory"
            >
              {swapping ? "Cancel" : "Done"}
            </button>
          </div>
        </div>
      )}

      {/* Footer: summary, save state, price, order */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ivory/10 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-4 sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-ivory">
              {photoCount} photos · {pages.length} pages
            </p>
            <p className="truncate text-[11px] text-ivory-dim" aria-live="polite">
              {error ??
                (tooMany
                  ? `That's more than ${format.maxPages} pages — remove a few photos`
                  : saveState === "saving"
                    ? "Saving…"
                    : saveState === "saved"
                      ? "Saved"
                      : format.label)}
            </p>
          </div>
          {canOrder ? (
            <button
              type="button"
              onClick={order}
              disabled={ordering || !photoCount || tooMany || pricing || !price}
              className="shrink-0 bg-champagne px-5 py-3 text-[11px] uppercase tracking-[0.25em] text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {ordering
                ? "Opening checkout…"
                : pricing || !price
                  ? "Pricing…"
                  : `Order · ${money(price.priceCents, price.currency)}`}
            </button>
          ) : (
            <span className="shrink-0 text-right text-[11px] uppercase tracking-[0.2em] text-ivory-dim">
              Ordering opens soon
            </span>
          )}
        </div>
        {canOrder && price && !pricing && (
          <p className="-mt-2 pb-3 text-center text-[10px] text-ivory-dim">
            Printed in Australia and delivered to your door · price is exactly what the printer charges
          </p>
        )}
      </div>

      {drawer && (
        <PhotoDrawer
          photos={photos}
          inBook={new Set(book.photoIds)}
          onToggle={togglePhoto}
          onAddAll={addPhotos}
          onClose={() => setDrawer(false)}
        />
      )}
    </div>
  );
}

function PhotoDrawer({
  photos,
  inBook,
  onToggle,
  onAddAll,
  onClose,
}: {
  photos: BuilderPhoto[];
  inBook: Set<string>;
  onToggle: (id: string) => void;
  onAddAll: (ids: string[]) => void;
  onClose: () => void;
}) {
  const albums = (["wedding", "engagement"] as const).filter((a) => photos.some((p) => p.album === a));
  const [album, setAlbum] = useState<(typeof albums)[number]>(albums[0] ?? "wedding");
  const list = photos.filter((p) => p.album === album);
  const missing = list.filter((p) => !inBook.has(p.id)).map((p) => p.id);

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Add photos">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative flex max-h-[75vh] flex-col border-t border-champagne/30 bg-ink-raised">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-8">
          <div className="flex gap-4 text-[11px] uppercase tracking-[0.3em]">
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
          <div className="ml-auto flex items-center gap-4 text-[11px] uppercase tracking-[0.2em]">
            {missing.length > 0 && (
              <button type="button" onClick={() => onAddAll(missing)} className="text-champagne hover:text-ivory">
                Add all {missing.length}
              </button>
            )}
            <button type="button" onClick={onClose} className="bg-champagne px-4 py-2 text-ink">
              Done
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1 overflow-y-auto px-4 pb-6 sm:grid-cols-6 sm:px-8 lg:grid-cols-8">
          {list.map((p) => {
            const on = inBook.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onToggle(p.id)}
                aria-pressed={on}
                aria-label={on ? "Remove from book" : "Add to book"}
                className="relative aspect-square overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumb}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover transition-opacity ${on ? "opacity-100" : "opacity-45 hover:opacity-80"}`}
                />
                {on && (
                  <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-champagne text-[11px] text-ink">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
