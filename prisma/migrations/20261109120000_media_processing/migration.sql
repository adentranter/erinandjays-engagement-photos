-- AlterEnum
ALTER TYPE "MediaType" ADD VALUE 'animation';

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('pending', 'uploading', 'processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "media"
    ADD COLUMN "mime_type" TEXT,
    ADD COLUMN "duration_ms" INTEGER,
    ADD COLUMN "video_url" TEXT,
    ADD COLUMN "gif_url" TEXT,
    ADD COLUMN "motion_source" TEXT,
    ADD COLUMN "status" "ProcessingStatus" NOT NULL DEFAULT 'pending',
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "error" TEXT,
    ADD COLUMN "run_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "locked_at" TIMESTAMPTZ(6),
    ADD COLUMN "processed_at" TIMESTAMPTZ(6),
    ADD COLUMN "content_id" TEXT,
    ADD COLUMN "companion_of" UUID,
    ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;

-- Existing photos keep their renditions as they are. Videos go back through
-- the new pipeline (posters, correct dimensions, upright playback for
-- rotated clips), as does anything that never got a thumbnail.
UPDATE "media"
   SET "status" = CASE
         WHEN "type" = 'video' OR "thumb_url" IS NULL THEN 'pending'::"ProcessingStatus"
         ELSE 'ready'::"ProcessingStatus"
       END;

-- CreateIndex
CREATE INDEX "media_status_run_after_idx" ON "media"("status", "run_after");

-- CreateIndex
CREATE INDEX "media_companion_of_idx" ON "media"("companion_of");

-- CreateTable
CREATE TABLE "album_settings" (
    "album" "Album" NOT NULL,
    "cover_id" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "album_settings_pkey" PRIMARY KEY ("album")
);
