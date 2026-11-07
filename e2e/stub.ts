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
    tls: false,
  },
];

export async function stubBackend(page: Page, extraKeys: string[] = []) {
  await page.addInitScript(
    ([profiles, extra]) => {
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
        transformCallback: () => 0,
        invoke: async (cmd: string, args: { id?: string; name?: string }) => {
          switch (cmd) {
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
              return {
                driver: "Redis 6.2.14",
                address: `${p.host}:${p.port}`,
                database: 0,
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
                    kind: "string",
                    ttlSeconds: null,
                  })),
                nextCursor: null,
              };
            }
            case "get_key": {
              const n = args.name as string;
              const w = window as unknown as {
                __reads?: number;
                __FAIL_GET__?: boolean;
              };
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
                ttlSeconds: (args.name as string).startsWith("temp:")
                  ? 90
                  : null,
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
                databases: [{ index: 0, keys: keys.length, expires: 0 }],
              };
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
    [profiles, extraKeys] as const,
  );
}
