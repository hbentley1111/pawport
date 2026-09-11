// Per-process protection; no GPS, ZIP, search bodies or Google content are retained.
// Replace this interface with shared enforcement before opening high-volume access.
export function createServiceLimiter(now: () => number = Date.now) {
  const entries = new Map<string, { count: number; until: number }>();
  return (userId: string, kind: "search" | "details" | "write") => {
    const time = now();
    for (const [key, entry] of entries)
      if (entry.until <= time) entries.delete(key);
    const key = `${kind}:${userId}`,
      entry = entries.get(key);
    const maximum = kind === "search" ? 20 : 60;
    if (!entry) {
      if (entries.size >= 10000) return false;
      entries.set(key, { count: 1, until: time + 300000 });
      return true;
    }
    if (entry.count >= maximum) return false;
    entry.count++;
    return true;
  };
}
export const allowServiceRequest = createServiceLimiter();
