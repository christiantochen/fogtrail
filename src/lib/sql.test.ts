import { describe, expect, it } from "vitest";
import type { ColumnInfo, SchemaInfo, TableInfo } from "../api/types";
import {
  approxRows,
  columnSub,
  filterTables,
  isNumericType,
  pickSchema,
  rangeLabel,
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
