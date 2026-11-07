import { describe, expect, it } from "vitest";
import { emptyDraft } from "./profile";
import {
  applyUrl,
  buildRedisUrl,
  looksLikeUrl,
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
