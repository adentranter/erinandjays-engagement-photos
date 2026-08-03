"use client";

import { useState } from "react";
import type { MediaItem } from "@/lib/photos";
import { Lightbox } from "@/components/lightbox";

export function Gallery({ media }: { media: MediaItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
        {media.map((item, i) => (
          <button
            key={item.name}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="tile mb-3 block w-full cursor-zoom-in break-inside-avoid focus:outline-none"
            aria-label={
              item.type === "video"
                ? `Play video ${i + 1} of ${media.length}`
                : `View photograph ${i + 1} of ${media.length}`
            }
          >
            {item.type === "video" ? (
              <span className="relative block w-full bg-ink-raised">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={`/api/photo/${encodeURIComponent(item.name)}`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-auto w-full"
                  style={{ aspectRatio: `${item.width} / ${item.height}` }}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border border-champagne/70 bg-ink/55 text-ivory backdrop-blur-sm">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              </span>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/photo/${encodeURIComponent(item.name)}?size=thumb`}
                alt=""
                width={item.width}
                height={item.height}
                loading={i < 8 ? "eager" : "lazy"}
                decoding="async"
                className="h-auto w-full bg-ink-raised"
              />
            )}
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          media={media}
          index={openIndex}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}
