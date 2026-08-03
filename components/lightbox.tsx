"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MediaItem } from "@/lib/photos";

interface LightboxProps {
  media: MediaItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

const largeUrl = (name: string) =>
  `/api/photo/${encodeURIComponent(name)}?size=large`;

const videoUrl = (name: string) =>
  `/api/photo/${encodeURIComponent(name)}`;

export function Lightbox({ media, index, onNavigate, onClose }: LightboxProps) {
  const item = media[index];
  const touchStartX = useRef<number | null>(null);

  const prev = useCallback(
    () => onNavigate((index - 1 + media.length) % media.length),
    [index, media.length, onNavigate]
  );
  const next = useCallback(
    () => onNavigate((index + 1) % media.length),
    [index, media.length, onNavigate]
  );

  // Keyboard navigation + scroll lock
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [prev, next, onClose]);

  // Preload neighbouring images so arrowing feels instant
  useEffect(() => {
    [index - 1, index + 1].forEach((i) => {
      const neighbour = media[(i + media.length) % media.length];
      if (neighbour?.type === "image") {
        new Image().src = largeUrl(neighbour.name);
      }
    });
  }, [index, media]);

  const label =
    item.type === "video"
      ? `Video ${index + 1} of ${media.length}`
      : `Photograph ${index + 1} of ${media.length}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex flex-col bg-ink/97 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={(e) => (touchStartX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        if (Math.abs(dx) > 48) (dx > 0 ? prev : next)();
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5 py-4 text-[11px] uppercase tracking-[0.3em] text-ivory-dim"
        onClick={(e) => e.stopPropagation()}
      >
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(media.length).padStart(2, "0")}
        </span>
        <div className="flex items-center gap-6">
          <a
            href={`/api/photo/${encodeURIComponent(item.name)}?size=original`}
            download
            className="text-ivory transition-colors hover:text-champagne"
          >
            Download
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ivory transition-colors hover:text-champagne"
          >
            Close
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-16">
        {item.type === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={item.name}
            src={videoUrl(item.name)}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={item.name}
            src={largeUrl(item.name)}
            alt={`Photograph ${index + 1}`}
            className="max-h-full max-w-full object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        <NavButton side="left" label="Previous" onActivate={prev} />
        <NavButton side="right" label="Next" onActivate={next} />
      </div>
    </div>
  );
}

function NavButton({
  side,
  label,
  onActivate,
}: {
  side: "left" | "right";
  label: string;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      className={`absolute top-1/2 hidden -translate-y-1/2 p-4 font-display text-4xl font-light text-ivory-dim transition-colors hover:text-champagne sm:block ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {side === "left" ? "\u2190" : "\u2192"}
    </button>
  );
}
