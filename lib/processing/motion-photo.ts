/**
 * Find the video that Android "Motion Photos" carry inside the still image.
 *
 * Manufacturers don't agree on one layout, so several strategies are tried
 * in order of how much they can be trusted:
 *
 *  1. Google Motion Photo v1 (Pixel, newer Samsung/OnePlus/Xiaomi): XMP
 *     `Container:Directory` lists items appended after the primary image;
 *     the `MotionPhoto` item's `Length` locates the MP4 from the end.
 *  2. Legacy Google "MicroVideo": `GCamera:MicroVideoOffset` = bytes from
 *     the end of the file where the MP4 starts.
 *  3. Samsung: a `MotionPhoto_Data` marker immediately before the MP4.
 *  4. Samsung HEIC: a top-level `mpvd` box whose payload is the MP4.
 *  5. Last resort: an MP4 `ftyp` box anywhere after the primary image.
 *
 * Every candidate must start with a plausible `ftyp` box before it's used,
 * so a wrong offset can't turn random bytes into a "video".
 */

export interface EmbeddedVideo {
  start: number;
  end: number;
  method: "container" | "microvideo" | "samsung-marker" | "mpvd" | "scan";
}

const VIDEO_BRANDS = new Set([
  "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "hvc1",
  "M4V ", "qt  ", "3gp4", "3gp5", "3gp6", "dash", "MSNV",
]);

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = Math.max(0, start); i < Math.min(end, buf.length); i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s;
}

function u32(buf: Uint8Array, at: number): number {
  return ((buf[at] << 24) | (buf[at + 1] << 16) | (buf[at + 2] << 8) | buf[at + 3]) >>> 0;
}

/** Does an MP4/QuickTime file plausibly begin at `at`? */
export function looksLikeMp4At(buf: Uint8Array, at: number): boolean {
  if (at < 0 || at + 12 > buf.length) return false;
  if (ascii(buf, at + 4, at + 8) !== "ftyp") return false;
  const size = u32(buf, at);
  if (size < 16 || size > 512) return false;
  return VIDEO_BRANDS.has(ascii(buf, at + 8, at + 12));
}

