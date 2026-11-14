import { describe, expect, it } from "vitest";
import { tokenClass, tokenize } from "./sqlHighlight";

/** "type:text" for each token that isn't a space, for compact assertions. */
const kinds = (sql: string) =>
  tokenize(sql)
    .filter((t) => t.type !== "space")
    .map((t) => `${t.type}:${sql.slice(t.start, t.end)}`);

describe("tokenize", () => {
  it("covers the whole text with no gaps", () => {
    const sql = "SELECT a, 'x' /* c */ FROM `t` -- end\nWHERE n > 1.5";
    const tokens = tokenize(sql);
    expect(tokens[0].start).toBe(0);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].start).toBe(tokens[i - 1].end);
    }
    expect(tokens[tokens.length - 1].end).toBe(sql.length);
  });

  it("splits words, numbers and punctuation", () => {
    expect(kinds("SELECT a.b, 42 FROM t")).toEqual([
      "word:SELECT",
      "word:a",
      "punct:.",
      "word:b",
      "punct:,",
      "number:42",
      "word:FROM",
      "word:t",
    ]);
  });

  it("keeps a semicolon or a quote inside a string in the string", () => {
    expect(kinds("SELECT 'a;b' AS x")).toEqual([
      "word:SELECT",
      "string:'a;b'",
      "word:AS",
      "word:x",
    ]);
    expect(kinds("SELECT 'it''s' , \"a\\\"b\"")).toEqual([
      "word:SELECT",
      "string:'it''s'",
      "punct:,",
      'string:"a\\"b"',
    ]);
  });

  it("reads backtick names, with doubled backticks inside", () => {
    expect(kinds("SELECT `we``ird name` FROM t")).toEqual([
      "word:SELECT",
      "quoted:`we``ird name`",
      "word:FROM",
      "word:t",
    ]);
  });

  it("reads the three kinds of comment", () => {
    expect(kinds("a -- x\nb # y\nc /* z */ d")).toEqual([
      "word:a",
      "comment:-- x",
      "word:b",
      "comment:# y",
      "word:c",
      "comment:/* z */",
      "word:d",
    ]);
  });

  it("does not treat -- without a space as a comment", () => {
    expect(kinds("SELECT 1--1")).toEqual([
      "word:SELECT",
      "number:1",
      "punct:-",
      "punct:-",
      "number:1",
    ]);
  });

  it("marks what is still open at the end of the text", () => {
    const open = (sql: string) =>
      (() => {
        const t = tokenize(sql);
        return t[t.length - 1]?.open;
      })();
    expect(open("SELECT 'abc")).toBe(true);
    expect(open("SELECT `abc")).toBe(true);
    expect(open("SELECT /* abc")).toBe(true);
    expect(open("SELECT 'abc'")).toBe(false);
  });

  it("copes with empty text and odd characters", () => {
    expect(tokenize("")).toEqual([]);
    expect(kinds("é + ü")).toEqual(["word:é", "punct:+", "word:ü"]);
  });
});

describe("tokenClass", () => {
  const cls = (sql: string) => tokenize(sql).map((t) => tokenClass(sql, t));

  it("colours keywords whatever their case, strings, numbers and comments", () => {
    expect(cls("select 1")).toEqual(["tk-kw", null, "tk-num"]);
    expect(cls("'a' -- c")).toEqual(["tk-str", null, "tk-cm"]);
  });

  it("does not colour a word after a dot, or common column names", () => {
    expect(cls("o.end")).toEqual([null, null, null]);
    expect(cls("status index format")).toEqual([null, null, null, null, null]);
  });

  it("leaves names alone, and does not colour write keywords", () => {
    expect(cls("orders")).toEqual([null]);
    expect(cls("DELETE")).toEqual([null]);
  });
});

describe("tokenize for PostgreSQL", () => {
  const pgKinds = (sql: string) =>
    tokenize(sql, "postgres")
      .filter((t) => t.type !== "space")
      .map((t) => `${t.type}:${sql.slice(t.start, t.end)}`);

  it("reads double quotes as a name, not a string", () => {
    expect(pgKinds('SELECT "Weird Name" FROM "a""b"')).toEqual([
      "word:SELECT",
      'quoted:"Weird Name"',
      "word:FROM",
      'quoted:"a""b"',
    ]);
  });
  it("keeps MySQL's reading by default", () => {
    expect(kinds('SELECT "x"')).toEqual(["word:SELECT", 'string:"x"']);
  });
  it("does not treat # as a comment", () => {
    expect(pgKinds("SELECT a #> b")).toContain("punct:#");
    expect(kinds("SELECT 1 # note")).toContain("comment:# note");
  });
  it("does not treat a backslash as an escape inside a string", () => {
    expect(pgKinds("SELECT 'a\\' , 'b'")).toEqual([
      "word:SELECT",
      "string:'a\\'",
      "punct:,",
      "string:'b'",
    ]);
  });
});
