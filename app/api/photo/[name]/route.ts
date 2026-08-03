import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import sharp from "sharp";
import {
  isImageFile,
  isVideoFile,
  mediaContentType,
  safeMediaPath,
} from "@/lib/photos";

export const dynamic = "force-dynamic";

// Fixed size ladder so the cache can't be poisoned with arbitrary widths.
const SIZES = { thumb: 640, large: 2200 } as const;
type SizeKey = keyof typeof SIZES;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const filePath = safeMediaPath(name);
  if (!filePath) return new Response("Not found", { status: 404 });

  const size = req.nextUrl.searchParams.get("size");

  // Videos only support original (or null) — no sharp resize.
  if (isVideoFile(name)) {
    if (size !== null && size !== "original") {
      return new Response("Bad size", { status: 400 });
    }

    // Stream for playback in the lightbox; attachment for explicit download.
    const download = size === "original";
    const stat = await fsPromises.stat(filePath).catch(() => null);
    if (!stat) return new Response("Not found", { status: 404 });

    const stream = fs.createReadStream(filePath);

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": mediaContentType(name),
        "Content-Length": String(stat.size),
        "Content-Disposition": download
          ? `attachment; filename="${encodeURIComponent(name)}"`
          : `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (!isImageFile(name)) return new Response("Not found", { status: 404 });

  // ?size=original streams the untouched file with a download disposition.
  if (size === "original" || size === null) {
    const file = await fsPromises.readFile(filePath).catch(() => null);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          size === "original"
            ? "application/octet-stream"
            : mediaContentType(name),
        "Content-Disposition":
          size === "original"
            ? `attachment; filename="${encodeURIComponent(name)}"`
            : `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (!(size in SIZES)) return new Response("Bad size", { status: 400 });
  const width = SIZES[size as SizeKey];

  try {
    const buffer = await sharp(filePath)
      .rotate() // honour EXIF orientation
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: size === "thumb" ? 78 : 88 })
      .toBuffer();

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
