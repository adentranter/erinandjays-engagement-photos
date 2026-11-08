-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Album" AS ENUM ('wedding', 'engagement');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('photographer', 'guest');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('image', 'video');

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "album" "Album" NOT NULL,
    "role" "Role" NOT NULL,
    "uploader_name" TEXT,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "thumb_url" TEXT,
    "large_url" TEXT,
    "derived_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_file_key_key" ON "media"("file_key");

-- CreateIndex
CREATE INDEX "media_album_created_at_idx" ON "media"("album", "created_at");

