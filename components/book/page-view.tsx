"use client";

import { LAYOUTS, slotsFor, type BookFormat, type LayoutId, type Page } from "@/lib/book/layouts";
import type { BuilderPhoto } from "./builder";

/**
 * One interior page as it will print: same slot geometry as the print
 * renderer (lib/book/render.ts), drawn with the gallery thumbnails.
 */
export function PageView({
  page,
  format,
  photos,
  selectedId,
  swapping,
  onPhoto,
}: {
  page: Page;
  format: BookFormat;
  photos: Map<string, BuilderPhoto>;
  selectedId: string | null;
  swapping: boolean;
  onPhoto: (id: string) => void;
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
        const selected = id && id === selectedId;
        return (
          <div
            key={i}
            className="absolute"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
          >
            {photo ? (
              <button
                type="button"
                onClick={() => onPhoto(photo.id)}
                aria-label={selected ? "Selected photo" : "Select photo"}
                aria-pressed={Boolean(selected)}
                className={`group relative block h-full w-full overflow-hidden outline-none ${
                  swapping && !selected ? "cursor-copy" : "cursor-pointer"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.thumb}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={`h-full w-full ${layout.fit === "contain" ? "object-contain" : "object-cover"} transition-opacity duration-200 ${
                    swapping && !selected ? "group-hover:opacity-70" : ""
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
              <div className="h-full w-full border border-dashed border-black/10" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Tiny diagram of a layout, for the page layout picker. */
export function LayoutIcon({ id, aspect }: { id: LayoutId; aspect: number }) {
  const w = aspect >= 1 ? 22 : 22 * aspect;
  const h = aspect >= 1 ? 22 / aspect : 22;
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
