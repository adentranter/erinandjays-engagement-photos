export type Album = "wedding" | "engagement";
export type Role = "photographer" | "guest";

export const ALBUMS: readonly Album[] = ["wedding", "engagement"];

/** One tile in a gallery, wherever the file actually lives. */
export interface GalleryItem {
  id: string;
  type: "image" | "video";
  width?: number;
  height?: number;
  /** ~640px image for the grid */
  thumb: string;
  /** ~2200px image for the lightbox */
  large: string;
  /** Inline source (video playback) */
  src: string;
  /** Same-origin URL that responds with an attachment */
  download: string;
  role: Role;
  /** Guest name to show, or null for the photographer */
  credit: string | null;
}
