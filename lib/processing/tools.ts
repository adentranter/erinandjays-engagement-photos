import "server-only";
import { spawn } from "node:child_process";

/**
 * Thin wrappers around the media CLIs installed in the Docker image
 * (ffmpeg/ffprobe, libheif, exiftool). Every call has a hard timeout so a
 * malformed or hostile file can't wedge the worker.
 */

export class ToolMissingError extends Error {}

interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export function run(
  cmd: string,
  args: string[],
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      // Keep only the tail; ffmpeg can be chatty.
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new ToolMissingError(`${cmd} is not installed`) : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

/* ---------------- ffprobe ---------------- */

export interface VideoInfo {
  width: number;
  height: number;
  durationMs: number;
  codec: string;
  hasAudio: boolean;
  /** Rotation the player must apply (from the display matrix), 0/90/180/270 */
  rotation: number;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeoutMs: 30_000 }
  );
  const data = JSON.parse(stdout.toString()) as {
    streams?: ProbeStream[];
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("No video stream found");

  const raw = Number(
    video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0
  );
  const rotation = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
  const sideways = rotation === 90 || rotation === 270;
  const seconds = Number(data.format?.duration ?? video.duration ?? 0);

  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    codec: video.codec_name ?? "unknown",
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    rotation,
  };
}

/* ---------------- ffmpeg ---------------- */

/**
 * Extra clockwise rotation chosen in the studio. ffmpeg already applies the
 * file's own rotation metadata (autorotate), so this is on top of that.
 */
function turn(degrees = 0): string[] {
  switch (((degrees % 360) + 360) % 360) {
    case 90:
      return ["transpose=clock"];
    case 180:
      return ["hflip", "vflip"];
    case 270:
      return ["transpose=cclock"];
    default:
      return [];
  }
}

function filters(...parts: Array<string | string[]>): string {
  return parts.flat().filter(Boolean).join(",");
}

/** Scale so the long edge is at most `max`, keeping even dimensions. */
function fitLongEdge(max: number): string {
  return `scale='if(gte(iw,ih),min(${max},iw),-2)':'if(gte(iw,ih),-2,min(${max},ih))':flags=lanczos`;
}

export async function videoPoster(
  input: string,
  output: string,
  durationMs: number,
  rotate = 0
): Promise<void> {
  // Skip the first frame or so: phones often start on a black/blurred frame.
  const at = durationMs > 1500 ? "0.5" : "0";
  const vf = filters(turn(rotate));
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", at, "-i", input,
    ...(vf ? ["-vf", vf] : []),
    "-frames:v", "1", "-q:v", "2",
    output,
  ], { timeoutMs: 60_000 });
}

/** Short, silent, looping H.264 clip for Live/Motion Photos. */
export async function motionClip(
  input: string,
  output: string,
  { maxSeconds, maxEdge = 1080, rotate = 0 }: { maxSeconds: number; maxEdge?: number; rotate?: number }
): Promise<void> {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-t", String(maxSeconds), "-i", input,
    "-an",
    "-vf", filters(turn(rotate), fitLongEdge(maxEdge)),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    output,
  ], { timeoutMs: 180_000 });
}

/** Two-pass palette GIF: 12fps, ≤480px, infinite loop, no audio. */
export async function animatedGif(
  input: string,
  output: string,
  {
    maxSeconds,
    fps = 12,
    width = 480,
    rotate = 0,
  }: { maxSeconds: number; fps?: number; width?: number; rotate?: number }
): Promise<void> {
  const chain =
    filters(turn(rotate), `fps=${fps}`, `scale='min(${width},iw)':-1:flags=lanczos`) +
    `,split[a][b];` +
    `[a]palettegen=max_colors=256:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-t", String(maxSeconds), "-i", input,
    "-an", "-filter_complex", chain, "-loop", "0",
    output,
  ], { timeoutMs: 180_000 });
}

/**
 * Full-length H.264/AAC MP4 with upright pixels: used for codecs browsers
 * can't play (HEVC etc.) and for any rotated video, so playback never
 * depends on a player honouring rotation metadata.
 */
export async function playbackTranscode(
  input: string,
  output: string,
  { hasAudio, rotate = 0 }: { hasAudio: boolean; rotate?: number }
): Promise<void> {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-vf", filters(turn(rotate), fitLongEdge(1920)),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]),
    "-movflags", "+faststart",
    output,
  ], { timeoutMs: 60 * 60_000 });
}

/* ---------------- HEIC ---------------- */

/**
 * Decode HEIC/HEIF to a full-resolution JPEG. sharp's bundled libvips can't
 * decode HEVC-coded images, so this goes through libheif (heif-dec, called
 * heif-convert before libheif 1.18), falling back to ffmpeg.
 */
export async function heicToJpeg(input: string, output: string): Promise<void> {
  const attempts: Array<[string, string[]]> = [
    ["heif-dec", ["-q", "95", input, output]],
    ["heif-convert", ["-q", "95", input, output]],
    ["ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-frames:v", "1", "-q:v", "1", output]],
  ];
  let lastError: unknown;
  for (const [cmd, args] of attempts) {
    try {
      await run(cmd, args, { timeoutMs: 120_000 });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not convert HEIC");
}

/* ---------------- exiftool ---------------- */

/**
 * Apple's ContentIdentifier links a Live Photo's still and its MOV even when
 * the filenames don't match. Optional: returns null if exiftool is missing.
 */
export async function appleContentId(file: string): Promise<string | null> {
  try {
    const { stdout } = await run(
      "exiftool",
      ["-j", "-n", "-ContentIdentifier", "-MediaGroupUUID", file],
      { timeoutMs: 20_000 }
    );
    const [tags] = JSON.parse(stdout.toString()) as Array<Record<string, unknown>>;
    const id = tags?.ContentIdentifier ?? tags?.MediaGroupUUID;
    return typeof id === "string" && id.length >= 8 ? id.toUpperCase() : null;
  } catch (err) {
    if (err instanceof ToolMissingError) return null;
    return null; // metadata is best-effort; never fail a job on it
  }
}
