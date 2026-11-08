import "server-only";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { UTApi, UTFile } from "uploadthing/server";

export const utapi = new UTApi();

/** Stream a remote file to disk, refusing anything over `maxBytes`. */
export async function downloadTo(url: string, dest: string, maxBytes: number): Promise<number> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Fetching original failed (${res.status})`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PermanentError("File is larger than the processing limit");

  let seen = 0;
  const body = Readable.fromWeb(res.body as NodeWebStream);
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > maxBytes) body.destroy(new PermanentError("File is larger than the processing limit"));
  });
  await pipeline(body, fs.createWriteStream(dest));
  return seen;
}

export interface StoredFile {
  key: string;
  url: string;
}

/**
 * Upload generated files. Files are opened lazily from disk so a large
 * transcode isn't held in memory. Names are `<mediaId>.<asset>.<ext>` —
 * UploadThing keys are flat, so the media id groups a record's assets.
 */
export async function storeFiles(
  files: Array<{ path: string; name: string; type: string }>
): Promise<StoredFile[]> {
  if (files.length === 0) return [];
  const blobs = await Promise.all(
    files.map(async (f) => {
      const blob = await fs.openAsBlob(f.path, { type: f.type });
      return new UTFile([blob], f.name, { type: f.type });
    })
  );
  const results = await utapi.uploadFiles(blobs);
  return results.map((r, i) => {
    if (!r.data) {
      throw new Error(`Storing ${files[i].name} failed: ${r.error?.message ?? "unknown error"}`);
    }
    return { key: r.data.key, url: r.data.ufsUrl };
  });
}

/** Errors that retrying won't fix (bad file, unsupported format). */
export class PermanentError extends Error {}
