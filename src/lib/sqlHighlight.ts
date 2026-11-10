/** A small SQL tokenizer for colouring and for finding what is under the caret. It
 *  only needs to split text into the right kinds of pieces; it is not a parser. */

export type TokenType =
  "space" | "comment" | "string" | "quoted" | "number" | "word" | "punct";

export interface Token {
  type: TokenType;
  start: number;
  /** Exclusive. */
  end: number;
  /** A string, quoted name or block comment that never closes. */
  open: boolean;
}

/** Words that get the keyword colour. Writes are not listed on purpose: the editor won't send them. */
export const KEYWORDS: ReadonlySet<string> = new Set(
  (
    "SELECT FROM WHERE GROUP BY ORDER HAVING LIMIT OFFSET JOIN LEFT RIGHT INNER OUTER CROSS NATURAL " +
    "ON USING AS AND OR NOT IN IS NULL LIKE REGEXP RLIKE BETWEEN EXISTS DISTINCT ALL UNION INTERSECT EXCEPT " +
    "CASE WHEN THEN ELSE END ASC DESC WITH RECURSIVE OVER PARTITION ESCAPE XOR DIV MOD TRUE FALSE " +
    "SHOW DESCRIBE EXPLAIN CREATE TABLE VIEW INTO FOR"
  ).split(" "),
);

const WORD_START = /[A-Za-z_$\u0080-￿]/;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/;
const DIGIT = /[0-9]/;

/** Splits SQL into tokens that together cover the whole text. */
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  const n = sql.length;
  let i = 0;
  const push = (type: TokenType, start: number, end: number, open = false) =>
    out.push({ type, start, end, open });

  while (i < n) {
    const c = sql[i];
    const start = i;
    if (/\s/.test(c)) {
      while (i < n && /\s/.test(sql[i])) i++;
      push("space", start, i);
    } else if (
      c === "#" ||
      (c === "-" && sql[i + 1] === "-" && (i + 2 >= n || /\s/.test(sql[i + 2])))
    ) {
      while (i < n && sql[i] !== "\n") i++;
      // A line comment is still being typed if the text ends inside it.
      push("comment", start, i, i >= n);
    } else if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      const closed = i < n;
      i = closed ? i + 2 : n;
      push("comment", start, i, !closed);
    } else if (c === "'" || c === '"') {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "\\") {
          i += 2;
        } else if (sql[i] === c) {
          // A doubled quote is a quote inside the string.
          if (sql[i + 1] === c) i += 2;
          else {
            i++;
            closed = true;
            break;
          }
        } else i++;
      }
      i = Math.min(i, n);
      push("string", start, i, !closed);
    } else if (c === "`") {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "`") {
          if (sql[i + 1] === "`") i += 2;
          else {
            i++;
            closed = true;
            break;
          }
        } else i++;
      }
      i = Math.min(i, n);
      push("quoted", start, i, !closed);
    } else if (DIGIT.test(c) || (c === "." && DIGIT.test(sql[i + 1] ?? ""))) {
      while (i < n && /[0-9a-fA-FxX.eE_]/.test(sql[i])) i++;
      push("number", start, i);
    } else if (WORD_START.test(c)) {
      while (i < n && WORD_PART.test(sql[i])) i++;
      push("word", start, i);
    } else {
      i++;
      push("punct", start, i);
    }
  }
  return out;
}

/** The colour class for a token, or null for plain text. */
export function tokenClass(sql: string, t: Token): string | null {
  switch (t.type) {
    case "comment":
      return "tk-cm";
    case "string":
      return "tk-str";
    case "number":
      return "tk-num";
    case "word":
      // A word after a dot is a name (`o.status`), whatever it is called.
      if (sql[t.start - 1] === ".") return null;
      return KEYWORDS.has(sql.slice(t.start, t.end).toUpperCase())
        ? "tk-kw"
        : null;
    default:
      return null;
  }
}

/** Past this size the colours are skipped, so a huge paste can't slow typing down. */
export const HIGHLIGHT_LIMIT = 50_000;
