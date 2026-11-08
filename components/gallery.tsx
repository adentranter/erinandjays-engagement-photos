"use client";

import { useState } from "react";
import type { GalleryItem } from "@/lib/gallery-types";
import { Lightbox } from "@/components/lightbox";
import { MotionVideo } from "@/components/motion-video";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute top-2.5 left-2.5 border border-ivory/40 bg-ink/55 px-2 py-0.5 text-[9px] uppercase tracking-[0.25em] text-ivory backdrop-blur-sm">
      {children}
    </span>
  );
}

export function Gallery({ media }: { media: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
        {media.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="tile mb-3 block w-full cursor-zoom-in break-inside-avoid focus:outline-none"
            aria-label={
              item.type === "video"
                ? `Play video ${i + 1} of ${media.length}`
                : `View photograph ${i + 1} of ${media.length}`
            }
          >
            {item.type === "animation" && item.motion ? (
              <span className="relative block w-full bg-ink-raised">
                <MotionVideo
                  src={item.motion}
                  poster={item.thumb}
                  className="h-auto w-full"
                  style={{ aspectRatio: `${item.width ?? 3} / ${item.height ?? 4}` }}
                />
                <Badge>Live</Badge>
              </span>
            ) : item.type === "video" ? (
              <span className="relative block w-full bg-ink-raised">
                {item.poster ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.thumb}
                    alt=""
                    width={item.width}
                    height={item.height}
                    loading={i < 8 ? "eager" : "lazy"}
                    decoding="async"
                    className="h-auto w-full"
                  />
                ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={`${item.src}#t=0.1`}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-auto w-full"
                    style={{
                      aspectRatio: `${item.width ?? 16} / ${item.height ?? 9}`,
                    }}
                  />
                )}
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
                src={item.thumb}
                alt=""
                width={item.width}
                height={item.height}
                loading={i < 8 ? "eager" : "lazy"}
                decoding="async"
                className="h-auto w-full bg-ink-raised"
              />
            )}
            {item.credit && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent px-3 pt-8 pb-2.5 text-left text-[10px] uppercase tracking-[0.25em] text-ivory/90">
                {item.credit}
              </span>
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
