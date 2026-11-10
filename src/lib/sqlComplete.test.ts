import { describe, expect, it } from "vitest";
import {
  type Known,
  contextAt,
  findRefs,
  quoteName,
  suggest,
} from "./sqlComplete";
import { tokenize } from "./sqlHighlight";

const cols = {
  orders: [
    { name: "id", dataType: "bigint" },
    { name: "customer_id", dataType: "bigint" },
    { name: "status", dataType: "enum" },
    { name: "total", dataType: "decimal" },
  ],
  customers: [
    { name: "id", dataType: "bigint" },
    { name: "name", dataType: "varchar" },
    { name: "email", dataType: "varchar" },
  ],
} as Record<string, { name: string; dataType: string }[]>;

const known: Known = {
  tables: [
    { name: "customers", view: false },
    { name: "orders", view: false },
    { name: "paying_customers", view: true },
    { name: "weird name", view: false },
  ],
  schemas: ["shop", "analytics"],
  columns: (t) => cols[t],
  tablesOf: (s) =>
    s === "analytics" ? [{ name: "daily_revenue", view: false }] : undefined,
};

/** Suggestions with the caret at `|`. */
function at(sql: string, manual = false) {
  const caret = sql.indexOf("|");
  const text = sql.replace("|", "");
  return suggest(contextAt(text, caret), known, manual);
}
const labels = (sql: string, manual = false) =>
  at(sql, manual).map((i) => i.label);

describe("findRefs", () => {
  const refs = (sql: string) => findRefs(sql, tokenize(sql));

  it("reads tables with and without aliases", () => {
    expect(refs("SELECT * FROM orders o JOIN customers AS c ON 1")).toEqual([
      { schema: undefined, table: "orders", alias: "o" },
      { schema: undefined, table: "customers", alias: "c" },
    ]);
  });

  it("does not take a clause word for an alias", () => {
    expect(refs("SELECT * FROM orders WHERE id = 1")).toEqual([
      { schema: undefined, table: "orders", alias: undefined },
    ]);
    expect(refs("SELECT * FROM orders LEFT JOIN customers ON 1")).toHaveLength(
      2,
    );
  });

  it("reads a database prefix, backticks and a comma list", () => {
    expect(refs("FROM analytics.daily_revenue d, `weird name` w")).toEqual([
      { schema: "analytics", table: "daily_revenue", alias: "d" },
      { schema: undefined, table: "weird name", alias: "w" },
    ]);
  });
});

describe("contextAt", () => {
  it("finds the word being typed", () => {
    const c = contextAt("SELECT sta", 10);
    expect(c.prefix).toBe("sta");
    expect(c.start).toBe(7);
  });

  it("finds the qualifier before a dot", () => {
    expect(contextAt("SELECT o.st", 11).qualifier).toBe("o");
    expect(contextAt("SELECT `weird name`.", 20).qualifier).toBe("weird name");
  });

  it("is blocked inside strings, comments and quoted names", () => {
    expect(contextAt("SELECT 'ab", 10).blocked).toBe(true);
    expect(contextAt("SELECT 'ab' ", 12).blocked).toBe(false);
    expect(contextAt("SELECT 1 -- ab", 14).blocked).toBe(true);
    expect(contextAt("SELECT 1 /* ab", 14).blocked).toBe(true);
    expect(contextAt("SELECT `ab", 10).blocked).toBe(true);
    expect(contextAt("SELECT 1 /* ab */ ", 18).blocked).toBe(false);
  });

  it("expects a table after FROM and JOIN, and not right after a table name", () => {
    expect(contextAt("SELECT * FROM ", 14).wantsTable).toBe(true);
    expect(contextAt("SELECT * FROM o", 15).wantsTable).toBe(true);
    expect(contextAt("SELECT * FROM a JOIN ", 21).wantsTable).toBe(true);
    expect(contextAt("SELECT * FROM a, ", 17).wantsTable).toBe(true);
    expect(contextAt("SELECT * FROM orders ", 21).wantsTable).toBe(false);
    expect(contextAt("SELECT * FROM orders o ", 23).wantsTable).toBe(false);
    expect(contextAt("SELECT * FROM orders WHERE ", 27).wantsTable).toBe(false);
    expect(contextAt("SELECT a, ", 10).wantsTable).toBe(false);
  });

  it("knows when nothing comes before", () => {
    expect(contextAt("sel", 3).atStart).toBe(true);
    expect(contextAt("-- hi\nsel", 9).atStart).toBe(true);
    expect(contextAt("SELECT s", 8).atStart).toBe(false);
  });
});

