/**
 * Browser-side hints shown before upload. The server re-checks everything
 * from the actual bytes; this only tells people what we noticed.
 */

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?)$/i;
const VIDEO_EXT = /\.(mov|mp4|m4v|3gp|webm)$/i;

export function isMediaFile(f: File): boolean {
  return (
    f.type.startsWith("image/") ||
    f.type.startsWith("video/") ||
    IMAGE_EXT.test(f.name) ||
    VIDEO_EXT.test(f.name)
  );
}

export function isVideoFile(f: File): boolean {
  return f.type.startsWith("video/") || (!f.type && VIDEO_EXT.test(f.name));
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

export interface Detected {
  photos: number;
  videos: number;
  gifs: number;
  livePhotos: number;
  motionPhotos: number;
  heic: number;
  /** Looks like iPhone stills with no MOVs alongside: motion may be lost. */
  stillsWithoutMotion: boolean;
}

async function hasMotionXmp(f: File): Promise<boolean> {
  if (!/jpe?g|heic|heif/i.test(f.type || f.name)) return false;
  // XMP sits near the start; Samsung's marker sits before the trailing clip.
  const head = await f.slice(0, 256 * 1024).text();
  if (/MotionPhoto\s*=\s*"1"|MicroVideo\s*=\s*"1"|<[\w-]+:MotionPhoto>1</.test(head)) return true;
  if (f.size > 1024 * 1024) {
    const tail = await f.slice(Math.max(0, f.size - 8 * 1024 * 1024)).text();
    return tail.includes("MotionPhoto_Data");
  }
  return false;
}

export async function detect(files: File[]): Promise<Detected> {
  const stills = files.filter((f) => !isVideoFile(f));
  const videos = files.filter(isVideoFile);
  const videoStems = new Set(videos.map((v) => stem(v.name)));
  const paired = stills.filter((s) => videoStems.has(stem(s.name)));
  const gifs = stills.filter((f) => f.type === "image/gif" || /\.gif$/i.test(f.name)).length;
  const heic = stills.filter((f) => /heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name)).length;

  const motionFlags = await Promise.all(
    stills.filter((s) => !paired.includes(s)).map((s) => hasMotionXmp(s).catch(() => false))
  );
  const motionPhotos = motionFlags.filter(Boolean).length;

  const iphoneNamed = stills.filter((s) => /^IMG_\d{4}/i.test(s.name) && !paired.includes(s));
  return {
    photos: stills.length - paired.length - motionPhotos - gifs,
    videos: videos.length - paired.length,
    gifs,
    livePhotos: paired.length,
    motionPhotos,
    heic,
    stillsWithoutMotion: iphoneNamed.length > 0 && videos.length === 0,
  };
}

export function describe(d: Detected): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) =>
    count > 0 && parts.push(`${count} ${count === 1 ? one : many}`);
  n(d.photos, "photo");
  n(d.livePhotos, "Live Photo");
  n(d.motionPhotos, "Motion Photo");
  n(d.gifs, "GIF");
  n(d.videos, "video");
  return parts.join(" · ");
}
