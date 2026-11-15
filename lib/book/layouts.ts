/**
 * Photo book page layouts, shared by the builder (browser preview) and the
 * print renderer (lib/book/render.ts), so what people see is what prints.
 *
 * A book is one layout per interior page plus a flat list of photo spots:
 * page 1's spots first, then page 2's, and so on, with "" for a spot not
 * filled yet. People fill spots one at a time; nothing is laid out for
 * them automatically.
 */

/** Position on the page as fractions of its width/height (0–1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutId = "full" | "framed" | "duo" | "trio" | "quad" | "blank";

export interface Layout {
  id: LayoutId;
  label: string;
  /** cover = fill the slot, cropping; contain = whole photo, letterboxed */
  fit: "cover" | "contain";
  /**
   * Slots for a portrait page. Landscape pages swap x/y so two-up layouts
   * sit side by side instead of stacked. Square pages use them as-is.
   */
  slots: Box[];
}

const M = 0.07; // outer margin (keeps faces clear of Prodigi's 10mm safe area)
const G = 0.02; // gutter between photos
const inner = 1 - 2 * M;
const half = (inner - G) / 2;

export const LAYOUTS: Record<LayoutId, Layout> = {
  full: { id: "full", label: "Full bleed", fit: "cover", slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  framed: { id: "framed", label: "Framed", fit: "contain", slots: [{ x: M, y: M, w: inner, h: inner }] },
  duo: {
    id: "duo",
    label: "Two",
    fit: "cover",
    slots: [
      { x: M, y: M, w: inner, h: half },
      { x: M, y: M + half + G, w: inner, h: half },
    ],
  },
  trio: {
    id: "trio",
    label: "Three",
    fit: "cover",
    slots: [
      { x: M, y: M, w: inner, h: inner * 0.6 },
      { x: M, y: M + inner * 0.6 + G, w: half, h: inner * 0.4 - G },
      { x: M + half + G, y: M + inner * 0.6 + G, w: half, h: inner * 0.4 - G },
    ],
  },
  quad: {
    id: "quad",
    label: "Four",
    fit: "cover",
    slots: [
      { x: M, y: M, w: half, h: half },
      { x: M + half + G, y: M, w: half, h: half },
      { x: M, y: M + half + G, w: half, h: half },
      { x: M + half + G, y: M + half + G, w: half, h: half },
    ],
  },
  blank: { id: "blank", label: "Blank", fit: "cover", slots: [] },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];

export function isLayoutId(v: string): v is LayoutId {
  return v in LAYOUTS;
}

/** Slots for a page of the given aspect (width / height). */
export function slotsFor(layout: LayoutId, pageAspect: number): Box[] {
  const slots = LAYOUTS[layout].slots;
  if (pageAspect <= 1.05) return slots;
  return slots.map((b) => ({ x: b.y, y: b.x, w: b.h, h: b.w }));
}

/** A book size we sell, printed by Prodigi in Australia. */
export interface BookFormat {
  /** Prodigi SKU — also what's saved on the book */
  sku: string;
  size: "A4" | "A5";
  orientation: "portrait" | "landscape";
  cover: "hardcover" | "softcover";
  widthMm: number;
  heightMm: number;
  /** Fewest interior pages the printer accepts */
  minPages: number;
  maxPages: number;
  label: string;
}

function format(
  sku: string,
  size: BookFormat["size"],
  orientation: BookFormat["orientation"],
  cover: BookFormat["cover"]
): BookFormat {
  const [long, short] = size === "A4" ? [297, 210] : [210, 148];
  const portrait = orientation === "portrait";
  return {
    sku,
    size,
    orientation,
    cover,
    widthMm: portrait ? short : long,
    heightMm: portrait ? long : short,
    minPages: 24,
    maxPages: 300,
    label: `${cover === "hardcover" ? "Hardcover" : "Softcover"} · ${size} ${orientation}`,
  };
}

/** Every size Prodigi prints and ships within Australia (checked Nov 2026). */
export const FORMATS: BookFormat[] = [
  format("BOOK-FE-A4-P-HARD-G", "A4", "portrait", "hardcover"),
  format("BOOK-FE-A4-L-HARD-G", "A4", "landscape", "hardcover"),
  format("BOOK-FE-A5-P-HARD-G", "A5", "portrait", "hardcover"),
  format("BOOK-FE-A5-L-HARD-G", "A5", "landscape", "hardcover"),
  format("BOOK-FE-A4-P-SOFT-G", "A4", "portrait", "softcover"),
  format("BOOK-FE-A5-P-SOFT-G", "A5", "portrait", "softcover"),
];

export function formatFor(sku: string | null | undefined): BookFormat | null {
  return FORMATS.find((f) => f.sku === sku) ?? null;
}

/* ------------------------------------------------------------------ */
/* Designs: a starting set of empty pages                              */
/* ------------------------------------------------------------------ */

export interface Design {
  id: string;
  name: string;
  blurb: string;
  pages: number;
  /** Repeated to fill the pages */
  pattern: LayoutId[];
}

export const DESIGNS: Design[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "One photo to a page, room to breathe",
    pages: 24,
    pattern: ["full", "framed", "full", "duo", "framed", "full"],
  },
  {
    id: "story",
    name: "Story",
    blurb: "A mix of big moments and small ones",
    pages: 40,
    pattern: ["full", "duo", "framed", "trio", "full", "quad", "framed", "duo"],
  },
  {
    id: "collection",
    name: "Collection",
    blurb: "Lots of photos, several to a page",
    pages: 60,
    pattern: ["quad", "full", "trio", "quad", "duo", "framed"],
  },
];

