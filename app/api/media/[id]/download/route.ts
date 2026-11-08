import { getRow } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * UploadThing URLs are cross-origin, so <a download> is ignored there.
 * Proxy the original through us with an attachment disposition instead.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await getRow(id);
  if (!row || row.hidden) return new Response("Not found", { status: 404 });

  const upstream = await fetch(row.url, { signal: req.signal });
  if (!upstream.ok || !upstream.body) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type":
      upstream.headers.get("content-type") ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
    "Cache-Control": "private, max-age=3600",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { headers });
}
