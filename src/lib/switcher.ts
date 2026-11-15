// Finding a project by a few typed letters, for the quick switcher. No React, so it can be tested.

/**
 * How well `name` matches `query`, higher is better, or 0 for no match: the whole name
 * starting with it, a word starting with it, anywhere in it, then its letters in order
 * ("shw" finds "Shotz website").
 */
export function matchScore(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (n.startsWith(q)) return 4;
  if (n.split(/[\s\-_/.,:]+/).some((word) => word.startsWith(q))) return 3;
  if (n.includes(q)) return 2;
  let at = 0;
  for (const letter of q.replace(/\s+/g, "")) {
    at = n.indexOf(letter, at) + 1;
    if (at === 0) return 0;
  }
  return 1;
}

/** The items that match, best first; equally good ones keep their order (most recently worked on first). */
export function matching<T extends { name: string }>(items: T[], query: string): T[] {
  return items
    .map((item, index) => ({ item, index, score: matchScore(item.name, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
