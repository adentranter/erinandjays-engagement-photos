import { z } from "zod";
import { currentOwnerHash } from "@/lib/guest";
import { findDuplicates } from "@/lib/media";

export const dynamic = "force-dynamic";

const Body = z.object({
  album: z.enum(["wedding", "engagement"]),
  files: z
    .array(
      z.object({
        key: z.string().max(200),
        name: z.string().max(300),
        size: z.number().int().nonnegative(),
        fingerprint: z.string().regex(/^v1:[0-9a-f]{64}$/).nullable().optional(),
      })
    )
    .max(500),
});

/**
 * Before uploading, the uploader asks which selected files are already in
 * the album so it can skip them. Only answers "is this here", which anyone
 * can already see by browsing the gallery.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const { album, files } = parsed.data;
  const matches = await findDuplicates(album, files, await currentOwnerHash());
  return Response.json(matches, { headers: { "Cache-Control": "no-store" } });
}
