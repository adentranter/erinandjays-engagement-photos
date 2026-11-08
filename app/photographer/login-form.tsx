"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.3em] text-ivory-dim">
          Password
        </span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="w-full border border-champagne/30 bg-ink-raised px-4 py-3 text-base font-light text-ivory focus:border-champagne focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-champagne px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ink hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
      {state.error && (
        <p role="alert" className="text-center text-sm text-[#e8a598]">
          {state.error}
        </p>
      )}
    </form>
  );
}
