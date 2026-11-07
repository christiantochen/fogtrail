import { useKeyDetail } from "../api/queries";
import { copyText } from "../lib/clipboard";
import { formatBytes } from "../lib/format";
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

  if (q.isPending) {
    return (
      <div className="detail" aria-busy="true">
        <div className="skeleton" style={{ width: 320 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }
  // A failed re-read keeps showing the last value; only a first failure replaces the page.
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
