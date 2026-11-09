"use server";

import { revalidatePath } from "next/cache";
import { currentOwnerHash } from "@/lib/guest";
import { deleteRow, getOwnedRow, setRotation } from "@/lib/media";
import { utapi } from "@/lib/processing/storage";
import { requeue } from "@/lib/processing/worker";

/**
 * Guests managing their own uploads. Every action re-checks that the item
 * was uploaded from this browser (hashed guest cookie) — the id alone is
 * never enough.
 */

function refresh() {
  revalidatePath("/upload");
  revalidatePath("/wedding");
  revalidatePath("/photographer");
  revalidatePath("/");
}

export async function deleteMyUpload(id: string): Promise<{ ok: boolean }> {
  const row = await getOwnedRow(id, await currentOwnerHash());
  if (!row) return { ok: false };
  const keys = await deleteRow(row.id);
  if (keys.length) {
    await utapi.deleteFiles(keys).catch((err) => {
      console.error("[guest delete] uploadthing cleanup failed:", err);
    });
  }
  refresh();
  return { ok: true };
}

export async function rotateMyUpload(id: string): Promise<{ ok: boolean }> {
  const row = await getOwnedRow(id, await currentOwnerHash());
  if (!row) return { ok: false };
  await setRotation(row.id, 90);
  await requeue(row.id);
  refresh();
  return { ok: true };
}
