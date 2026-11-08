import "server-only";
import { db } from "@/lib/db";
import { processingConfig as cfg } from "./config";
import { processMedia } from "./process";
import { PermanentError } from "./storage";

/**
 * A small Postgres-backed job queue. The `media` table is the queue:
 * `status = 'pending'` rows are claimed with FOR UPDATE SKIP LOCKED, so
 * several containers (or a restart mid-job) never double-process a row.
 * A heartbeat keeps long transcodes from looking abandoned; rows whose
 * heartbeat stops (crash, redeploy) are picked up again automatically.
 */

interface WorkerState {
  started: boolean;
  running: number;
  waiters: Set<() => void>;
}

const g = globalThis as unknown as { __mediaWorker?: WorkerState };
const state: WorkerState = (g.__mediaWorker ??= { started: false, running: 0, waiters: new Set() });

export function startMediaWorker(): void {
  if (state.started) return;
  state.started = true;
  console.log(`[media] worker started (concurrency ${cfg.concurrency})`);
  for (let i = 0; i < cfg.concurrency; i++) void loop(i);
}

/** Called after an upload so it's picked up without waiting for the poll. */
export function nudgeMediaWorker(): void {
  for (const wake of [...state.waiters]) wake();
}

async function loop(slot: number): Promise<void> {
  for (;;) {
    let claimed: { id: string; attempts: number } | null = null;
    try {
      claimed = await claim();
    } catch (err) {
      console.error("[media] claim failed:", err);
    }

    if (!claimed) {
      await idle();
      continue;
    }

    state.running++;
    const heartbeat = setInterval(() => {
      void db.media
        .updateMany({ where: { id: claimed!.id, status: "processing" }, data: { lockedAt: new Date() } })
        .catch(() => {});
    }, 60_000);
    const started = Date.now();
    try {
      await processMedia(claimed.id);
      console.log(`[media] ${claimed.id} ready in ${((Date.now() - started) / 1000).toFixed(1)}s (slot ${slot})`);
    } catch (err) {
      await fail(claimed.id, claimed.attempts, err);
    } finally {
      clearInterval(heartbeat);
      state.running--;
    }
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, cfg.pollMs);
    function done() {
      clearTimeout(timer);
      state.waiters.delete(done);
      resolve();
    }
    state.waiters.add(done);
  });
}

async function claim(): Promise<{ id: string; attempts: number } | null> {
  const rows = await db.$queryRaw<Array<{ id: string; attempts: number }>>`
    UPDATE "media"
       SET "status" = 'processing', "locked_at" = now(), "attempts" = "attempts" + 1
     WHERE "id" = (
       SELECT "id" FROM "media"
        WHERE ("status" = 'pending' AND "run_after" <= now())
           OR ("status" = 'processing'
               AND "locked_at" < now() - make_interval(mins => ${cfg.staleLockMinutes}::int))
        ORDER BY "run_after", "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING "id"::text AS "id", "attempts"`;
  return rows[0] ?? null;
}

async function fail(id: string, attempts: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const permanent = err instanceof PermanentError;
  const giveUp = permanent || attempts >= cfg.maxAttempts;
  // 30s, 2m, 8m …
  const backoffMs = 30_000 * 4 ** Math.max(0, attempts - 1);
  console.error(`[media] ${id} attempt ${attempts} failed${giveUp ? " (giving up)" : ""}:`, message);
  await db.media
    .update({
      where: { id },
      data: {
        status: giveUp ? "failed" : "pending",
        error: message.slice(0, 500),
        lockedAt: null,
        runAfter: new Date(Date.now() + (giveUp ? 0 : backoffMs)),
      },
    })
    .catch(() => {}); // row deleted mid-job
}

/** Put a failed (or any) item back in the queue from scratch. */
export async function requeue(id: string): Promise<void> {
  await db.media.updateMany({
    where: { id },
    data: { status: "pending", attempts: 0, error: null, runAfter: new Date(), lockedAt: null },
  });
  nudgeMediaWorker();
}
