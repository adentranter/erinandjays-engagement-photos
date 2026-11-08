"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  checkPassword,
  endSession,
  isPhotographer,
  startSession,
} from "@/lib/auth";
import { deleteRow, setHidden } from "@/lib/media";
import { utapi } from "@/lib/derivatives";

export async function login(
  _prev: { error: string | null },
  form: FormData
): Promise<{ error: string | null }> {
  const password = String(form.get("password") ?? "");
  // Small fixed delay blunts password guessing without needing a store.
  await new Promise((r) => setTimeout(r, 400));
  if (!checkPassword(password)) return { error: "That password isn't right." };
  await startSession();
  redirect("/photographer");
}

export async function logout() {
  await endSession();
  redirect("/photographer");
}

async function requirePhotographer() {
  if (!(await isPhotographer())) throw new Error("Not signed in");
}

function refresh() {
  revalidatePath("/photographer");
  revalidatePath("/wedding");
  revalidatePath("/engagement");
  revalidatePath("/");
}

export async function toggleHidden(form: FormData) {
  await requirePhotographer();
  await setHidden(String(form.get("id")), form.get("hidden") === "true");
  refresh();
}

export async function removeMedia(form: FormData) {
  await requirePhotographer();
  const keys = await deleteRow(String(form.get("id")));
  if (keys.length) {
    try {
      await utapi.deleteFiles(keys);
    } catch (err) {
      console.error("[delete] uploadthing cleanup failed:", err);
    }
  }
  refresh();
}