function indexOf(buf: Uint8Array, needle: string, from = 0): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= buf.length - needle.length; i++) {
    if (buf[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

/** All XMP packets in the file as text (there can be several, plus Extended XMP). */
export function readXmp(buf: Uint8Array, limit = 4 * 1024 * 1024): string {
  const packets: string[] = [];
  const scanEnd = Math.min(buf.length, limit);
  let from = 0;
  while (from < scanEnd) {
    const open = indexOf(buf.subarray(0, scanEnd), "<x:xmpmeta", from);
    if (open < 0) break;
    const close = indexOf(buf.subarray(0, scanEnd), "</x:xmpmeta>", open);
    if (close < 0) break;
    packets.push(ascii(buf, open, close + 12));
    from = close + 12;
  }
  return packets.join("\n");
}

/** Reads `prefix:Name="v"` or `<prefix:Name>v</prefix:Name>`, any namespace prefix. */
function xmpValue(fragment: string, name: string): string | null {
  const attr = new RegExp(`\\b[\\w-]+:${name}\\s*=\\s*"([^"]*)"`).exec(fragment);
  if (attr) return attr[1];
  const el = new RegExp(`<[\\w-]+:${name}>([^<]*)</[\\w-]+:${name}>`).exec(fragment);
  return el ? el[1].trim() : null;
}

interface ContainerItem {
  semantic: string;
  length: number;
  padding: number;
}

function containerItems(xmp: string): ContainerItem[] {
  const items: ContainerItem[] = [];
  // Each item is either a self-closing element with attributes or an
  // element with child nodes; capture both shapes.
  const re = /<[\w-]+:Item\b([^>]*?)(\/>|>([\s\S]*?)<\/[\w-]+:Item>)/g;
  for (let m = re.exec(xmp); m; m = re.exec(xmp)) {
    const body = `${m[1]} ${m[3] ?? ""}`;
    const semantic = xmpValue(body, "Semantic");
    if (!semantic) continue;
    items.push({
      semantic,
      length: Number(xmpValue(body, "Length") ?? 0) || 0,
      padding: Number(xmpValue(body, "Padding") ?? 0) || 0,
    });
  }
  return items;
}

export function motionPhotoFlags(xmp: string): { isMotionPhoto: boolean; presentationUs?: number } {
  const motion = xmpValue(xmp, "MotionPhoto") ?? xmpValue(xmp, "MicroVideo");
  const ts =
    xmpValue(xmp, "MotionPhotoPresentationTimestampUs") ??
    xmpValue(xmp, "MicroVideoPresentationTimestampUs");
  return {
    isMotionPhoto: motion === "1",
    presentationUs: ts ? Number(ts) : undefined,
  };
}

function fromContainer(buf: Uint8Array, xmp: string): EmbeddedVideo | null {
  const items = containerItems(xmp);
  const idx = items.findIndex((i) => i.semantic === "MotionPhoto");
  if (idx < 1) return null; // index 0 is always the primary image
  // Items after the primary are laid out back to back at the end of the
  // file, so the video starts at end minus everything from it onwards.
  const tail = items.slice(idx).reduce((n, i) => n + i.length, 0);
  if (!items[idx].length || tail > buf.length) return null;
  const start = buf.length - tail;
  if (!looksLikeMp4At(buf, start)) return null;
  return { start, end: start + items[idx].length, method: "container" };
}

function fromMicroVideo(buf: Uint8Array, xmp: string): EmbeddedVideo | null {
  const offset = Number(xmpValue(xmp, "MicroVideoOffset") ?? 0);
  if (!offset || offset > buf.length) return null;
  const start = buf.length - offset;
  return looksLikeMp4At(buf, start) ? { start, end: buf.length, method: "microvideo" } : null;
}

function fromSamsungMarker(buf: Uint8Array): EmbeddedVideo | null {
  const marker = "MotionPhoto_Data";
  const at = indexOf(buf, marker, 1024);
  if (at < 0) return null;
  const start = at + marker.length;
  return looksLikeMp4At(buf, start) ? { start, end: buf.length, method: "samsung-marker" } : null;
}

/** Samsung HEIC motion photos keep the clip in a top-level `mpvd` box. */
function fromMpvdBox(buf: Uint8Array): EmbeddedVideo | null {
  if (ascii(buf, 4, 8) !== "ftyp") return null;
  let at = 0;
  while (at + 8 <= buf.length) {
    let size = u32(buf, at);
    const type = ascii(buf, at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize; files here are far below 4GB so the high word is 0.
      size = u32(buf, at + 12);
      header = 16;
    } else if (size === 0) {
      size = buf.length - at;
    }
    if (size < header) return null;
    if (type === "mpvd") {
      const start = at + header;
      return looksLikeMp4At(buf, start)
        ? { start, end: Math.min(at + size, buf.length), method: "mpvd" }
        : null;
    }
    at += size;
  }
  return null;
}

function fromScan(buf: Uint8Array): EmbeddedVideo | null {
  // Skip the container's own leading ftyp (HEIC) and the image header.
  for (let at = indexOf(buf, "ftyp", 1024); at >= 0; at = indexOf(buf, "ftyp", at + 4)) {
    if (looksLikeMp4At(buf, at - 4)) {
      return { start: at - 4, end: buf.length, method: "scan" };
    }
  }
  return null;
}

export function findEmbeddedVideo(buf: Uint8Array): EmbeddedVideo | null {
  const xmp = readXmp(buf);
  const found =
    (xmp && fromContainer(buf, xmp)) ||
    (xmp && fromMicroVideo(buf, xmp)) ||
    fromSamsungMarker(buf) ||
    fromMpvdBox(buf) ||
    fromScan(buf);
  // A real clip is at least a few KB; anything smaller is noise.
  if (!found || found.end - found.start < 4096) return null;
  return found;
}
