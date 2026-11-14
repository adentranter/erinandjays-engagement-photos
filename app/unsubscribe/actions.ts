"use server";

import { redirect } from "next/navigation";
import { unsubscribe } from "@/lib/notify";

export async function confirmUnsubscribe(form: FormData) {
  const token = String(form.get("token") ?? "");
  await unsubscribe(token);
  redirect(`/unsubscribe?token=${encodeURIComponent(token)}`);
}
