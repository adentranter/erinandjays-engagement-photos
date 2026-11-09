/**
 * Runs once when the Next.js server boots. Starts the in-process media
 * worker that turns uploads into display-ready assets (see
 * lib/processing/worker.ts). Set MEDIA_WORKER=off to run a web-only node.
 *
 * The import must sit inside the NEXT_RUNTIME check (not after an early
 * return) so the edge build drops it — the worker needs Node APIs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DATABASE_URL || process.env.MEDIA_WORKER === "off") return;
    const { startMediaWorker } = await import("./lib/processing/worker");
    startMediaWorker();
  }
}
