import type { Page } from "@playwright/test";

// The real backend is Rust, so the page talks to a stub of it. The data is
// fixed so the screenshots are stable.
export const profiles = [
  {
    id: "1",
    name: "eCMS Standard - UAT",
    driver: "redis",
    host: "redis-standard.uat.example.dev",
    port: 6379,
    username: null,
    database: 0,
    schema: null,
    tls: true,
  },
  {
    id: "2",
    name: "local-valkey",
    driver: "redis",
    host: "127.0.0.1",
    port: 6380,
    username: null,
    database: 0,
    schema: null,
    tls: false,
  },
];

// A MySQL connection, added only by tests that ask for it, so the Redis tests keep
// seeing the two profiles above.
export const mysqlProfile = {
  id: "3",
  name: "shop-prod",
  driver: "mysql",
  host: "db.internal",
  port: 3306,
  username: "fogtrail",
  database: 0,
  schema: "shop",
  tls: false,
};

export async function stubBackend(
  page: Page,
  extraKeys: string[] = [],
  options: { mysql?: boolean } = {},
) {
  await page.addInitScript(
    ([base, extra, mysql]) => {
      const profiles = mysql ? [...base, mysql] : [...base];
      const keys = [
        ...extra,
        "cache:user:1",
        "cache:user:2",
        "session:abc",
        "session:def",
        "config",
        "jobs/daily",
        "jobs/weekly",
      ];
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        // Menu clicks arrive as events; menu(id) in a test plays one of them.
        // getCurrentWindow() reads which window this page is.
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main", windowLabel: "main" },
        },
        transformCallback: (cb: (e: unknown) => void) => {
          const w = window as unknown as { __cbs?: ((e: unknown) => void)[] };
          (w.__cbs ??= []).push(cb);
          return w.__cbs.length - 1;
        },
        invoke: async (cmd: string, args: { id?: string; name?: string }) => {
          switch (cmd) {
            case "plugin:event|listen": {
              const w = window as unknown as {
                __cbs: ((e: unknown) => void)[];
                __menu?: (id: string) => void;
              };
              const a = args as unknown as { handler: number; event: string };
              if (a.event === "menu")
                w.__menu = (id) =>
                  w.__cbs[a.handler]({ event: "menu", id: 0, payload: id });
              return 0;
            }
            case "plugin:event|unlisten":
              return null;
            // The window: tests set __customTitleBar to play Windows, which
            // has no OS frame, and read __win for what the buttons asked for.
            case "plugin:window|is_decorated":
              return !(window as unknown as { __customTitleBar?: boolean })
                .__customTitleBar;
            // __maximized and __fullscreen hold the window's state.
            case "plugin:window|is_maximized":
              return !!(window as unknown as { __maximized?: boolean })
                .__maximized;
            case "plugin:window|is_fullscreen":
              return !!(window as unknown as { __fullscreen?: boolean })
                .__fullscreen;
            case "plugin:window|minimize":
            case "plugin:window|toggle_maximize":
            case "plugin:window|close":
            case "plugin:process|exit": {
              const w = window as unknown as {
                __win?: string[];
                __maximized?: boolean;
              };
              const name = cmd.split("|")[1];
              if (name === "toggle_maximize") w.__maximized = !w.__maximized;
              (w.__win ??= []).push(name);
              return null;
            }
            case "toggle_fullscreen": {
              const w = window as unknown as {
                __win?: string[];
                __fullscreen?: boolean;
              };
              (w.__win ??= []).push("toggle_fullscreen");
              w.__fullscreen = !w.__fullscreen;
              return w.__fullscreen;
            }
            case "set_theme": {
              const w = window as unknown as { __themes?: string[] };
              (w.__themes ??= []).push(
                (args as { theme?: string }).theme ?? "",
              );
              return null;
            }
            case "plugin:app|version":
              return "0.2.1";
            case "list_profiles":
              return profiles;
            case "connect": {
              await new Promise((r) =>
                setTimeout(
                  r,
                  (window as unknown as { __CONNECT_DELAY__?: number })
                    .__CONNECT_DELAY__ ?? 0,
                ),
              );
              if (
                (window as unknown as { __FAIL_CONNECT__?: boolean })
                  .__FAIL_CONNECT__
              )
                throw { kind: "connect", message: "Connection refused" };
              const p = profiles.find((x) => x.id === args.id)!;
              if (p.driver === "mysql")
                return {
                  driver: "MySQL 8.0.36",
                  address: `${p.host}:${p.port}`,
                  database: 0,
                  store: "sql",
                };
              return {
                driver: "Redis 6.2.14",
                address: `${p.host}:${p.port}`,
                database: 0,
                store: "keyValue",
              };
            }
            case "scan_keys": {
              const glob = (args.pattern as string | undefined) ?? "*";
              // Redis glob -> RegExp: * any run, [..] class, \\x literal.
              let src = "";
              for (let i = 0; i < glob.length; i++) {
                const c = glob[i];
                if (c === "\\") src += "\\" + glob[++i];
                else if (c === "*") src += ".*";
                else if (c === "[" || c === "]") src += c;
                else src += c.replace(/[.+?^${}()|\\]/g, "\\$&");
              }
              const re = new RegExp("^" + src + "$");
              return {
                items: keys
                  .filter((n) => re.test(n))
                  .map((name) => ({
                    name,
                    kind: name.startsWith("hash:") ? "hash" : "string",
                    ttlSeconds: name.startsWith("temp:")
                      ? 90
                      : name.startsWith("soon:")
                        ? 30
                        : null,
                  }))
                  .filter(
                    (n) => !args.kind || (args.kind as string) === n.kind,
                  ),
                nextCursor: null,
              };
            }
            case "get_key": {
              const n = args.name as string;
              const w = window as unknown as {
                __reads?: number;
                __FAIL_GET__?: boolean;
                __tempBorn?: number;
              };
              // temp: keys live for 90 s from their first read, then Redis removes them.
              let tempLeft: number | null = null;
              if (n.startsWith("temp:")) {
                w.__tempBorn ??= Date.now();
                tempLeft = 90 - Math.floor((Date.now() - w.__tempBorn) / 1000);
                if (tempLeft <= 0)
                  throw { kind: "notFound", message: `No such key: ${n}` };
              }
              if (n.startsWith("live:")) {
                if (w.__FAIL_GET__)
                  throw { kind: "connect", message: "Connection lost" };
                w.__reads = (w.__reads ?? 0) + 1;
                return {
                  name: n,
                  kind: "string",
                  ttlSeconds: null,
                  encoding: "raw",
                  sizeBytes: 30,
                  readWith: ["GET key"],
                  value: {
                    type: "text",
                    text: JSON.stringify({ id: 1, count: w.__reads }),
                    truncated: false,
                  },
                };
              }
              if (n.startsWith("doc:"))
                return {
                  name: n,
                  kind: "string",
                  ttlSeconds: null,
                  encoding: "raw",
                  sizeBytes: 90,
                  readWith: ["GET key"],
                  value: {
                    type: "text",
                    text: '{"id":9,"status":"paid","items":[{"sku":"A-1","qty":3},{"sku":"B-2","qty":1}],"note":"Paid in full"}',
                    truncated: false,
                  },
                };
              if (n.startsWith("user:"))
                return {
                  name: n,
                  kind: "hash",
                  ttlSeconds: null,
                  encoding: "listpack",
                  sizeBytes: 120,
                  readWith: ["HGETALL key"],
                  value: {
                    type: "map",
                    total: 4,
                    truncated: false,
                    entries: [
                      { key: "name", value: "Ayu Lestari" },
                      { key: "email", value: "ayu@example.com" },
                      { key: "plan", value: "pro" },
                      { key: "city", value: "Bandung" },
                    ],
                  },
                };
              return {
                name: args.name,
                kind: "string",
                ttlSeconds: tempLeft,
                encoding: "embstr",
                sizeBytes: 12,
                readWith: ["GET key"],
                value: { type: "text", text: "hello world", truncated: false },
              };
            }
            case "server_info":
              return {
                product: "Redis",
                version: "6.2.14",
                usedMemory: 25_800_000,
                maxMemory: 30_000_000,
                databases: [{ index: 0, keys: keys.length, expires: 0 }],
                // Tests set __DB_COUNT__ to 1 or null to mimic a one-database or a CONFIG-less server.
                databaseCount:
                  "__DB_COUNT__" in window
                    ? (window as unknown as { __DB_COUNT__: number | null })
                        .__DB_COUNT__
                    : 16,
              };
            case "test_connection": {
              const prof = args.profile as { driver: string };
              return prof.driver === "mysql"
                ? { product: "MySQL", version: "8.0.36", keyCount: null }
                : { product: "Redis", version: "6.2.14", keyCount: 7 };
            }
            case "list_schemas":
              return [
                { name: "analytics", system: false },
                { name: "information_schema", system: true },
                { name: "mysql", system: true },
                { name: "shop", system: false },
              ];
            case "list_tables": {
              const schema = (args as unknown as { schema: string }).schema;
              if (schema !== "shop") return [];
              return [
                { name: "customers", kind: "table", estimatedRows: 1200 },
                { name: "events", kind: "table", estimatedRows: 250 },
                { name: "orders", kind: "table", estimatedRows: 48213 },
                { name: "paying_customers", kind: "view", estimatedRows: null },
                { name: "weird name", kind: "table", estimatedRows: 1 },
              ];
            }
            case "table_structure": {
              const t = (args as unknown as { table: string }).table;
              ((
                window as unknown as { __structureCalls?: string[] }
              ).__structureCalls ??= []).push(t);
              const col = (
                name: string,
                dataType: string,
                extra: Record<string, unknown> = {},
              ) => ({
                name,
                dataType,
                nullable: false,
                key: null,
                default: null,
                extra: null,
                comment: null,
                ...extra,
              });
              if (t === "orders")
                return {
                  kind: "table",
                  engine: "InnoDB",
                  comment: null,
                  columns: [
                    col("id", "bigint unsigned", {
                      key: "PRI",
                      extra: "auto_increment",
                    }),
                    col("customer_id", "bigint unsigned", { key: "MUL" }),
                    col("status", "enum('paid','pending')", {
                      default: "pending",
                    }),
                    col("total", "decimal(10,2)"),
                    col("notes", "varchar(255)", { nullable: true }),
                  ],
                  indexes: [
                    {
                      name: "PRIMARY",
                      unique: true,
                      columns: ["id"],
                      indexType: "BTREE",
                    },
                    {
                      name: "idx_customer",
                      unique: false,
                      columns: ["customer_id"],
                      indexType: "BTREE",
                    },
                  ],
                  foreignKeys: [
                    {
                      name: "fk_orders_customer",
                      columns: ["customer_id"],
                      refSchema: "shop",
                      refTable: "customers",
                      refColumns: ["id"],
                    },
                  ],
                };
              return {
                kind: t === "paying_customers" ? "view" : "table",
                engine: t === "paying_customers" ? null : "InnoDB",
                comment: null,
                columns: [
                  col("id", "bigint unsigned", { key: "PRI" }),
                  col("kind", "varchar(20)"),
                ],
                indexes: [],
                foreignKeys: [],
              };
            }
            case "table_rows": {
              const a = args as unknown as {
                table: string;
                offset: number;
                view?: {
                  filter?: string;
                  sortColumn?: string;
                  sortDesc?: boolean;
                };
              };
              const w = window as unknown as {
                __rowDelay?: number;
                __rowCalls?: { table: string; offset: number }[];
                __rowViews?: unknown[];
                __FAIL_ROWS__?: boolean;
              };
              // A test can make reads slow, to look at the loading state.
              if (w.__rowDelay)
                await new Promise((r) => setTimeout(r, w.__rowDelay));
              (w.__rowCalls ??= []).push({ table: a.table, offset: a.offset });
              (w.__rowViews ??= []).push(a.view ?? {});
              if (w.__FAIL_ROWS__)
                throw { kind: "sql", message: "SELECT command denied to user" };
              const filter = a.view?.filter ?? "";
              // The backend checks the whole statement; this is the same idea, cut down.
              if (filter.includes(";"))
                throw {
                  kind: "blocked",
                  message:
                    "Running more than one statement at once is not allowed. Fogtrail runs SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only. Nothing was sent to the server.",
                };
              if (/\bboom\b/.test(filter))
                throw {
                  kind: "sql",
                  message: "Unknown column 'boom' in 'where clause'",
                };
              if (a.table === "orders") {
                const columns = [
                  { name: "id", typeName: "BIGINT" },
                  { name: "customer_id", typeName: "BIGINT" },
                  { name: "status", typeName: "ENUM" },
                  { name: "total", typeName: "DECIMAL" },
                  { name: "notes", typeName: "VARCHAR" },
                  { name: "items", typeName: "JSON" },
                  { name: "created_at", typeName: "TIMESTAMP" },
                  { name: "meta", typeName: "TEXT" },
                ];
                let rows: (string | null)[][] = [
                  [
                    "48213",
                    "9021",
                    "paid",
                    "184.50",
                    null,
                    '[{"sku":"BK-114","qty":2},{"sku":"BK-207","qty":1}]',
                    "2026-11-11 09:42:07",
                    // A text column that holds JSON.
                    '{"source":"web","coupon":"SPRING"}',
                  ],
                  [
                    "48212",
                    "4417",
                    "pending",
                    "62.00",
                    "Leave at front desk",
                    '{"gift":true}',
                    "2026-11-10 19:27:03",
                    // Plain words in a text column stay plain.
                    "called twice",
                  ],
                  [
                    "48211",
                    "7730",
                    "paid",
                    "310.25",
                    "",
                    "[]",
                    "2026-11-09 12:18:42",
                    "",
                  ],
                ];
                if (/nomatch/.test(filter)) rows = [];
                else if (/status\s*=\s*'paid'/.test(filter))
                  rows = rows.filter((r) => r[2] === "paid");
                const sortAt = columns.findIndex(
                  (c) => c.name === a.view?.sortColumn,
                );
                if (sortAt >= 0) {
                  const dir = a.view?.sortDesc ? -1 : 1;
                  rows = [...rows].sort(
                    (x, y) =>
                      dir *
                      String(x[sortAt] ?? "").localeCompare(
                        String(y[sortAt] ?? ""),
                        undefined,
                        { numeric: true },
                      ),
                  );
                }
                return { columns, rows, offset: 0, hasMore: false };
              }
              // `events` is long enough to page: 250 rows, 100 per page.
              const total = a.table === "events" ? 250 : 0;
              const shown = Math.max(0, Math.min(100, total - a.offset));
              return {
                columns: [
                  { name: "id", typeName: "BIGINT" },
                  { name: "kind", typeName: "VARCHAR" },
                ],
                rows: Array.from({ length: shown }, (_, i) => [
                  String(a.offset + i + 1),
                  (a.offset + i) % 2 ? "tock" : "tick",
                ]),
                offset: a.offset,
                hasMore: a.offset + shown < total,
              };
            }
            case "run_query": {
              const a = args as unknown as {
                sql: string;
                schema: string | null;
                runId: string;
              };
              const w = window as unknown as {
                __queryCalls?: { sql: string; schema: string | null }[];
                __stopSlow?: Record<string, () => void>;
              };
              (w.__queryCalls ??= []).push({ sql: a.sql, schema: a.schema });
              // The same rule as the backend guard, cut down: one statement, and only
              // reads. The real thing is tested in Rust.
              const bare = a.sql
                .replace(/\/\*[\s\S]*?\*\//g, " ")
                .replace(/(--|#)[^\n]*/g, " ")
                .trim()
                .replace(/;+\s*$/, "");
              const word = (
                bare.match(/^\(?\s*(\w+)/)?.[1] ?? ""
              ).toUpperCase();
              const allowed = [
                "SELECT",
                "SHOW",
                "DESCRIBE",
                "DESC",
                "EXPLAIN",
                "WITH",
              ];
              const allowedText =
                "Fogtrail runs SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only. Nothing was sent to the server.";
              if (bare === "")
                throw {
                  kind: "blocked",
                  message: "There is nothing to run. Type a statement first.",
                };
              if (
                a.sql
                  .trim()
                  .replace(/;+\s*$/, "")
                  .includes(";")
              )
                throw {
                  kind: "blocked",
                  message: `Running more than one statement at once is not allowed. ${allowedText}`,
                };
              if (!allowed.includes(word))
                throw {
                  kind: "blocked",
                  message: `${word} is not allowed. ${allowedText}`,
                };
              if (/slow/i.test(a.sql)) {
                // Waits until the test cancels it.
                await new Promise<void>((resolve) => {
                  (w.__stopSlow ??= {})[a.runId] = resolve;
                });
                throw { kind: "sql", message: "Stopped." };
              }
              if (/broken/i.test(a.sql))
                throw {
                  kind: "sql",
                  message:
                    "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'broken' at line 1",
                };
              if (/huge/i.test(a.sql))
                return {
                  columns: [{ name: "n", typeName: "BIGINT" }],
                  rows: Array.from({ length: 1000 }, (_, i) => [String(i + 1)]),
                  truncated: true,
                  rowLimit: 1000,
                  elapsedMs: 1840,
                };
              if (/nothing/i.test(a.sql))
                return {
                  columns: [
                    { name: "id", typeName: "BIGINT" },
                    { name: "kind", typeName: "VARCHAR" },
                  ],
                  rows: [],
                  truncated: false,
                  rowLimit: 1000,
                  elapsedMs: 3,
                };
              return {
                columns: [
                  { name: "id", typeName: "BIGINT" },
                  { name: "status", typeName: "ENUM" },
                  { name: "total", typeName: "DECIMAL" },
                  { name: "notes", typeName: "VARCHAR" },
                ],
                rows: [
                  ["48213", "paid", "184.50", null],
                  ["48212", "pending", "62.00", "Leave at front desk"],
                  ["48211", "paid", "310.25", ""],
                ],
                truncated: false,
                rowLimit: 1000,
                elapsedMs: 12,
              };
            }
            case "cancel_query": {
              const w = window as unknown as {
                __stopSlow?: Record<string, () => void>;
                __cancelled?: string[];
              };
              const id = (args as unknown as { runId: string }).runId;
              (w.__cancelled ??= []).push(id);
              w.__stopSlow?.[id]?.();
              return null;
            }
            case "save_profile": {
              const w = window as unknown as { __saved?: unknown[] };
              (w.__saved ??= []).push(args);
              const prof = args.profile as { id: string };
              return { ...prof, id: prof.id || "9" };
            }
            case "disconnect":
              return null;
            default:
              throw new Error(`unstubbed command: ${cmd}`);
          }
        },
      };
    },
    [profiles, extraKeys, options.mysql ? mysqlProfile : null] as const,
  );
}
