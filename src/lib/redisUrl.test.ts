import { describe, expect, it } from "vitest";
import { emptyDraft } from "./profile";
import {
  applyUrl,
  buildConnectionUrl,
  buildRedisUrl,
  looksLikeUrl,
  parseConnectionUrl,
  parseMysqlUrl,
  parseRedisUrl,
  type ParsedUrl,
} from "./redisUrl";

const ok = (s: string): ParsedUrl => {
  const r = parseRedisUrl(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (s: string) => {
  const r = parseRedisUrl(s);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("parseRedisUrl", () => {
  it("reads a full URL", () => {
    expect(
      ok("redis://default:xxxxxxxx@skilled-jam-canvas-38099.db.redis.io:13946"),
    ).toEqual({
      host: "skilled-jam-canvas-38099.db.redis.io",
      port: 13946,
      username: "default",
      password: "xxxxxxxx",
      tls: false,
    });
  });
  it("treats a URL with no username as legacy AUTH: password only", () => {
    const v = ok("redis://:s3cret@cache.example.com:6380");
    expect(v.username).toBe("");
    expect(v.password).toBe("s3cret");
  });
  it("leaves username and password out when there is no user section", () => {
    const v = ok("redis://cache.example.com:6380");
    expect(v.username).toBeUndefined();
    expect(v.password).toBeUndefined();
  });
  it("leaves the port out when missing, so the caller applies 6379", () => {
    expect(ok("redis://localhost").port).toBeUndefined();
    expect(ok("redis://localhost:").port).toBeUndefined();
  });
  it("reads the database from the path", () => {
    expect(ok("redis://localhost:6379/2").database).toBe(2);
    expect(ok("redis://localhost/15").database).toBe(15);
    expect(ok("redis://localhost/").database).toBeUndefined();
    expect(ok("redis://localhost:6379/0?timeout=5").database).toBe(0);
  });
  it("turns TLS on for rediss and off for redis, in any case", () => {
    expect(ok("rediss://h:1").tls).toBe(true);
    expect(ok("REDISS://h:1").tls).toBe(true);
    expect(ok("redis://h:1").tls).toBe(false);
  });
  it("percent-decodes the username and password", () => {
    const v = ok("redis://us%40er:p%40ss%3Aw%2Frd%25@h:1");
    expect(v.username).toBe("us@er");
    expect(v.password).toBe("p@ss:w/rd%");
  });
  it("copes with a raw @ inside the password", () => {
    const v = ok("redis://u:p@ss@h:1");
    expect(v.password).toBe("p@ss");
    expect(v.host).toBe("h");
  });
  it("reads an IPv6 host", () => {
    const v = ok("redis://[::1]:6380/3");
    expect(v.host).toBe("::1");
    expect(v.port).toBe(6380);
    expect(v.database).toBe(3);
  });
  it("trims surrounding space", () => {
    expect(ok("  redis://h:1\n").host).toBe("h");
  });

  describe("errors", () => {
    it("names an unsupported scheme", () => {
      expect(err("http://h:1")).toMatch(/Unsupported scheme “http:\/\/”/);
      expect(err("rediss+unix://h")).toMatch(/Unsupported scheme/);
    });
    it("rejects text that is not a URL", () => {
      expect(err("localhost:6379")).toMatch(/not a Redis URL/);
      expect(err("")).toMatch(/not a Redis URL/);
    });
    it("rejects a missing host", () => {
      expect(err("redis://")).toMatch(/no host/);
      expect(err("redis://user:pw@:6379")).toMatch(/no host/);
    });
    it("rejects an invalid port", () => {
      for (const p of ["0", "65536", "abc", "-1", "6379x"])
        expect(err(`redis://h:${p}`)).toMatch(/Port/);
    });
    it("rejects a database that is not a number", () => {
      expect(err("redis://h:1/two")).toMatch(/Database “two”/);
    });
    it("rejects a broken percent escape", () => {
      expect(err("redis://u:%zz@h:1")).toMatch(/password/);
      expect(err("redis://%zz:p@h:1")).toMatch(/username/);
    });
  });
});

describe("looksLikeUrl", () => {
  it("only matches scheme:// text", () => {
    expect(looksLikeUrl("redis://h")).toBe(true);
    expect(looksLikeUrl("http://h")).toBe(true);
    expect(looksLikeUrl("cache.example.com")).toBe(false);
    expect(looksLikeUrl("10.0.0.1:6379")).toBe(false);
  });
});

describe("applyUrl", () => {
  const url = ok("rediss://default:pw@h.example.com:13946/2");
  it("fills every field the URL has, including TLS", () => {
    const r = applyUrl(emptyDraft(), "", url, true);
    expect(r.draft).toMatchObject({
      host: "h.example.com",
      port: "13946",
      username: "default",
      database: "2",
      tls: true,
    });
    expect(r.password).toBe("pw");
    expect(r.filled).toEqual([
      "host",
      "tls",
      "port",
      "database",
      "username",
      "password",
    ]);
  });
  it("applies the defaults to a new connection when the URL omits port and database", () => {
    const r = applyUrl(
      { ...emptyDraft(), port: "7000", database: "5" },
      "",
      ok("redis://h"),
      true,
    );
    expect(r.draft.port).toBe("6379");
    expect(r.draft.database).toBe("0");
  });
  it("overwrites only what the URL has when editing", () => {
    const existing = {
      ...emptyDraft(),
      name: "prod",
      host: "old",
      port: "7000",
      username: "alice",
      database: "5",
      tls: true,
    };
    const r = applyUrl(
      existing,
      "saved-in-form",
      ok("redis://new.example.com"),
      false,
    );
    expect(r.draft).toMatchObject({
      name: "prod",
      host: "new.example.com",
      port: "7000",
      username: "alice",
      database: "5",
      tls: false,
    });
    expect(r.password).toBe("saved-in-form");
    expect(r.filled).toEqual(["host", "tls"]);
  });
  it("clears the username for a legacy-AUTH URL", () => {
    const r = applyUrl(
      { ...emptyDraft(), username: "alice" },
      "",
      ok("redis://:pw@h"),
      false,
    );
    expect(r.draft.username).toBe("");
    expect(r.password).toBe("pw");
  });
  it("never touches the name", () => {
    expect(
      applyUrl({ ...emptyDraft(), name: "keep" }, "", url, true).draft.name,
    ).toBe("keep");
  });
});

describe("buildRedisUrl", () => {
  const d = {
    ...emptyDraft(),
    host: "h.example.com",
    port: "13946",
    username: "default",
    database: "2",
    tls: true,
  };
  it("leaves the password out unless asked, with no stand-in text", () => {
    expect(buildRedisUrl(d, "p@ss", false)).toBe(
      "rediss://default@h.example.com:13946/2",
    );
    expect(buildRedisUrl(d, "p@ss", true)).toBe(
      "rediss://default:p%40ss@h.example.com:13946/2",
    );
  });
  it("leaves out an empty password, a zero database and a blank username", () => {
    expect(
      buildRedisUrl(
        { ...d, username: "", database: "0", tls: false },
        "",
        true,
      ),
    ).toBe("redis://h.example.com:13946");
    expect(buildRedisUrl({ ...d, username: "" }, "pw", true)).toBe(
      "rediss://:pw@h.example.com:13946/2",
    );
  });
  it("brackets an IPv6 host", () => {
    expect(
      buildRedisUrl(
        { ...d, host: "::1", tls: false, username: "", database: "0" },
        "",
        true,
      ),
    ).toBe("redis://[::1]:13946");
  });
  it("round-trips through the parser", () => {
    const built = buildRedisUrl(d, "we/ird:p@ss%", true);
    expect(ok(built)).toEqual({
      host: "h.example.com",
      port: 13946,
      username: "default",
      password: "we/ird:p@ss%",
      database: 2,
      tls: true,
    });
  });
});

describe("MySQL URLs", () => {
  const ok = (input: string) => {
    const r = parseMysqlUrl(input);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("reads user, password, host, port and database", () => {
    expect(ok("mysql://fogtrail:p%40ss@db.internal:3307/shop")).toEqual({
      host: "db.internal",
      port: 3307,
      username: "fogtrail",
      password: "p@ss",
      schema: "shop",
      tls: false,
    });
  });
  it("leaves out what the URL does not say", () => {
    const v = ok("mysql://db.internal");
    expect(v.port).toBeUndefined();
    expect(v.schema).toBeUndefined();
    expect(v.username).toBeUndefined();
  });
  it("turns TLS on from the usual query options", () => {
    expect(ok("mysql://h/db?ssl-mode=REQUIRED").tls).toBe(true);
    expect(ok("mysql://h/db?tls=true").tls).toBe(true);
    expect(ok("mysql://h/db?ssl-mode=DISABLED").tls).toBe(false);
    expect(ok("mysql://h/db").tls).toBe(false);
  });
  it("decodes a database name and ignores the query for it", () => {
    expect(ok("mysql://h/my%20db?ssl-mode=required").schema).toBe("my db");
  });
  it("refuses another scheme with a MySQL message", () => {
    const r = parseMysqlUrl("redis://h:6379");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Use mysql://");
    const bad = parseMysqlUrl("localhost:3306");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("MySQL URL");
  });
  it("refuses a bad port", () => {
    expect(parseMysqlUrl("mysql://h:99999/db").ok).toBe(false);
  });
  it("a Redis URL is not accepted as MySQL, nor the reverse", () => {
    expect(parseRedisUrl("mysql://h/db").ok).toBe(false);
  });

  it("fills a fresh MySQL form, with 3306 when the URL has no port", () => {
    const d = { ...emptyDraft("mysql"), name: "x" };
    const r = applyUrl(d, "", ok("mysql://u:pw@db/shop"), true);
    expect(r.draft.host).toBe("db");
    expect(r.draft.port).toBe("3306");
    expect(r.draft.schema).toBe("shop");
    expect(r.password).toBe("pw");
    expect(r.filled).toContain("schema");
    expect(r.filled).not.toContain("database");
  });
  it("keeps the typed database when editing and the URL has none", () => {
    const d = { ...emptyDraft("mysql"), schema: "keep" };
    const r = applyUrl(d, "", ok("mysql://db"), false);
    expect(r.draft.schema).toBe("keep");
  });

  it("builds a URL back, with the password only when asked", () => {
    const d = {
      ...emptyDraft("mysql"),
      host: "db",
      username: "u",
      schema: "my db",
      tls: true,
    };
    expect(buildConnectionUrl(d, "p@ss", false)).toBe(
      "mysql://u@db:3306/my%20db?ssl-mode=required",
    );
    expect(buildConnectionUrl(d, "p@ss", true)).toBe(
      "mysql://u:p%40ss@db:3306/my%20db?ssl-mode=required",
    );
  });
  it("a built URL parses back to the same form", () => {
    const d = {
      ...emptyDraft("mysql"),
      host: "db",
      username: "u",
      schema: "s",
    };
    const v = ok(buildConnectionUrl(d, "pw", true));
    expect(v).toMatchObject({
      host: "db",
      username: "u",
      password: "pw",
      schema: "s",
      port: 3306,
    });
  });
  it("Redis forms still build redis URLs", () => {
    expect(buildConnectionUrl(emptyDraft(), "", false)).toBe(
      "redis://127.0.0.1:6379",
    );
  });
});

describe("postgres URLs", () => {
  const ok = (url: string) => {
    const r = parseConnectionUrl(url, "postgres");
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("reads user, password, host, port and database", () => {
    expect(ok("postgres://ro:p%40ss@db.example.com:6432/shop")).toEqual({
      host: "db.example.com",
      port: 6432,
      username: "ro",
      password: "p@ss",
      dbname: "shop",
      tls: true,
      sslMode: undefined,
    });
  });
  it("accepts the postgresql scheme", () => {
    expect(ok("postgresql://u@h/db").dbname).toBe("db");
  });
  it("maps sslmode", () => {
    expect(ok("postgres://u@h/db?sslmode=disable")).toMatchObject({
      sslMode: "disable",
      tls: false,
    });
    expect(ok("postgres://u@h/db?sslmode=verify-full").sslMode).toBe(
      "verify-full",
    );
    expect(ok("postgres://u@h/db?sslmode=verify-ca").sslMode).toBe(
      "verify-full",
    );
    expect(ok("postgres://u@h/db?sslmode=prefer").sslMode).toBe("require");
    expect(ok("postgres://u@h/db").sslMode).toBeUndefined();
  });
  it("refuses other schemes with a message naming PostgreSQL", () => {
    const r = parseConnectionUrl("mysql://u@h/db", "postgres");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("postgres://");
  });
  it("fills a new form, applying the safe SSL default", () => {
    const parsed = ok("postgres://ro:pw@h/shop");
    const out = applyUrl({ ...emptyDraft("postgres") }, "", parsed, true);
    expect(out.draft).toMatchObject({
      host: "h",
      port: "5432",
      dbname: "shop",
      username: "ro",
      sslMode: "require",
    });
    expect(out.password).toBe("pw");
    expect(out.filled).toContain("dbname");
  });
  it("builds a URL back, with the password only on request", () => {
    const d = {
      ...emptyDraft("postgres"),
      host: "h",
      username: "ro",
      dbname: "my db",
      sslMode: "verify-full" as const,
    };
    expect(buildConnectionUrl(d, "p w", false)).toBe(
      "postgres://ro@h:5432/my%20db?sslmode=verify-full",
    );
    expect(buildConnectionUrl(d, "p w", true)).toBe(
      "postgres://ro:p%20w@h:5432/my%20db?sslmode=verify-full",
    );
  });
});
