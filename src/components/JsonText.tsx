import { useMemo } from "react";
import { summaryOf, type Block } from "../lib/fold";
import type { Range } from "../lib/find";
import { tokenizeJson } from "../lib/json";
import { Marked } from "./Marked";

/** Past this size, coloring costs more than it helps, so plain text is shown. */
export const COLOR_LIMIT = 200_000;

export interface Folding {
  blocks: readonly Block[];
  /** Start lines of the blocks that are folded. */
  folded: ReadonlySet<number>;
  onToggle: (line: number) => void;
}

interface Line {
  text: string;
  start: number;
}

export function JsonText({
  text,
  ranges = [],
  current,
  folding,
  fresh,
}: {
  text: string;
  ranges?: readonly Range[];
  current?: number;
  folding?: Folding;
  fresh?: { pulse: number; lines: ReadonlySet<string> };
}) {
  const lines = useMemo<Line[] | null>(() => {
    if (text.length > COLOR_LIMIT) return null;
    let at = 0;
    return text.split("\n").map((t) => {
      const line = { text: t, start: at };
      at += t.length + 1;
      return line;
    });
  }, [text]);
  const byStart = useMemo(
    () => new Map(folding?.blocks.map((b) => [b.start, b])),
    [folding?.blocks],
  );

  if (!lines)
    return (
      <pre className="code">
        <Marked text={text} ranges={ranges} current={current} />
      </pre>
    );

  const rows = visibleLines(lines.length, byStart, folding?.folded);
  return (
    <pre className="code code--fold">
      {rows.map((i) => (
        <LineView
          key={`${i}:${fresh?.lines.has(lines[i].text) ? fresh.pulse : 0}`}
          fresh={!!fresh?.lines.has(lines[i].text)}
          index={i}
          line={lines[i]}
          block={byStart.get(i)}
          folding={folding}
          lastLine={lines[byStart.get(i)?.end ?? i].text}
          ranges={ranges}
          current={current}
        />
      ))}
    </pre>
  );
}

/** Line numbers on screen: a folded block shows its opening line only. */
function visibleLines(
  count: number,
  blocks: ReadonlyMap<number, Block>,
  folded: ReadonlySet<number> | undefined,
): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < count) {
    out.push(i);
    const b = blocks.get(i);
    i = b && folded?.has(i) ? b.end + 1 : i + 1;
  }
  return out;
}

function LineView({
  index,
  line,
  block,
  folding,
  lastLine,
  ranges,
  current,
  fresh,
}: {
  index: number;
  line: Line;
  block: Block | undefined;
  folding: Folding | undefined;
  lastLine: string;
  ranges: readonly Range[];
  current: number | undefined;
  fresh: boolean;
}) {
  const isFolded = !!block && !!folding?.folded.has(index);
  const body = tokenizeJson(line.text).reduce<{
    at: number;
    nodes: React.ReactNode[];
  }>(
    (acc, t, k) => {
      const piece = (
        <Marked
          text={t.text}
          offset={acc.at}
          ranges={ranges}
          current={current}
        />
      );
      acc.nodes.push(
        t.kind === "plain" ? (
          <span key={k}>{piece}</span>
        ) : (
          <span key={k} className={`json-${t.kind}`}>
            {piece}
          </span>
        ),
      );
      return { at: acc.at + t.text.length, nodes: acc.nodes };
    },
    { at: line.start, nodes: [] },
  ).nodes;
  return (
    <div className={fresh ? "fl fl--fresh" : "fl"} data-line={index}>
      {block && folding ? (
        <button
          type="button"
          className="fl__g"
          aria-expanded={!isFolded}
          aria-label={isFolded ? "Expand block" : "Collapse block"}
          onClick={() => folding.onToggle(index)}
        >
          {isFolded ? "▸" : "▾"}
        </button>
      ) : (
        <span className="fl__g" aria-hidden="true" />
      )}
      <span className="fl__t">
        {body}
        {isFolded && block && (
          <>
            <span className="fold-note">{` … ${summaryOf(block)} `}</span>
            {lastLine.trim()}
          </>
        )}
      </span>
    </div>
  );
}
