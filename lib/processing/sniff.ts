/**
 * Identify a file from its leading bytes. Extensions and the browser's
 * declared MIME type are hints at best (HEIC often arrives with an empty
 * type, renamed files lie), so processing decisions are made from this.
 */

export type SniffedKind =
  | { kind: "image"; format: "jpeg" | "png" | "webp" | "heic" | "avif" | "tiff" }
  | { kind: "gif" }
  | { kind: "video"; format: "mp4" | "mov" | "webm" | "3gp" }
  | { kind: "unknown" };

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const MOV_BRANDS = new Set(["qt  "]);
const THREEGP_PREFIX = "3g";

function ascii(buf: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, buf.length); i++) s += String.fromCharCode(buf[i]);
  return s;
}

/** Every brand (major + compatible) in a leading ISO-BMFF `ftyp` box. */
export function ftypBrands(buf: Uint8Array): string[] | null {
  if (buf.length < 16 || ascii(buf, 4, 8) !== "ftyp") return null;
  const size = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  const end = Math.min(size >>> 0 || buf.length, buf.length, 4096);
  const brands = [ascii(buf, 8, 12)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(buf, i, i + 4));
  return brands;
}

export function sniff(buf: Uint8Array): SniffedKind {
  if (buf.length < 12) return { kind: "unknown" };

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { kind: "image", format: "jpeg" };
  }
  if (ascii(buf, 0, 8) === "\x89PNG\r\n\x1a\n") return { kind: "image", format: "png" };
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return { kind: "gif" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    return { kind: "image", format: "webp" };
  }
  if (ascii(buf, 0, 4) === "II*\0" || ascii(buf, 0, 4) === "MM\0*") {
    return { kind: "image", format: "tiff" };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: "video", format: "webm" };
  }

  const brands = ftypBrands(buf);
  if (brands) {
    const major = brands[0];
    // Still images first: an AVIF/HEIC sequence can list video brands too.
    if (AVIF_BRANDS.has(major)) return { kind: "image", format: "avif" };
    if (HEIC_BRANDS.has(major)) return { kind: "image", format: "heic" };
    if (MOV_BRANDS.has(major)) return { kind: "video", format: "mov" };
    if (major.startsWith(THREEGP_PREFIX)) return { kind: "video", format: "3gp" };
    if (brands.some((b) => HEIC_BRANDS.has(b)) && !brands.some(isVideoBrand)) {
      return { kind: "image", format: "heic" };
    }
    return { kind: "video", format: "mp4" };
  }

  // Older QuickTime files can start straight with a moov/mdat/wide atom.
  const atom = ascii(buf, 4, 8);
  if (["moov", "mdat", "wide", "free", "skip", "pnot"].includes(atom)) {
    return { kind: "video", format: "mov" };
  }

  return { kind: "unknown" };
}

function isVideoBrand(b: string): boolean {
  return ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  "].includes(b);
}

export function mimeFor(s: SniffedKind): string {
  switch (s.kind) {
    case "gif":
      return "image/gif";
    case "image":
      return s.format === "jpeg" ? "image/jpeg" : `image/${s.format}`;
    case "video":
      if (s.format === "mov") return "video/quicktime";
      if (s.format === "3gp") return "video/3gpp";
      return `video/${s.format}`;
    default:
      return "application/octet-stream";
  }
}
