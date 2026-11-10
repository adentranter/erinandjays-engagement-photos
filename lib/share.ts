import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getPublicItem } from "@/lib/media";
import { PHOTO_PARAM, type Album } from "@/lib/gallery-types";

export { PHOTO_PARAM };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

/**
 * Page metadata for an album, with a link preview of the shared photo when
 * the URL is `?photo=<id>` — so pasting the link into a chat shows the picture.
 */
export async function albumMetadata(
  album: Album,
  title: string,
  photoId: string | string[] | undefined
): Promise<Metadata> {
  const base: Metadata = { title };
  const id = typeof photoId === "string" ? photoId : undefined;
  if (!id) return base;

  const item = await getPublicItem(album, id).catch(() => null);
  if (!item) return base;

  const root = await origin();
  const image = item.type === "video" ? item.poster ?? item.thumb : item.large;
  const url = `${root}/${album}?${PHOTO_PARAM}=${encodeURIComponent(item.id)}`;
  const shared = item.credit ? `Shared by ${item.credit}` : "A photograph from the day";

  return {
    title,
    metadataBase: new URL(root),
    alternates: { canonical: url },
    openGraph: {
      title,
      description: shared,
      url,
      type: "website",
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description: shared, images: [image] },
  };
}
