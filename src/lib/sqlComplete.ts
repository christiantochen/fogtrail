import { KEYWORDS as KEYWORD_SET, type Token, tokenize } from "./sqlHighlight";

export type ItemKind =
  "keyword" | "function" | "table" | "view" | "column" | "database";

export interface Item {
  /** Shown in the list. */
  label: string;
  /** What replaces the word being typed. */
  insert: string;
  kind: ItemKind;
  /** A column's type, or the table a column comes from. */
  detail?: string;
}

/** A table named in FROM, JOIN, UPDATE or INTO, with the alias it was given. */
export interface TableRef {
  schema?: string;
  table: string;
  alias?: string;
}

/** What is known about the text around the caret. */
export interface Context {
  /** Where the word being typed starts. */
  start: number;
  prefix: string;
  /** `orders` in `orders.st`, or null. */
  qualifier: string | null;
  /** The caret is inside a string, a comment or a quoted name: suggest nothing. */
  blocked: boolean;
  /** A table name is expected here (after FROM, JOIN and so on). */
  wantsTable: boolean;
  /** Nothing comes before the word: suggest statement starters. */
  atStart: boolean;
  refs: TableRef[];
}

/** What the editor has loaded about the open connection. */
export interface Known {
  /** How names are quoted and what counts as a string. MySQL when left out. */
  dialect?: "mysql" | "postgres";
  tables: { name: string; view: boolean }[];
  schemas: string[];
  /** Columns of a table, or undefined while they are still loading or unknown. */
  columns: (
    table: string,
    schema?: string,
  ) => { name: string; dataType: string }[] | undefined;
  /** Tables of another database, or undefined while loading. */
  tablesOf: (schema: string) => { name: string; view: boolean }[] | undefined;
}

const STARTERS = ["SELECT", "SHOW", "DESCRIBE", "EXPLAIN", "WITH"];
const PG_STARTERS = ["SELECT", "SHOW", "EXPLAIN", "VALUES", "WITH"];
const KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS NULL",
  "IS NOT NULL",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "DISTINCT",
  "UNION",
  "UNION ALL",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "WITH",
  "SHOW TABLES",
  "SHOW COLUMNS FROM",
  "SHOW CREATE TABLE",
  "SHOW INDEX FROM",
  "SHOW DATABASES",
  "DESCRIBE",
  "EXPLAIN",
];
const FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "IFNULL",
  "NULLIF",
  "CONCAT",
  "LENGTH",
  "LOWER",
  "UPPER",
  "TRIM",
  "SUBSTRING",
  "REPLACE",
  "ROUND",
  "FLOOR",
  "CEIL",
  "ABS",
  "NOW",
  "CURDATE",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "DATEDIFF",
  "DATE_FORMAT",
  "DATE_ADD",
  "DATE_SUB",
  "CAST",
  "JSON_EXTRACT",
  "JSON_UNQUOTE",
  "GROUP_CONCAT",
];

/** Words after which a table name is expected. */
const TABLE_WORDS = new Set([
  "FROM",
  "JOIN",
  "INTO",
  "UPDATE",
  "TABLE",
  "DESCRIBE",
  "DESC",
]);
/** Words that are not an alias when they follow a table name. */
const NOT_ALIASES = new Set([
  "WHERE",
  "GROUP",
  "ORDER",
  "HAVING",
  "LIMIT",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "NATURAL",
  "ON",
  "USING",
  "UNION",
  "SET",
  "FOR",
  "AS",
  "AND",
  "OR",
  "WINDOW",
  "PARTITION",
]);

const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** PostgreSQL folds bare names to lower case, so only these may be written bare. */
const PLAIN_PG_NAME = /^[a-z_][a-z0-9_$]*$/;

/** Words PostgreSQL will not take as a bare table or column name. */
const PG_RESERVED = new Set(
  (
    "ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC BOTH CASE CAST CHECK COLLATE COLUMN " +
    "CONSTRAINT CREATE CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_TIME CURRENT_TIMESTAMP " +
    "CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT FALSE FETCH FOR FOREIGN " +
    "FROM GRANT GROUP HAVING IN INITIALLY INTERSECT INTO LATERAL LEADING LIMIT LOCALTIME " +
    "LOCALTIMESTAMP NOT NULL OFFSET ON ONLY OR ORDER PLACING PRIMARY REFERENCES RETURNING " +
    "SELECT SESSION_USER SOME SYMMETRIC TABLE THEN TO TRAILING TRUE UNION UNIQUE USER USING " +
    "VARIADIC WHEN WHERE WINDOW WITH"
  ).split(" "),
);

/**
 * A name as it must be written in SQL: bare when it can be, quoted when not. MySQL
 * quotes with backticks. PostgreSQL uses double quotes, and also for anything with a
 * capital letter or a reserved word, because bare names are folded to lower case.
 */
