import { describe, expect, it } from "vitest";
import { draftOf, emptyDraft, toProfile, validate } from "./profile";

describe("validate", () => {
  it("accepts the defaults once named", () => {
    expect(validate({ ...emptyDraft(), name: "local" })).toEqual({});
  });
  it("flags each bad field", () => {
    const e = validate({
      ...emptyDraft(),
      name: " ",
      host: "",
      port: "70000",
      database: "x",
    });
    expect(Object.keys(e).sort()).toEqual(["database", "host", "name", "port"]);
  });
  it("rejects zero, negative and decimal ports", () => {
    for (const port of ["0", "-1", "63.5", ""]) {
      expect(validate({ ...emptyDraft(), name: "a", port }).port).toBeDefined();
    }
  });
});

describe("toProfile", () => {
  it("trims, converts numbers and nulls a blank username", () => {
    const p = toProfile({
      ...emptyDraft(),
      name: " a ",
      host: " h ",
      port: "6380",
      username: " ",
    });
    expect(p).toMatchObject({
      name: "a",
      host: "h",
      port: 6380,
      username: null,
      database: 0,
      schema: null,
      id: "",
    });
  });
  it("round-trips through draftOf", () => {
    const p = toProfile(
      { ...emptyDraft(), name: "a", username: "ro", tls: true },
      "id1",
    );
    expect(toProfile(draftOf(p), "id1")).toEqual(p);
  });
});

describe("MySQL drafts", () => {
  it("starts on 3306 with no database", () => {
    const d = emptyDraft("mysql");
    expect(d.driver).toBe("mysql");
    expect(d.port).toBe("3306");
    expect(d.schema).toBe("");
  });
  it("does not need a Redis database number", () => {
    const d = {
      ...emptyDraft("mysql"),
      name: "shop",
      username: "ro",
      database: "x",
    };
    expect(validate(d)).toEqual({});
  });
  it("needs a user, which Redis does not", () => {
    expect(validate({ ...emptyDraft("mysql"), name: "shop" }).username).toBe(
      "Enter a user.",
    );
    expect(validate({ ...emptyDraft(), name: "r" }).username).toBeUndefined();
  });
  it("limits the database name to MySQL's 64 characters", () => {
    const d = { ...emptyDraft("mysql"), name: "a", username: "u" };
    expect(validate({ ...d, schema: "x".repeat(64) }).schema).toBeUndefined();
    expect(validate({ ...d, schema: "x".repeat(65) }).schema).toBeDefined();
  });
  it("a MySQL profile carries its schema and no Redis database", () => {
    const p = toProfile(
      { ...emptyDraft("mysql"), name: "shop", schema: " shop ", database: "5" },
      "id1",
    );
    expect(p).toMatchObject({
      driver: "mysql",
      schema: "shop",
      database: 0,
      port: 3306,
    });
  });
  it("a blank schema is null", () => {
    expect(toProfile({ ...emptyDraft("mysql"), name: "a" }).schema).toBeNull();
  });
  it("a Redis profile never carries a schema", () => {
    const p = toProfile({ ...emptyDraft(), name: "a", schema: "ignored" });
    expect(p.driver).toBe("redis");
    expect(p.schema).toBeNull();
  });
  it("round-trips through draftOf", () => {
    const p = toProfile(
      { ...emptyDraft("mysql"), name: "a", schema: "shop", username: "ro" },
      "id1",
    );
    expect(toProfile(draftOf(p), "id1")).toEqual(p);
  });
  it("an old Redis profile with no driver reads as Redis", () => {
    const old = { ...toProfile({ ...emptyDraft(), name: "a" }), driver: "" };
    expect(draftOf(old).driver).toBe("redis");
  });
});

describe("PostgreSQL profiles", () => {
  const pg = { ...emptyDraft("postgres"), name: "shop", username: "ro" };

  it("starts on port 5432 with SSL required", () => {
    expect(emptyDraft("postgres").port).toBe("5432");
    expect(emptyDraft("postgres").sslMode).toBe("require");
  });
  it("needs a user and a database", () => {
    const e = validate({ ...emptyDraft("postgres"), name: "a" });
    expect(Object.keys(e).sort()).toEqual(["dbname", "username"]);
    expect(validate({ ...pg, dbname: "shop" })).toEqual({});
  });
  it("saves the database and SSL mode, and no MySQL schema", () => {
    const p = toProfile({ ...pg, dbname: " shop ", sslMode: "verify-full" });
    expect(p.driver).toBe("postgres");
    expect(p.dbname).toBe("shop");
    expect(p.sslMode).toBe("verify-full");
    expect(p.schema).toBeNull();
    expect(p.database).toBe(0);
    expect(p.tls).toBe(true);
  });
  it("disable turns TLS off in the profile", () => {
    expect(toProfile({ ...pg, dbname: "shop", sslMode: "disable" }).tls).toBe(
      false,
    );
  });
  it("round-trips through draftOf", () => {
    const p = toProfile({ ...pg, dbname: "shop", sslMode: "disable" }, "id1");
    expect(toProfile(draftOf(p), "id1")).toEqual(p);
  });
  it("a profile with no SSL mode reads as require", () => {
    const p = { ...toProfile({ ...pg, dbname: "shop" }), sslMode: null };
    expect(draftOf(p).sslMode).toBe("require");
  });
  it("other stores leave the PostgreSQL fields empty", () => {
    const p = toProfile({ ...emptyDraft(), name: "a" });
    expect(p.dbname).toBeNull();
    expect(p.sslMode).toBeNull();
  });
});
