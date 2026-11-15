import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { getBook } from "@/lib/book/books";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ehrin & Jay — Your photo book", robots: { index: false } };

const STEPS = [
  { key: "paid", label: "Ordered" },
  { key: "submitted", label: "With the printer" },
  { key: "in_production", label: "Printing" },
  { key: "shipped", label: "On its way" },
] as const;

function stepIndex(status: string): number {
  if (status === "rendering" || status === "failed") return 0;
  return STEPS.findIndex((s) => s.key === status);
}

/**
 * Order status, linked from Stripe's success redirect and the emails.
 * The id is an unguessable uuid; the page shows no personal details.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const [{ id }, { paid }] = await Promise.all([params, searchParams]);
  const book = await getBook(id);
  if (!book) notFound();

  const justPaid = paid === "1";
  const waitingForStripe = book.status === "checkout" || book.status === "draft";
  const at = stepIndex(book.status);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 sm:px-8">
      <SiteNav current="/book" />
      {/* Stripe's webhook can land a moment after the redirect. */}
      {justPaid && waitingForStripe && <meta httpEquiv="refresh" content="3" />}
      <header className="pt-16 pb-10 text-center sm:pt-20">
        <p className="text-[11px] font-light uppercase tracking-[0.45em] text-ivory-dim">
          {justPaid ? "Thank you" : "Your photo book"}
        </p>
        <h1 className="mt-5 font-display text-5xl font-light italic leading-tight">
          {book.title || "Your photo book"}
        </h1>
        <div aria-hidden className="mx-auto mt-8 h-px w-24 bg-champagne/60" />
      </header>

      {waitingForStripe ? (
        <p className="text-center text-sm text-ivory-dim">
          {justPaid ? "Confirming your payment…" : "This book hasn't been ordered yet."}
        </p>
      ) : book.status === "cancelled" ? (
        <p className="text-center text-sm text-ivory-dim">This order was cancelled.</p>
      ) : (
        <>
          <ol className="flex justify-between gap-2">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex flex-1 flex-col items-center gap-3 text-center">
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 rounded-full ${i <= at ? "bg-champagne" : "border border-ivory/30"}`}
                />
                <span className={`text-[10px] uppercase tracking-[0.2em] ${i <= at ? "text-ivory" : "text-ivory-dim"}`}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-12 space-y-4 text-center text-sm font-light leading-relaxed text-ivory-dim">
            {book.status === "shipped" ? (
              book.trackingUrl ? (
                <p>
                  <a href={book.trackingUrl} className="text-champagne underline-offset-4 hover:underline">
                    Track your parcel
                  </a>
                  {book.trackingNumber && ` · ${book.trackingNumber}`}
                </p>
              ) : (
                <p>Your book has left the printer.</p>
              )
            ) : (
              <p>
                It&rsquo;s printed in Australia and usually ships within about a week. We&rsquo;ll email you
                tracking as soon as it&rsquo;s on its way.
              </p>
            )}
            {book.status === "failed" && (
              <p>There&rsquo;s a small hold-up sending it to the printer — we&rsquo;re on it.</p>
            )}
          </div>
        </>
      )}

      <p className="mt-16 text-center">
        <Link href="/book" className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim hover:text-champagne">
          Make another book
        </Link>
      </p>
    </main>
  );
}
