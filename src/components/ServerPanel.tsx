import { useServerInfo } from "../api/queries";
import { formatBytes, formatUptime, hitRate } from "../lib/format";

export function ServerPanel() {
  const q = useServerInfo(true);

  if (q.isPending) {
    return (
      <div className="detail" aria-busy="true">
        <div className="skeleton" style={{ width: 320 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="detail">
        <div role="alert" className="alert alert--block">
          {q.error.message}
        </div>
      </div>
    );
  }

  const s = q.data;
  const rate = hitRate(s.hits, s.misses);
  const totalKeys = s.databases.reduce((n, d) => n + d.keys, 0);
  const stats: [string, string][] = [
    ["Uptime", s.uptimeSeconds === null ? "—" : formatUptime(s.uptimeSeconds)],
    [
      "Memory",
      s.usedMemory === null
        ? "—"
        : s.maxMemory
          ? `${formatBytes(s.usedMemory)} of ${formatBytes(s.maxMemory)}`
          : `${formatBytes(s.usedMemory)} (no limit)`,
    ],
    ["Clients", s.connectedClients?.toString() ?? "—"],
    ["Ops per second", s.opsPerSec?.toString() ?? "—"],
    ["Hit rate", rate === null ? "—" : `${Math.round(rate * 100)}%`],
    ["Keys", totalKeys.toLocaleString()],
  ];

  return (
    <div className="detail">
      <div>
        <h1 className="detail__name">
          {s.product} {s.version}
        </h1>
        <div className="chips">
          {s.mode && <span className="chip">{s.mode}</span>}
          {s.role && <span className="chip">{s.role}</span>}
          {s.os && <span className="chip">{s.os}</span>}
        </div>
      </div>

      <dl className="stats">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="panel">
        <div className="panel__bar">
          <span className="section-label">Databases</span>
          <span className="panel__note">Only databases that hold keys</span>
        </div>
        {s.databases.length === 0 ? (
          <p className="note">No keys on this server.</p>
        ) : (
          <table className="grid grid--groups">
            <thead>
              <tr>
                <th>Database</th>
                <th>Keys</th>
                <th>With expiry</th>
              </tr>
            </thead>
            <tbody>
              {s.databases.map((d) => (
                <tr key={d.index}>
                  <td>db{d.index}</td>
                  <td>{d.keys.toLocaleString()}</td>
                  <td>{d.expires.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="readwith">
        <span>Read with</span>
        <code>INFO</code>
        <span>every 5 seconds while this panel is open</span>
      </div>
    </div>
  );
}
