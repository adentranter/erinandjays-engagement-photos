import { NextRequest } from "next/server";
import { getStatuses } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * Processing status for just-uploaded items, polled by the uploader.
 * Only answers for ids the caller already has (random UUIDs from the
 * upload response), and returns nothing that isn't visible elsewhere.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const statuses = await getStatuses(ids);
  return Response.json(statuses, { headers: { "Cache-Control": "no-store" } });
}
