import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";
import { sessionFromRequest } from "@/lib/auth";
import { insertMedia } from "@/lib/media";
import { ownerHashFromRequest } from "@/lib/guest";
import { nudgeMediaWorker } from "@/lib/processing/worker";
import type { Album, Role } from "@/lib/gallery-types";

const f = createUploadthing();

interface Meta {
  album: Album;
  role: Role;
  uploaderName: string | null;
  ownerTokenHash: string | null;
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
      })
    )
    .middleware(async ({ req, input }) => {
      const required = process.env.GUEST_UPLOAD_CODE?.trim();
      if (required && input.code?.toLowerCase() !== required.toLowerCase()) {
        throw new UploadThingError("That guest code doesn't match.");
      }
      return {
        album: "wedding",
        role: "guest",
        uploaderName: input.name,
        // Lets this browser rotate/delete its own uploads later.
        ownerTokenHash: ownerHashFromRequest(req),
      } satisfies Meta;
    })
    .onUploadComplete(({ metadata, file }) => record(metadata, file)),

  /** Behind PHOTOGRAPHER_PASSWORD; can upload into either album. */
  photographer: f({
    image: { maxFileSize: "64MB", maxFileCount: 200 },
    video: { maxFileSize: "4GB", maxFileCount: 20 },
  })
    .input(z.object({ album: z.enum(["wedding", "engagement"]) }))
    .middleware(async ({ req, input }) => {
      if (!sessionFromRequest(req)) {
        throw new UploadThingError("Please sign in again.");
      }
      return {
        album: input.album,
        role: "photographer",
        uploaderName: null,
        ownerTokenHash: null,
      } satisfies Meta;
    })
    .onUploadComplete(({ metadata, file }) => record(metadata, file)),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
