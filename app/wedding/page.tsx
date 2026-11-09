import type { Metadata } from "next";
import Link from "next/link";
import { getAlbum } from "@/lib/media";
import { currentOwnerHash } from "@/lib/guest";
import { DownloadMenu } from "@/components/download-menu";
import { SiteNav } from "@/components/site-nav";
import { AlbumHeader, mediaLabel } from "@/components/album-header";
import { WeddingGallery } from "@/components/wedding-gallery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Wedding" };

export default async function WeddingPage() {
  const media = await getAlbum("wedding", await currentOwnerHash());
  const photos = media.filter((m) => m.type !== "video").length;
  const videos = media.length - photos;
  const details = process.env.WEDDING_DETAILS; // e.g. "14 March 2027 · Somewhere lovely"

  return (
    <main className="mx-auto max-w-[1800px] px-4 pb-24 sm:px-8">
      <SiteNav current="/wedding" />
      <AlbumHeader eyebrow="The wedding of" details={details}>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          <span>{mediaLabel(photos, videos)}</span>
          {media.length > 0 && (
            <>
              <span aria-hidden className="text-champagne">·</span>
              <DownloadMenu album="wedding" photoCount={photos} videoCount={videos} />
            </>
          )}
        </div>
        <Link
          href="/upload"
          className="mt-8 border border-champagne/60 px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-ivory transition-colors hover:bg-champagne hover:text-ink"
        >
          Add your photos
        </Link>
      </AlbumHeader>

      {media.length === 0 ? (
        <p className="pt-8 text-center text-sm font-light tracking-wide text-ivory-dim">
          Nothing here yet — be the first to share a photo from the day.
        </p>
      ) : (
        <WeddingGallery media={media} />
      )}
    </main>
  );
}
