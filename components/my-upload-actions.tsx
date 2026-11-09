"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMyUpload, rotateMyUpload } from "@/app/upload/actions";

/** Rotate / Delete controls for something this browser uploaded. */
export function MyUploadActions({
  id,
  className = "",
  onDeleted,
  busy = false,
}: {
  id: string;
  className?: string;
  onDeleted?: () => void;
  /** Disable Rotate while the item is still being processed */
  busy?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const rotate = () =>
    start(async () => {
      await rotateMyUpload(id);
      router.refresh();
    });

  const remove = () => {
    if (!confirm("Delete this from the gallery for good? This can't be undone.")) return;
    start(async () => {
      const { ok } = await deleteMyUpload(id);
      if (ok) onDeleted?.();
      router.refresh();
    });
  };

  return (
    <div className={`flex items-center gap-5 ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={rotate}
        disabled={pending || busy}
        title="Turn 90° clockwise"
        className="transition-colors hover:text-champagne disabled:opacity-40"
      >
        Rotate
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="transition-colors hover:text-[#e8a598] disabled:opacity-40"
      >
        {pending ? "…" : "Delete"}
      </button>
    </div>
  );
}
