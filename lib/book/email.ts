import "server-only";
import { Resend } from "resend";
import type { PhotoBook } from "@prisma/client";
import { emailConfig } from "@/lib/notify";

/** Order emails to the customer. Skipped quietly if email isn't set up. */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function money(cents: number | null, currency: string): string {
  if (cents == null) return "";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

function wrap(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#16130f;font-family:Georgia,'Times New Roman',serif">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px;color:#f2ede4;text-align:center">
    <p style="font-size:11px;letter-spacing:.4em;text-transform:uppercase;color:#a89f90;margin:0">Ehrin &amp; Jay</p>
    <h1 style="font-weight:300;font-style:italic;font-size:34px;margin:18px 0 28px">${heading}</h1>
    <div style="height:1px;width:72px;background:#c9a96a;margin:0 auto 28px"></div>
    <div style="font-size:15px;line-height:1.7;color:#d8d0c2">${body}</div>
  </div></body></html>`;
}

async function send(book: PhotoBook, subject: string, html: string): Promise<void> {
  const cfg = emailConfig();
  if (cfg.missing.length || !book.customerEmail) return;
  const { error } = await new Resend(cfg.apiKey!).emails.send({
    from: cfg.from!,
    to: book.customerEmail,
    replyTo: cfg.replyTo,
    subject,
    html,
  });
  if (error) console.error(`[book] email to ${book.id} failed:`, error.message);
}

function statusLink(book: PhotoBook): string {
  const site = emailConfig().siteUrl;
  return site ? `<p style="margin-top:28px"><a href="${esc(`${site}/book/${book.id}`)}" style="color:#c9a96a">See your order</a></p>` : "";
}

export async function emailOrderPlaced(book: PhotoBook): Promise<void> {
  const title = book.title.trim() || "your photo book";
  await send(
    book,
    `Your photo book is being made`,
    wrap(
      "Thank you",
      `<p>We&rsquo;ve sent <em>${esc(title)}</em> to the printer${
        book.priceCents != null ? ` (${esc(money(book.priceCents, book.currency))} paid)` : ""
      }. It&rsquo;s printed in Australia and usually ships within about a week — we&rsquo;ll email you the tracking as soon as it&rsquo;s on its way.</p>${statusLink(book)}`
    )
  );
}

export async function emailShipped(book: PhotoBook): Promise<void> {
  const track = book.trackingUrl
    ? `<p><a href="${esc(book.trackingUrl)}" style="color:#c9a96a">Track your parcel</a>${
        book.trackingNumber ? ` · ${esc(book.trackingNumber)}` : ""
      }</p>`
    : book.trackingNumber
      ? `<p>Tracking number: ${esc(book.trackingNumber)}</p>`
      : "";
  await send(
    book,
    `Your photo book is on its way`,
    wrap("On its way", `<p>Your photo book has left the printer.</p>${track}${statusLink(book)}`)
  );
}
