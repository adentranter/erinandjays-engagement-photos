import Link from "next/link";

const LINKS = [
  { href: "/wedding", label: "Wedding", short: "Wedding" },
  { href: "/engagement", label: "Engagement", short: "Engagement" },
  { href: "/upload", label: "Share photos", short: "Share" },
] as const;

export function SiteNav({ current }: { current?: string }) {
  return (
    <nav className="flex items-center justify-between gap-4 pt-6 text-[10px] uppercase tracking-[0.2em] text-ivory-dim sm:text-[11px] sm:tracking-[0.3em]">
      <Link
        href="/"
        className="whitespace-nowrap font-display text-lg normal-case italic tracking-normal text-ivory hover:text-champagne"
      >
        E <span className="not-italic text-champagne">&amp;</span> J
      </Link>
      <div className="flex items-center gap-4 sm:gap-8">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current === l.href ? "page" : undefined}
            className={`whitespace-nowrap transition-colors hover:text-champagne ${
              current === l.href ? "text-ivory" : ""
            }`}
          >
            <span className="sm:hidden">{l.short}</span>
            <span className="hidden sm:inline">{l.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