export function quoteName(
  name: string,
  dialect: "mysql" | "postgres" = "mysql",
): string {
  if (dialect === "postgres") {
    return PLAIN_PG_NAME.test(name) && !PG_RESERVED.has(name.toUpperCase())
      ? name
      : `"${name.replace(/"/g, '""')}"`;
  }
  return PLAIN_NAME.test(name) ? name : `\`${name.replace(/`/g, "``")}\``;
}

const unquote = (s: string) =>
  s.startsWith("`")
    ? s.slice(1, s.endsWith("`") ? -1 : undefined).replace(/``/g, "`")
    : s.startsWith('"')
      ? s.slice(1, s.endsWith('"') ? -1 : undefined).replace(/""/g, '"')
      : s;

/** Finds the tables a statement reads from, with their aliases. */
export function findRefs(sql: string, tokens: Token[]): TableRef[] {
  const sig = tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  const text = (t: Token) => sql.slice(t.start, t.end);
  const isName = (t: Token | undefined) =>
    t !== undefined && (t.type === "word" || t.type === "quoted");
  const isPunct = (t: Token | undefined, ch: string) =>
    t !== undefined && t.type === "punct" && text(t) === ch;
  const refs: TableRef[] = [];

  for (let i = 0; i < sig.length; i++) {
    if (sig[i].type !== "word") continue;
    const word = text(sig[i]).toUpperCase();
    if (!["FROM", "JOIN", "UPDATE", "INTO"].includes(word)) continue;
    let j = i + 1;
    // A comma-separated list: `FROM a x, b y`.
    for (;;) {
      if (!isName(sig[j])) break;
      let table = unquote(text(sig[j]));
      let schema: string | undefined;
      j++;
      if (isPunct(sig[j], ".") && isName(sig[j + 1])) {
        schema = table;
        table = unquote(text(sig[j + 1]));
        j += 2;
      }
      let alias: string | undefined;
      if (
        sig[j] &&
        sig[j].type === "word" &&
        text(sig[j]).toUpperCase() === "AS"
      ) {
        j++;
      }
      const a = sig[j];
      if (
        isName(a) &&
        !(a.type === "word" && NOT_ALIASES.has(text(a).toUpperCase()))
      ) {
        alias = unquote(text(a));
        j++;
      }
      refs.push({ schema, table, alias });
      if (isPunct(sig[j], ",")) {
        j++;
        continue;
      }
      break;
    }
  }
  return refs;
}

/** What the text around `caret` means for completion. */
export function contextAt(
  sql: string,
  caret: number,
  dialect: "mysql" | "postgres" = "mysql",
): Context {
  const tokens = tokenize(sql, dialect);
  const refs = findRefs(sql, tokens);
  const empty: Context = {
    start: caret,
    prefix: "",
    qualifier: null,
    blocked: false,
    wantsTable: false,
    atStart: false,
    refs,
  };

  // Inside a string, a comment or a quoted name there is nothing to suggest.
  for (const t of tokens) {
    if (t.type !== "string" && t.type !== "comment" && t.type !== "quoted")
      continue;
    const inside =
      caret > t.start && (caret < t.end || (t.open && caret <= t.end));
    // A line comment ends at the line break, so the caret at its very end is inside it.
    const atEndOfComment =
      t.type === "comment" && caret === t.end && t.end > t.start;
    if (inside || (atEndOfComment && sql[t.start] !== "/")) {
      return { ...empty, blocked: true };
    }
  }

  let start = caret;
  while (start > 0 && /[A-Za-z0-9_$\u0080-￿]/.test(sql[start - 1])) start--;
  const prefix = sql.slice(start, caret);

  // Tokens before the word, without spaces and comments.
  const before = tokens.filter(
    (t) => t.end <= start && t.type !== "space" && t.type !== "comment",
  );
  const last = before[before.length - 1];
  const text = (t: Token) => sql.slice(t.start, t.end);

  let qualifier: string | null = null;
  if (
    last &&
    last.type === "punct" &&
    text(last) === "." &&
    last.end === start
  ) {
    const q = before[before.length - 2];
    if (q && (q.type === "word" || q.type === "quoted")) {
      qualifier = unquote(text(q));
    } else {
      return { ...empty, start, prefix, blocked: true };
    }
  }

  // Walk back to the nearest word that says what comes next.
  let wantsTable = false;
  if (qualifier === null) {
    let inList = false;
    for (let k = before.length - 1; k >= 0; k--) {
      const t = before[k];
      const w = t.type === "word" ? text(t).toUpperCase() : "";
      if (t.type === "punct") {
        const ch = text(t);
        if (ch === "(" || ch === ")") break;
        if (ch === ",") inList = true;
        continue;
      }
      if (t.type === "word" && TABLE_WORDS.has(w)) {
        // Right after a table name (`FROM orders |`) the next word is an alias or a clause.
        const next = before[k + 1];
        const afterName =
          !inList &&
          next !== undefined &&
          k + 1 === before.length - 1 &&
          (next.type === "quoted" ||
            (next.type === "word" &&
              !NOT_ALIASES.has(text(next).toUpperCase())));
        wantsTable = !afterName;
        break;
      }
      // Inside a comma list the names and aliases before the comma are skipped.
      if (
        inList &&
        (t.type === "quoted" ||
          (t.type === "word" && (w === "AS" || !KEYWORD_SET.has(w))))
      ) {
        continue;
      }
      if (t.type === "number" && inList) continue;
      break;
    }
  }

  return {
    start,
    prefix,
    qualifier,
    blocked: false,
    wantsTable,
    atStart: before.length === 0,
    refs,
  };
}

