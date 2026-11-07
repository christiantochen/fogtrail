import { describe, expect, it } from "vitest";
import { tokenizeJson } from "./json";

describe("tokenizeJson", () => {
  it("classifies keys, strings, numbers and literals", () => {
    const t = tokenizeJson('{"a": "x", "n": -1.5e3, "ok": true, "z": null}');
    const kinds = t
      .filter((x) => x.kind !== "plain")
      .map((x) => [x.text, x.kind]);
    expect(kinds).toEqual([
      ['"a"', "key"],
      ['"x"', "string"],
      ['"n"', "key"],
      ["-1.5e3", "number"],
      ['"ok"', "key"],
      ["true", "literal"],
      ['"z"', "key"],
      ["null", "literal"],
    ]);
  });

  it("round-trips the input exactly", () => {
    const src = '{\n  "a": [1, 2, {"b": "c\\"d"}]\n}';
    expect(
      tokenizeJson(src)
        .map((t) => t.text)
        .join(""),
    ).toBe(src);
  });

  it("does not color digits inside strings", () => {
    const t = tokenizeJson('"order 66"');
    expect(t).toEqual([{ text: '"order 66"', kind: "string" }]);
  });
});
