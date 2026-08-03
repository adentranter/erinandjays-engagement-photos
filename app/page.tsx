import { getMedia } from "@/lib/photos";
import { Gallery } from "@/components/gallery";
import { DownloadMenu } from "@/components/download-menu";

export const dynamic = "force-dynamic";

function mediaLabel(photos: number, videos: number): string {
  const parts: string[] = [];
  if (photos > 0) {
    parts.push(`${photos} photograph${photos === 1 ? "" : "s"}`);
  }
  if (videos > 0) {
    parts.push(`${videos} video${videos === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "0 photographs";
  return parts.join(" · ");
}

export default async function Home() {
  const media = await getMedia();
  const photos = media.filter((m) => m.type === "image").length;
  const videos = media.filter((m) => m.type === "video").length;

  return (
    <main className="mx-auto max-w-[1800px] px-4 pb-24 sm:px-8">
      <header className="flex flex-col items-center pt-20 pb-14 text-center sm:pt-28">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
          The engagement of
        </p>
        <h1 className="mt-5 font-display text-6xl font-light italic leading-none sm:text-8xl">
          Erin <span className="not-italic text-champagne">&amp;</span> Jay
        </h1>
        <div
          aria-hidden
          className="mt-8 h-px w-24 bg-champagne/60"
        />
        <p className="mt-8 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          28 June 2026
          <span aria-hidden className="mx-3 text-champagne">
            ·
          </span>
          Queens Gardens — North Ward
        </p>
        <div className="mt-6 flex items-center gap-6 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          <span>{mediaLabel(photos, videos)}</span>
          <span aria-hidden className="text-champagne">
            ·
          </span>
          <DownloadMenu photoCount={photos} videoCount={videos} />
        </div>
      </header>

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
