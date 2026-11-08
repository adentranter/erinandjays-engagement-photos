/** Tunables for media processing. All overridable from the environment. */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const processingConfig = {
  /** Parallel jobs per container. FFmpeg is CPU-heavy; keep this small. */
  concurrency: num("MEDIA_WORKER_CONCURRENCY", 1),
  /** Tries before a job is marked failed (with backoff between them). */
  maxAttempts: num("MEDIA_MAX_ATTEMPTS", 3),
  /** Idle poll interval; uploads also wake the worker immediately. */
  pollMs: num("MEDIA_POLL_MS", 5_000),
  /** A job whose heartbeat is older than this is assumed dead and retried. */
  staleLockMinutes: num("MEDIA_STALE_LOCK_MINUTES", 10),

  /** Refuse to process originals bigger than this (UploadThing caps uploads too). */
  maxOriginalBytes: num("MEDIA_MAX_ORIGINAL_MB", 4096) * 1024 * 1024,

  /** Longest motion clip kept from a Live/Motion Photo. */
  motionMaxSeconds: num("MOTION_MAX_SECONDS", 10),
  /** GIFs are capped tighter than the MP4 clip — they get big fast. */
  gifMaxSeconds: num("GIF_MAX_SECONDS", 6),
  gifWidth: num("GIF_WIDTH", 480),
  gifFps: num("GIF_FPS", 12),
  /** A MOV longer than this is never treated as a Live Photo's motion. */
  livePhotoMaxMs: num("LIVE_PHOTO_MAX_SECONDS", 8) * 1000,
  /** Videos up to this long get a short GIF preview. Longer ones never do. */
  videoGifPreviewMaxSeconds: num("VIDEO_GIF_PREVIEW_MAX_SECONDS", 6),
  /** HEVC etc. are transcoded to H.264 for playback only up to this length. */
  transcodeMaxSeconds: num("VIDEO_TRANSCODE_MAX_SECONDS", 20 * 60),
} as const;

/**
 * Display renditions — unchanged from the original gallery: the same sizes
 * and quality as before. The original is always kept and is what downloads
 * serve.
 */
export const RENDITIONS = [
  { label: "thumb", width: 640, quality: 78 },
  { label: "large", width: 2200, quality: 88 },
] as const;
