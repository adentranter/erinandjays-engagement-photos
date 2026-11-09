import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { sessionFromRequest } from "@/lib/auth";
import { findDuplicates, insertMedia } from "@/lib/media";
import { ownerHashFromRequest } from "@/lib/guest";
import { nudgeMediaWorker } from "@/lib/processing/worker";
import type { Album, Role } from "@/lib/gallery-types";

const f = createUploadthing();

interface Meta {
  album: Album;
  role: Role;
  uploaderName: string | null;
  ownerTokenHash: string | null;
  fingerprint: string | null;
}

const fileOptions = {
  /** Content fingerprint computed in the browser (lib/fingerprint.ts) */
  fingerprint: z.string().regex(/^v1:[0-9a-f]{64}$/).optional(),
  /** Upload even if it looks like it's already in the album */
  allowDuplicate: z.boolean().optional(),
};

/**
 * Refuse a file that's already in the album before it's uploaded. The
 * uploader checks first and skips these; this catches races (two tabs,
 * two guests sending the same photo at once).
 */
async function refuseDuplicates(
  album: Album,
  files: ReadonlyArray<{ name: string; size: number }>,
  input: { fingerprint?: string; allowDuplicate?: boolean }
) {
  if (input.allowDuplicate) return;
  const dupes = await findDuplicates(
    album,
    files.map((f, i) => ({
      key: String(i),
      name: f.name,
      size: f.size,
      // One file per request from our uploader, so the fingerprint is its.
      fingerprint: files.length === 1 ? input.fingerprint : null,
    })),
    null
  );
  if (Object.keys(dupes).length) {
    throw new UploadThingError("Already in the gallery");
  }
}

async function record(
  metadata: Meta,
  file: { key: string; name: string; ufsUrl: string; type: string; size: number }
) {
  const id = await insertMedia({
    album: metadata.album,
    role: metadata.role,
    uploaderName: metadata.uploaderName,
    ownerTokenHash: metadata.ownerTokenHash,
    fingerprint: metadata.fingerprint,
    fileKey: file.key,
    fileName: file.name,
    url: file.ufsUrl,
    mimeType: file.type,
    size: file.size,
  });
  nudgeMediaWorker();
  return { id };
}

export const uploadRouter = {
  /** Anyone with the link (and the optional guest code) can add to the wedding. */
  guest: f({
    image: { maxFileSize: "32MB", maxFileCount: 30 },
    video: { maxFileSize: "512MB", maxFileCount: 5 },
  })
    .input(
      z.object({
        name: z.string().trim().min(1, "Add your name").max(60),
        code: z.string().trim().max(100).optional(),
        ...fileOptions,
      })
    )
    .middleware(async ({ req, input, files }) => {
      const required = process.env.GUEST_UPLOAD_CODE?.trim();
      if (required && input.code?.toLowerCase() !== required.toLowerCase()) {
        throw new UploadThingError("That guest code doesn't match.");
      }
      await refuseDuplicates("wedding", files, input);
      return {
        album: "wedding",
        role: "guest",
        uploaderName: input.name,
        // Lets this browser rotate/delete its own uploads later.
        ownerTokenHash: ownerHashFromRequest(req),
        fingerprint: files.length === 1 ? input.fingerprint ?? null : null,
      } satisfies Meta;
    })
    .onUploadComplete(({ metadata, file }) => record(metadata, file)),

  /** Behind PHOTOGRAPHER_PASSWORD; can upload into either album. */
  photographer: f({
    image: { maxFileSize: "64MB", maxFileCount: 200 },
    video: { maxFileSize: "4GB", maxFileCount: 20 },
  })
    .input(z.object({ album: z.enum(["wedding", "engagement"]), ...fileOptions }))
    .middleware(async ({ req, input, files }) => {
      if (!sessionFromRequest(req)) {
        throw new UploadThingError("Please sign in again.");
      }
      await refuseDuplicates(input.album, files, input);
      return {
        album: input.album,
        role: "photographer",
        uploaderName: null,
        ownerTokenHash: null,
        fingerprint: files.length === 1 ? input.fingerprint ?? null : null,
      } satisfies Meta;
    })
    .onUploadComplete(({ metadata, file }) => record(metadata, file)),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
