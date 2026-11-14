import "server-only";
import crypto from "node:crypto";
import { Resend } from "resend";
import type { Media, NotificationSettings, Subscriber } from "@prisma/client";
import { db } from "@/lib/db";
import { PHOTO_PARAM, type Album } from "@/lib/gallery-types";

/**
 * Email updates. Whenever a batch of uploads lands, the couple (added in
 * the studio) and any guests who left their email get one message about it.
 *
 * A "batch" ends once nothing new has been uploaded for `quietMinutes` and
 * the new files have finished processing (so the email has thumbnails).
 * The batch is everything created since `cursor`; a row lock on the single
 * settings row means only one server sends it, however many are running.
 */

const SITE_NAME = "Ehrin & Jay";
const TICK_MS = 60_000;
/** Don't hold an email back forever for a file that's stuck processing. */
const MAX_PROCESSING_WAIT_MS = 30 * 60_000;
const PREVIEW_COUNT = 6;

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.EMAIL_FROM?.trim() || null;
  const siteUrl = process.env.SITE_URL?.trim().replace(/\/+$/, "") || null;
  const missing = [
    !apiKey && "RESEND_API_KEY",
    !from && "EMAIL_FROM",
    !siteUrl && "SITE_URL",
  ].filter(Boolean) as string[];
  return { apiKey, from, siteUrl, replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined, missing };
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

const newToken = () => crypto.randomBytes(24).toString("base64url");

/* ------------------------------------------------------------------ */
/* Settings & subscribers                                              */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<NotificationSettings> {
  return db.notificationSettings.upsert({
    where: { id: 1 },
    create: { id: 1, cursor: new Date() },
    update: {},
  });
}

export async function saveSettings(change: {
  enabled: boolean;
  emailGuests: boolean;
  quietMinutes: number;
}): Promise<void> {
  const current = await getSettings();
  await db.notificationSettings.update({
    where: { id: 1 },
    data: {
      ...change,
      // Turning updates on shouldn't email out everything uploaded so far.
      ...(change.enabled && !current.enabled ? { cursor: new Date() } : {}),
    },
  });
}

export async function listSubscribers(): Promise<Subscriber[]> {
  return db.subscriber.findMany({ orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
}

/** Replace the couple's addresses with exactly this list. */
export async function setCoupleEmails(emails: string[]): Promise<void> {
  const wanted = [...new Set(emails)];
  await db.$transaction([
    // Anyone dropped from the list goes back to being a plain guest (if
    // they'd also signed up while uploading) or is removed.
    db.subscriber.deleteMany({
      where: { kind: "couple", email: { notIn: wanted }, ownerTokenHash: null },
    }),
    db.subscriber.updateMany({
      where: { kind: "couple", email: { notIn: wanted } },
      data: { kind: "guest" },
    }),
    ...wanted.map((email) =>
      db.subscriber.upsert({
        where: { email },
        create: { email, kind: "couple", unsubscribeToken: newToken() },
        // Re-adding someone in the studio is an explicit opt back in.
        update: { kind: "couple", unsubscribedAt: null },
      })
    ),
  ]);
}

/** A guest left their email on the upload page. */
export async function addGuestSubscriber(input: {
  email: string;
  name: string | null;
  ownerTokenHash: string | null;
}): Promise<void> {
  const email = normaliseEmail(input.email);
  if (!email) return;
  await db.subscriber.upsert({
    where: { email },
    create: {
      email,
      name: input.name,
      kind: "guest",
      ownerTokenHash: input.ownerTokenHash,
      unsubscribeToken: newToken(),
    },
    // Typing it in again means they want the emails again.
    update: {
      unsubscribedAt: null,
      ...(input.name ? { name: input.name } : {}),
      ...(input.ownerTokenHash ? { ownerTokenHash: input.ownerTokenHash } : {}),
    },
  });
}

export async function removeSubscriber(id: string): Promise<void> {
  await db.subscriber.deleteMany({ where: { id } });
}

export async function findByUnsubscribeToken(token: string): Promise<Subscriber | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return db.subscriber.findUnique({ where: { unsubscribeToken: token } });
}

export async function unsubscribe(token: string): Promise<boolean> {
  const sub = await findByUnsubscribeToken(token);
  if (!sub) return false;
  if (!sub.unsubscribedAt) {
    await db.subscriber.update({ where: { id: sub.id }, data: { unsubscribedAt: new Date() } });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* The background loop                                                 */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __notifier?: boolean };

export function startNotifier(): void {
  if (g.__notifier) return;
  g.__notifier = true;
  console.log("[notify] email updates watcher started");
  const tick = async () => {
    try {
      await checkAndSend();
    } catch (err) {
      console.error("[notify] check failed:", err);
    }
    setTimeout(tick, TICK_MS);
  };
  setTimeout(tick, 15_000);
}

const WORKING = new Set<Media["status"]>(["pending", "uploading", "processing"]);

type BatchRow = Pick<
  Media,
  "id" | "album" | "role" | "uploaderName" | "ownerTokenHash" | "type" | "thumbUrl" | "status" | "hidden" | "companionOf" | "createdAt"
>;

/**
 * Claim the finished batch (if there is one) by moving the cursor past it,
 * inside a row lock so only one server does this. Returns what to announce.
 */
async function claimBatch(): Promise<{ rows: BatchRow[]; settings: NotificationSettings } | null> {
  await getSettings(); // make sure the row exists
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM notification_settings WHERE id = 1 FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return null; // another server is on it
    const settings = await tx.notificationSettings.findUniqueOrThrow({ where: { id: 1 } });
    if (!settings.enabled) return null;

    const rows = await tx.media.findMany({
      where: { createdAt: { gte: settings.cursor } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, album: true, role: true, uploaderName: true, ownerTokenHash: true, type: true,
        thumbUrl: true, status: true, hidden: true, companionOf: true, createdAt: true,
      },
    });
    if (!rows.length) return null;

    const newest = rows[rows.length - 1].createdAt.getTime();
    const age = Date.now() - newest;
    if (age < settings.quietMinutes * 60_000) return null; // still uploading
    if (age < MAX_PROCESSING_WAIT_MS && rows.some((r) => WORKING.has(r.status) && !r.companionOf)) {
      return null; // wait for thumbnails
    }

    // +1ms: Postgres keeps microseconds, JS dates only milliseconds.
    await tx.notificationSettings.update({
      where: { id: 1 },
      data: { cursor: new Date(newest + 1), lastSentAt: new Date() },
    });
    return { rows, settings };
  });
}

