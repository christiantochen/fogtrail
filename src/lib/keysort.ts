import type { KeyNode } from "../api/types";

/** Key types a scan can be limited to, in the order the chips show them. */
export const KEY_KINDS = [
  { id: "string", chip: "STR", plural: "Strings" },
  { id: "hash", chip: "HASH", plural: "Hashes" },
  { id: "list", chip: "LIST", plural: "Lists" },
  { id: "set", chip: "SET", plural: "Sets" },
  { id: "zset", chip: "ZSET", plural: "Sorted sets" },
  { id: "stream", chip: "STRM", plural: "Streams" },
] as const;

export type SortMode = "name" | "expiry";

/** When a key runs out, in ms, going by when its TTL was read. */
const expiresAt = (k: KeyNode) =>
  (k.scannedAt ?? 0) + (k.ttlSeconds ?? 0) * 1000;

/**
 * The loaded keys that have a TTL, soonest first. Redis cannot sort a scan for us,
 * so this only ever covers the keys loaded so far.
 */
export function sortByExpiry(keys: KeyNode[]): KeyNode[] {
  return keys
    .filter((k) => k.ttlSeconds !== null)
    .sort(
      (a, b) => expiresAt(a) - expiresAt(b) || a.name.localeCompare(b.name),
    );
}
