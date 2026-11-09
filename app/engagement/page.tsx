import type { Metadata } from "next";
import { getAlbum } from "@/lib/media";
import { Gallery } from "@/components/gallery";
import { DownloadMenu } from "@/components/download-menu";
import { SiteNav } from "@/components/site-nav";
import { AlbumHeader, Dot, mediaLabel } from "@/components/album-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Engagement" };

export default async function EngagementPage() {
  const media = await getAlbum("engagement");
  const photos = media.filter((m) => m.type !== "video").length;
  const videos = media.length - photos;

  return (
    <main className="mx-auto max-w-[1800px] px-4 pb-24 sm:px-8">
      <SiteNav current="/engagement" />
      <AlbumHeader
        eyebrow="The engagement of"
        details={
          <>
            28 June 2026
            <Dot />
            Queens Gardens — North Ward
          </>
        }
      >
        <div className="mt-6 flex items-center gap-6 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          <span>{mediaLabel(photos, videos)}</span>
          <span aria-hidden className="text-champagne">·</span>
          <DownloadMenu album="engagement" photoCount={photos} videoCount={videos} />
        </div>
      </AlbumHeader>

      {media.length === 0 ? (
        <p className="pt-16 text-center text-sm font-light tracking-wide text-ivory-dim">
          No photographs yet — add files to the photos folder and refresh.
        </p>
      ) : (
        <Gallery media={media} />
      )}
    </main>
  );
}
