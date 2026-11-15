import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { BookBuilder, type BuilderPhoto, type SavedBook } from "@/components/book/builder";
import { currentOwnerHash } from "@/lib/guest";
import { getCoverIds } from "@/lib/albums";
import { bookablePhotos, getDraft, listOrders } from "@/lib/book/books";
import { bookConfig } from "@/lib/book/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Make a photo book" };

/** How many photos a fresh book starts with. */
const STARTER_PHOTOS = 40;

export default async function BookPage() {
  const ownerHash = await currentOwnerHash();
  const [photos, draft, orders, covers] = await Promise.all([
    bookablePhotos().catch(() => []),
    getDraft(ownerHash).catch(() => null),
    listOrders(ownerHash).catch(() => []),
    getCoverIds(),
  ]);
  const cfg = bookConfig();

  const builderPhotos: BuilderPhoto[] = photos.map((p) => ({
    id: p.id,
    album: p.album,
    thumb: p.thumb,
    large: p.large,
    aspect: p.aspect,
    credit: p.credit,
  }));

  // A fresh book starts finished: the photographer's wedding set (or
  // whatever there is), the album cover, and the couple's names.
  const ids = new Set(photos.map((p) => p.id));
  const starter = (
    photos.some((p) => p.album === "wedding" && p.byPhotographer)
      ? photos.filter((p) => p.album === "wedding" && p.byPhotographer)
      : photos.some((p) => p.byPhotographer)
        ? photos.filter((p) => p.byPhotographer)
        : photos
  )
    .slice(0, STARTER_PHOTOS)
    .map((p) => p.id);
  const starterCover = [covers.wedding, covers.engagement].find((c) => c && ids.has(c)) ?? starter[0] ?? null;

  const saved: SavedBook | null = draft
    ? {
        id: draft.id,
        title: draft.title,
        subtitle: draft.subtitle,
        photoIds: draft.photoIds.filter((id) => ids.has(id)),
        layouts: draft.layouts,
        coverId: draft.coverId,
      }
    : null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-48 sm:px-8">
      <SiteNav current="/book" />
      <header className="pt-12 pb-8 text-center sm:pt-16">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">Keep it forever</p>
        <h1 className="mt-4 font-display text-5xl font-light italic leading-tight sm:text-6xl">Make a photo book</h1>
        <div aria-hidden className="mx-auto mt-6 h-px w-24 bg-champagne/60" />
        <p className="mx-auto mt-6 max-w-md text-sm font-light leading-relaxed text-ivory-dim">
          We&rsquo;ve laid one out for you. Tap any photo to swap or remove it, change a page&rsquo;s
          layout, or add more from the galleries — it saves as you go.
        </p>
        {orders.length > 0 && (
          <p className="mt-6 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            Your orders:{" "}
            {orders.map((o, i) => (
              <span key={o.id}>
                {i > 0 && " · "}
                <Link href={`/book/${o.id}`} className="text-champagne hover:text-ivory">
                  {o.title || "Photo book"}
                </Link>
              </span>
            ))}
          </p>
        )}
      </header>

      {photos.length === 0 ? (
        <p className="text-center text-sm text-ivory-dim">
          There are no photos in the galleries yet — come back once some have been added.
        </p>
      ) : (
        <BookBuilder
          photos={builderPhotos}
          format={cfg.format}
          saved={saved}
          starter={{
            title: "Ehrin & Jay",
            subtitle: process.env.WEDDING_DETAILS?.trim() ?? "",
            photoIds: starter,
            coverId: starterCover,
          }}
          canPrice={Boolean(cfg.prodigiKey)}
          canOrder={cfg.missing.length === 0}
        />
      )}
    </main>
  );
}
