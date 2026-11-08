import { getRow } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * UploadThing URLs are cross-origin, so <a download> is ignored there.
 * Proxy the file through us with an attachment disposition instead.
 * Default is the untouched original; ?asset=gif gives the animated GIF
 * made from a Live/Motion Photo (or a short video).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await getRow(id);
  if (!row || row.hidden) return new Response("Not found", { status: 404 });

  const wantsGif = new URL(req.url).searchParams.get("asset") === "gif";
  if (wantsGif && !row.gifUrl) return new Response("Not found", { status: 404 });
  const url = wantsGif ? row.gifUrl! : row.url;
  const fileName = wantsGif
    ? `${row.fileName.replace(/\.[^.]+$/, "")}.gif`
    : row.fileName;

  const upstream = await fetch(url, { signal: req.signal });
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": wantsGif
      ? "image/gif"
      : upstream.headers.get("content-type") ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, max-age=3600",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { headers });
}
