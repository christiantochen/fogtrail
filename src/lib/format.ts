/** `null` means the key never expires. */
export function formatTtl(seconds: number | null): string {
  if (seconds === null) return "No expiry";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (seconds < 3600) return `${m}m ${seconds % 60}s`.replace(/ 0s$/, "");
  const h = Math.floor(seconds / 3600);
  if (seconds < 86400) return `${h}h ${m % 60}m`.replace(/ 0m$/, "");
  const d = Math.floor(seconds / 86400);
  return `${d}d ${h % 24}h`.replace(/ 0h$/, "");
}

/** Short TTL for tree rows, one unit only. */
export function formatTtlShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * What a tree row shows for a key's TTL: one unit, counting down from the scan.
 * `null` means no TTL to show; `expired` means the time is up.
 */
export function ttlLabel(
  ttlSeconds: number | null,
  scannedAt: number,
  now: number,
): { text: string; expired: boolean } | null {
  const left = remainingTtl(ttlSeconds, scannedAt, Math.max(now, scannedAt));
  if (left === null) return null;
  if (left === 0) return { text: "expired", expired: true };
  return { text: formatTtlShort(left), expired: false };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const BADGES: Record<string, string> = {
  string: "STR",
  hash: "HASH",
  list: "LIST",
  set: "SET",
  zset: "ZSET",
  stream: "STRM",
};

export const typeBadge = (kind: string) =>
  BADGES[kind] ?? kind.toUpperCase().slice(0, 4);

/** Pretty-prints JSON, or returns null when the text is not a JSON object/array. */
export function tryPrettyJson(text: string): string | null {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return null;
  }
}

/** Classic hex dump: offset, 16 bytes of hex, printable ASCII. */
export function hexDump(hex: string): string {
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 32) {
    const chunk = hex.slice(i, i + 32);
    const bytes = chunk.match(/../g) ?? [];
    const ascii = bytes
      .map((b) => {
        const c = parseInt(b, 16);
        return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
      })
      .join("");
    lines.push(
      `${(i / 2).toString(16).padStart(6, "0")}  ${bytes.join(" ").padEnd(47)}  ${ascii}`,
    );
  }
  return lines.join("\n");
}

/** Local date and time for a stream entry, or an em dash when the ID carries no time. */
export function formatStreamTime(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "3d 4h", "5h 12m", "42s": the two largest units. */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** Share of lookups that found a key, or null before any lookups. */
export function hitRate(
  hits: number | null,
  misses: number | null,
): number | null {
  if (hits === null || misses === null || hits + misses === 0) return null;
  return hits / (hits + misses);
}

/**
 * Database indexes to offer. When the server says how many it has, all of them;
 * when it won't say, only the ones that hold keys. The current one is always there.
 */
export function databaseChoices(
  withKeys: number[],
  current: number,
  count: number | null,
): number[] {
  const all = new Set<number>([
    ...(count === null ? withKeys : Array.from({ length: count }, (_, i) => i)),
    current,
  ]);
  return [...all].sort((a, b) => a - b);
}

/** Seconds left on a TTL read at `fetchedAt`; `null` for no expiry. Never below 0. */
export function remainingTtl(
  ttlSeconds: number | null,
  fetchedAt: number,
  now: number,
): number | null {
  if (ttlSeconds === null) return null;
  return Math.max(0, ttlSeconds - Math.floor((now - fetchedAt) / 1000));
}
