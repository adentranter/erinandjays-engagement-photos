"use client";

import { useActionState } from "react";
import { sendTestEmailAction } from "./actions";

export function TestEmailButton() {
  const [result, action, pending] = useActionState(sendTestEmailAction, null);
  return (
    <form action={action} className="flex flex-col items-center gap-2 sm:items-start">
      <button
        type="submit"
        disabled={pending}
        className="text-[11px] uppercase tracking-[0.3em] underline decoration-champagne/40 underline-offset-4 hover:text-champagne disabled:opacity-40"
      >
        {pending ? "Sending…" : "Send the couple a test email"}
      </button>
      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-ivory" : "text-[#e8a598]"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
