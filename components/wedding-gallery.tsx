"use client";

import { useMemo, useState } from "react";
import type { GalleryItem } from "@/lib/gallery-types";
import { Gallery } from "@/components/gallery";

type Filter = { kind: "all" } | { kind: "photographer" } | { kind: "guest"; name?: string };

export function WeddingGallery({ media }: { media: GalleryItem[] }) {
  const [filter, setFilter] = useState<Filter>({ kind: "all" });

  const guests = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of media) {
      if (m.credit) counts.set(m.credit, (counts.get(m.credit) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [media]);

  const pro = media.filter((m) => m.role === "photographer").length;
  const guestTotal = media.length - pro;

  const visible = media.filter((m) => {
    if (filter.kind === "photographer") return m.role === "photographer";
    if (filter.kind === "guest") {
      return m.role === "guest" && (!filter.name || m.credit === filter.name);
    }
    return true;
  });

  const tab = (active: boolean) =>
    `pb-1 transition-colors hover:text-champagne ${
      active ? "border-b border-champagne text-ivory" : ""
    }`;

  return (
    <>
      {pro > 0 && guestTotal > 0 && (
        <div className="mb-8 flex flex-col items-center gap-5">
          <div className="flex items-center gap-8 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            <button type="button" className={tab(filter.kind === "all")} onClick={() => setFilter({ kind: "all" })}>
              All
            </button>
            <button type="button" className={tab(filter.kind === "photographer")} onClick={() => setFilter({ kind: "photographer" })}>
              Photographer · {pro}
            </button>
            <button type="button" className={tab(filter.kind === "guest")} onClick={() => setFilter({ kind: "guest" })}>
              Guests · {guestTotal}
            </button>
          </div>
        </div>
      )}

      {(filter.kind === "guest" || pro === 0) && guests.length > 1 && (
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {guests.map(([name, count]) => {
            const active = filter.kind === "guest" && filter.name === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() =>
                  setFilter(active ? { kind: "guest" } : { kind: "guest", name })
                }
                className={`border px-3 py-1.5 text-[11px] tracking-[0.15em] transition-colors ${
                  active
                    ? "border-champagne bg-champagne/15 text-ivory"
                    : "border-champagne/25 text-ivory-dim hover:border-champagne/60 hover:text-ivory"
                }`}
              >
                {name} <span className="text-champagne/80">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Remount on filter change so the lightbox indexes the filtered set */}
      <Gallery key={JSON.stringify(filter)} media={visible} />
    </>
  );
}