export function designLayouts(design: Design): LayoutId[] {
  return Array.from({ length: design.pages }, (_, i) => design.pattern[i % design.pattern.length]);
}

/** Photo spots a design gives, for "24 pages · 30 photos". */
export function designSpots(design: Design): number {
  return designLayouts(design).reduce((n, l) => n + LAYOUTS[l].slots.length, 0);
}

/* ------------------------------------------------------------------ */
/* Pages and spots                                                     */
/* ------------------------------------------------------------------ */

export interface Page {
  layout: LayoutId;
  /** One per slot, in slot order; "" is an empty spot */
  photos: string[];
}

const asLayout = (l: string): LayoutId => (isLayoutId(l) ? l : "framed");

/** Split the flat spot list into pages. Missing spots come back empty. */
export function pagesOf(layouts: string[], spots: string[]): Page[] {
  let i = 0;
  return layouts.map((raw) => {
    const layout = asLayout(raw);
    const n = LAYOUTS[layout].slots.length;
    const photos = Array.from({ length: n }, (_, k) => spots[i + k] ?? "");
    i += n;
    return { layout, photos };
  });
}

/** Back to the flat lists that get saved. */
export function flatten(pages: Page[]): { layouts: LayoutId[]; spots: string[] } {
  return { layouts: pages.map((p) => p.layout), spots: pages.flatMap((p) => p.photos) };
}

/**
 * Change one page's layout. Its photos stay in order; if the new layout has
 * fewer spots, the extras come off the page (they're still in the gallery).
 */
export function withLayout(pages: Page[], index: number, layout: LayoutId): Page[] {
  return pages.map((p, i) => {
    if (i !== index) return p;
    const n = LAYOUTS[layout].slots.length;
    const kept = p.photos.filter(Boolean);
    return { layout, photos: Array.from({ length: n }, (_, k) => kept[k] ?? "") };
  });
}

/**
 * New pages for a different design, carrying the photos already placed
 * across in order so switching design never loses work that fits.
 */
export function redesign(pages: Page[], layouts: LayoutId[]): Page[] {
  const placed = pages.flatMap((p) => p.photos).filter(Boolean);
  let i = 0;
  return layouts.map((layout) => {
    const n = LAYOUTS[layout].slots.length;
    const photos = Array.from({ length: n }, () => placed[i++] ?? "");
    return { layout, photos };
  });
}

/** How a photo of `aspect` sits in a slot of `slotAspect` (fractions of the slot). */
export function placeInSlot(
  aspect: number,
  slotAspect: number,
  fit: Layout["fit"]
): { x: number; y: number; w: number; h: number } {
  // For "contain": shrink to fit. For "cover" the renderer crops instead.
  if (fit === "cover") return { x: 0, y: 0, w: 1, h: 1 };
  if (aspect > slotAspect) {
    const h = slotAspect / aspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = aspect / slotAspect;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
