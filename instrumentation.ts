/**
 * Runs once when the Next.js server boots. Starts the in-process media
 * worker that turns uploads into display-ready assets (see
 * lib/processing/worker.ts), and the watcher that emails out new uploads
 * (lib/notify.ts). Set MEDIA_WORKER=off to run a web-only node.
 *
 * The imports must sit inside the NEXT_RUNTIME check (not after an early
 * return) so the edge build drops them — they need Node APIs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DATABASE_URL) return;
    // Safe on every node: only one claims each batch.
    const { startNotifier } = await import("./lib/notify");
    startNotifier();
    if (process.env.MEDIA_WORKER === "off") return;
    const { startMediaWorker } = await import("./lib/processing/worker");
    startMediaWorker();
  }
}
