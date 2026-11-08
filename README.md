# Ehrin & Jay — Wedding & Engagement Gallery

A small photo site with two albums and crowd-sourced guest uploads.
Next.js 15 / React 19 / Tailwind v4, UploadThing for file storage, Postgres
for metadata, `sharp` for resizing, `archiver` for streamed zip downloads.

| Page | What it does |
| --- | --- |
| `/` | Landing — links to both albums |
| `/engagement` | Engagement shoot. Files in `./photos` plus anything the photographer uploads to this album |
| `/wedding` | Photographer + guest uploads, filterable by Photographer / Guests / each guest's name |
| `/upload` | Guests add photos & videos tagged with their name (optionally gated by `GUEST_UPLOAD_CODE`) |
| `/photographer` | Password-protected studio: upload to either album, hide or delete any file |

## Setup

Copy `.env.example` to `.env.local` and fill in:

- `DATABASE_URL` — any Postgres 13+. The `media` table is created automatically.
- `UPLOADTHING_TOKEN` — UploadThing dashboard → API Keys.
- `PHOTOGRAPHER_PASSWORD` — shared password for `/photographer`.
- Optional: `SESSION_SECRET`, `GUEST_UPLOAD_CODE`, `WEDDING_DETAILS`.

```bash
npm install
npm run dev
```

## How uploads work

1. The browser uploads straight to UploadThing (files never pass through this server).
2. UploadThing calls back `/api/uploadthing`; we insert a row with the album,
   role (photographer / guest) and guest name.
3. For images, the server then fetches the original once and stores a 640px
   and a 2200px webp back in UploadThing for the grid and lightbox. Until
   that finishes (or if it fails, e.g. HEIC) the original is shown.

Guest uploads appear immediately. The photographer can hide (reversible) or
delete (removes the files from UploadThing too) from `/photographer`.

The production server must be reachable by UploadThing for the callback.
Behind a proxy it uses the forwarded host; if that's wrong, set
`UPLOADTHING_CALLBACK_URL=https://your-domain/api/uploadthing`.

## Deploy (Coolify / Docker)

The Dockerfile uses Next standalone output and bakes `./photos` into the
image for the engagement album. Set the env vars above on the service.
`/api/health` doesn't touch the database, so rolling deploys stay healthy
even if Postgres is briefly unavailable.

## Endpoints

| Route | Purpose |
| --- | --- |
| `/api/photo/:name?size=thumb\|large\|original` | Local files from `./photos` |
| `/api/media/:id/download` | Uploaded original, as an attachment |
| `/api/download?album=wedding\|engagement&kind=all\|photos\|video` | Streamed zip (wedding zips are grouped into `photographer/` and `guests/<name>/`) |
| `/api/uploadthing` | UploadThing route handler (`guest` and `photographer` endpoints) |
