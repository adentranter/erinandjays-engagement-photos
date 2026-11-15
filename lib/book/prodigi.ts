import "server-only";
import { bookConfig } from "./config";

/**
 * Prodigi print API (v4). Prodigi prints the book in its nearest lab
 * (Australia for AU addresses) and ships it straight to the customer; it
 * bills the card on our Prodigi account.
 *
 * Sandbox keys hit the sandbox, where orders are never printed or charged.
 * Set PRODIGI_ENV=live (with a live key) to place real orders.
 *
 * Things Prodigi's docs leave open, checked against the sandbox before go-live:
 *  - pageCount is the PDF's page count including the two cover pages.
 *  - The cover and interior go in one PDF ("default" print area); the spine
 *    is its own PDF ("spine" print area).
 */

const LIVE = "https://api.prodigi.com/v4.0";
const SANDBOX = "https://api.sandbox.prodigi.com/v4.0";

export class ProdigiError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const cfg = bookConfig();
  if (!cfg.prodigiKey) throw new ProdigiError("PRODIGI_API_KEY is not set");
  const res = await fetch(`${cfg.prodigiLive ? LIVE : SANDBOX}${path}`, {
    method,
    headers: { "X-API-Key": cfg.prodigiKey, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  if (!res.ok) {
    const detail = typeof json === "object" && json ? JSON.stringify(json).slice(0, 400) : text.slice(0, 400);
    throw new ProdigiError(`Prodigi ${method} ${path} failed (${res.status}): ${detail}`, res.status, json);
  }
  return json as T;
}

interface Cost {
  amount: string;
  currency: string;
}

function cents(cost: Cost | undefined | null): number {
  const n = Number(cost?.amount ?? 0);
  return Math.round((Number.isFinite(n) ? n : 0) * 100);
}

export interface Quote {
  totalCents: number;
  currency: string;
  shippingMethod: string;
  /** Lab country the book would be printed in */
  printedIn: string | null;
}

interface QuoteResponse {
  outcome: string;
  quotes?: Array<{
    shipmentMethod: string;
    costSummary: { items?: Cost; shipping?: Cost; totalTax?: Cost; totalCost?: Cost };
    shipments?: Array<{ fulfillmentLocation?: { countryCode?: string } }>;
  }>;
}

/** What Prodigi will charge us for one copy delivered within Australia. */
export async function quoteBook(pageCount: number): Promise<Quote> {
  const cfg = bookConfig();
  const res = await call<QuoteResponse>("POST", "/quotes", {
    shippingMethod: cfg.shippingMethod.toLowerCase(),
    destinationCountryCode: cfg.country,
    currencyCode: cfg.currency,
    items: [{ sku: cfg.sku, copies: 1, attributes: {}, assets: [{ printArea: "default", pageCount }] }],
  });
  const q = res.quotes?.[0];
  if (!q) throw new ProdigiError(`Prodigi returned no quote (${res.outcome})`);
  const s = q.costSummary;
  const totalCents = s.totalCost
    ? cents(s.totalCost)
    : cents(s.items) + cents(s.shipping) + cents(s.totalTax);
  const currency = (s.totalCost ?? s.items)?.currency ?? "";
  // Never charge a customer AUD for a quote in another currency.
  if (currency.toUpperCase() !== cfg.currency) {
    throw new ProdigiError(`Prodigi quoted in ${currency || "an unknown currency"}, expected ${cfg.currency}`);
  }
  if (totalCents <= 0) throw new ProdigiError("Prodigi quoted a zero total");
  return {
    totalCents,
    currency,
    shippingMethod: q.shipmentMethod,
    printedIn: q.shipments?.[0]?.fulfillmentLocation?.countryCode ?? null,
  };
}

/** Spine width for this many PDF pages, printed for an Australian address. */
export async function spineWidthMm(pageCount: number): Promise<number> {
  const cfg = bookConfig();
  const res = await call<{ success?: boolean; message?: string; spineInfo?: { widthMm?: number } }>(
    "POST",
    "/products/spine",
    { sku: cfg.sku, destinationCountryCode: cfg.country, state: "", numberOfPages: pageCount }
  );
  const w = Number(res.spineInfo?.widthMm);
  if (!Number.isFinite(w) || w <= 0) {
    throw new ProdigiError(`Prodigi returned no spine width: ${res.message ?? JSON.stringify(res).slice(0, 200)}`);
  }
  return w;
}

export interface OrderInput {
  bookId: string;
  pageCount: number;
  pdfUrl: string;
  spineUrl: string;
  callbackUrl: string | null;
  recipient: {
    name: string;
    email: string | null;
    phone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postcode: string;
    country: string;
  };
}

export interface ProdigiOrder {
  id: string;
  status?: {
    stage?: string;
    details?: Record<string, string>;
    issues?: Array<{ errorCode?: string; description?: string }>;
  };
  shipments?: Array<{
    id?: string;
    status?: string;
    tracking?: { url?: string | null; number?: string | null } | null;
    carrier?: { name?: string; service?: string } | null;
  }>;
}

/**
 * Place the order. The book id is the idempotency key, so retrying after a
 * timeout returns the order already placed instead of printing it twice.
 */
export async function createOrder(o: OrderInput): Promise<ProdigiOrder> {
  const cfg = bookConfig();
  const r = o.recipient;
  const res = await call<{ outcome: string; order?: ProdigiOrder }>("POST", "/orders", {
    merchantReference: o.bookId,
    idempotencyKey: o.bookId,
    shippingMethod: cfg.shippingMethod,
    ...(o.callbackUrl ? { callbackUrl: o.callbackUrl } : {}),
    recipient: {
      name: r.name,
      ...(r.email ? { email: r.email } : {}),
      ...(r.phone ? { phoneNumber: r.phone } : {}),
      address: {
        line1: r.line1,
        ...(r.line2 ? { line2: r.line2 } : {}),
        postalOrZipCode: r.postcode,
        countryCode: r.country,
        townOrCity: r.city,
        ...(r.state ? { stateOrCounty: r.state } : {}),
      },
    },
    items: [
      {
        merchantReference: o.bookId,
        sku: cfg.sku,
        copies: 1,
        sizing: "fillPrintArea",
        attributes: {},
        assets: [
          { printArea: "default", url: o.pdfUrl, pageCount: o.pageCount },
          { printArea: "spine", url: o.spineUrl },
        ],
      },
    ],
  });
  const outcome = res.outcome?.toLowerCase();
  if (!res.order?.id || !["created", "createdwithissues", "onhold", "alreadyexists"].includes(outcome)) {
    throw new ProdigiError(`Prodigi didn't create the order (${res.outcome})`, undefined, res);
  }
  return res.order;
}

export async function getOrder(id: string): Promise<ProdigiOrder> {
  const res = await call<{ order: ProdigiOrder }>("GET", `/orders/${encodeURIComponent(id)}`);
  return res.order;
}
