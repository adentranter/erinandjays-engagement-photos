"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { uploadFiles } from "@/lib/uploadthing";
import { describe, detect, isMediaFile, type Detected } from "@/lib/detect-media";
import { fingerprint } from "@/lib/fingerprint";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface Processing {
  id: string;
  status: "pending" | "uploading" | "processing" | "ready" | "failed";
  type: "image" | "animation" | "video";
  thumb: string | null;
  motionSource: string | null;
  partOf: string | null;
  error: string | null;
}

interface DuplicateMatch {
  reason: "file" | "name" | "selection";
  mine: boolean;
}

type ItemState =
  | "checking" // fingerprinting + asking the server about duplicates
  | "ready"
  | "duplicate" // skipped unless the person chooses "Upload anyway"
  | "uploading"
  | "uploaded"
  | "failed"
  | "cancelled";

interface Item {
  key: string;
  file: File;
  preview: string | null;
  fingerprint: string | null;
  dup: DuplicateMatch | null;
  /** Person chose to upload despite the duplicate warning */
  force: boolean;
  state: ItemState;
  progress: number;
  error: string | null;
  mediaId: string | null;
  processing: Processing | null;
}

type Props =
  | { mode: "guest"; requireCode: boolean; offerEmail?: boolean }
  | { mode: "photographer"; album: "wedding" | "engagement" };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const NAME_KEY = "guest-upload-name";
const CODE_KEY = "guest-upload-code";
const EMAIL_KEY = "guest-upload-email";
const PARALLEL_UPLOADS = 3;

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode etc. — not important
  }
}

let keySeq = 0;
const nextKey = () => `f${Date.now().toString(36)}${(keySeq++).toString(36)}`;

/** Browsers can show these inline; HEIC and most videos they can't. */
function previewable(f: File): boolean {
  return /^image\/(jpeg|png|gif|webp|avif)$/.test(f.type);
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
    })
  );
}

const fieldClass =
  "w-full border border-champagne/30 bg-ink-raised px-4 py-3 text-base font-light text-ivory placeholder:text-ivory-dim/60 focus:border-champagne focus:outline-none";
