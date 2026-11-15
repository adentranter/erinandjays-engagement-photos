/**
 * Photo book page layouts, shared by the builder (browser preview) and the
 * print renderer (lib/book/render.ts), so what people see is what prints.
 *
 * A book is an ordered list of photo ids plus one layout name per interior
 * page. Photos flow through the pages in order, each page taking as many
 * photos as its layout has slots. Changing one page's layout re-flows the
 * pages after it (see `relayoutFrom`).
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

/** Page size and limits for the book being sold (from lib/book/config.ts). */
export interface BookFormat {
  label: string;
  widthMm: number;
  heightMm: number;
  /** Fewest interior pages the printer accepts */
  minPages: number;
  maxPages: number;
}

export interface PhotoShape {
  id: string;
  /** width / height; 1.5 when unknown */
  aspect: number;
}

export interface Page {
  layout: LayoutId;
  /** One per filled slot, in slot order */
  photos: string[];
}

/** Lay the photos into pages using `layouts`, adding pages if they run out. */
export function flow(photos: PhotoShape[], layouts: string[], format: BookFormat): Page[] {
  const pages: Page[] = [];
  let i = 0;
  for (const raw of layouts) {
    const layout = isLayoutId(raw) ? raw : "framed";
    const n = LAYOUTS[layout].slots.length;
    pages.push({ layout, photos: photos.slice(i, i + n).map((p) => p.id) });
    i += n;
  }
  if (i < photos.length) {
    const extra = autoLayouts(photos.slice(i), format);
    return flow(photos, [...layouts.filter(isLayoutId), ...extra], format);
  }
  return pages;
}

/**
 * Pick layouts for these photos: photos that match the page's shape get a
 * full-bleed page, photos of the other shape pair up, and every sixth page
 * is a four-up to keep it moving.
 */
export function autoLayouts(photos: PhotoShape[], format: BookFormat): LayoutId[] {
  const pageAspect = format.widthMm / format.heightMm;
  const portraitPage = pageAspect < 0.95;
  const landscapePage = pageAspect > 1.05;
  const out: LayoutId[] = [];
  let i = 0;
  while (i < photos.length) {
    const left = photos.length - i;
    const p = photos[i];
    const tall = p.aspect < 0.95;
    const wide = p.aspect > 1.05;
    const nextWide = i + 1 < photos.length && photos[i + 1].aspect > 1.05;

    if (out.length % 6 === 5 && left >= 4) {
      out.push("quad");
      i += 4;
    } else if (wide && nextWide && portraitPage) {
      out.push("duo");
      i += 2;
    } else if (tall && i + 1 < photos.length && photos[i + 1].aspect < 0.95 && landscapePage) {
      out.push("duo");
      i += 2;
    } else if ((tall && portraitPage) || (wide && landscapePage)) {
      out.push("full");
      i += 1;
    } else {
      out.push("framed");
      i += 1;
    }
  }
  return out;
}

/** Split multi-photo pages until there are `min` pages (or nothing to split). */
export function stretch(layouts: LayoutId[], min: number): LayoutId[] {
  const out = [...layouts];
  while (out.length < min) {
    const at = out.findIndex((l) => LAYOUTS[l].slots.length > 1);
    if (at < 0) break;
    const n = LAYOUTS[out[at]].slots.length;
    out.splice(at, 1, ...Array<LayoutId>(n).fill("framed"));
  }
  return out;
}

/** Pad with blank pages to the minimum and to an even count. */
export function pad(layouts: LayoutId[], format: BookFormat): LayoutId[] {
  const out = [...layouts];
  while (out.length < format.minPages || out.length % 2 !== 0) out.push("blank");
  return out;
}

/** Fresh layout for a whole book. */
export function layoutBook(photos: PhotoShape[], format: BookFormat): LayoutId[] {
  return pad(stretch(autoLayouts(photos, format), format.minPages), format);
}

/**
 * Change page `index` to `layout` and re-flow every page after it,
 * keeping the pages before it untouched.
 */
export function relayoutFrom(
  photos: PhotoShape[],
  layouts: string[],
  index: number,
  layout: LayoutId,
  format: BookFormat
): LayoutId[] {
  const before = layouts.slice(0, index).map((l) => (isLayoutId(l) ? l : "framed"));
  const used = before.reduce((n, l) => n + LAYOUTS[l].slots.length, 0) + LAYOUTS[layout].slots.length;
  const rest = autoLayouts(photos.slice(used), format);
  return pad([...before, layout, ...rest], format);
}

/** Drop trailing blank pages beyond what's needed, then re-pad. */
export function tidy(layouts: string[], format: BookFormat): LayoutId[] {
  const out = layouts.filter(isLayoutId);
  while (out.length && out[out.length - 1] === "blank") out.pop();
  return pad(out, format);
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

function trimBlankTail(layouts: LayoutId[]): LayoutId[] {
  const out = [...layouts];
  while (out.length && out[out.length - 1] === "blank") out.pop();
  return out;
}

/**
 * Keep pages before `index` as they are and lay out every photo after them
 * afresh. Used when photos are added or removed, so earlier pages the
 * person may have arranged don't shuffle.
 */
export function relayoutAfter(photos: PhotoShape[], layouts: string[], index: number, format: BookFormat): LayoutId[] {
  const before = layouts.slice(0, Math.max(0, index)).map((l) => (isLayoutId(l) ? l : "framed"));
  const pages = flow(photos, before, format);
  // Pages before `index` may have lost their photos (e.g. removed ones).
  const kept = pages.filter((p) => p.layout === "blank" || p.photos.length).map((p) => p.layout);
  const used = kept.reduce((n, l) => n + LAYOUTS[l].slots.length, 0);
  const rest = autoLayouts(photos.slice(used), format);
  return pad(stretch(trimBlankTail([...kept, ...rest]), format.minPages), format);
}
