/** A `{ … }` or `[ … ]` that spans several lines of formatted JSON. */
export interface Block {
  /** Line with the opening bracket. */
  start: number;
  /** Line with the closing bracket. */
  end: number;
  open: "{" | "[";
  /** Direct children: fields of an object, items of an array. */
  count: number;
}

/**
 * Finds the foldable blocks in JSON formatted with one entry per line
 * (what JSON.stringify(x, null, 2) writes). Blocks on a single line, like `[]`, are skipped.
 */
export function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const indentOf = (l: string) => l.length - l.trimStart().length;
  const stack: { start: number; open: "{" | "[" }[] = [];
  const out: Block[] = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("}") || t.startsWith("]")) {
      const top = stack.pop();
      if (!top) return;
      const inner = indentOf(lines[top.start]) + 2;
      let count = 0;
      for (let j = top.start + 1; j < i; j++) {
        const c = lines[j].trimStart();
        if (
          indentOf(lines[j]) === inner &&
          !c.startsWith("}") &&
          !c.startsWith("]")
        )
          count++;
      }
      out.push({ start: top.start, end: i, open: top.open, count });
    } else if (t.endsWith("{") || t.endsWith("[")) {
      stack.push({ start: i, open: t.endsWith("{") ? "{" : "[" });
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

/** "5 fields", "1 item": what a folded block says it holds. */
export function summaryOf(b: Block): string {
  const [one, many] = b.open === "{" ? ["field", "fields"] : ["item", "items"];
  return `${b.count} ${b.count === 1 ? one : many}`;
}

/** The line a character offset falls on. */
export function lineAt(text: string, offset: number): number {
  let line = 0;
  for (
    let i = text.indexOf("\n");
    i !== -1 && i < offset;
    i = text.indexOf("\n", i + 1)
  )
    line++;
  return line;
}

/** Unfolds every folded block that would hide `line`, so a find hit is never out of sight. */
export function unfoldFor(
  folded: ReadonlySet<number>,
  blocks: readonly Block[],
  line: number,
): Set<number> {
  const next = new Set(folded);
  for (const b of blocks)
    if (b.start < line && line <= b.end) next.delete(b.start);
  return next;
}

/** Everything folded except the outermost block, so the top level stays readable. */
export function collapseAll(blocks: readonly Block[]): Set<number> {
  return new Set(blocks.filter((b) => b.start > 0).map((b) => b.start));
}
