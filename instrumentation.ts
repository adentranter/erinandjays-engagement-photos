/**
 * Runs once when the Next.js server boots. Starts the in-process media
 * worker that turns uploads into display-ready assets (see
 * lib/processing/worker.ts). Set MEDIA_WORKER=off to run a web-only node.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL || process.env.MEDIA_WORKER === "off") return;
  const { startMediaWorker } = await import("./lib/processing/worker");
  startMediaWorker();
}
