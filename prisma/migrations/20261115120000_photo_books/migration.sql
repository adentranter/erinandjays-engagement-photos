-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('draft', 'checkout', 'paid', 'rendering', 'submitted', 'in_production', 'shipped', 'cancelled', 'failed');

-- CreateTable
CREATE TABLE "photo_books" (
    "id" UUID NOT NULL,
    "owner_token_hash" TEXT,
    "status" "BookStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "layouts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cover_id" TEXT,
    "sku" TEXT,
    "page_count" INTEGER,
    "cost_cents" INTEGER,
    "price_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "shipping_method" TEXT,
    "stripe_session_id" TEXT,
    "stripe_payment_id" TEXT,
    "customer_email" TEXT,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "shipping_address" JSONB,
    "pdf_url" TEXT,
    "spine_url" TEXT,
    "file_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prodigi_order_id" TEXT,
    "tracking_url" TEXT,
    "tracking_number" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "photo_books_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "photo_books_stripe_session_id_key" ON "photo_books"("stripe_session_id");
CREATE UNIQUE INDEX "photo_books_prodigi_order_id_key" ON "photo_books"("prodigi_order_id");
CREATE INDEX "photo_books_owner_token_hash_status_idx" ON "photo_books"("owner_token_hash", "status");
CREATE INDEX "photo_books_status_idx" ON "photo_books"("status");
