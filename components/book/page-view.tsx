"use client";

import { LAYOUTS, slotsFor, type BookFormat, type LayoutId, type Page } from "@/lib/book/layouts";
import type { BuilderPhoto } from "./builder";

/**
 * One interior page as it will print: same slot geometry as the print
 * renderer (lib/book/render.ts), drawn with the gallery thumbnails. Empty
 * spots are buttons that open the photo picker.
 */
export function PageView({
  page,
  pageNumber,
  format,
  photos,
  selectedSlot,
  moving,
  onSpot,
}: {
  page: Page;
  pageNumber: number;
  format: BookFormat;
  photos: Map<string, BuilderPhoto>;
  /** Slot on this page that's selected, if any */
  selectedSlot: number | null;
  /** Something is being moved: every spot is a drop target */
  moving: boolean;
  onSpot: (slot: number) => void;
}) {
  const layout = LAYOUTS[page.layout];
  const slots = slotsFor(page.layout, format.widthMm / format.heightMm);
  return (
    <div
      className="relative w-full overflow-hidden bg-[#fbf9f5] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7)]"
      style={{ aspectRatio: `${format.widthMm} / ${format.heightMm}` }}
    >
      {slots.map((s, i) => {
        const id = page.photos[i];
        const photo = id ? photos.get(id) : undefined;
        const selected = selectedSlot === i;
        const where = slots.length > 1 ? `spot ${i + 1} on page ${pageNumber}` : `page ${pageNumber}`;
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
          >
            {photo ? (
              <button
                type="button"
                onClick={() => onSpot(i)}
                aria-label={moving ? `Move here: ${where}` : `Photo on ${where}`}
                aria-pressed={selected}
                className={`group relative block h-full w-full overflow-hidden outline-none ${
                  moving && !selected ? "cursor-copy" : "cursor-pointer"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumb}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={`h-full w-full ${layout.fit === "contain" ? "object-contain" : "object-cover"} transition-opacity duration-200 ${
                    moving && !selected ? "group-hover:opacity-70" : ""
                  }`}
                />
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 transition-shadow ${
                    selected
                      ? "shadow-[inset_0_0_0_3px_var(--color-champagne)]"
                      : "group-hover:shadow-[inset_0_0_0_2px_rgba(201,169,106,0.7)] group-focus-visible:shadow-[inset_0_0_0_2px_rgba(201,169,106,0.9)]"
                  }`}
                />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSpot(i)}
                aria-label={moving ? `Move here: ${where}` : `Add a photo to ${where}`}
                className={`group grid h-full w-full place-items-center border border-dashed outline-none transition-colors ${
                  moving
                    ? "border-champagne/70 bg-champagne/10"
                    : "border-black/20 bg-black/[0.03] hover:border-champagne hover:bg-champagne/10 focus-visible:border-champagne"
                }`}
              >
                <span
                  aria-hidden
                  className="grid h-7 w-7 place-items-center rounded-full border border-black/25 text-base leading-none text-black/40 transition-colors group-hover:border-champagne group-hover:bg-champagne group-hover:text-ink"
                >
                  +
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Tiny diagram of a layout, for the page layout picker. */
export function LayoutIcon({ id, aspect, size = 22 }: { id: LayoutId; aspect: number; size?: number }) {
  const w = aspect >= 1 ? size : size * aspect;
  const h = aspect >= 1 ? size / aspect : size;
  const slots = slotsFor(id, aspect);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} fill="none" stroke="currentColor" strokeOpacity="0.5" />
      {slots.map((s, i) => (
        <rect key={i} x={s.x * w} y={s.y * h} width={s.w * w} height={s.h * h} fill="currentColor" />
      ))}
    </svg>
  );
}
