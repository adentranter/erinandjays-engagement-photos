import { listAllOrders } from "@/lib/book/books";
import { retryBookAction } from "./actions";

const LABEL: Record<string, string> = {
  paid: "Paid — queued",
  rendering: "Making print file",
  submitted: "With Prodigi",
  in_production: "Printing",
  shipped: "Shipped",
  cancelled: "Cancelled",
  failed: "Needs attention",
};

const money = (cents: number | null, currency: string) =>
  cents == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** Paid photo books, with a retry for any the worker couldn't place. */
export async function BookOrders() {
  const orders = await listAllOrders().catch(() => []);
  if (!orders.length) return null;
  return (
    <section className="mx-auto mt-20 max-w-3xl">
      <h2 className="text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
        Photo book orders · {orders.length}
      </h2>
      <ul className="mt-6 divide-y divide-ivory/10 border-y border-ivory/10 text-sm">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <a href={`/book/${o.id}`} className="font-display text-lg italic text-ivory hover:text-champagne">
              {o.title || "Photo book"}
            </a>
            <span className="text-ivory-dim">{o.customerName ?? "—"}</span>
            <span className="text-ivory-dim">
              {money(o.priceCents, o.currency)} paid · {money(o.costCents, o.currency)} cost
            </span>
            <span className={`ml-auto text-[11px] uppercase tracking-[0.2em] ${o.status === "failed" ? "text-red-300" : "text-champagne"}`}>
              {LABEL[o.status] ?? o.status}
            </span>
            {o.pdfUrl && (
              <a href={o.pdfUrl} className="text-[11px] uppercase tracking-[0.2em] text-ivory-dim hover:text-ivory">
                PDF
              </a>
            )}
            {o.status === "failed" && (
              <form action={retryBookAction}>
                <input type="hidden" name="id" value={o.id} />
                <button className="text-[11px] uppercase tracking-[0.2em] text-ivory underline-offset-4 hover:underline">
                  Retry
                </button>
              </form>
            )}
            {o.error && <p className="w-full text-xs text-ivory-dim">{o.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
