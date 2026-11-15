import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, degrees, type PDFFont } from "pdf-lib";
import { db } from "@/lib/db";
import { safeMediaPath } from "@/lib/photos";
import { heicToJpeg } from "@/lib/processing/tools";
import type { BookFormat, Page } from "./layouts";
import { LAYOUTS, placeInSlot, slotsFor } from "./layouts";

/**
 * Print files for Prodigi: one PDF (front cover, interior pages, back
 * cover, each a single page at the book's trim size with no bleed or crop
 * marks — Prodigi adds those) and one spine PDF.
 *
 * Every page is flattened to one 300 dpi RGB JPEG (photos and any shading
 * baked in, so there's no PDF transparency); cover and spine text is drawn
 * on top as vector text in an embedded font.
 */

const DPI = 300;
const MM_PER_IN = 25.4;
const px = (mm: number) => Math.round((mm / MM_PER_IN) * DPI);
const pt = (mm: number) => (mm / MM_PER_IN) * 72;

const INK = { r: 0x16, g: 0x13, b: 0x0f };
const IVORY = rgb(0xf2 / 255, 0xed / 255, 0xe4 / 255);
const CHAMPAGNE = rgb(0xc9 / 255, 0xa9 / 255, 0x6a / 255);
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const MAX_SOURCE_BYTES = 120 * 1024 * 1024;

export interface RenderInput {
  title: string;
  subtitle: string;
  coverId: string | null;
  pages: Page[];
  format: BookFormat;
}

/* ------------------------------------------------------------------ */
/* Photo sources                                                       */
/* ------------------------------------------------------------------ */

/**
 * The best upright copy of a gallery photo we can get: the original file
 * (auto-oriented, plus any studio rotation), falling back to the 2200px
 * rendition, which already has rotation applied.
 */
async function loadPhoto(id: string, tmp: string): Promise<sharp.Sharp> {
  if (id.startsWith("file:")) {
    const file = safeMediaPath(id.slice(5));
    if (!file) throw new Error(`Unknown photo ${id}`);
    return sharp(file, { limitInputPixels: 300_000_000 }).autoOrient();
  }
  const row = await db.media.findUnique({ where: { id } });
  if (!row) throw new Error(`Photo ${id} no longer exists`);

  try {
    const buf = await download(row.url);
    try {
      await sharp(buf).metadata();
      return sharp(buf, { limitInputPixels: 300_000_000 }).autoOrient().rotate(row.rotation);
    } catch {
      // e.g. HEIC, which sharp's prebuilt libvips can't read.
      const src = path.join(tmp, `${id}.src`);
      const jpg = path.join(tmp, `${id}.jpg`);
      await fs.writeFile(src, buf);
      await heicToJpeg(src, jpg);
      return sharp(await fs.readFile(jpg)).autoOrient().rotate(row.rotation);
    }
  } catch (err) {
    if (!row.largeUrl) throw err;
    console.warn(`[book] using the 2200px copy of ${id}:`, err instanceof Error ? err.message : err);
    return sharp(await download(row.largeUrl));
  }
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetching ${url} failed (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_SOURCE_BYTES) throw new Error("Photo is too large to print");
  return Buffer.from(await res.arrayBuffer());
}

