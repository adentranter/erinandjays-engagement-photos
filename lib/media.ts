import "server-only";
import type { Media } from "@prisma/client";
import { db, hasDatabase } from "@/lib/db";
import { getMedia, type MediaItem } from "@/lib/photos";
import type { Album, GalleryItem, Role } from "@/lib/gallery-types";

export type MediaRow = Media;

export interface NewMedia {
  album: Album;
  role: Role;
  uploaderName: string | null;
  fileKey: string;
  fileName: string;
  url: string;
  /** What the browser said; the worker re-checks the actual bytes. */
  mimeType: string;
  size: number;
}

/** Record a finished upload and queue it for processing. */
export async function insertMedia(m: NewMedia): Promise<string> {
  const type = m.mimeType.startsWith("video/") ? "video" : "image";
  const row = await db.media.upsert({
    where: { fileKey: m.fileKey },
    create: { ...m, type, size: BigInt(m.size), status: "pending" },
    update: { url: m.url },
    select: { id: true },
  });
  return row.id;
}

export interface MediaStatus {
  id: string;
  status: MediaRow["status"];
  type: MediaRow["type"];
  thumb: string | null;
  motionSource: string | null;
  /** Merged into this Live Photo still */
  partOf: string | null;
  error: string | null;
}

export async function getStatuses(ids: string[]): Promise<MediaStatus[]> {
  const valid = ids.filter(isUuid).slice(0, 100);
  if (!valid.length) return [];
  const rows = await db.media.findMany({
    where: { id: { in: valid } },
    select: {
      id: true,
      status: true,
      type: true,
      thumbUrl: true,
      motionSource: true,
      companionOf: true,
      error: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    type: r.type,
    thumb: r.thumbUrl,
    motionSource: r.motionSource,
    partOf: r.companionOf,
    error: r.status === "failed" ? r.error : null,
  }));
}

export async function getRow(id: string): Promise<MediaRow | null> {
  if (!isUuid(id)) return null;
  return db.media.findUnique({ where: { id } });
}

export async function listRows(
  album: Album,
  opts: { includeHidden?: boolean } = {}
): Promise<MediaRow[]> {
  if (!hasDatabase()) return [];
  if (opts.includeHidden) {
    // Studio view: everything except Live Photo MOVs merged into a still.
    return db.media.findMany({
      where: { album, companionOf: null },
      orderBy: { createdAt: "desc" },
    });
  }
  // Public: processed items only. Rows being reprocessed stay visible as
  // long as they already have renditions from an earlier pass.
  // Photographer's set first, then guests in the order they arrived.
  return db.media.findMany({
    where: {
      album,
      hidden: false,
      companionOf: null,
      OR: [{ status: "ready" }, { status: { not: "failed" }, thumbUrl: { not: null } }],
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

/** Add `by` degrees (clockwise) to the studio rotation. */
export async function setRotation(id: string, by: number): Promise<void> {
  if (!isUuid(id)) return;
  await db.$executeRaw`
    UPDATE "media" SET "rotation" = ("rotation" + ${by}::int) % 360 WHERE "id" = ${id}::uuid`;
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  if (!isUuid(id)) return;
  await db.media.updateMany({ where: { id }, data: { hidden } });
}

/**
 * Removes the row (and a Live Photo's merged MOV) and returns every
 * UploadThing key that belonged to them.
 */
export async function deleteRow(id: string): Promise<string[]> {
  if (!isUuid(id)) return [];
  const rows = await db.media.findMany({
    where: { OR: [{ id }, { companionOf: id }] },
    select: { id: true, fileKey: true, derivedKeys: true },
  });
  if (!rows.length) return [];
  await db.media.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.flatMap((r) => [r.fileKey, ...r.derivedKeys]);
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

/* ---------- mapping to what the gallery renders ---------- */

export function rowToItem(row: MediaRow): GalleryItem {
  const download = `/api/media/${row.id}/download`;
  return {
    id: row.id,
    type: row.type,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    thumb: row.thumbUrl ?? row.url,
    large: row.largeUrl ?? row.url,
    // Prefer the browser-friendly MP4 (motion clip or HEVC transcode).
    src: row.videoUrl ?? row.url,
    poster: row.type === "video" ? row.largeUrl ?? undefined : undefined,
    motion: row.type === "animation" && row.motionSource !== "gif" ? row.videoUrl ?? undefined : undefined,
    gifDownload: row.gifUrl ? `${download}?asset=gif` : undefined,
    download,
    role: row.role,
    credit: row.role === "guest" ? row.uploaderName ?? "A guest" : null,
  };
}

function fileToItem(m: MediaItem): GalleryItem {
  const base = `/api/photo/${encodeURIComponent(m.name)}`;
  return {
    id: `file:${m.name}`,
    type: m.type,
    width: m.width,
    height: m.height,
    thumb: `${base}?size=thumb`,
    large: `${base}?size=large`,
    src: base,
    download: `${base}?size=original`,
    role: "photographer",
    credit: null,
  };
}

/**
 * Everything visible in an album. The engagement album also includes the
 * files baked into ./photos, which stay the source of truth for that shoot.
 */
export async function getAlbum(album: Album): Promise<GalleryItem[]> {
  const rows = (await listRows(album)).map(rowToItem);
  if (album !== "engagement") return rows;
  const files = (await getMedia()).map(fileToItem);
  return [...files, ...rows];
}
