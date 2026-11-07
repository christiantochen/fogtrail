import { describe, expect, it } from "vitest";
import { readCommand } from "./clipboard";

describe("readCommand", () => {
  it("picks the read command for each type", () => {
    expect(readCommand("string", "a")).toBe('GET "a"');
    expect(readCommand("hash", "a")).toBe('HGETALL "a"');
    expect(readCommand("zset", "a")).toBe('ZRANGE "a" 0 -1 WITHSCORES');
    expect(readCommand("stream", "a")).toBe('XREVRANGE "a" + - COUNT 100');
    expect(readCommand("module", "a")).toBe('TYPE "a"');
  });

  it("escapes characters a shell would act on", () => {
    expect(readCommand("string", 'a"b$c')).toBe('GET "a\\"b\\$c"');
  });
});