/** Photo cropped (cover) or fitted (contain) to exactly w×h pixels. */
async function photoTile(
  id: string,
  w: number,
  h: number,
  fit: "cover" | "contain",
  tmp: string
): Promise<{ input: Buffer; left: number; top: number }> {
  // Flatten EXIF/studio rotation first so the reported size is upright.
  const upright = await (await loadPhoto(id, tmp)).toColourspace("srgb").png({ compressionLevel: 0 }).toBuffer({ resolveWithObject: true });
  const aspect = upright.info.width / upright.info.height;
  const place = placeInSlot(aspect, w / h, fit);
  const tw = Math.max(1, Math.round(place.w * w));
  const th = Math.max(1, Math.round(place.h * h));
  const input = await sharp(upright.data)
    .resize(tw, th, { fit: "cover", position: sharp.strategy.attention })
    .flatten({ background: "#ffffff" })
    .toBuffer();
  return { input, left: Math.round(place.x * w), top: Math.round(place.y * h) };
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

async function interiorPage(page: Page, format: BookFormat, tmp: string): Promise<Buffer> {
  const W = px(format.widthMm);
  const H = px(format.heightMm);
  const layout = LAYOUTS[page.layout];
  const slots = slotsFor(page.layout, format.widthMm / format.heightMm);
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < page.photos.length && i < slots.length; i++) {
    if (!page.photos[i]) continue; // an empty spot prints as plain paper
    const s = slots[i];
    const sx = Math.round(s.x * W);
    const sy = Math.round(s.y * H);
    const sw = Math.round((s.x + s.w) * W) - sx;
    const sh = Math.round((s.y + s.h) * H) - sy;
    const tile = await photoTile(page.photos[i], sw, sh, layout.fit, tmp);
    composites.push({ input: tile.input, left: sx + tile.left, top: sy + tile.top });
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .withMetadata({ density: DPI })
    .toBuffer();
}

/** Cover photo, full bleed, with a soft dark band at the foot for the title. */
async function frontCover(coverId: string | null, format: BookFormat, tmp: string): Promise<Buffer> {
  const W = px(format.widthMm);
  const H = px(format.heightMm);
  const base = sharp({ create: { width: W, height: H, channels: 3, background: INK } });
  if (!coverId) return base.jpeg({ quality: 92 }).toBuffer();
  const tile = await photoTile(coverId, W, H, "cover", tmp);
  const band = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgb(22,19,15)" stop-opacity="0"/>
        <stop offset="1" stop-color="rgb(22,19,15)" stop-opacity="0.78"/>
      </linearGradient></defs>
      <rect x="0" y="${Math.round(H * 0.6)}" width="${W}" height="${H - Math.round(H * 0.6)}" fill="url(#g)"/>
    </svg>`
  );
  return base
    .composite([{ input: tile.input, left: 0, top: 0 }, { input: band, left: 0, top: 0 }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .withMetadata({ density: DPI })
    .toBuffer();
}

async function solidInk(wMm: number, hMm: number): Promise<Buffer> {
  return sharp({ create: { width: Math.max(1, px(wMm)), height: px(hMm), channels: 3, background: INK } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/* PDFs                                                                */
/* ------------------------------------------------------------------ */

async function fonts(doc: PDFDocument): Promise<{ title: PDFFont; body: PDFFont }> {
  doc.registerFontkit(fontkit);
  const [title, body] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "cormorant-garamond-latin-500-italic.woff")),
    fs.readFile(path.join(FONT_DIR, "cormorant-garamond-latin-400-normal.woff")),
  ]);
  return {
    title: await doc.embedFont(title, { subset: true }),
    body: await doc.embedFont(body, { subset: true }),
  };
}

/** Largest size ≤ max at which `text` fits in `width` points. */
function fitSize(font: PDFFont, text: string, width: number, max: number): number {
  const w = font.widthOfTextAtSize(text, max);
  return w <= width ? max : Math.max(6, (max * width) / w);
}

function centred(page: ReturnType<PDFDocument["addPage"]>, font: PDFFont, text: string, size: number, y: number, color = IVORY) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (page.getWidth() - w) / 2, y, size, font, color });
}

/** Strip characters the subset font can't draw (emoji etc.). */
function printable(text: string, font: PDFFont): string {
  const ok = new Set(font.getCharacterSet());
  return [...text].filter((c) => c === " " || ok.has(c.codePointAt(0)!)).join("").trim();
}

export async function renderBookPdf(input: RenderInput): Promise<{ path: string; pages: number }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "book-"));
  try {
    const { format } = input;
    const doc = await PDFDocument.create();
    doc.setTitle(input.title || "Photo book");
    doc.setCreator("Ehrin & Jay gallery");
    const f = await fonts(doc);
    const W = pt(format.widthMm);
    const H = pt(format.heightMm);
    const safe = pt(14); // inside Prodigi's 10mm safe area, with room to spare

    const addImagePage = async (jpeg: Buffer) => {
      const img = await doc.embedJpg(jpeg);
      const page = doc.addPage([W, H]);
      page.drawImage(img, { x: 0, y: 0, width: W, height: H });
      return page;
    };

    // Front cover
    const front = await addImagePage(await frontCover(input.coverId, format, tmp));
    const title = printable(input.title, f.title);
    const subtitle = printable(input.subtitle, f.body);
    if (title) {
      const size = fitSize(f.title, title, W - 2 * safe, pt(16));
      centred(front, f.title, title, size, safe + pt(subtitle ? 16 : 10));
    }
    if (subtitle) {
      const size = fitSize(f.body, subtitle.toUpperCase(), W - 2 * safe, pt(3.6));
      centred(front, f.body, subtitle.toUpperCase(), size, safe + pt(6), CHAMPAGNE);
    }

    // Interior
    for (const page of input.pages) {
      await addImagePage(await interiorPage(page, format, tmp));
    }

    // Back cover
    const back = await addImagePage(await solidInk(format.widthMm, format.heightMm));
    centred(back, f.title, "E & J", pt(7), H / 2, CHAMPAGNE);

    const out = path.join(os.tmpdir(), `book-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    await fs.writeFile(out, await doc.save());
    return { path: out, pages: doc.getPageCount() };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Spine artwork: ink with the title running top to bottom. */
export async function renderSpinePdf(title: string, widthMm: number, format: BookFormat): Promise<string> {
  const doc = await PDFDocument.create();
  const f = await fonts(doc);
  const W = pt(widthMm);
  const H = pt(format.heightMm);
  const img = await doc.embedJpg(await solidInk(widthMm, format.heightMm));
  const page = doc.addPage([W, H]);
  page.drawImage(img, { x: 0, y: 0, width: W, height: H });

  const text = printable(title, f.title);
  // Too thin for legible type below ~6mm.
  if (text && widthMm >= 6) {
    const size = Math.min(fitSize(f.title, text, H - 2 * pt(20), W * 0.55), pt(6));
    const w = f.title.widthOfTextAtSize(text, size);
    // Reads top to bottom, as on most English-language spines.
    page.drawText(text, {
      // Rotated -90°, glyphs rise toward +x from the baseline.
      x: W / 2 - size * 0.35,
      y: (H + w) / 2,
      size,
      font: f.title,
      color: CHAMPAGNE,
      rotate: degrees(-90),
    });
  }
  const out = path.join(os.tmpdir(), `spine-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  await fs.writeFile(out, await doc.save());
  return out;
}
