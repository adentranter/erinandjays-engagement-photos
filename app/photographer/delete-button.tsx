"use client";

export function DeleteButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Delete this file for good? This can't be undone.")) {
          e.preventDefault();
        }
      }}
      className="hover:text-[#e8a598]"
    >
      Delete
    </button>
  );
}