const lower = (s: string) => s.toLowerCase();

/** Matches the case the person is typing in: `sel` gives `select`, `SEL` gives `SELECT`. */
function keywordInsert(word: string, prefix: string): string {
  return prefix !== "" &&
    prefix === lower(prefix) &&
    prefix !== prefix.toUpperCase()
    ? word.toLowerCase()
    : word;
}

/** How well a name fits what was typed: 0 starts with it, 1 has a word inside it that does. */
function fit(name: string, prefix: string): number | null {
  if (prefix === "") return 0;
  const n = lower(name);
  const p = lower(prefix);
  if (n.startsWith(p)) return 0;
  return n.split(/[_\s.$]+/).some((part) => part.startsWith(p)) ? 1 : null;
}

const MAX_ITEMS = 8;

/**
 * What to offer at the caret. Automatic suggestions need at least one typed
 * letter or a dot; `manual` (Ctrl+Space) allows an empty word.
 */
export function suggest(ctx: Context, known: Known, manual = false): Item[] {
  if (ctx.blocked) return [];
  if (ctx.prefix === "" && ctx.qualifier === null && !manual) return [];

  type Scored = { item: Item; rank: number; group: number; order: number };
  const found: Scored[] = [];
  const add = (item: Item, group: number) => {
    const rank = fit(item.label, ctx.prefix);
    if (rank !== null) found.push({ item, rank, group, order: found.length });
  };
  const tableItem = (t: { name: string; view: boolean }): Item => ({
    label: t.name,
    insert: quoteName(t.name, known.dialect),
    kind: t.view ? "view" : "table",
    detail: t.view ? "view" : undefined,
  });

  if (ctx.qualifier !== null) {
    const q = lower(ctx.qualifier);
    // An alias wins, then a table of the query; a plain database name comes last.
    const ref =
      ctx.refs.find((r) => lower(r.alias ?? "") === q) ??
      ctx.refs.find(
        (r) =>
          lower(r.table) === q &&
          (r.schema !== undefined ||
            known.tables.some((t) => lower(t.name) === q)),
      );
    if (ref) {
      for (const c of known.columns(ref.table, ref.schema) ?? []) {
        add(
          {
            label: c.name,
            insert: quoteName(c.name, known.dialect),
            kind: "column",
            detail: c.dataType,
          },
          0,
        );
      }
    } else {
      const schema = known.schemas.find((s) => lower(s) === q);
      if (schema)
        for (const t of known.tablesOf(schema) ?? []) add(tableItem(t), 0);
    }
  } else if (ctx.wantsTable) {
    for (const t of known.tables) add(tableItem(t), 0);
    for (const s of known.schemas) {
      add(
        { label: s, insert: quoteName(s, known.dialect), kind: "database" },
        1,
      );
    }
  } else if (ctx.atStart) {
    for (const w of known.dialect === "postgres" ? PG_STARTERS : STARTERS) {
      add(
        { label: w, insert: keywordInsert(w, ctx.prefix), kind: "keyword" },
        0,
      );
    }
  } else {
    const seen = new Set<string>();
    for (const r of ctx.refs) {
      for (const c of known.columns(r.table, r.schema) ?? []) {
        const key = lower(c.name);
        // The same column name in two joined tables is offered once, with the first table.
        if (seen.has(key)) continue;
        seen.add(key);
        add(
          {
            label: c.name,
            insert: quoteName(c.name, known.dialect),
            kind: "column",
            detail:
              ctx.refs.length > 1
                ? `${r.alias ?? r.table} · ${c.dataType}`
                : c.dataType,
          },
          0,
        );
      }
    }
    for (const w of KEYWORDS) {
      add(
        { label: w, insert: keywordInsert(w, ctx.prefix), kind: "keyword" },
        1,
      );
    }
    for (const f of FUNCTIONS) {
      add(
        {
          label: f,
          insert: keywordInsert(f, ctx.prefix) + "(",
          kind: "function",
        },
        2,
      );
    }
    for (const t of known.tables) add(tableItem(t), 3);
  }

  found.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.group - b.group ||
      // Keywords keep the order they are listed in; names go shortest first.
      (a.item.kind === "keyword" || a.item.kind === "function"
        ? a.order - b.order
        : a.item.label.length - b.item.label.length ||
          a.item.label.localeCompare(b.item.label)),
  );
  const items = found.map((f) => f.item).slice(0, MAX_ITEMS);
  // Nothing to offer once the word is already complete and is the only match.
  if (
    items.length === 1 &&
    ctx.prefix !== "" &&
    lower(items[0].insert) === lower(ctx.prefix)
  ) {
    return [];
  }
  return items;
}