export async function checkAndSend(): Promise<void> {
  const cfg = emailConfig();
  if (cfg.missing.length) return;

  const batch = await claimBatch();
  if (!batch) return;

  const items = batch.rows.filter(
    (r) => !r.hidden && !r.companionOf && r.status !== "failed" && (r.status === "ready" || r.thumbUrl)
  );
  if (!items.length) return;

  const subs = await db.subscriber.findMany({
    where: {
      unsubscribedAt: null,
      ...(batch.settings.emailGuests ? {} : { kind: "couple" }),
    },
  });
  // Don't tell a guest about a batch that's entirely their own uploads.
  const recipients = subs.filter(
    (s) => s.kind === "couple" || !s.ownerTokenHash || items.some((i) => i.ownerTokenHash !== s.ownerTokenHash)
  );
  if (!recipients.length) return;

  try {
    const sent = await sendBatchEmails(recipients, items);
    console.log(`[notify] announced ${items.length} upload(s) to ${sent} recipient(s)`);
  } catch (err) {
    console.error("[notify] sending failed:", err);
  }
}

/* ------------------------------------------------------------------ */
/* Composing & sending                                                 */
/* ------------------------------------------------------------------ */

function client() {
  const cfg = emailConfig();
  if (cfg.missing.length) throw new Error(`Missing ${cfg.missing.join(", ")}`);
  return { resend: new Resend(cfg.apiKey!), cfg };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function describeCount(rows: BatchRow[]): string {
  const videos = rows.filter((r) => r.type === "video").length;
  const stills = rows.length - videos;
  return [stills && plural(stills, "photo"), videos && plural(videos, "video")].filter(Boolean).join(" and ");
}

function credits(rows: BatchRow[]): string {
  const names = [
    ...new Set(rows.map((r) => (r.role === "photographer" ? "the photographer" : r.uploaderName?.trim() || "a guest"))),
  ];
  if (names.length <= 3) return names.join(names.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, " and $1");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

interface Section {
  album: Album;
  rows: BatchRow[];
}

function compose(sections: Section[], siteUrl: string, unsubscribeUrl: string) {
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const all = sections.flatMap((s) => s.rows);
  const where = sections.length === 1 ? `the ${sections[0].album} gallery` : "the galleries";
  const subject = `${describeCount(all)} added to ${where}`;

  const blocks = sections
    .map(({ album, rows }) => {
      const link = `${siteUrl}/${album}`;
      const thumbs = rows
        .filter((r) => r.thumbUrl)
        .slice(0, PREVIEW_COUNT)
        .map(
          (r) => `<a href="${esc(`${link}?${PHOTO_PARAM}=${encodeURIComponent(r.id)}`)}" style="display:inline-block;margin:3px">
            <img src="${esc(r.thumbUrl!)}" width="168" height="168" alt="" style="display:block;width:168px;height:168px;object-fit:cover;border:0;background:#211d17">
          </a>`
        )
        .join("");
      const more = rows.length > PREVIEW_COUNT ? `<p style="margin:12px 0 0;color:#a89f90;font-size:13px">and ${rows.length - PREVIEW_COUNT} more</p>` : "";
      return `
        <p style="margin:32px 0 6px;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#a89f90">The ${esc(album)} gallery</p>
        <p style="margin:0 0 16px;font-size:16px;color:#f2ede4">${esc(describeCount(rows))} from ${esc(credits(rows))}</p>
        <div style="font-size:0">${thumbs}</div>
        ${more}
        <p style="margin:24px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#c9a96a;color:#16130f;padding:14px 26px;font-size:12px;letter-spacing:.3em;text-transform:uppercase;text-decoration:none">See them</a></p>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#16130f;font-family:Georgia,'Times New Roman',serif">
    <div style="max-width:560px;margin:0 auto;padding:48px 20px;text-align:center;color:#f2ede4">
      <p style="margin:0;font-size:11px;letter-spacing:.45em;text-transform:uppercase;color:#a89f90">${esc(SITE_NAME)}</p>
      <h1 style="margin:16px 0 0;font-weight:300;font-style:italic;font-size:34px">New ${total === 1 ? "memory" : "memories"} shared</h1>
      <div style="width:80px;height:1px;background:#c9a96a;margin:28px auto 0"></div>
      ${blocks}
      <p style="margin:48px 0 0;font-size:12px;color:#7d756b">You're getting this because you asked for updates from ${esc(SITE_NAME)}'s gallery.
        <a href="${esc(unsubscribeUrl)}" style="color:#a89f90">Stop these emails</a></p>
    </div></body></html>`;

  const text = [
    `${SITE_NAME}: new ${total === 1 ? "memory" : "memories"} shared`,
    "",
    ...sections.map(({ album, rows }) => `${describeCount(rows)} from ${credits(rows)} in the ${album} gallery: ${siteUrl}/${album}`),
    "",
    `Stop these emails: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}

async function sendBatchEmails(recipients: Subscriber[], items: BatchRow[]): Promise<number> {
  const { resend, cfg } = client();
  const sections: Section[] = (["wedding", "engagement"] as const)
    .map((album) => ({ album, rows: items.filter((i) => i.album === album) }))
    .filter((s) => s.rows.length);

  const emails = recipients.map((sub) => {
    const unsubscribeUrl = `${cfg.siteUrl}/unsubscribe?token=${sub.unsubscribeToken}`;
    const { subject, html, text } = compose(sections, cfg.siteUrl!, unsubscribeUrl);
    return {
      from: cfg.from!,
      to: [sub.email],
      replyTo: cfg.replyTo,
      subject,
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${cfg.siteUrl}/api/unsubscribe?token=${sub.unsubscribeToken}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    };
  });

  // One email per person (nobody sees anyone else's address), 100 per call.
  for (let i = 0; i < emails.length; i += 100) {
    const { error } = await resend.batch.send(emails.slice(i, i + 100));
    if (error) throw new Error(`Resend: ${error.message}`);
  }
  return emails.length;
}

/** From the studio: send a sample of the latest uploads to the couple. */
export async function sendTestEmail(): Promise<{ ok: boolean; message: string }> {
  const cfg = emailConfig();
  if (cfg.missing.length) return { ok: false, message: `Set ${cfg.missing.join(", ")} first.` };
  const couple = await db.subscriber.findMany({ where: { kind: "couple", unsubscribedAt: null } });
  if (!couple.length) return { ok: false, message: "Add the couple's emails first." };
  const sample = await db.media.findMany({
    where: { hidden: false, companionOf: null, status: "ready" },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true, album: true, role: true, uploaderName: true, ownerTokenHash: true, type: true,
      thumbUrl: true, status: true, hidden: true, companionOf: true, createdAt: true,
    },
  });
  if (!sample.length) return { ok: false, message: "Upload something first so the test has photos in it." };
  try {
    const n = await sendBatchEmails(couple, sample);
    return { ok: true, message: `Test sent to ${plural(n, "address", "addresses")}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Sending failed." };
  }
}
