# Erin & Jay — Engagement Gallery

Zero-database photo gallery. The filesystem is the CMS: drop full-resolution
images and videos into `photos/` and they show up. Next.js 15 / React 19 /
Tailwind v4, `sharp` for on-the-fly resizing, `archiver` for a streamed
download-all zip.

## Run locally

```bash
npm install
mkdir -p photos   # drop .jpg / .png / .webp / .mp4 files in here
npm run dev
```

## Deploy (Coolify / Docker)

`docker compose up -d --build`, or point Coolify at the repo — the Dockerfile
uses Next standalone output. Mount your photo directory at `/photos`
(or set `PHOTOS_DIR`). Put it behind your existing proxy at
`jayanderins-engagement.adentranter.com`.

## Endpoints

| Route | Purpose |
| --- | --- |
| `/` | Masonry grid + lightbox |
| `/api/photo/:name?size=thumb` | 640px webp for the grid (images) |
| `/api/photo/:name?size=large` | 2200px webp for the lightbox (images) |
| `/api/photo/:name?size=original` | Untouched file, download disposition |
| `/api/download?kind=all\|photos\|video` | Streamed zip of originals (default: all) |

## Notes

- Photo list + dimensions are cached in-process for prod; restart the
  container (or redeploy) after adding photos. Swap the cache for a
  `revalidateTag` or drop it entirely if you want instant pickup.
- Resized variants are generated per request with long immutable
  cache headers — put Cloudflare in front and it becomes free.
- No auth by design. If you want it semi-private, Cloudflare Access or
  basic auth at the proxy is less code than Auth.js for a one-page site.
# erinandjays-engagement-photos
