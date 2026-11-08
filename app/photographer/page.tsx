import type { Metadata } from "next";
import Link from "next/link";
import { isPhotographer, isPhotographerConfigured } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { listRows, rowToItem } from "@/lib/media";
import { ALBUMS, type Album } from "@/lib/gallery-types";
import { SiteNav } from "@/components/site-nav";
import { Uploader } from "@/components/uploader";
import { LoginForm } from "./login-form";
import { DeleteButton } from "./delete-button";
import { logout, removeMedia, toggleHidden } from "./actions";

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
  const rows = await listRows(album, { includeHidden: true });

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
                <a href={item.src} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden">
                  {row.type === "video" ? (
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
                  <div className="flex items-center justify-between">
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