const smallButton =
  "text-[10px] uppercase tracking-[0.2em] text-ivory-dim transition-colors hover:text-champagne disabled:opacity-40";

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function Uploader(props: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const cancelRun = useRef(false);

  const album = props.mode === "guest" ? "wedding" : props.album;

  useEffect(() => {
    setName(load(NAME_KEY));
    setCode(load(CODE_KEY));
    setEmail(load(EMAIL_KEY));
  }, []);

  // Free preview object URLs when the component goes away.
  useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.preview) URL.revokeObjectURL(it.preview);
    },
    []
  );

  // Don't let people close the tab mid-upload by accident.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const patch = useCallback((key: string, change: Partial<Item>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...change } : it)));
  }, []);

  /* ---------- selecting files ---------- */

  const addFiles = useCallback(
    async (list: FileList | null) => {
      if (!list) return;
      setError(null);
      const existing = itemsRef.current;
      const picked = Array.from(list)
        .filter(isMediaFile)
        // Same file picked twice in this session: ignore quietly.
        .filter((f) => !existing.some((it) => it.file.name === f.name && it.file.size === f.size));
      if (!picked.length) return;

      const fresh: Item[] = picked.map((file) => ({
        key: nextKey(),
        file,
        preview: previewable(file) ? URL.createObjectURL(file) : null,
        fingerprint: null,
        dup: null,
        force: false,
        state: "checking",
        progress: 0,
        error: null,
        mediaId: null,
        processing: null,
      }));
      setItems((prev) => [...prev, ...fresh]);

      // Fingerprint (a couple at a time; each reads ~1.5MB).
      const prints = new Map<string, string | null>();
      await mapLimit(fresh, 2, async (it) => {
        prints.set(it.key, await fingerprint(it.file));
      });

      // Ask the server which ones are already in the album.
      let server: Record<string, { reason: "file" | "name"; mine: boolean }> = {};
      try {
        const res = await fetch("/api/media/duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            album,
            files: fresh.map((it) => ({
              key: it.key,
              name: it.file.name,
              size: it.file.size,
              fingerprint: prints.get(it.key) ?? null,
            })),
          }),
        });
        if (res.ok) server = await res.json();
      } catch {
        // If the check fails, upload normally; the server still refuses exact repeats.
      }

      // Decide each file's fate up front (state updaters must stay pure:
      // React may run them twice).
      const seen = new Set(
        itemsRef.current.filter((it) => it.fingerprint).map((it) => it.fingerprint as string)
      );
      const verdicts = new Map<string, Pick<Item, "fingerprint" | "dup" | "state">>();
      for (const it of fresh) {
        const fp = prints.get(it.key) ?? null;
        const inSelection = fp !== null && seen.has(fp);
        if (fp) seen.add(fp);
        const dup: DuplicateMatch | null = server[it.key]
          ? server[it.key]
          : inSelection
            ? { reason: "selection", mine: true }
            : null;
        verdicts.set(it.key, { fingerprint: fp, dup, state: dup ? "duplicate" : "ready" });
      }
      setItems((prev) =>
        prev.map((it) => (verdicts.has(it.key) ? { ...it, ...verdicts.get(it.key)! } : it))
      );
    },
    [album]
  );

  const remove = (key: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.key === key);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return prev.filter((i) => i.key !== key);
    });
  };

  const removeWhere = (pred: (it: Item) => boolean) => {
    setItems((prev) => {
      for (const it of prev) if (pred(it) && it.preview) URL.revokeObjectURL(it.preview);
      return prev.filter((it) => !pred(it));
    });
  };

  /* ---------- uploading ---------- */

  const uploadOne = async (it: Item) => {
    if (cancelRun.current) return;
    const controller = new AbortController();
    controllers.current.set(it.key, controller);
    patch(it.key, { state: "uploading", progress: 0, error: null });

    const common = {
      files: [it.file],
      signal: controller.signal,
      onUploadProgress: ({ progress }: { progress: number }) => patch(it.key, { progress }),
    };
    const extra = {
      fingerprint: it.fingerprint ?? undefined,
      allowDuplicate: it.force || undefined,
    };

    try {
      const res =
        props.mode === "guest"
          ? await uploadFiles("guest", {
              ...common,
              input: {
                name: name.trim(),
                code: props.requireCode ? code.trim() : undefined,
                email: props.offerEmail && email.trim() ? email.trim() : undefined,
                ...extra,
              },
            })
          : await uploadFiles("photographer", {
              ...common,
              input: { album: props.album, ...extra },
            });
      const id = (res[0]?.serverData as { id?: string } | null)?.id ?? null;
      patch(it.key, { state: "uploaded", progress: 100, mediaId: id });
    } catch (err) {
      if (controller.signal.aborted) {
        patch(it.key, { state: "cancelled", progress: 0 });
      } else {
        const message = err instanceof Error ? err.message : "Upload failed";
        if (/already in the gallery/i.test(message)) {
          patch(it.key, { state: "duplicate", dup: { reason: "file", mine: false }, progress: 0 });
        } else {
          patch(it.key, { state: "failed", error: message, progress: 0 });
        }
      }
    } finally {
      controllers.current.delete(it.key);
    }
  };

  const start = async (only?: Item[]) => {
    setError(null);
    if (props.mode === "guest" && !name.trim()) {
      setError("Add your name so we know who to thank.");
      return;
    }
    if (props.mode === "guest" && props.offerEmail && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That email doesn't look quite right. Leave it empty if you'd rather not get updates.");
      return;
    }
    if (props.mode === "guest") {
      save(NAME_KEY, name.trim());
      if (props.offerEmail) save(EMAIL_KEY, email.trim());
      if (props.requireCode) save(CODE_KEY, code.trim());
    }

    const queue = (only ?? itemsRef.current).filter(
      (it) => it.state === "ready" || it.state === "failed" || it.state === "cancelled" || (it.state === "duplicate" && it.force)
    );
    if (!queue.length) return;

    cancelRun.current = false;
    setRunning(true);
    try {
      await mapLimit(queue, PARALLEL_UPLOADS, uploadOne);
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  const cancelAll = () => {
    cancelRun.current = true;
    for (const c of controllers.current.values()) c.abort();
  };

  /* ---------- processing status after upload ---------- */

  const watching = items
    .filter((it) => it.mediaId && it.processing?.status !== "ready" && it.processing?.status !== "failed" && !it.processing?.partOf)
    .map((it) => it.mediaId as string);
  const watchKey = watching.join(",");

  useEffect(() => {
    if (!watchKey) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/media/status?ids=${watchKey}`, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const rows = (await res.json()) as Processing[];
        const byId = new Map(rows.map((r) => [r.id, r]));
        setItems((prev) =>
          prev.map((it) => (it.mediaId && byId.has(it.mediaId) ? { ...it, processing: byId.get(it.mediaId)! } : it))
        );
        if (rows.every((r) => r.status === "ready" || r.status === "failed" || r.partOf)) {
          router.refresh();
        }
      } catch {
        // transient; try again on the next tick
      }
    };
    const timer = setInterval(poll, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [watchKey, router]);

  /* ---------- derived ---------- */

  const counts = useMemo(() => {
    const c = { checking: 0, ready: 0, duplicate: 0, uploading: 0, uploaded: 0, failed: 0, cancelled: 0 };
    for (const it of items) c[it.state]++;
    return c;
  }, [items]);
  const forced = items.filter((it) => it.state === "duplicate" && it.force).length;
  const inGallery = items.filter(
    (it) => it.state === "duplicate" && !it.force && it.dup?.reason !== "selection"
  ).length;
  const toSend = counts.ready + counts.failed + counts.cancelled + forced;

  const runBytes = useMemo(() => {
    const active = items.filter((it) => it.state === "uploading" || it.state === "uploaded");
    const total = active.reduce((n, it) => n + it.file.size, 0);
    const done = active.reduce((n, it) => n + (it.file.size * it.progress) / 100, 0);
    return { total, done, pct: total ? (done / total) * 100 : 0 };
  }, [items]);

  const pendingFiles = useMemo(
    () => items.filter((it) => it.state !== "uploaded").map((it) => it.file),
    [items]
  );
  useEffect(() => {
    let cancelled = false;
    if (!pendingFiles.length) {
      setDetected(null);
      return;
    }
    void detect(pendingFiles).then((d) => !cancelled && setDetected(d));
    return () => {
      cancelled = true;
    };
  }, [pendingFiles]);

  const processingDone = items.filter(
    (it) => it.processing && (it.processing.status === "ready" || it.processing.partOf)
  ).length;

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-5">
      {props.mode === "guest" && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="name"
            placeholder="e.g. Aunty Sue"
            className={fieldClass}
          />
        </label>
      )}

      {props.mode === "guest" && props.offerEmail && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            Your email <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            placeholder="We'll tell you when new photos are added"
            className={fieldClass}
          />
        </label>
      )}

      {props.mode === "guest" && props.requireCode && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">Guest code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={100}
            autoCapitalize="none"
            placeholder="On your table card"
            className={fieldClass}
          />
        </label>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={`flex min-h-40 flex-col items-center justify-center gap-3 border border-dashed px-6 py-8 text-center transition-colors ${
          dragging
            ? "border-champagne bg-champagne/10"
            : "border-champagne/40 hover:border-champagne hover:bg-champagne/5"
        }`}
      >
        <span className="font-display text-3xl font-light italic">
          {items.length > 0 ? "Add more" : "Choose photos & videos"}
        </span>
        <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          Tap to browse, or drop them here
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mov"
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {detected && pendingFiles.length > 0 && describe(detected) && (
        <p className="text-center text-[11px] uppercase tracking-[0.25em] text-champagne" aria-live="polite">
          {describe(detected)}
        </p>
      )}

      {detected?.stillsWithoutMotion && (
        <p className="border border-champagne/25 px-4 py-3 text-center text-sm font-light leading-relaxed text-ivory-dim">
          Uploading Live Photos from an iPhone? Your phone may only send the
          still picture. To keep the movement, open the photo in Photos, tap
          Share → <span className="text-ivory">Save as Video</span>, and upload
          that video too.
        </p>
      )}

      {items.length > 0 && (
        <section className="flex flex-col gap-4 border border-champagne/20 p-4" aria-label="Your selection">
          {/* Summary + bulk controls */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
            <span className="text-ivory">
              {[
                counts.checking && `${counts.checking} checking`,
                counts.ready && `${counts.ready} ready`,
                counts.uploading && `${counts.uploading} uploading`,
                counts.uploaded && `${counts.uploaded} uploaded`,
                counts.duplicate && `${counts.duplicate} duplicate${counts.duplicate === 1 ? "" : "s"}`,
                counts.failed && `${counts.failed} failed`,
                counts.cancelled && `${counts.cancelled} cancelled`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="flex flex-wrap gap-4">
              {counts.duplicate > forced && !running && (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => removeWhere((it) => it.state === "duplicate" && !it.force)}
                >
                  Remove duplicates
                </button>
              )}
              {counts.uploaded > 0 && !running && (
                <button type="button" className={smallButton} onClick={() => removeWhere((it) => it.state === "uploaded")}>
                  Clear uploaded
                </button>
              )}
              {!running && (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => removeWhere((it) => it.state !== "uploading")}
                >
                  Clear all
                </button>
              )}
            </span>
          </div>

          {inGallery > 0 && (
            <p className="text-sm font-light leading-relaxed text-ivory-dim">
              {inGallery === 1 ? "One file looks" : `${inGallery} files look`} like
              {inGallery === 1 ? " it's" : " they're"} already in the gallery, so
              {inGallery === 1 ? " it" : " they"}&rsquo;ll be skipped. Tap{" "}
              <span className="text-ivory">Upload anyway</span> if that&rsquo;s wrong.
            </p>
          )}

          {(running || counts.uploaded > 0) && runBytes.total > 0 && (
            <div className="flex flex-col gap-1.5" aria-live="polite">
              <div className="h-1 w-full bg-champagne/15">
                <div
                  className="h-1 bg-champagne transition-[width] duration-300"
                  style={{ width: `${runBytes.pct}%` }}
                />
              </div>
              <p className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-ivory-dim">
                <span>
                  {formatBytes(runBytes.done)} of {formatBytes(runBytes.total)}
                </span>
                <span>{running ? "Keep this page open" : `${Math.round(runBytes.pct)}%`}</span>
              </p>
            </div>
          )}

          <ul className="flex max-h-[28rem] flex-col divide-y divide-champagne/10 overflow-y-auto">
            {items.map((it) => (
              <FileRow
                key={it.key}
                item={it}
                running={running}
                onRemove={() => remove(it.key)}
                onCancel={() => controllers.current.get(it.key)?.abort()}
                onRetry={() => void start([it])}
                onForce={() => patch(it.key, { force: true })}
                onUnforce={() => patch(it.key, { force: false })}
              />
            ))}
          </ul>
        </section>
      )}

      {running ? (
        <button
          type="button"
          onClick={cancelAll}
          className="border border-champagne/60 px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ivory transition-colors hover:bg-champagne/10"
        >
          Cancel uploads
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={toSend === 0 || counts.checking > 0}
          className="bg-champagne px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {counts.checking > 0
            ? "Checking…"
            : toSend > 0
              ? `Upload ${toSend} file${toSend === 1 ? "" : "s"}`
              : "Upload"}
        </button>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-[#e8a598]">
          {error}
        </p>
      )}

      {counts.uploaded > 0 && !running && (
        <p className="text-center text-sm font-light text-ivory" aria-live="polite">
          Thank you — {counts.uploaded} file{counts.uploaded === 1 ? "" : "s"} added
          {processingDone < counts.uploaded ? ", getting them ready for the gallery…" : "."}{" "}
          <Link
            href={props.mode === "guest" ? "/wedding" : `/${props.album}`}
            className="text-champagne underline underline-offset-4"
          >
            See the gallery
          </Link>
        </p>
      )}

      {items.length === 0 && <MotionHelp />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One file in the list                                                */
/* ------------------------------------------------------------------ */

function FileRow({
  item: it,
  running,
  onRemove,
  onCancel,
  onRetry,
  onForce,
  onUnforce,
}: {
  item: Item;
  running: boolean;
  onRemove: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onForce: () => void;
  onUnforce: () => void;
}) {
  const isVideo = it.file.type.startsWith("video/") || /\.(mov|mp4|m4v)$/i.test(it.file.name);
  const thumb = it.processing?.thumb ?? it.preview;

  let status: React.ReactNode;
  switch (it.state) {
    case "checking":
      status = "Checking…";
      break;
    case "ready":
      status = "Ready";
      break;
    case "duplicate":
      status = it.force ? (
        <span className="text-champagne">Will upload anyway</span>
      ) : (
        <span className="text-champagne">
          {it.dup?.reason === "selection"
            ? "Selected twice, skipping"
            : it.dup?.mine
              ? "You already uploaded this"
              : "Already in the gallery"}
        </span>
      );
      break;
    case "uploading":
      status = `${Math.round(it.progress)}%`;
      break;
    case "uploaded":
      status = it.processing?.partOf
        ? "Added to its Live Photo ✓"
        : it.processing?.status === "ready"
          ? it.processing.type === "animation"
            ? "In the gallery ✓ (moving)"
            : "In the gallery ✓"
          : it.processing?.status === "failed"
            ? <span className="text-[#e8a598]">Uploaded; couldn&rsquo;t process</span>
            : "Uploaded · processing…";
      break;
    case "failed":
      status = <span className="text-[#e8a598]">{it.error ?? "Failed"}</span>;
      break;
    case "cancelled":
      status = "Cancelled";
      break;
  }

  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="relative h-12 w-12 shrink-0 overflow-hidden bg-ink">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.15em] text-ivory-dim">
            {isVideo ? "Video" : (it.file.name.split(".").pop() ?? "File").slice(0, 4)}
          </span>
        )}
        {it.state === "duplicate" && !it.force && <span className="absolute inset-0 bg-ink/60" />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`truncate text-sm font-light ${it.state === "duplicate" && !it.force ? "text-ivory-dim line-through decoration-ivory-dim/50" : "text-ivory"}`}>
            {it.file.name}
          </span>
          <span className="shrink-0 text-[10px] tracking-[0.1em] text-ivory-dim">{formatBytes(it.file.size)}</span>
        </div>
        {it.state === "uploading" ? (
          <div className="h-0.5 w-full bg-champagne/15">
            <div className="h-0.5 bg-champagne transition-[width] duration-200" style={{ width: `${it.progress}%` }} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-ivory-dim">
          <span className="truncate normal-case tracking-[0.05em]">{status}</span>
          <span className="flex shrink-0 gap-3">
            {it.state === "uploading" && (
              <button type="button" className={smallButton} onClick={onCancel}>
                Cancel
              </button>
            )}
            {(it.state === "failed" || it.state === "cancelled") && !running && (
              <button type="button" className={smallButton} onClick={onRetry}>
                Retry
              </button>
            )}
            {it.state === "duplicate" && it.dup?.reason !== "selection" && (
              <button type="button" className={smallButton} onClick={it.force ? onUnforce : onForce}>
                {it.force ? "Skip" : "Upload anyway"}
              </button>
            )}
            {it.state !== "uploading" && it.state !== "uploaded" && (
              <button type="button" className={smallButton} onClick={onRemove} aria-label={`Remove ${it.file.name}`}>
                Remove
              </button>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

function MotionHelp() {
  return (
    <details className="text-sm font-light leading-relaxed text-ivory-dim">
      <summary className="cursor-pointer text-center text-[11px] uppercase tracking-[0.3em] hover:text-champagne">
        Live Photos &amp; Motion Photos
      </summary>
      <div className="mt-4 flex flex-col gap-3">
        <p>
          Just pick them like any other photo; we&rsquo;ll keep the movement
          wherever your phone includes it.
        </p>
        <p>
          <span className="text-ivory">iPhone:</span> most browsers only hand
          over the still picture. To keep a Live Photo moving, open it in
          Photos, tap Share → Save as Video, then upload the video. From a
          computer, uploading the photo and its matching .MOV together works
          too.
        </p>
        <p>
          <span className="text-ivory">Android:</span> Motion Photos usually
          come through with their movement. If one arrives still, share it
          from Google Photos as a video instead.
        </p>
      </div>
    </details>
  );
}
