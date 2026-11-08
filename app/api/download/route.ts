import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextRequest } from "next/server";
import archiver from "archiver";
import { getMedia, PHOTOS_DIR } from "@/lib/photos";
import { listRows, type MediaRow } from "@/lib/media";
import { nodeToWebStream } from "@/lib/stream";
import { ALBUMS, type Album } from "@/lib/gallery-types";

export const dynamic = "force-dynamic";

const KINDS = ["all", "photos", "video"] as const;
type Kind = (typeof KINDS)[number];

function parseKind(raw: string | null): Kind {
  return raw && (KINDS as readonly string[]).includes(raw)
    ? (raw as Kind)
    : "all";
}

function parseAlbum(raw: string | null): Album {
  return raw && (ALBUMS as readonly string[]).includes(raw)
    ? (raw as Album)
    : "engagement";
}

function matchesKind(type: "image" | "animation" | "video", kind: Kind): boolean {
  if (kind === "all") return true;
  if (kind === "photos") return type !== "video";
  return type === "video";
}

function zipName(album: Album, kind: Kind): string {
  const suffix = kind === "all" ? album : `${album}-${kind}`;
  return `ehrin-and-jay-${suffix}.zip`;
}

/** Keep names unique inside the zip; guests all upload IMG_0001.jpg. */
function entryName(row: MediaRow, seen: Set<string>): string {
  const folder =
    row.role === "photographer"
      ? "photographer"
      : `guests/${(row.uploaderName ?? "guest").replace(/[\\/:*?"<>|]/g, "_")}`;
  let name = `${folder}/${row.fileName}`;
  for (let i = 2; seen.has(name); i++) {
    name = `${folder}/${i}-${row.fileName}`;
  }
  seen.add(name);
  return name;
}

/**
 * Streams a zip of originals. ?album=engagement|wedding, ?kind=all|photos|video.
 * Local files are read from disk; uploaded files are fetched one at a time
 * from UploadThing so only one upstream response is open at once.
 */
export async function GET(req: NextRequest) {
  const kind = parseKind(req.nextUrl.searchParams.get("kind"));
  const album = parseAlbum(req.nextUrl.searchParams.get("album"));

  const files =
    album === "engagement"
      ? (await getMedia()).filter((m) => matchesKind(m.type, kind))
      : [];
  const rows = (await listRows(album)).filter((r) => matchesKind(r.type, kind));

  if (files.length + rows.length === 0) {
    return new Response("Nothing to download", { status: 404 });
  }

  const archive = archiver("zip", { store: true }); // JPEGs/MP4s don't compress
  const passthrough = new PassThrough();
  let aborted = false;

  const cleanup = () => {
    aborted = true;
    try {
      archive.abort();
    } catch {
      // already finalized/aborted
    }
    if (!passthrough.destroyed) passthrough.destroy();
  };

  if (req.signal.aborted) cleanup();
  else req.signal.addEventListener("abort", cleanup, { once: true });

  archive.on("error", (err) => {
    if (!passthrough.destroyed) passthrough.destroy(err);
  });
  archive.pipe(passthrough);

  for (const item of files) {
    archive.file(path.join(PHOTOS_DIR, item.name), { name: item.name });
  }

  // archiver handles entries in order; count them so we only open the next
  // upstream response once the previous entry has been fully written.
  let written = 0;
  const waiters: Array<{ at: number; resolve: () => void }> = [];
  archive.on("entry", () => {
    written++;
    for (const w of waiters.filter((w) => written >= w.at)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve();
    }
  });
  const writtenAtLeast = (at: number) =>
    written >= at
      ? Promise.resolve()
      : new Promise<void>((resolve) => waiters.push({ at, resolve }));

  void (async () => {
    const seen = new Set<string>();
    let queued = files.length;
    for (const row of rows) {
      if (aborted) return;
      const res = await fetch(row.url, { signal: req.signal }).catch(
        () => null
      );
      if (!res?.ok || !res.body) continue; // skip missing files, keep going
      archive.append(Readable.fromWeb(res.body as NodeWebStream), {
        name: entryName(row, seen),
      });
      await writtenAtLeast(++queued);
    }
    if (!aborted) await archive.finalize();
  })().catch((err) => {
    if (!passthrough.destroyed) passthrough.destroy(err);
  });

  return new Response(nodeToWebStream(passthrough, req.signal), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName(album, kind)}"`,
      "Cache-Control": "no-store",
    },
  });
}
