export type JsonTokenKind = "key" | "string" | "number" | "literal" | "plain";

export interface JsonToken {
  text: string;
  kind: JsonTokenKind;
}

const TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

/** Splits already-formatted JSON into colorable pieces. Concatenating the texts gives the input back. */
export function tokenizeJson(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last)
      out.push({ text: text.slice(last, start), kind: "plain" });
    const t = m[0];
    const kind: JsonTokenKind = t.startsWith('"')
      ? /^\s*:/.test(text.slice(start + t.length))
        ? "key"
        : "string"
      : /^(true|false|null)$/.test(t)
        ? "literal"
        : "number";
    out.push({ text: t, kind });
    last = start + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}
