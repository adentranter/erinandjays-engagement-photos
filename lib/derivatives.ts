import "server-only";
import sharp from "sharp";
import { UTApi, UTFile } from "uploadthing/server";
import { getRow, setDerivatives } from "@/lib/media";

/**
 * Phones and pro cameras produce 5–30MB images — far too heavy for a grid.
 * After an upload lands we pull the original once, render the same webp
 * ladder the engagement gallery uses, and park those back in UploadThing.
 * If anything fails the gallery just falls back to the original URL.
 */

const LADDER = [
  { label: "thumb", width: 640, quality: 78 },
  { label: "large", width: 2200, quality: 88 },
] as const;

const inFlight = new Set<string>();

export const utapi = new UTApi();

export function queueDerivatives(id: string): void {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  void makeDerivatives(id)
    .catch((err) => console.error(`[derivatives] ${id} failed:`, err))
    .finally(() => inFlight.delete(id));
}

async function makeDerivatives(id: string): Promise<void> {
  const row = await getRow(id);
  if (!row || row.type !== "image") return;

  const res = await fetch(row.url);
  if (!res.ok) throw new Error(`fetch original: ${res.status}`);
  const original = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(original).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 3;
  const height = (rotated ? meta.width : meta.height) ?? 2;

  const base = row.fileName.replace(/\.[^.]+$/, "");
  const files = await Promise.all(
    LADDER.map(async (step) => {
      const buf = await sharp(original)
        .rotate()
        .resize({ width: step.width, withoutEnlargement: true })
        .webp({ quality: step.quality })
        .toBuffer();
      return new UTFile([new Uint8Array(buf)], `${base}.${step.label}.webp`, {
        type: "image/webp",
      });
    })
  );

  const results = await utapi.uploadFiles(files);
  const [thumb, large] = results.map((r) => r.data);

  await setDerivatives(id, {
    width,
    height,
    thumbUrl: thumb?.ufsUrl ?? null,
    largeUrl: large?.ufsUrl ?? null,
    keys: results.flatMap((r) => (r.data ? [r.data.key] : [])),
  });
}
