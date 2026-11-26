import { describe, expect, it } from "vitest";
import type { ForeignKeyInfo } from "../api/types";
import { fkFilter, fkFor, fkLabel, quoteName, sqlLiteral } from "./fk";

const fk = (columns: string[], refColumns: string[]): ForeignKeyInfo => ({
  name: "fk_x",
  columns,
  refSchema: "shop",
  refTable: "customers",
  refColumns,
});

describe("quoteName", () => {
  it("uses backticks for MySQL and doubles any inside", () => {
    expect(quoteName("mysql", "id")).toBe("`id`");
    expect(quoteName("mysql", "a`b")).toBe("`a``b`");
  });
  it("uses double quotes for PostgreSQL and doubles any inside", () => {
    expect(quoteName("postgres", "id")).toBe('"id"');
    expect(quoteName("postgres", 'a"b')).toBe('"a""b"');
  });
});

describe("sqlLiteral", () => {
  it("leaves whole numbers bare in a number column", () => {
    expect(sqlLiteral("mysql", "48", true)).toBe("48");
    expect(sqlLiteral("postgres", "-7", true)).toBe("-7");
    expect(sqlLiteral("mysql", "0", true)).toBe("0");
  });
  it("quotes numbers that are really text", () => {
    expect(sqlLiteral("mysql", "007", true)).toBe("'007'");
    expect(sqlLiteral("mysql", "1.5", true)).toBe("'1.5'");
    expect(sqlLiteral("mysql", "12345678901234567890", true)).toBe(
      "'12345678901234567890'",
    );
  });
  it("doubles single quotes", () => {
    expect(sqlLiteral("postgres", "O'Neil")).toBe("'O''Neil'");
    expect(sqlLiteral("mysql", "'; DROP TABLE x; --")).toBe(
      "'''; DROP TABLE x; --'",
    );
  });
  it("sends PostgreSQL text with a backslash as an escape string", () => {
    expect(sqlLiteral("postgres", "a\\b")).toBe("E'a\\\\b'");
    // The hostile value from the review: nothing in it can end the string early.
    expect(sqlLiteral("postgres", "\\'); COMMIT; --")).toBe(
      "E'\\\\''); COMMIT; --'",
    );
    expect(sqlLiteral("postgres", "O'Neil")).toBe("'O''Neil'");
  });
  it("leaves a number bare only for a number column", () => {
    expect(sqlLiteral("mysql", "48", true)).toBe("48");
    expect(sqlLiteral("mysql", "48")).toBe("'48'");
    expect(sqlLiteral("postgres", "48")).toBe("'48'");
    // The edge of what is kept bare.
    expect(sqlLiteral("mysql", "123456789012345678", true)).toBe(
      "123456789012345678",
    );
    expect(sqlLiteral("mysql", "1234567890123456789", true)).toBe(
      "'1234567890123456789'",
    );
    expect(sqlLiteral("mysql", "-0", true)).toBe("'-0'");
    expect(sqlLiteral("mysql", "", true)).toBe("''");
    expect(sqlLiteral("mysql", "é\\")).toBe("CONVERT(X'c3a95c' USING utf8mb4)");
  });
  it("sends MySQL text with a backslash as hex, whatever sql_mode says", () => {
    expect(sqlLiteral("mysql", "a\\b")).toBe(
      "CONVERT(X'615c62' USING utf8mb4)",
    );
    expect(sqlLiteral("mysql", "\\' OR 1=1 --")).toBe(
      "CONVERT(X'5c27204f5220313d31202d2d' USING utf8mb4)",
    );
  });
  it("gives no literal for a NUL byte", () => {
    expect(sqlLiteral("mysql", "a\0b")).toBeNull();
  });
});

describe("fkFor", () => {
  it("finds the key a column is part of", () => {
    const keys = [fk(["customer_id"], ["id"]), fk(["a", "b"], ["x", "y"])];
    expect(fkFor(keys, "b")).toBe(keys[1]);
    expect(fkFor(keys, "other")).toBeUndefined();
    expect(fkFor([], "a")).toBeUndefined();
  });
});

describe("fkFilter", () => {
  const names = [
    { name: "id", typeName: "BIGINT" },
    { name: "customer_id", typeName: "BIGINT" },
    { name: "region", typeName: "VARCHAR" },
    { name: "code", typeName: "VARCHAR" },
  ];
  it("matches the referenced column", () => {
    expect(
      fkFilter("mysql", fk(["customer_id"], ["id"]), names, [
        "5",
        "48",
        "eu",
        null,
      ]),
    ).toBe("`id` = 48");
    expect(
      fkFilter("postgres", fk(["customer_id"], ["id"]), names, [
        "5",
        "48",
        "eu",
        null,
      ]),
    ).toBe('"id" = 48');
  });
  it("matches every column of a composite key", () => {
    expect(
      fkFilter("postgres", fk(["region", "customer_id"], ["r", "id"]), names, [
        "5",
        "48",
        "e'u",
        null,
      ]),
    ).toBe(`"r" = 'e''u' AND "id" = 48`);
  });
  it("quotes a number held in a text column", () => {
    expect(
      fkFilter("postgres", fk(["code"], ["code"]), names, [
        "5",
        "1",
        "eu",
        "48",
      ]),
    ).toBe(`"code" = '48'`);
  });
  it("has no row to go to when any part is null or missing", () => {
    const row = ["5", null, "eu", null];
    expect(
      fkFilter("mysql", fk(["customer_id"], ["id"]), names, row),
    ).toBeNull();
    expect(
      fkFilter("mysql", fk(["region", "customer_id"], ["r", "id"]), names, row),
    ).toBeNull();
    expect(
      fkFilter("mysql", fk(["gone"], ["id"]), names, ["5", "1", "eu", null]),
    ).toBeNull();
  });
  it("refuses a key whose column lists do not match", () => {
    expect(
      fkFilter(
        "mysql",
        fk(["a", "b"], ["x"]),
        [
          { name: "a", typeName: "INT" },
          { name: "b", typeName: "INT" },
        ],
        ["1", "2"],
      ),
    ).toBeNull();
  });
});

describe("fkLabel", () => {
  it("names the table and column", () => {
    expect(fkLabel(fk(["c"], ["id"]), "shop")).toBe("customers.id");
  });
  it("adds the schema when it is another one", () => {
    expect(fkLabel(fk(["c"], ["id"]), "other")).toBe("shop.customers.id");
  });
  it("lists the columns of a composite key", () => {
    expect(fkLabel(fk(["a", "b"], ["x", "y"]), "shop")).toBe(
      "customers (x, y)",
    );
  });
});
