import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "../api/types";
import {
  groupColumns,
  isWide,
  kindOf,
  rowObject,
  typeBadge,
  WIDE_AT,
} from "./rowGroups";
import { splitRow } from "./sql";

describe("isWide", () => {
  it("is for more than 24 columns", () => {
    expect(isWide(WIDE_AT)).toBe(false);
    expect(isWide(WIDE_AT + 1)).toBe(true);
  });
});

describe("kindOf", () => {
  it("sorts a column by what it holds", () => {
    expect(kindOf("VARCHAR")).toBe("text");
    expect(kindOf("TEXT")).toBe("text");
    expect(kindOf("BIGINT")).toBe("number");
    expect(kindOf("NUMERIC")).toBe("number");
    expect(kindOf("TIMESTAMPTZ")).toBe("date");
    expect(kindOf("DATETIME")).toBe("date");
    expect(kindOf("DATE")).toBe("date");
    expect(kindOf("JSONB")).toBe("json");
    expect(kindOf("TEXT[]")).toBe("array");
    expect(kindOf("BOOL")).toBe("other");
  });
  it("counts a text column that holds JSON as JSON", () => {
    expect(kindOf("TEXT", true)).toBe("json");
  });
  it("keeps an array an array even though it is shown as JSON", () => {
    expect(kindOf("INT8[]", true)).toBe("array");
  });
});

describe("groupColumns", () => {
  const names = [
    "id",
    "status",
    "billing_name",
    "billing_tax",
    "shipping_city",
    "billing_due_at",
    "shipping_cost",
    "created_at",
  ];
  it("groups by the name before the first underscore, when two columns share it", () => {
    expect(groupColumns(names)).toEqual([
      { name: "core", columns: [0, 1] },
      { name: "billing_", columns: [2, 3, 5] },
      { name: "shipping_", columns: [4, 6] },
      { name: "other", columns: [7] },
    ]);
  });
  it("leaves out a group with nothing in it", () => {
    expect(groupColumns(["a_x", "a_y"])).toEqual([
      { name: "a_", columns: [0, 1] },
    ]);
    expect(groupColumns([])).toEqual([]);
  });
  it("keeps every column in exactly one group", () => {
    const all = groupColumns(names).flatMap((g) => g.columns);
    expect([...all].sort((a, b) => a - b)).toEqual(names.map((_, i) => i));
  });
});

describe("typeBadge", () => {
  const info = (over: Partial<ColumnInfo>): ColumnInfo => ({
    name: "id",
    dataType: "uuid",
    nullable: false,
    key: null,
    default: null,
    extra: null,
    comment: null,
    ...over,
  });
  const col = { name: "id", typeName: "UUID" };
  it("shows the type, and PK for a primary key", () => {
    expect(typeBadge(col, info({ key: "PRI" }))).toBe("uuid · PK");
    expect(typeBadge(col, info({ key: "UNI" }))).toBe("uuid");
  });
  it("falls back to the result's type before the structure has loaded", () => {
    expect(typeBadge(col, undefined)).toBe("uuid");
  });
});

describe("rowObject", () => {
  const columns = [
    { name: "id", typeName: "BIGINT" },
    { name: "meta", typeName: "JSONB" },
    { name: "tags", typeName: "TEXT[]" },
    { name: "note", typeName: "TEXT" },
    { name: "big", typeName: "JSONB" },
  ];
  const row: (string | null)[] = [
    "7",
    '{"a":1}',
    "{wholesale,gift}",
    null,
    '{"id":12345678901234567890}',
  ];
  it("makes JSON and arrays real JSON, and keeps the rest as the server sent it", () => {
    const out = rowObject(columns, row, splitRow(columns, row).json);
    expect(out.id).toBe("7");
    expect(out.meta).toEqual({ a: 1 });
    expect(out.tags).toEqual(["wholesale", "gift"]);
    expect(out.note).toBeNull();
  });
  it("keeps a JSON value as text when a number in it is too big to survive", () => {
    const out = rowObject(columns, row, splitRow(columns, row).json);
    expect(out.big).toBe('{"id":12345678901234567890}');
  });
});
