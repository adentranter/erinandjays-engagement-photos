import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { Uploader } from "@/components/uploader";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Share your photos" };

export default function UploadPage() {
  const requireCode = Boolean(process.env.GUEST_UPLOAD_CODE?.trim());

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
      <Uploader mode="guest" requireCode={requireCode} />
    </main>
  );
}
