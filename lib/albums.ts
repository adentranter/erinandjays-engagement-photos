import "server-only";
import { db, hasDatabase } from "@/lib/db";
import type { Album, GalleryItem } from "@/lib/gallery-types";

/** Cover chosen in the studio, if any. */
export async function getCoverIds(): Promise<Partial<Record<Album, string>>> {
  if (!hasDatabase()) return {};
  try {
    const rows = await db.albumSettings.findMany();
    return Object.fromEntries(
      rows.filter((r) => r.coverId).map((r) => [r.album, r.coverId as string])
    );
  } catch (err) {
    console.error("[albums] couldn't read covers:", err);
    return {};
  }
}

export async function setCoverId(album: Album, coverId: string | null): Promise<void> {
  await db.albumSettings.upsert({
    where: { album },
    create: { album, coverId },
    update: { coverId },
  });
}

/** Items that can serve as a cover: anything with a real still image. */
export function coverCandidates(items: GalleryItem[]): GalleryItem[] {
  return items.filter((m) => m.type !== "video" || m.thumb !== m.src);
}

/**
 * The chosen cover if it's still in the album (it may have been hidden or
 * deleted since), otherwise the first photographer image, then any image.
 */
export function pickCover(items: GalleryItem[], chosenId?: string): GalleryItem | undefined {
  const chosen = chosenId ? items.find((m) => m.id === chosenId) : undefined;
  return (
    chosen ??
    items.find((m) => m.type !== "video" && m.role === "photographer") ??
    items.find((m) => m.type !== "video")
  );
}
