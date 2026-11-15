/**
 * Photos this browser opened in the gallery lightbox, newest first, so the
 * photo book picker can offer them first. Kept in localStorage only: it's a
 * convenience, and an empty list (private window, cleared storage) is fine.
 */

const KEY = "recently-viewed-photos";
const MAX = 60;

export function recentlyViewed(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberViewed(id: string): void {
  try {
    const list = [id, ...recentlyViewed().filter((x) => x !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked or full: nothing to remember, nothing breaks.
  }
}
