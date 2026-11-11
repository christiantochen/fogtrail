import { describe, expect, it } from "vitest";
import type { ColumnInfo, SchemaInfo, TableInfo } from "../api/types";
import {
  approxCompact,
  approxRows,
  columnSub,
  elapsedLabel,
  filterTables,
  isJsonType,
  isNumericType,
  isTimeType,
  jsonSummary,
  lineCount,
  nextSort,
  pickSchema,
  prettyJson,
  rangeLabel,
  resultToTsv,
  rowCountLabel,
  splitTimestamp,
  visibleSchemas,
} from "./sql";

const table = (name: string, rows: number | null = 1): TableInfo => ({
  name,
  kind: "table",
  estimatedRows: rows,
});
const schema = (name: string, system = false): SchemaInfo => ({ name, system });

describe("approxRows", () => {
  it("is always an estimate", () => {
    expect(approxRows(48213)).toBe("~48,213");
    expect(approxRows(0)).toBe("~0");
  });
  it("is blank when the server gave no estimate", () => {
    expect(approxRows(null)).toBe("");
  });
});

describe("approxCompact", () => {
  it("leaves small numbers alone", () => {
    expect(approxCompact(0)).toBe("~0");
    expect(approxCompact(978)).toBe("~978");
    expect(approxCompact(999)).toBe("~999");
  });
  it("rounds thousands and millions, with one decimal under ten", () => {
    expect(approxCompact(1000)).toBe("~1k");
    expect(approxCompact(1219)).toBe("~1.2k");
    expect(approxCompact(9949)).toBe("~9.9k");
    expect(approxCompact(9950)).toBe("~10k");
    expect(approxCompact(48445)).toBe("~48k");
    expect(approxCompact(401353)).toBe("~401k");
    expect(approxCompact(7681394)).toBe("~7.7m");
    expect(approxCompact(12_400_000)).toBe("~12m");
  });
  it("carries into the next unit instead of showing 1000k", () => {
    expect(approxCompact(999_499)).toBe("~999k");
    expect(approxCompact(999_500)).toBe("~1m");
    expect(approxCompact(3_400_000_000)).toBe("~3.4b");
  });
  it("is blank when the server gave no estimate", () => {
    expect(approxCompact(null)).toBe("");
  });
});

describe("rangeLabel", () => {
  it("counts from one", () => {
    expect(rangeLabel(0, 100)).toBe("Rows 1–100");
    expect(rangeLabel(1200, 50)).toBe("Rows 1,201–1,250");
  });
  it("says so when there is nothing", () => {
    expect(rangeLabel(0, 0)).toBe("No rows");
  });
});

describe("filterTables", () => {
  const all = [table("orders"), table("Order_items"), table("customers")];
  it("matches part of a name, ignoring case", () => {
    expect(filterTables(all, "ORDER").map((t) => t.name)).toEqual([
      "orders",
      "Order_items",
    ]);
  });
  it("keeps everything for a blank term", () => {
    expect(filterTables(all, "  ")).toHaveLength(3);
  });
});

describe("schemas", () => {
  const list = [
    schema("information_schema", true),
    schema("mysql", true),
    schema("shop"),
  ];
  it("hides built-in schemas unless asked, but never the open one", () => {
    expect(visibleSchemas(list, false, null).map((s) => s.name)).toEqual([
      "shop",
    ]);
    expect(visibleSchemas(list, false, "mysql").map((s) => s.name)).toEqual([
      "mysql",
      "shop",
    ]);
    expect(visibleSchemas(list, true, null)).toHaveLength(3);
  });
  it("opens the profile's schema when it exists", () => {
    expect(pickSchema(list, "shop")).toBe("shop");
  });
  it("falls back to the first user schema, then the first of anything", () => {
    expect(pickSchema(list, "gone")).toBe("shop");
    expect(pickSchema(list, null)).toBe("shop");
    expect(pickSchema([schema("mysql", true)], null)).toBe("mysql");
    expect(pickSchema([], null)).toBeNull();
  });
});

describe("column helpers", () => {
  const info: ColumnInfo = {
    name: "id",
    dataType: "bigint unsigned",
    nullable: false,
    key: "PRI",
    default: null,
    extra: null,
    comment: null,
  };
  it("lines numbers up on the right", () => {
    expect(isNumericType("BIGINT")).toBe(true);
    expect(isNumericType("decimal")).toBe(true);
    expect(isNumericType("VARCHAR")).toBe(false);
  });
  it("describes a column under its name", () => {
    expect(columnSub({ name: "id", typeName: "BIGINT" }, info)).toBe(
      "bigint unsigned · PK",
    );
    expect(
      columnSub(
        { name: "n", typeName: "VARCHAR" },
        { ...info, key: null, nullable: true, dataType: "varchar(40)" },
      ),
    ).toBe("varchar(40) · null");
    expect(columnSub({ name: "n", typeName: "VARCHAR" }, undefined)).toBe(
      "varchar",
    );
  });
});

