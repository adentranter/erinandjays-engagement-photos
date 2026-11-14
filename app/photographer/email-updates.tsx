import { emailConfig, getSettings, listSubscribers } from "@/lib/notify";
import { removeSubscriberAction, saveEmailSettings } from "./actions";
import { TestEmailButton } from "./test-email-button";

const field =
  "w-full border border-champagne/30 bg-ink-raised px-4 py-3 text-base font-light text-ivory placeholder:text-ivory-dim/60 focus:border-champagne focus:outline-none";
const label = "text-[11px] uppercase tracking-[0.3em] text-ivory-dim";

function when(d: Date) {
  return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export async function EmailUpdates() {
  const [settings, subs] = await Promise.all([getSettings(), listSubscribers()]);
  const { missing } = emailConfig();
  const couple = subs.filter((s) => s.kind === "couple");
  const guests = subs.filter((s) => s.kind === "guest");
  const activeGuests = guests.filter((s) => !s.unsubscribedAt);

  return (
    <section className="mx-auto mt-20 max-w-xl">
      <h2 className="mb-6 text-center text-[11px] uppercase tracking-[0.3em] text-ivory-dim">Email updates</h2>
      <p className="mb-6 text-center text-sm font-light leading-relaxed text-ivory-dim">
        When a batch of uploads is finished, the couple and any guests who left their email get one
        message with previews and a link to the gallery.
      </p>

      {missing.length > 0 && (
        <p className="mb-6 border border-[#e8a598]/40 px-4 py-3 text-center text-sm font-light text-[#e8a598]">
          Emails can&rsquo;t go out until <code>{missing.join(", ")}</code>{" "}
          {missing.length === 1 ? "is" : "are"} set on the server.
        </p>
      )}

      <form action={saveEmailSettings} className="flex flex-col gap-5">
        <label className="flex items-center gap-3 text-sm font-light text-ivory">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="h-4 w-4 accent-champagne" />
          Send email updates
        </label>

        <label className="flex flex-col gap-2">
          <span className={label}>Bride &amp; groom&rsquo;s emails</span>
          <textarea
            name="coupleEmails"
            rows={2}
            defaultValue={couple.map((s) => s.email).join("\n")}
            placeholder={"one per line"}
            className={field}
          />
          {couple.some((s) => s.unsubscribedAt) && (
            <span className="text-[12px] font-light text-ivory-dim">
              {couple.filter((s) => s.unsubscribedAt).map((s) => s.email).join(", ")} unsubscribed from an
              email; saving again turns them back on.
            </span>
          )}
        </label>

        <label className="flex items-center gap-3 text-sm font-light text-ivory">
          <input type="checkbox" name="emailGuests" defaultChecked={settings.emailGuests} className="h-4 w-4 accent-champagne" />
          Let guests leave their email when uploading, and email them too
        </label>

        <label className="flex flex-col gap-2">
          <span className={label}>A batch is done after</span>
          <select name="quietMinutes" defaultValue={String(settings.quietMinutes)} className={field}>
            {[5, 10, 20, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m} minutes with no new uploads
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="bg-champagne px-6 py-4 text-[12px] uppercase tracking-[0.35em] text-ink transition-opacity hover:opacity-90"
        >
          Save email settings
        </button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-3 text-center text-sm font-light text-ivory-dim sm:flex-row sm:justify-between sm:text-left">
        <span>{settings.lastSentAt ? `Last update sent ${when(settings.lastSentAt)}` : "No updates sent yet"}</span>
        <TestEmailButton />
      </div>

      {guests.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-center text-[11px] uppercase tracking-[0.3em] text-champagne">
            Guests getting updates ({activeGuests.length})
          </summary>
          <ul className="mt-4 divide-y divide-champagne/10 text-sm font-light">
            {guests.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className={`min-w-0 truncate ${s.unsubscribedAt ? "text-ivory-dim line-through" : "text-ivory"}`}>
                  {s.name ? `${s.name} · ` : ""}
                  {s.email}
                </span>
                <form action={removeSubscriberAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className="text-[10px] uppercase tracking-[0.2em] text-ivory-dim hover:text-champagne">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
