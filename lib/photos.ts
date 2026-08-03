import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Photos live on disk, not in a database. Drop files into ./photos
 * (or point PHOTOS_DIR at a mounted volume) and they appear.
 */
export const PHOTOS_DIR =
  process.env.PHOTOS_DIR ?? path.join(process.cwd(), "photos");

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tiff",
]);
const VIDEO_EXTENSIONS = new Set([".mp4"]);

export type MediaType = "image" | "video";

export interface MediaItem {
  name: string;
  type: MediaType;
  width: number;
  height: number;
}

/** @deprecated Prefer MediaItem — kept as an alias for image-shaped items. */
export type Photo = MediaItem;

let cache: MediaItem[] | null = null;

function mediaTypeFor(name: string): MediaType | null {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export function isMediaFile(name: string): boolean {
  return mediaTypeFor(name) !== null && !name.startsWith(".");
}

export function isPhotoFile(name: string): boolean {
  return isMediaFile(name);
}

export function isImageFile(name: string): boolean {
  return mediaTypeFor(name) === "image" && !name.startsWith(".");
}

export function isVideoFile(name: string): boolean {
  return mediaTypeFor(name) === "video" && !name.startsWith(".");
}

/** Reject anything that isn't a plain filename inside PHOTOS_DIR. */
export function safeMediaPath(name: string): string | null {
  if (!isMediaFile(name)) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  return path.join(PHOTOS_DIR, name);
}

/** @deprecated Prefer safeMediaPath */
export function safePhotoPath(name: string): string | null {
  return safeMediaPath(name);
}

function contentTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".tiff":
      return "image/tiff";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

export function mediaContentType(name: string): string {
  return contentTypeFor(name);
}

export async function getMedia(): Promise<MediaItem[]> {
  if (cache && process.env.NODE_ENV === "production") return cache;

  const entries = await fs.readdir(PHOTOS_DIR).catch(() => [] as string[]);
  const files = entries.filter(isMediaFile).sort();

  const items = await Promise.all(
    files.map(async (name): Promise<MediaItem | null> => {
      const type = mediaTypeFor(name);
      if (!type) return null;

      if (type === "video") {
        // Fixed 16:9 placeholder until a probe is worth the dependency.
        return { name, type, width: 16, height: 9 };
      }

      try {
        const meta = await sharp(path.join(PHOTOS_DIR, name)).metadata();
        const rotated = (meta.orientation ?? 1) >= 5;
        const width = rotated ? meta.height : meta.width;
        const height = rotated ? meta.width : meta.height;
        return { name, type, width: width ?? 3, height: height ?? 2 };
      } catch {
        return null; // unreadable file — skip it
      }
    })
  );

  cache = items.filter((p): p is MediaItem => p !== null);
  return cache;
}

/** @deprecated Prefer getMedia */
export async function getPhotos(): Promise<MediaItem[]> {
  return getMedia();
}
