import { piecesOf, type Range } from "../lib/find";

/** Text with search matches wrapped in <mark>. `current` is the match the user is on. */
export function Marked({
  text,
  offset = 0,
  ranges,
  current = -1,
}: {
  text: string;
  /** Where `text` starts inside the string the ranges were found in. */
  offset?: number;
  ranges: readonly Range[];
  current?: number;
}) {
  if (ranges.length === 0) return <>{text}</>;
  return (
    <>
      {piecesOf(text, offset, ranges).map((p, i) =>
        p.hit === null ? (
          p.text
        ) : (
          <mark
            key={i}
            className={p.hit === current ? "mark mark--current" : "mark"}
            data-current={p.hit === current ? "true" : undefined}
          >
            {p.text}
          </mark>
        ),
      )}
    </>
  );
}
