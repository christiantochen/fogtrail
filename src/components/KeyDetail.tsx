import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useKeyDetail } from "../api/queries";
import { copyText } from "../lib/clipboard";
import { formatBytes, remainingTtl } from "../lib/format";
import { refreshAll } from "../lib/refreshAll";
import { useNow } from "../lib/useNow";
import { useUi } from "../state/ui";
import { TtlChip } from "./TtlChip";
import { AutoRefresh } from "./AutoRefresh";
import { ValueView, valueAsText } from "./ValueView";

export function KeyDetail({ name }: { name: string }) {
  const every = useUi((s) => s.refreshEvery);
  const q = useKeyDetail(name, every);
  const select = useUi((s) => s.select);
  const pinned = useUi((s) => s.pins.includes(name));
  const togglePin = useUi((s) => s.togglePin);
  const qc = useQueryClient();

  // When the TTL runs out, ask the server once: the key is probably gone, and the
  // page should say so rather than keep showing the old value.
  const now = useNow();
  const lastAtZero = useRef(0);
  const left = q.data
    ? remainingTtl(q.data.ttlSeconds, q.dataUpdatedAt, now)
    : null;
  const { refetch, isFetching } = q;
  useEffect(() => {
    if (left !== 0 || isFetching) return;
    // At most once every two seconds, in case Redis reports a TTL of 0 for a live key.
    if (Date.now() - lastAtZero.current < 2000) return;
    lastAtZero.current = Date.now();
    void refetch();
  }, [left, isFetching, refetch]);

  if (q.isPending) {
    return (
      <div className="detail" aria-busy="true">
        <div className="skeleton" style={{ width: 320 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }
  if (q.isError && q.error.kind === "notFound") {
    return (
      <div className="detail">
        <div className="gone">
          <h1 className="detail__name mono">{name}</h1>
          <h2>This key no longer exists</h2>
          <p>
            It expired or was deleted. Refresh the key list to see what is left.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                refreshAll(qc);
                select(null);
              }}
            >
              Refresh list
            </button>
          </div>
        </div>
      </div>
    );
  }
  // Any other failed re-read keeps showing the last value; only a first failure replaces the page.
  if (q.isError && !q.data) {
    return (
      <div className="detail">
        <div role="alert" className="alert alert--block">
          {q.error.message}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => void q.refetch()}
          >
            Try again
          </button>
          <button type="button" className="btn" onClick={() => select(null)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const d = q.data as NonNullable<typeof q.data>;
  const count =
    d.value.type === "map" ||
    d.value.type === "list" ||
    d.value.type === "table"
      ? `${d.value.total} ${d.value.type === "table" ? "members" : d.value.type === "map" ? "fields" : "items"}`
      : null;

  return (
    <div className="detail">
      <div className="detail__head">
        <div>
          <h1 className="detail__name mono">{d.name}</h1>
          <div className="chips">
            <span className="chip">{d.kind}</span>
            <TtlChip seconds={d.ttlSeconds} fetchedAt={q.dataUpdatedAt} />
            {count && <span className="chip">{count}</span>}
            {d.encoding && d.encoding !== d.kind && (
              <span className="chip">{d.encoding}</span>
            )}
            {d.sizeBytes != null && (
              <span className="chip">{formatBytes(d.sizeBytes)}</span>
            )}
          </div>
        </div>
        <div className="actions actions--wrap">
          <AutoRefresh updatedAt={q.dataUpdatedAt} failed={q.isError} />
          <button
            type="button"
            className="btn"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            {q.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={pinned}
            onClick={() => togglePin(d.name)}
          >
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void copyText(d.name, "key name")}
          >
            Copy key
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void copyText(valueAsText(d.value), "value")}
          >
            Copy value
          </button>
        </div>
      </div>

      <ValueView key={d.name} value={d.value} name={d.name} />

      <div className="readwith">
        <span>Read with</span>
        {d.readWith.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
    </div>
  );
}
