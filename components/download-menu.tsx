"use client";

import { useEffect, useId, useRef, useState } from "react";

interface DownloadMenuProps {
  photoCount: number;
  videoCount: number;
}

const OPTIONS = [
  {
    kind: "all",
    label: "All",
    href: "/api/download?kind=all",
    describe: (p: number, v: number) =>
      `${p + v} file${p + v === 1 ? "" : "s"}`,
    when: (p: number, v: number) => p > 0 || v > 0,
  },
  {
    kind: "photos",
    label: "Just photos",
    href: "/api/download?kind=photos",
    describe: (p: number) => `${p} photograph${p === 1 ? "" : "s"}`,
    when: (p: number) => p > 0,
  },
  {
    kind: "video",
    label: "Video",
    href: "/api/download?kind=video",
    describe: (_p: number, v: number) => `${v} video${v === 1 ? "" : "s"}`,
    when: (_p: number, v: number) => v > 0,
  },
] as const;

export function DownloadMenu({
  photoCount,
  videoCount,
}: Readonly<DownloadMenuProps>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = OPTIONS.filter((o) => o.when(photoCount, videoCount));
  if (options.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-ivory underline decoration-champagne/60 underline-offset-4 transition-colors hover:text-champagne"
      >
        Download all
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          aria-hidden
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2.5 4.5 L6 8 L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Download options"
          className="absolute left-1/2 top-full z-20 mt-3 w-52 -translate-x-1/2 border border-champagne/25 bg-ink-raised py-2 text-left shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
        >
          {options.map((option) => (
            <a
              key={option.kind}
              role="menuitem"
              href={option.href}
              onClick={() => setOpen(false)}
              className="flex flex-col gap-0.5 px-4 py-2.5 text-ivory transition-colors hover:bg-champagne/10 hover:text-champagne"
            >
              <span className="text-[11px] uppercase tracking-[0.28em]">
                {option.label}
              </span>
              <span className="text-[10px] font-light normal-case tracking-wide text-ivory-dim">
                {option.describe(photoCount, videoCount)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
