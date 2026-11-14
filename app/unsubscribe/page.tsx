import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { findByUnsubscribeToken } from "@/lib/notify";
import { confirmUnsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Email updates", robots: { index: false } };

/**
 * Asks before unsubscribing: link checkers in mail systems open every link
 * in an email, so a plain GET must never change anything.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token ?? "";
  const sub = token ? await findByUnsubscribeToken(token).catch(() => null) : null;

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 sm:px-8">
      <SiteNav />
      <header className="pt-16 pb-10 text-center sm:pt-20">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">Email updates</p>
        <h1 className="mt-5 font-display text-5xl font-light italic leading-tight">
          {sub?.unsubscribedAt ? "You're unsubscribed" : "Stop the emails?"}
        </h1>
        <div aria-hidden className="mx-auto mt-8 h-px w-24 bg-champagne/60" />
      </header>
      <div className="flex flex-col items-center gap-6 text-center text-sm font-light leading-relaxed text-ivory-dim">
        {!sub ? (
          <p>That link doesn&rsquo;t look right. It may have been copied only partly.</p>
        ) : sub.unsubscribedAt ? (
          <p>
            We won&rsquo;t email <span className="text-ivory">{sub.email}</span> about new photos any more.
            Leave your email again next time you upload if you change your mind.
          </p>
        ) : (
          <>
            <p>
              We&rsquo;ll stop emailing <span className="text-ivory">{sub.email}</span> when new photos are added.
            </p>
            <form action={confirmUnsubscribe}>
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="bg-champagne px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ink transition-opacity hover:opacity-90"
              >
                Unsubscribe
              </button>
            </form>
          </>
        )}
        <Link href="/wedding" className="text-champagne underline underline-offset-4">
          Back to the gallery
        </Link>
      </div>
    </main>
  );
}