describe("suggest", () => {
  it("offers nothing before a letter is typed, unless asked", () => {
    expect(labels("SELECT |")).toEqual([]);
    expect(labels("SELECT |", true).length).toBeGreaterThan(0);
  });

  it("offers statement starters at the start, and not the ones that write", () => {
    expect(labels("s|")).toEqual(["SELECT", "SHOW"]);
    expect(labels("d|")).toEqual(["DESCRIBE"]);
    expect(labels("de|")).toEqual(["DESCRIBE"]);
    expect(labels("i|")).toEqual([]);
  });

  it("matches the case being typed", () => {
    expect(at("sel|")[0].insert).toBe("select");
    expect(at("SEL|")[0].insert).toBe("SELECT");
  });

  it("offers tables after FROM, views marked, and databases last", () => {
    const items = at("SELECT * FROM c|");
    expect(items.map((i) => i.label)).toEqual([
      "customers",
      "paying_customers",
    ]);
    const all = at("SELECT * FROM |", true);
    expect(all.map((i) => i.label)).toContain("paying_customers");
    expect(all.find((i) => i.label === "paying_customers")?.kind).toBe("view");
    expect(all.map((i) => i.kind).lastIndexOf("table")).toBeLessThan(
      all.findIndex((i) => i.kind === "database"),
    );
  });

  it("quotes names that need it", () => {
    expect(at("SELECT * FROM we|")[0].insert).toBe("`weird name`");
    expect(quoteName("orders")).toBe("orders");
    expect(quoteName("a`b")).toBe("`a``b`");
    expect(quoteName("1st")).toBe("`1st`");
  });

  it("offers columns of the tables in the query, then keywords", () => {
    const items = at("SELECT st| FROM orders");
    expect(items[0]).toMatchObject({
      label: "status",
      kind: "column",
      detail: "enum",
    });
  });

  it("offers a column after a table or alias and a dot", () => {
    expect(labels("SELECT o.| FROM orders o", true)).toEqual(
      ["id", "customer_id", "status", "total"].sort(
        (a, b) => a.length - b.length || a.localeCompare(b),
      ),
    );
    expect(labels("SELECT c.na| FROM orders o JOIN customers c ON 1")).toEqual([
      "name",
    ]);
    expect(labels("SELECT orders.st| FROM orders")).toEqual(["status"]);
  });

  it("offers nothing after a dot when the name is unknown", () => {
    expect(labels("SELECT x.| FROM orders", true)).toEqual([]);
  });

  it("offers the tables of another database after its name and a dot", () => {
    expect(labels("SELECT * FROM analytics.|", true)).toEqual([
      "daily_revenue",
    ]);
    expect(labels("SELECT * FROM shop.|", true)).toEqual([]);
  });

  it("offers a shared column name once when two tables are joined", () => {
    const items = at("SELECT i| FROM orders o JOIN customers c ON 1");
    expect(items.filter((i) => i.label === "id")).toHaveLength(1);
  });

  it("ranks names that start with the text before ones that only contain it", () => {
    const items = at("SELECT id| FROM orders");
    expect(items[0].label).toBe("id");
    expect(items.map((i) => i.label)).toContain("customer_id");
  });

  it("offers nothing inside a string or a comment", () => {
    expect(labels("SELECT 'sta| FROM orders")).toEqual([]);
    expect(labels("SELECT 1 -- sta|")).toEqual([]);
  });

  it("offers nothing when the word is complete and nothing else matches", () => {
    expect(labels("SELECT * FROM orders|")).toEqual([]);
  });

  it("offers functions with an opening bracket", () => {
    const f = at("SELECT cou| FROM orders").find((i) => i.kind === "function");
    expect(f?.insert).toBe("count(");
    const g = at("SELECT COU| FROM orders").find((i) => i.kind === "function");
    expect(g?.insert).toBe("COUNT(");
  });

  it("shows at most eight", () => {
    expect(at("SELECT | FROM orders", true).length).toBeLessThanOrEqual(8);
  });
});
