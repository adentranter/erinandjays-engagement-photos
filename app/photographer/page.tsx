import type { Metadata } from "next";
import Link from "next/link";
import { isPhotographer, isPhotographerConfigured } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { getAlbum, listRows, rowToItem, type MediaRow } from "@/lib/media";
import { coverCandidates, getCoverIds, pickCover } from "@/lib/albums";
import { ALBUMS, type Album } from "@/lib/gallery-types";
import { SiteNav } from "@/components/site-nav";
import { Uploader } from "@/components/uploader";
import { LoginForm } from "./login-form";
import { DeleteButton } from "./delete-button";
import { EmailUpdates } from "./email-updates";
import {
  chooseCover,
  logout,
  removeMedia,
  retryMedia,
  rotateMedia,
  toggleHidden,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Photographer" };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-8">
      <SiteNav />
      <header className="pt-16 pb-10 text-center">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
          For the photographer
        </p>
        <h1 className="mt-5 font-display text-5xl font-light italic">
          Studio
        </h1>
        <div aria-hidden className="mx-auto mt-8 h-px w-24 bg-champagne/60" />
      </header>
      {children}
    </main>
  );
}

export default async function PhotographerPage({
  searchParams,
}: {
  searchParams: Promise<{ album?: string }>;
}) {
  if (!isPhotographerConfigured() || !hasDatabase()) {
    return (
      <Shell>
        <p className="text-center text-sm text-ivory-dim">
          Set <code>PHOTOGRAPHER_PASSWORD</code>, <code>DATABASE_URL</code> and{" "}
          <code>UPLOADTHING_TOKEN</code> to enable uploads.
        </p>
      </Shell>
    );
  }

  if (!(await isPhotographer())) {
    return (
      <Shell>
        <div className="mx-auto max-w-sm">
          <LoginForm />
        </div>
      </Shell>
    );
  }

  const raw = (await searchParams).album;
  const album: Album = (ALBUMS as readonly string[]).includes(raw ?? "")
    ? (raw as Album)
    : "wedding";
  const [rows, visible, covers] = await Promise.all([
    listRows(album, { includeHidden: true }),
    getAlbum(album),
    getCoverIds(),
  ]);
  const candidates = coverCandidates(visible);
  const chosenId = covers[album];
  const cover = pickCover(visible, chosenId);

  return (
    <Shell>
      <div className="mb-10 flex items-center justify-center gap-8 text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
        {ALBUMS.map((a) => (
          <Link
            key={a}
            href={`/photographer?album=${a}`}
            className={`pb-1 hover:text-champagne ${
              a === album ? "border-b border-champagne text-ivory" : ""
            }`}
          >
            {a}
          </Link>
        ))}
        <form action={logout}>
          <button type="submit" className="hover:text-champagne">
            Sign out
          </button>
        </form>
      </div>

      <section className="mx-auto max-w-xl">
        <h2 className="mb-6 text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          Upload to the {album} gallery
        </h2>
        <Uploader key={album} mode="photographer" album={album} />
      </section>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="mb-6 text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          Album cover
        </h2>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
          <div className="aspect-[4/5] w-40 shrink-0 overflow-hidden bg-ink-raised">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover.thumb} alt="Current cover" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
                No photos yet
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 text-center text-sm font-light text-ivory-dim sm:text-left">
            <p>
              This is the picture on the {album} card on the home page.{" "}
              {chosenId && cover?.id === chosenId
                ? "You chose it."
                : "It's picked automatically until you choose one."}
            </p>
            {chosenId && (
              <form action={chooseCover}>
                <input type="hidden" name="album" value={album} />
                <input type="hidden" name="coverId" value="" />
                <button
                  type="submit"
                  className="text-[11px] uppercase tracking-[0.3em] underline decoration-champagne/40 underline-offset-4 hover:text-champagne"
                >
                  Go back to automatic
                </button>
              </form>
            )}
          </div>
        </div>
        {candidates.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-center text-[11px] uppercase tracking-[0.3em] text-champagne">
              Choose a different cover ({candidates.length})
            </summary>
            <ul className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
              {candidates.map((item) => {
                const current = item.id === cover?.id;
                return (
                  <li key={item.id}>
                    <form action={chooseCover}>
                      <input type="hidden" name="album" value={album} />
                      <input type="hidden" name="coverId" value={item.id} />
                      <button
                        type="submit"
                        aria-label={current ? "Current cover" : "Use as cover"}
                        aria-pressed={current}
                        className={`block aspect-[4/5] w-full overflow-hidden bg-ink-raised outline-offset-2 ${
                          current ? "outline outline-2 outline-champagne" : "opacity-80 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </section>

      <EmailUpdates />

      <section className="mt-20">
        <h2 className="mb-6 text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          {rows.length} uploaded file{rows.length === 1 ? "" : "s"}
          {album === "engagement" && " (plus the ones built into the site)"}
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((row) => {
            const item = rowToItem(row);
            return (
              <li
                key={row.id}
                className={`flex flex-col bg-ink-raised ${row.hidden ? "opacity-40" : ""}`}
              >
                <a href={item.src} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden">
                  <StatusBadge row={row} />
                  {row.type === "video" && !row.thumbUrl ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={`${item.src}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </a>
                <div className="flex flex-col gap-2 p-3 text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
                  <span className="truncate text-ivory">
                    {row.role === "guest" ? row.uploaderName : "Photographer"}
                  </span>
                  {row.status === "failed" && row.error && (
                    <span className="normal-case tracking-normal text-[#e8a598]" title={row.error}>
                      {row.error.length > 80 ? `${row.error.slice(0, 80)}…` : row.error}
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {row.status === "failed" ? (
                      <form action={retryMedia}>
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="text-champagne hover:text-ivory">
                          Retry
                        </button>
                      </form>
                    ) : (
                      <form action={rotateMedia}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          className="hover:text-champagne disabled:opacity-40"
                          disabled={row.status === "processing"}
                          title="Turn 90° clockwise"
                        >
                          Rotate
                        </button>
                      </form>
                    )}
                    <form action={toggleHidden}>
                      <input type="hidden" name="id" value={row.id} />
                      <input type="hidden" name="hidden" value={String(!row.hidden)} />
                      <button type="submit" className="hover:text-champagne">
                        {row.hidden ? "Show" : "Hide"}
                      </button>
                    </form>
                    <form action={removeMedia}>
                      <input type="hidden" name="id" value={row.id} />
                      <DeleteButton />
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}

function StatusBadge({ row }: { row: MediaRow }) {
  const label =
    row.status === "pending" || row.status === "uploading"
      ? "Queued"
      : row.status === "processing"
        ? "Processing"
        : row.status === "failed"
          ? "Failed"
          : row.type === "animation"
            ? row.motionSource === "live_photo"
              ? "Live"
              : row.motionSource === "motion_photo"
                ? "Motion"
                : "GIF"
            : null;
  if (!label) return null;
  return (
    <span
      className={`absolute top-2 left-2 z-10 px-2 py-1 text-[9px] uppercase tracking-[0.2em] ${
        row.status === "failed" ? "bg-[#7a2e24] text-ivory" : "bg-ink/75 text-ivory"
      }`}
    >
      {label}
    </span>
  );
}
