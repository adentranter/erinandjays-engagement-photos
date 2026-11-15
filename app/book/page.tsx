import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { BookBuilder, type BuilderPhoto, type SavedBook } from "@/components/book/builder";
import { currentOwnerHash } from "@/lib/guest";
import { bookablePhotos, getDraft, listOrders, startingPrices } from "@/lib/book/books";
import { bookConfig } from "@/lib/book/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Make a photo book" };

export default async function BookPage() {
  const ownerHash = await currentOwnerHash();
  const [photos, draft, orders, prices] = await Promise.all([
    bookablePhotos().catch(() => []),
    getDraft(ownerHash).catch(() => null),
    listOrders(ownerHash).catch(() => []),
    startingPrices().catch(() => ({})),
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

  const saved: SavedBook | null = draft
    ? {
        id: draft.id,
        sku: draft.sku,
        title: draft.title,
        subtitle: draft.subtitle,
        photoIds: draft.photoIds,
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
          Pick a size and a design, then tap each empty spot to choose its photo. Change any
          page&rsquo;s layout as you go — it saves automatically.
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
          saved={saved}
          defaults={{ title: "Ehrin & Jay", subtitle: process.env.WEDDING_DETAILS?.trim() ?? "" }}
          prices={prices}
          canPrice={Boolean(cfg.prodigiKey)}
          canOrder={cfg.missing.length === 0}
        />
      )}
    </main>
  );
}
