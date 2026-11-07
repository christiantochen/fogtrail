import { useEffect, useState } from "react";
import { formatTtl, remainingTtl } from "../lib/format";

/** TTL that counts down on screen, so you can watch a key about to expire. */
export function TtlChip({
  seconds,
  fetchedAt,
}: {
  seconds: number | null;
  fetchedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (seconds === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [seconds, fetchedAt]);

  const left = remainingTtl(seconds, fetchedAt, Math.max(now, fetchedAt));
  if (left === 0) return <span className="chip chip--warn">Expired</span>;
  return <span className="chip">TTL {formatTtl(left)}</span>;
}
