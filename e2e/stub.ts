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

// A PostgreSQL connection, added only by tests that ask for it.
export const postgresProfile = {
  id: "4",
  name: "shop-pg",
  driver: "postgres",
  host: "pg.internal",
  port: 5432,
  username: "fogtrail",
  database: 0,
  schema: null,
  tls: true,
  dbname: "shop",
  sslMode: "require",
};

export async function stubBackend(
  page: Page,
  extraKeys: string[] = [],
  options: { mysql?: boolean; postgres?: boolean; extraSchemas?: number } = {},
) {
  await page.addInitScript(
    ([base, extra, mysql, postgres, extraSchemas]) => {
      const profiles = [
        ...base,
        ...(mysql ? [mysql] : []),
        ...(postgres ? [postgres] : []),
      ];
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
          // `ledger`: 126 columns in groups, to try the row dialog on a wide table.
          const ledger = () => {
            const spec: [string, number, number][] = [
              ["", 9, 8],
              ["billing_", 22, 9],
              ["shipping_", 24, 11],
              ["audit_", 9, 7],
              ["flags_", 31, 9],
              ["x", 31, 8],
            ];
            const cols: {
              name: string;
              typeName: string;
              value: string | null;
            }[] = [];
            for (const [prefix, count, set] of spec) {
              for (let i = 0; i < count; i++) {
                const name =
                  prefix === ""
                    ? [
                        "id",
                        "status",
                        "total",
                        "channel",
                        "placed",
                        "meta",
                        "tags",
                        "note",
                        "ref",
                      ][i]
                    : prefix === "x"
                      ? `x${String(i).padStart(2, "0")}_value`
                      : `${prefix}${["name", "email", "city", "amount", "address", "due", "code", "memo", "flag"][i % 9]}${i >= 9 ? i : ""}`;
                const typeName =
                  name === "meta" || name.endsWith("address")
                    ? "JSON"
                    : name === "tags"
                      ? "TEXT[]"
                      : name === "id" || name.endsWith("amount")
                        ? "BIGINT"
                        : name === "placed" || name.endsWith("due")
                          ? "DATETIME"
                          : "VARCHAR";
                const value =
                  i >= set
                    ? null
                    : typeName === "JSON"
                      ? '{"a": 1, "b": 2, "c": 3}'
                      : typeName === "TEXT[]"
                        ? "{wholesale,gift}"
                        : typeName === "BIGINT"
                          ? String(7730 + i)
                          : typeName === "DATETIME"
                            ? "2026-11-14 10:58:13"
                            : name === "note"
                              ? "Deliver to the back door of the bakery, ring twice and ask for the manager on duty"
                              : `${name} ${i}`;
                cols.push({ name, typeName, value });
              }
            }
            return cols;
          };
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
              (window as unknown as { __pg?: boolean }).__pg =
                p.driver === "postgres";
              if (p.driver === "postgres")
                return {
                  driver: "PostgreSQL",
                  address: `${p.host}:${p.port}`,
                  database: 0,
                  store: "sql",
                };
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
              return prof.driver === "postgres"
                ? { product: "PostgreSQL", version: "16.4", keyCount: null }
                : prof.driver === "mysql"
                  ? { product: "MySQL", version: "8.0.36", keyCount: null }
                  : { product: "Redis", version: "6.2.14", keyCount: 7 };
            }
            case "list_schemas":
              if ((window as unknown as { __pg?: boolean }).__pg)
                return [
                  { name: "billing", system: false },
                  { name: "information_schema", system: true },
                  { name: "pg_catalog", system: true },
                  { name: "public", system: false },
                ];
              return [
                ...Array.from({ length: extraSchemas }, (_, i) => ({
                  name: `archive_${String(i).padStart(2, "0")}`,
                  system: false,
                })),
                { name: "analytics", system: false },
                { name: "information_schema", system: true },
                { name: "mysql", system: true },
                { name: "shop", system: false },
              ];
            case "list_tables": {
              const schema = (args as unknown as { schema: string }).schema;
              if ((window as unknown as { __pg?: boolean }).__pg) {
                if (schema === "billing")
                  return [
                    { name: "invoices", kind: "table", estimatedRows: 90 },
                  ];
                if (schema !== "public") return [];
                return [
                  { name: "Weird Name", kind: "table", estimatedRows: 1 },
                  { name: "customers", kind: "table", estimatedRows: 1200 },
                  { name: "mv_plan_counts", kind: "matview", estimatedRows: 3 },
                  { name: "orders", kind: "table", estimatedRows: 48213 },
                  {
                    name: "paying_customers",
                    kind: "view",
                    estimatedRows: null,
                  },
                ];
              }
              if (schema !== "shop") return [];
              return [
                { name: "customers", kind: "table", estimatedRows: 1200 },
                { name: "events", kind: "table", estimatedRows: 250 },
                { name: "orders", kind: "table", estimatedRows: 48213 },
                { name: "paying_customers", kind: "view", estimatedRows: null },
                { name: "ledger", kind: "table", estimatedRows: 6 },
                { name: "settings", kind: "table", estimatedRows: 1 },
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
              if (t === "ledger")
                return {
                  kind: "table",
                  engine: "InnoDB",
                  comment: null,
                  columns: ledger().map((c, i) =>
                    col(c.name, c.typeName.toLowerCase(), {
                      key: i === 0 ? "PRI" : null,
                    }),
                  ),
                  indexes: [],
                };
              if (
                t === "orders" &&
                (window as unknown as { __pg?: boolean }).__pg
              )
                return {
                  kind: "table",
                  engine: null,
                  comment: null,
                  columns: [
                    col("id", "bigint", {
                      key: "PRI",
                      extra: "generated by default as identity",
                    }),
                    col("customer_id", "bigint"),
                    col("status", "plan", { default: "'pending'::plan" }),
                    col("total", "numeric(10,2)"),
                    col("items", "jsonb", { nullable: true }),
                    col("created_at", "timestamp with time zone"),
                  ],
                  indexes: [
                    {
                      name: "orders_pkey",
                      unique: true,
                      columns: ["id"],
                      indexType: "btree",
                      definition:
                        "CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id)",
                    },
                    {
                      name: "idx_orders_big",
                      unique: false,
                      columns: ["total"],
                      indexType: "btree · partial",
                      definition:
                        "CREATE INDEX idx_orders_big ON public.orders USING btree (total) WHERE (total > 1000)",
                    },
                  ],
                  foreignKeys: [
                    {
                      name: "orders_customer_id_fkey",
                      columns: ["customer_id"],
                      refSchema: "public",
                      refTable: "customers",
                      refColumns: ["id"],
                    },
                  ],
                };
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
                __pg?: boolean;
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
              if (a.table === "orders" && w.__pg) {
                return {
                  columns: [
                    { name: "id", typeName: "INT8" },
                    { name: "status", typeName: "TEXT" },
                    { name: "total", typeName: "NUMERIC" },
                    { name: "items", typeName: "JSONB" },
                    { name: "created_at", typeName: "TIMESTAMPTZ" },
                    { name: "tags", typeName: "TEXT[]" },
                  ],
                  rows: [
                    [
                      "48213",
                      "paid",
                      "184.50",
                      '{"sku": "BK-114", "qty": 2}',
                      "2026-11-11 09:42:07.5+00",
                      '{gift,"rush order"}',
                    ],
                    [
                      "48212",
                      "pending",
                      "62.00",
                      null,
                      "2026-11-10 19:27:03+00",
                      "{}",
                    ],
                    [
                      "48211",
                      "paid",
                      "310.25",
                      '{"id": 9007199254740993}',
                      "2026-11-09 12:18:42+07",
                      "{a}",
                    ],
                  ],
                  offset: 0,
                  hasMore: false,
                };
              }
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
              if (a.table === "ledger") {
                const cols = ledger();
                return {
                  columns: cols.map((c) => ({
                    name: c.name,
                    typeName: c.typeName,
                  })),
                  rows: [cols.map((c) => c.value)],
                  offset: 0,
                  hasMore: false,
                };
              }
              if (a.table === "settings") {
                // Many columns with long names and no JSON: the row dialog has to lay them out.
                const names = [
                  "id",
                  "name",
                  "rbac_role_level_id",
                  "merchant_key",
                  "tax_inclusive_mode",
                  "is_rounding_generate_confirm",
                  "organization_partner_id",
                  "loyalty_mobile_app_store_listing",
                  "loyalty_mobile_app_ordering",
                  "chain_display_mode_id",
                  "gst_registration_number",
                  "default_crm_ui",
                  "time_format",
                  "smart_qrcode",
                  "is_batch_order",
                  "is_churned",
                  "churn_reason_id",
                  "country_region",
                  "partner_code",
                  "vibe_mode",
                  "location",
                  "address",
                  "lat",
                  "lon",
                ];
                const value = (n: string) =>
                  n === "location"
                    ? "Opposite Sample Park, Example Road, Example District, Singapore, Central, 000000, Singapore"
                    : n === "name"
                      ? "Harbor Books"
                      : n === "partner_code" || n === "vibe_mode"
                        ? null
                        : "1";
                return {
                  columns: names.map((name) => ({ name, typeName: "VARCHAR" })),
                  rows: [names.map(value)],
                  offset: 0,
                  hasMore: false,
                };
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
    [
      profiles,
      extraKeys,
      options.mysql ? mysqlProfile : null,
      options.postgres ? postgresProfile : null,
      options.extraSchemas ?? 0,
    ] as const,
  );
}
