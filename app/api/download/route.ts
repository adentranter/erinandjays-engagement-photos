import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { NextRequest } from "next/server";
import archiver from "archiver";
import { getMedia, PHOTOS_DIR, type MediaType } from "@/lib/photos";

export const dynamic = "force-dynamic";

const KINDS = ["all", "photos", "video"] as const;
type Kind = (typeof KINDS)[number];

const FILENAMES: Record<Kind, string> = {
  all: "ehrin-and-jay-engagement.zip",
  photos: "ehrin-and-jay-photos.zip",
  video: "ehrin-and-jay-video.zip",
};

function parseKind(raw: string | null): Kind {
  if (raw && (KINDS as readonly string[]).includes(raw)) {
    return raw as Kind;
  }
  return "all";
}

function matchesKind(type: MediaType, kind: Kind): boolean {
  if (kind === "all") return true;
  if (kind === "photos") return type === "image";
  return type === "video";
}

/**
 * Streams a zip of originals. Filter with ?kind=all|photos|video.
 * Nothing is buffered beyond archiver's high-water mark.
 */
export async function GET(req: NextRequest) {
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  const media = (await getMedia()).filter((item) =>
    matchesKind(item.type, kind)
  );

  if (media.length === 0) {
    return new Response("Nothing to download", { status: 404 });
  }

  const archive = archiver("zip", { store: true }); // JPEGs/MP4s don't compress
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  for (const item of media) {
    archive.file(path.join(PHOTOS_DIR, item.name), { name: item.name });
  }
  void archive.finalize();

  return new Response(Readable.toWeb(passthrough) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${FILENAMES[kind]}"`,
      "Cache-Control": "no-store",
    },
  });
}
