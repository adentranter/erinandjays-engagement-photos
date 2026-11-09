-- AlterTable
ALTER TABLE "media" ADD COLUMN "owner_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "media_owner_token_hash_idx" ON "media"("owner_token_hash");
