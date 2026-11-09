/**
 * A quick content fingerprint for duplicate detection, computed in the
 * browser before upload. Hashing whole multi-GB videos would be slow and
 * memory-hungry, so it hashes the size plus three 512KB samples (start,
 * middle, end); small files are hashed whole. Two different photos
 * colliding on all of that is not a practical concern.
 */

const SAMPLE = 512 * 1024;

export async function fingerprint(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-secure context
  try {
    const parts: BlobPart[] = [String(file.size), "|"];
    if (file.size <= SAMPLE * 3) {
      parts.push(file);
    } else {
      const mid = Math.floor(file.size / 2 - SAMPLE / 2);
      parts.push(
        file.slice(0, SAMPLE),
        file.slice(mid, mid + SAMPLE),
        file.slice(file.size - SAMPLE)
      );
    }
    const data = await new Blob(parts).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    return `v1:${hex}`;
  } catch {
    return null;
  }
}
