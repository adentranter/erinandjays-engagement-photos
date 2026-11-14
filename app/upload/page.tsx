import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { Uploader } from "@/components/uploader";
import { MyUploadActions } from "@/components/my-upload-actions";
import { currentOwnerHash } from "@/lib/guest";
import { listOwned } from "@/lib/media";
import { emailConfig, getSettings } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Share your photos" };

export default async function UploadPage() {
  const requireCode = Boolean(process.env.GUEST_UPLOAD_CODE?.trim());
  const mine = await listOwned(await currentOwnerHash()).catch(() => []);
  const settings = await getSettings().catch(() => null);
  const offerEmail = Boolean(settings?.enabled && settings.emailGuests && !emailConfig().missing.length);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 sm:px-8">
      <SiteNav current="/upload" />
      <header className="pt-16 pb-10 text-center sm:pt-20">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
          Were you there?
        </p>
        <h1 className="mt-5 font-display text-5xl font-light italic leading-tight sm:text-6xl">
          Share your photos
        </h1>
        <div aria-hidden className="mx-auto mt-8 h-px w-24 bg-champagne/60" />
        <p className="mt-8 text-sm font-light leading-relaxed text-ivory-dim">
          Add the moments you caught on the day. They&rsquo;ll appear in the
          wedding gallery with your name on them.
        </p>
      </header>
      <Uploader mode="guest" requireCode={requireCode} offerEmail={offerEmail} />

      {mine.length > 0 && (
        <section className="mt-20">
          <h2 className="text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            Your uploads · {mine.length}
          </h2>
          <p className="mt-3 text-center text-sm font-light text-ivory-dim">
            Shared from this phone or browser. Turn or remove anything here.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {mine.map((row) => {
              const working = row.status === "pending" || row.status === "processing";
              return (
                <li key={row.id} className="flex flex-col bg-ink-raised">
                  <div className="relative aspect-square overflow-hidden">
                    {row.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
                        {row.status === "failed" ? "Couldn't process" : "Processing…"}
                      </span>
                    )}
                    {row.thumbUrl && working && (
                      <span className="absolute top-2 left-2 bg-ink/75 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-ivory">
                        Updating…
                      </span>
                    )}
                  </div>
                  <MyUploadActions
                    id={row.id}
                    busy={working}
                    className="justify-between p-3 text-[10px] uppercase tracking-[0.2em] text-ivory-dim"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
