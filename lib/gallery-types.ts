export type Album = "wedding" | "engagement";
export type Role = "photographer" | "guest";

export const ALBUMS: readonly Album[] = ["wedding", "engagement"];

/** One tile in a gallery, wherever the file actually lives. */
export interface GalleryItem {
  id: string;
  /** animation = Live Photo, Motion Photo or animated GIF */
  type: "image" | "animation" | "video";
  width?: number;
  height?: number;
  /** ~640px image for the grid */
  thumb: string;
  /** ~2200px image for the lightbox */
  large: string;
  /** Inline source (video playback) */
  src: string;
  /** Still frame for videos */
  poster?: string;
  /** Silent looping MP4 for Live/Motion Photos */
  motion?: string;
  /** Same-origin attachment URL for the GIF version, when there is one */
  gifDownload?: string;
  /** Same-origin URL that responds with an attachment */
  download: string;
  role: Role;
  /** Guest name to show, or null for the photographer */
  credit: string | null;
  /** Uploaded from this browser: the viewer may rotate or delete it */
  mine?: boolean;
}
