"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUploadThing } from "@/lib/uploadthing";

type Props =
  | { mode: "guest"; requireCode: boolean }
  | { mode: "photographer"; album: "wedding" | "engagement" };

const NAME_KEY = "guest-upload-name";
const CODE_KEY = "guest-upload-code";

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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const fieldClass =
  "w-full border border-champagne/30 bg-ink-raised px-4 py-3 text-base font-light text-ivory placeholder:text-ivory-dim/60 focus:border-champagne focus:outline-none";

export function Uploader(props: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [batch, setBatch] = useState<{
    done: number;
    current: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);

  useEffect(() => {
    setName(load(NAME_KEY));
    setCode(load(CODE_KEY));
  }, []);

  const lastError = useRef<string | null>(null);
  const hookOpts = {
    onUploadProgress: setProgress,
    onUploadError: (e: Error) => {
      lastError.current = e.message;
    },
    uploadProgressGranularity: "fine",
  } as const;
  const guest = useUploadThing("guest", hookOpts);
  const pro = useUploadThing("photographer", hookOpts);
  const isUploading = guest.isUploading || pro.isUploading;

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    setFiles((prev) => [...prev, ...picked]);
    setError(null);
    setUploaded(0);
  }, []);

  const submit = async () => {
    setError(null);
    if (files.length === 0) return;
    if (props.mode === "guest" && !name.trim()) {
      setError("Add your name so we know who to thank.");
      return;
    }
    if (props.mode === "guest") {
      save(NAME_KEY, name.trim());
      if (props.requireCode) save(CODE_KEY, code.trim());
    }

    // Small batches keep each request under the per-type file limits and
    // mean a dropped connection only loses one batch.
    const batches = chunk(files, props.mode === "guest" ? 5 : 20);
    let done = 0;
    const total = files.length;
    lastError.current = null;

    try {
      for (const group of batches) {
        setProgress(0);
        setBatch({ done, current: group.length, total });
        const res =
          props.mode === "guest"
            ? await guest.startUpload(group, {
                name: name.trim(),
                code: props.requireCode ? code.trim() : undefined,
              })
            : await pro.startUpload(group, { album: props.album });
        if (!res) {
          throw new Error(lastError.current ?? "Upload didn't finish — try again.");
        }
        done += group.length;
        setFiles((prev) => prev.slice(group.length));
      }
      setUploaded(done);
      router.refresh();
    } catch (err) {
      setUploaded(done);
      setError(
        err instanceof Error ? err.message : "Something went wrong uploading."
      );
    } finally {
      setProgress(null);
      setBatch(null);
    }
  };

  const totalMb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024;

  return (
    <div className="flex flex-col gap-5">
      {props.mode === "guest" && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            Your name
          </span>
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

      {props.mode === "guest" && props.requireCode && (
        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            Guest code
          </span>
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
          addFiles(e.dataTransfer.files);
        }}
        disabled={isUploading}
        className={`flex min-h-48 flex-col items-center justify-center gap-3 border border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-champagne bg-champagne/10"
            : "border-champagne/40 hover:border-champagne hover:bg-champagne/5"
        }`}
      >
        <span className="font-display text-3xl font-light italic">
          {files.length > 0
            ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
            : "Choose photos & videos"}
        </span>
        <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          {files.length > 0
            ? `${totalMb.toFixed(totalMb < 10 ? 1 : 0)} MB · tap to add more`
            : "Tap to browse, or drop them here"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length > 0 && !isUploading && (
        <button
          type="button"
          onClick={() => setFiles([])}
          className="self-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim underline decoration-champagne/40 underline-offset-4 hover:text-champagne"
        >
          Clear selection
        </button>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isUploading || files.length === 0}
        className="bg-champagne px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {isUploading ? "Uploading…" : "Upload"}
      </button>

      {isUploading && batch && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="h-px w-full bg-champagne/20">
            <div
              className="h-px bg-champagne transition-[width] duration-300"
              style={{
                width: `${((batch.done + ((progress ?? 0) / 100) * batch.current) / batch.total) * 100}%`,
              }}
            />
          </div>
          <p className="text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
            {batch.done} of {batch.total} uploaded · keep this page open
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-[#e8a598]">
          {error}
        </p>
      )}

      {uploaded > 0 && !isUploading && !error && (
        <p className="text-center text-sm font-light text-ivory" aria-live="polite">
          Thank you — {uploaded} file{uploaded === 1 ? "" : "s"} added.{" "}
          <Link
            href={props.mode === "guest" ? "/wedding" : `/${props.album}`}
            className="text-champagne underline underline-offset-4"
          >
            See the gallery
          </Link>
        </p>
      )}
    </div>
  );
}
