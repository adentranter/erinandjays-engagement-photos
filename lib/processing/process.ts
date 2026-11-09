import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Media } from "@prisma/client";
import { db } from "@/lib/db";
import { processingConfig as cfg, RENDITIONS } from "./config";
import { findEmbeddedVideo } from "./motion-photo";
import { mimeFor, sniff, type SniffedKind } from "./sniff";
import { downloadTo, PermanentError, storeFiles, utapi } from "./storage";
import {
  animatedGif,
  appleContentId,
  heicToJpeg,
  motionClip,
  playbackTranscode,
  probeVideo,
  videoPoster,
  type VideoInfo,
} from "./tools";

/**
 * Turn one uploaded original into everything the gallery needs.
 *
 *   still image  → thumb + large WebP (HEIC decoded first)
 *   motion photo → the above + motion.mp4 + motion.gif   (type: animation)
 *   Live Photo   → the above, motion taken from the paired MOV
 *   GIF          → animated WebP renditions; the GIF itself is kept
 *   video        → poster renditions, H.264 transcode if needed,
 *                  GIF preview only when it's very short
 *
 * The original is never modified. Generated files replace the previous
 * set only after the new set is stored and the row updated.
 */

sharp.cache(false); // one-shot images; don't hold decoded pixels between jobs

interface Asset {
  path: string;
  name: string;
  type: string;
  role: "thumb" | "large" | "video" | "gif";
}

interface Result {
  type: "image" | "animation" | "video";
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  motionSource: string | null;
  contentId: string | null;
  gifIsOriginal?: boolean;
  assets: Asset[];
}

