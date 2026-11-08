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
  type: "image" | "video";
  size: number;
}

export async function insertMedia(m: NewMedia): Promise<string> {
  const row = await db.media.upsert({
    where: { fileKey: m.fileKey },
    create: { ...m, size: BigInt(m.size) },
    update: { url: m.url },
    select: { id: true },
  });
  return row.id;
}

export async function setDerivatives(
  id: string,
  d: {
    width: number;
    height: number;
    thumbUrl: string | null;
    largeUrl: string | null;
    keys: string[];
  }
): Promise<void> {
  await db.media.update({
    where: { id },
    data: {
      width: d.width,
      height: d.height,
      thumbUrl: d.thumbUrl,
      largeUrl: d.largeUrl,
      derivedKeys: d.keys,
    },
  });
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
    return db.media.findMany({
      where: { album },
      orderBy: { createdAt: "desc" },
    });
  }
  // Photographer's set first, then guests in the order they arrived.
  return db.media.findMany({
    where: { album, hidden: false },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function setHidden(id: string, hidden: boolean): Promise<void> {
  if (!isUuid(id)) return;
  await db.media.updateMany({ where: { id }, data: { hidden } });
}

/** Removes the row and returns every UploadThing key that belonged to it. */
export async function deleteRow(id: string): Promise<string[]> {
  if (!isUuid(id)) return [];
  const row = await db.media
    .delete({ where: { id }, select: { fileKey: true, derivedKeys: true } })
    .catch(() => null); // already gone
  return row ? [row.fileKey, ...row.derivedKeys] : [];
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

/* ---------- mapping to what the gallery renders ---------- */

export function rowToItem(row: MediaRow): GalleryItem {
  return {
    id: row.id,
    type: row.type,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    thumb: row.thumbUrl ?? row.url,
    large: row.largeUrl ?? row.url,
    src: row.url,
    download: `/api/media/${row.id}/download`,
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
