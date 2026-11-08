import type { ReactNode } from "react";

export function mediaLabel(photos: number, videos: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photograph${photos === 1 ? "" : "s"}`);
  if (videos > 0) parts.push(`${videos} video${videos === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "0 photographs";
}

export function AlbumHeader({
  eyebrow,
  details,
  children,
}: {
  eyebrow: string;
  details?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col items-center pt-16 pb-14 text-center sm:pt-24">
      <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
        {eyebrow}
      </p>
      <h1 className="mt-5 font-display text-6xl font-light italic leading-none sm:text-8xl">
        Ehrin <span className="not-italic text-champagne">&amp;</span> Jay
      </h1>
      <div aria-hidden className="mt-8 h-px w-24 bg-champagne/60" />
      {details && (
        <p className="mt-8 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          {details}
        </p>
      )}
      {children}
    </header>
  );
}

export function Dot() {
  return (
    <span aria-hidden className="mx-3 text-champagne">
      ·
    </span>
  );
}