describe("resultToTsv", () => {
  const cols = [
    { name: "id", typeName: "BIGINT" },
    { name: "note", typeName: "VARCHAR" },
  ];

  it("writes a header, then one line per row, separated by tabs", () => {
    expect(
      resultToTsv(cols, [
        ["1", "a"],
        ["2", "b"],
      ]),
    ).toBe("id\tnote\n1\ta\n2\tb");
  });

  it("leaves NULL empty, so it differs from the text 'NULL'", () => {
    expect(resultToTsv(cols, [["1", null]])).toBe("id\tnote\n1\t");
    expect(resultToTsv(cols, [["1", "NULL"]])).toBe("id\tnote\n1\tNULL");
  });

  it("keeps tabs and line breaks inside a value from breaking the table", () => {
    expect(resultToTsv(cols, [["1", "a\tb\nc\r\nd"]])).toBe(
      "id\tnote\n1\ta b c d",
    );
  });

  it("is just the header when there are no rows", () => {
    expect(resultToTsv(cols, [])).toBe("id\tnote");
  });
});

describe("rowCountLabel and elapsedLabel", () => {
  it("counts rows in words", () => {
    expect(rowCountLabel(0)).toBe("No rows");
    expect(rowCountLabel(1)).toBe("1 row");
    expect(rowCountLabel(1000)).toBe("1,000 rows");
  });

  it("shows milliseconds under a second and seconds above", () => {
    expect(elapsedLabel(0)).toBe("0 ms");
    expect(elapsedLabel(999)).toBe("999 ms");
    expect(elapsedLabel(1000)).toBe("1.0 s");
    expect(elapsedLabel(12345)).toBe("12.3 s");
  });
});

describe("lineCount", () => {
  it("is always at least one", () => {
    expect(lineCount("")).toBe(1);
    expect(lineCount("SELECT 1")).toBe(1);
  });

  it("counts a trailing newline as a new line, like the editor does", () => {
    expect(lineCount("a\nb")).toBe(2);
    expect(lineCount("a\nb\n")).toBe(3);
  });
});

describe("table data helpers", () => {
  it("cycles a sort up, down, off, and restarts on another column", () => {
    const a = nextSort(null, "total");
    expect(a).toEqual({ column: "total", desc: false });
    const b = nextSort(a, "total");
    expect(b).toEqual({ column: "total", desc: true });
    expect(nextSort(b, "total")).toBeNull();
    expect(nextSort(b, "id")).toEqual({ column: "id", desc: false });
  });

  it("summarises JSON arrays and objects, and nothing else", () => {
    expect(jsonSummary("[1,2,3]")).toBe("3 items");
    expect(jsonSummary("[1]")).toBe("1 item");
    expect(jsonSummary('{"a":1,"b":2}')).toBe("2 keys");
    expect(jsonSummary("{}")).toBe("0 keys");
    expect(jsonSummary("42")).toBeNull();
    expect(jsonSummary("null")).toBeNull();
    expect(jsonSummary("not json")).toBeNull();
  });

  it("lays JSON out over lines and refuses other text", () => {
    expect(prettyJson('{"a":[1,2]}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ]\n}',
    );
    expect(prettyJson("plain")).toBeNull();
  });

  it("splits a timestamp into date and time", () => {
    expect(splitTimestamp("2026-11-11 08:51:20")).toEqual([
      "2026-11-11",
      "08:51:20",
    ]);
    expect(splitTimestamp("2026-11-11 08:51:20.123456")?.[1]).toBe(
      "08:51:20.123456",
    );
    expect(splitTimestamp("2026-11-11")).toBeNull();
    expect(splitTimestamp("0000-00-00 00:00:00")).toEqual([
      "0000-00-00",
      "00:00:00",
    ]);
  });

  it("knows JSON and time column types", () => {
    expect(isJsonType("JSON")).toBe(true);
    expect(isJsonType("VARCHAR")).toBe(false);
    expect(isTimeType("TIMESTAMP")).toBe(true);
    expect(isTimeType("DATETIME")).toBe(true);
    expect(isTimeType("DATE")).toBe(false);
  });
});
