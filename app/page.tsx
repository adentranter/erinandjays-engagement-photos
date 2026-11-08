import Link from "next/link";
import { getAlbum } from "@/lib/media";
import { getCoverIds, pickCover } from "@/lib/albums";
import type { GalleryItem } from "@/lib/gallery-types";

export const dynamic = "force-dynamic";

function AlbumCard({
  href,
  title,
  subtitle,
  item,
  count,
}: {
  href: string;
  title: string;
  subtitle: string;
  item?: GalleryItem;
  count: number;
}) {
  return (
    <Link href={href} className="tile group block bg-ink-raised">
      <div className="relative aspect-[4/5] w-full overflow-hidden">
        {item ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumb}
            alt=""
            className="h-full w-full object-cover opacity-80 group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-2xl italic text-ivory-dim">
            Coming soon
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-[11px] uppercase tracking-[0.45em] text-ivory-dim">
            {subtitle}
          </p>
          <h2 className="font-display text-5xl font-light italic">{title}</h2>
          <p className="text-[11px] uppercase tracking-[0.3em] text-champagne">
            {count > 0 ? `${count} to see` : "Gallery"}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  const [wedding, engagement, covers] = await Promise.all([
    getAlbum("wedding"),
    getAlbum("engagement"),
    getCoverIds(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-8">
      <header className="flex flex-col items-center pt-20 pb-14 text-center sm:pt-28">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
          The photographs of
        </p>
        <h1 className="mt-5 font-display text-6xl font-light italic leading-none sm:text-8xl">
          Ehrin <span className="not-italic text-champagne">&amp;</span> Jay
        </h1>
        <div aria-hidden className="mt-8 h-px w-24 bg-champagne/60" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <AlbumCard
          href="/wedding"
          title="Wedding"
          subtitle="The day itself"
          item={pickCover(wedding, covers.wedding)}
          count={wedding.length}
        />
        <AlbumCard
          href="/engagement"
          title="Engagement"
          subtitle="28 June 2026"
          item={pickCover(engagement, covers.engagement)}
          count={engagement.length}
        />
      </div>

      <div className="mt-16 flex flex-col items-center gap-4 text-center">
        <p className="font-display text-2xl font-light italic">
          Took some photos on the day?
        </p>
        <Link
          href="/upload"
          className="border border-champagne/60 px-6 py-3 text-[11px] uppercase tracking-[0.35em] text-ivory transition-colors hover:bg-champagne hover:text-ink"
        >
          Share them with us
        </Link>
      </div>
    </main>
  );
}
