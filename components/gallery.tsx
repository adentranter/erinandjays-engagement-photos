"use client";

import { useCallback, useEffect, useState } from "react";
import { PHOTO_PARAM, type GalleryItem } from "@/lib/gallery-types";
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

  // Each open photo has its own URL (?photo=<id>): opening one pushes a
  // history entry so Back closes it, arrowing replaces it, and a pasted
  // link opens straight into that photo.
  const indexFromUrl = useCallback(() => {
    const id = new URLSearchParams(window.location.search).get(PHOTO_PARAM);
    const i = id ? media.findIndex((m) => m.id === id) : -1;
    return i >= 0 ? i : null;
  }, [media]);

  useEffect(() => {
    setOpenIndex(indexFromUrl());
    const onPop = () => setOpenIndex(indexFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [indexFromUrl]);

  const open = (i: number) => {
    setOpenIndex(i);
    window.history.pushState({ lightbox: true }, "", photoUrl(media[i].id));
  };
  const navigate = useCallback(
    (i: number) => {
      setOpenIndex(i);
      window.history.replaceState(window.history.state, "", photoUrl(media[i].id));
    },
    [media]
  );
  const close = useCallback(() => {
    setOpenIndex(null);
    if (window.history.state?.lightbox) window.history.back();
    else window.history.replaceState(window.history.state, "", photoUrl(null));
  }, []);

  return (
    <>
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
        {media.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => open(i)}
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
          onNavigate={navigate}
          onClose={close}
        />
      )}
    </>
  );
}

/** The current page's URL with ?photo= set to `id` (or removed). */
export function photoUrl(id: string | null): string {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PHOTO_PARAM, id);
  else url.searchParams.delete(PHOTO_PARAM);
  return url.pathname + url.search + url.hash;
}
