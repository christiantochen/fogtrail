import { useState } from "react";
import { streamPage } from "../api/browse";
import type { AppError, StreamEntry, StreamGroup } from "../api/types";
import { toAppError } from "../api/errors";
import { formatStreamTime } from "../lib/format";

interface Props {
  name: string;
  first: StreamEntry[];
  firstBefore: string | null;
  total: number;
  groups: StreamGroup[];
}

/** Stream entries, newest first, with older pages loaded on demand. */
export function StreamView({ name, first, firstBefore, total, groups }: Props) {
  const [extra, setExtra] = useState<StreamEntry[]>([]);
  const [before, setBefore] = useState(firstBefore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const entries = [...first, ...extra];

  const more = async () => {
    if (!before) return;
    setLoading(true);
    setError(null);
    try {
      const page = await streamPage(name, before);
      setExtra((e) => [...e, ...page.entries]);
      setBefore(page.nextBefore);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="table-wrap">
        <table className="grid grid--stream">
          <thead>
            <tr>
              <th>ID</th>
              <th>Time</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td className="nowrap">{formatStreamTime(e.timeMs)}</td>
                <td>
                  {e.fields.map((f, i) => (
                    <span className="kv" key={i}>
                      <span className="kv__k">{f.key}</span> {f.value}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="stream__foot">
        <span className="panel__note">
          Showing {entries.length} of {total}
        </span>
        {before && (
          <button
            type="button"
            className="btn btn--small"
            disabled={loading}
            onClick={() => void more()}
          >
            {loading ? "Loading…" : "Load older entries"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="alert alert--block" style={{ margin: 12 }}>
          {error.message}
        </div>
      )}

      {groups.length > 0 && (
        <div className="groups">
          <div className="section-label">Consumer groups</div>
          <table className="grid grid--groups">
            <thead>
              <tr>
                <th>Group</th>
                <th>Consumers</th>
                <th>Pending</th>
                <th>Last delivered</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td>{g.name}</td>
                  <td>{g.consumers}</td>
                  <td>{g.pending}</td>
                  <td>{g.lastDeliveredId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
