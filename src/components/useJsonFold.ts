import { useMemo, useState } from "react";
import { collapseAll, parseBlocks } from "../lib/fold";
import { COLOR_LIMIT, type Folding } from "./JsonText";

/** Fold state for one formatted JSON text: which blocks are closed, and the buttons that change it. */
export function useJsonFold(text: string, startFolded: boolean) {
  const foldable = text.length <= COLOR_LIMIT;
  const blocks = useMemo(
    () => (foldable ? parseBlocks(text) : []),
    [text, foldable],
  );
  const [folded, setFolded] = useState<ReadonlySet<number>>(() =>
    startFolded ? collapseAll(blocks) : new Set(),
  );
  // The outermost block stays open, so only the blocks inside it count.
  const inner = blocks.filter((b) => b.start > 0);
  const allFolded = inner.length > 0 && inner.every((b) => folded.has(b.start));
  const folding: Folding | undefined = foldable
    ? {
        blocks,
        folded,
        onToggle: (line) =>
          setFolded((f) => {
            const next = new Set(f);
            if (!next.delete(line)) next.add(line);
            return next;
          }),
      }
    : undefined;
  return {
    folding,
    /** There is something to fold. */
    canFold: foldable && inner.length > 0,
    allFolded,
    toggleAll: () => setFolded(allFolded ? new Set() : collapseAll(blocks)),
  };
}
