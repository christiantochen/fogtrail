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
