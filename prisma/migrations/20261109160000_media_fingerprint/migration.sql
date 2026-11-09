-- AlterTable
ALTER TABLE "media" ADD COLUMN "fingerprint" TEXT;

-- CreateIndex
CREATE INDEX "media_album_fingerprint_idx" ON "media"("album", "fingerprint");