export async function processMedia(id: string): Promise<void> {
  const row = await db.media.findUnique({ where: { id } });
  if (!row) return;
  if (row.companionOf) {
    await finish(row, null);
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `media-${id.slice(0, 8)}-`));
  try {
    const original = path.join(dir, "original");
    await downloadTo(row.url, original, cfg.maxOriginalBytes);
    const head = await readHead(original, 64 * 1024);
    const kind = sniff(head);

    let result: Result | "merged";
    switch (kind.kind) {
      case "image":
        result = await processStill(row, original, kind, dir);
        break;
      case "gif":
        result = await processGif(row, original, dir);
        break;
      case "video":
        result = await processVideo(row, original, kind, dir);
        break;
      default:
        throw new PermanentError("This file isn't a supported photo or video");
    }

    if (result === "merged") return; // became part of a Live Photo
    await finish(row, result);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fh = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/* ------------------------------------------------------------------ */
/* Stills (JPEG/PNG/WebP/HEIC/AVIF/TIFF), Motion Photos, Live Photos   */
/* ------------------------------------------------------------------ */

async function processStill(
  row: Media,
  original: string,
  kind: Extract<SniffedKind, { kind: "image" }>,
  dir: string
): Promise<Result> {
  let still = original;
  if (kind.format === "heic") {
    still = path.join(dir, "decoded.jpg");
    await heicToJpeg(original, still);
  }

  const assets = await renditions(row.id, still, dir, { animated: false, rotate: row.rotation });
  const meta = await sharp(still, { failOn: "error" }).metadata();
  const sideways = ((meta.orientation ?? 1) >= 5) !== (row.rotation % 180 === 90);
  const width = (sideways ? meta.height : meta.width) ?? null;
  const height = (sideways ? meta.width : meta.height) ?? null;

  const canHoldMotion = kind.format === "jpeg" || kind.format === "heic";
  const contentId = canHoldMotion ? await appleContentId(original) : null;

  const base: Result = {
    type: "image",
    mimeType: mimeFor(kind),
    width,
    height,
    durationMs: null,
    motionSource: null,
    contentId,
    assets,
  };
  if (!canHoldMotion) return base;

  // Android: the clip is inside this file.
  let motionSrc: string | null = null;
  let motionSource: "motion_photo" | "live_photo" | null = null;
  const embedded = findEmbeddedVideo(await fs.readFile(original));
  if (embedded) {
    motionSrc = path.join(dir, "embedded.mp4");
    const fh = await fs.open(original, "r");
    try {
      const buf = Buffer.alloc(embedded.end - embedded.start);
      await fh.read(buf, 0, buf.length, embedded.start);
      await fs.writeFile(motionSrc, buf);
    } finally {
      await fh.close();
    }
    motionSource = "motion_photo";
  }

  // iPhone: the clip is a separate MOV uploaded alongside.
  let companion: Media | null = null;
  if (!motionSrc) {
    companion = await findLiveCompanion(row, contentId);
    if (companion) {
      motionSrc = path.join(dir, "live.mov");
      await downloadTo(companion.url, motionSrc, 200 * 1024 * 1024);
      motionSource = "live_photo";
    }
  }
  if (!motionSrc || !motionSource) return base;

  try {
    const info = await probeVideo(motionSrc);
    if (motionSource === "live_photo" && info.durationMs > cfg.livePhotoMaxMs) {
      return base; // same name but a real video, not Live Photo motion
    }
    const motion = await motionAssets(row.id, motionSrc, info, dir, row.rotation);
    if (companion) await markCompanion(companion, row.id, info);
    return {
      ...base,
      type: "animation",
      durationMs: Math.min(info.durationMs, cfg.motionMaxSeconds * 1000),
      motionSource,
      assets: [...assets, ...motion],
    };
  } catch (err) {
    // A broken clip shouldn't cost the photo: keep it as a still.
    console.warn(`[media] ${row.id}: motion extraction failed, keeping still:`, err);
    return base;
  }
}

async function motionAssets(
  id: string,
  src: string,
  info: VideoInfo,
  dir: string,
  rotate: number
): Promise<Asset[]> {
  const mp4 = path.join(dir, "motion.mp4");
  const gif = path.join(dir, "motion.gif");
  await motionClip(src, mp4, { maxSeconds: cfg.motionMaxSeconds, rotate });
  await animatedGif(src, gif, {
    maxSeconds: Math.min(cfg.gifMaxSeconds, Math.ceil(info.durationMs / 1000) || cfg.gifMaxSeconds),
    fps: cfg.gifFps,
    width: cfg.gifWidth,
    rotate,
  });
  return [
    { path: mp4, name: `${id}.motion.mp4`, type: "video/mp4", role: "video" },
    { path: gif, name: `${id}.motion.gif`, type: "image/gif", role: "gif" },
  ];
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

/** Uploads from the same person, close together in time. */
function sameUploadScope(row: Media) {
  const windowMs = 6 * 60 * 60 * 1000;
  return {
    album: row.album,
    role: row.role,
    uploaderName: row.uploaderName,
    id: { not: row.id },
    createdAt: {
      gte: new Date(row.createdAt.getTime() - windowMs),
      lte: new Date(row.createdAt.getTime() + windowMs),
    },
  };
}

/** A Live Photo's MOV: same ContentIdentifier, or same filename stem. */
async function findLiveCompanion(row: Media, contentId: string | null): Promise<Media | null> {
  const candidates = await db.media.findMany({
    where: {
      ...sameUploadScope(row),
      type: "video",
      OR: [{ companionOf: null }, { companionOf: row.id }],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const name = stem(row.fileName);
  const fits = (c: Media) => c.durationMs === null || c.durationMs <= cfg.livePhotoMaxMs;
  return (
    (contentId && candidates.find((c) => c.contentId === contentId && fits(c))) ||
    candidates.find((c) => stem(c.fileName) === name && fits(c)) ||
    null
  );
}

async function markCompanion(video: Media, stillId: string, info: VideoInfo): Promise<void> {
  await db.media.update({
    where: { id: video.id },
    data: {
      companionOf: stillId,
      status: "ready",
      error: null,
      lockedAt: null,
      processedAt: new Date(),
      width: info.width,
      height: info.height,
      durationMs: info.durationMs,
    },
  });
}

/* ------------------------------------------------------------------ */
/* GIF                                                                 */
/* ------------------------------------------------------------------ */

async function processGif(row: Media, original: string, dir: string): Promise<Result> {
  const meta = await sharp(original, { animated: true, failOn: "error" }).metadata();
  const frames = meta.pages ?? 1;
  const assets = await renditions(row.id, original, dir, { animated: frames > 1, rotate: row.rotation });
  const sideways = row.rotation % 180 === 90;
  const w = meta.width ?? null;
  const h = meta.pageHeight ?? meta.height ?? null;
  return {
    type: frames > 1 ? "animation" : "image",
    mimeType: "image/gif",
    width: sideways ? h : w,
    height: sideways ? w : h,
    durationMs: meta.delay ? meta.delay.reduce((a, b) => a + b, 0) : null,
    motionSource: frames > 1 ? "gif" : null,
    contentId: null,
    gifIsOriginal: frames > 1,
    assets,
  };
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

async function processVideo(
  row: Media,
  original: string,
  kind: Extract<SniffedKind, { kind: "video" }>,
  dir: string
): Promise<Result | "merged"> {
  const info = await probeVideo(original).catch((err) => {
    throw new PermanentError(`This video couldn't be read (${(err as Error).message})`);
  });
  const contentId = kind.format === "mov" ? await appleContentId(original) : null;

  // Is this the motion half of a Live Photo whose still is also here?
  if (info.durationMs <= cfg.livePhotoMaxMs) {
    const still = await findLiveStill(row, contentId);
    if (still) {
      await db.$transaction([
        db.media.update({
          where: { id: row.id },
          data: {
            companionOf: still.id,
            contentId,
            mimeType: mimeFor(kind),
            width: info.width,
            height: info.height,
            durationMs: info.durationMs,
            status: "ready",
            error: null,
            lockedAt: null,
            processedAt: new Date(),
          },
        }),
        // Re-run the still so it picks this clip up (no-op if it already has).
        ...(still.motionSource
          ? []
          : [
              db.media.update({
                where: { id: still.id },
                data: { status: "pending", attempts: 0, runAfter: new Date() },
              }),
            ]),
      ]);
      return "merged";
    }
  }

  const rotate = row.rotation;
  const poster = path.join(dir, "poster.jpg");
  await videoPoster(original, poster, info.durationMs, rotate);
  const assets = await renditions(row.id, poster, dir, { animated: false });

  // Re-encode when the browser can't play the codec, or when the picture
  // relies on rotation metadata / a studio rotation: the MP4 we serve then
  // has upright pixels and plays the right way up everywhere.
  const playable = info.codec === "h264" || (kind.format === "webm" && /^vp[89]$|^av1$/.test(info.codec));
  const needsTurn = info.rotation !== 0 || rotate !== 0;
  if ((!playable || needsTurn) && info.durationMs <= cfg.transcodeMaxSeconds * 1000) {
    const mp4 = path.join(dir, "playback.mp4");
    await playbackTranscode(original, mp4, { hasAudio: info.hasAudio, rotate });
    assets.push({ path: mp4, name: `${row.id}.playback.mp4`, type: "video/mp4", role: "video" });
  }

  if (info.durationMs > 0 && info.durationMs <= cfg.videoGifPreviewMaxSeconds * 1000) {
    const gif = path.join(dir, "preview.gif");
    await animatedGif(original, gif, {
      maxSeconds: cfg.gifMaxSeconds,
      fps: cfg.gifFps,
      width: cfg.gifWidth,
      rotate,
    });
    assets.push({ path: gif, name: `${row.id}.preview.gif`, type: "image/gif", role: "gif" });
  }

  const sideways = rotate % 180 === 90;
  return {
    type: "video",
    mimeType: mimeFor(kind),
    width: sideways ? info.height : info.width,
    height: sideways ? info.width : info.height,
    durationMs: info.durationMs,
    motionSource: null,
    contentId,
    assets,
  };
}

async function findLiveStill(row: Media, contentId: string | null): Promise<Media | null> {
  const candidates = await db.media.findMany({
    where: { ...sameUploadScope(row), type: { in: ["image", "animation"] }, companionOf: null },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const name = stem(row.fileName);
  // Only stills that could carry a Live Photo (not PNG screenshots, GIFs).
  const eligible = (c: Media) =>
    c.motionSource !== "motion_photo" &&
    c.motionSource !== "gif" &&
    (c.mimeType === null || c.mimeType === "image/jpeg" || c.mimeType === "image/heic");
  return (
    (contentId && candidates.find((c) => c.contentId === contentId && eligible(c))) ||
    candidates.find((c) => stem(c.fileName) === name && eligible(c)) ||
    null
  );
}

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

async function renditions(
  id: string,
  source: string,
  dir: string,
  { animated, rotate = 0 }: { animated: boolean; rotate?: number }
): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const r of RENDITIONS) {
    const file = path.join(dir, `${r.label}.webp`);
    await sharp(source, { animated, failOn: "error", limitInputPixels: 200_000_000 })
      .autoOrient() // EXIF orientation first…
      .rotate(rotate) // …then any studio rotation on top
      .resize({ width: r.width, withoutEnlargement: true })
      .webp({ quality: r.quality, ...(animated ? { loop: 0 } : {}) })
      .toFile(file);
    out.push({ path: file, name: `${id}.${r.label}.webp`, type: "image/webp", role: r.label });
  }
  return out;
}

/** Store the new assets, update the row, then drop the old generated files. */
async function finish(row: Media, result: Result | null): Promise<void> {
  if (!result) {
    await db.media.update({
      where: { id: row.id },
      data: { status: "ready", error: null, lockedAt: null, processedAt: new Date() },
    });
    return;
  }

  const stored = await storeFiles(result.assets);
  const urlFor = (role: Asset["role"]) => {
    const i = result.assets.findIndex((a) => a.role === role);
    return i >= 0 ? stored[i].url : null;
  };
  const newKeys = stored.map((s) => s.key);

  // If someone pressed Rotate while this ran, the row now wants a different
  // result and has been re-queued: don't overwrite it, discard this output.
  const { count } = await db.media.updateMany({
    where: { id: row.id, rotation: row.rotation, status: "processing" },
    data: {
      type: result.type,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      durationMs: result.durationMs,
      thumbUrl: urlFor("thumb"),
      largeUrl: urlFor("large"),
      videoUrl: urlFor("video"),
      gifUrl: result.gifIsOriginal ? row.url : urlFor("gif"),
      motionSource: result.motionSource,
      contentId: result.contentId,
      derivedKeys: newKeys,
      status: "ready",
      error: null,
      lockedAt: null,
      processedAt: new Date(),
    },
  });
  if (count === 0) {
    await utapi.deleteFiles(newKeys).catch(() => {});
    return;
  }

  const stale = row.derivedKeys.filter((k) => !newKeys.includes(k));
  if (stale.length) {
    await utapi.deleteFiles(stale).catch((err) => {
      console.warn(`[media] ${row.id}: couldn't delete old renditions:`, err);
    });
  }
}
