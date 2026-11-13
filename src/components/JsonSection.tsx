import { copyText } from "../lib/clipboard";
import type { JsonField } from "../lib/sql";
import { CollapseAllIcon, ExpandAllIcon, ExpandIcon } from "./Icons";
import { JsonText } from "./JsonText";
import type { Range } from "../lib/find";
import { useJsonFold, useRevealHit } from "./useJsonFold";

const NONE: readonly Range[] = [];

/** The fold button: one control that closes every block, then opens them again. */
export function FoldAllButton({
  fold,
  labeled,
}: {
  fold: ReturnType<typeof useJsonFold>;
  labeled?: boolean;
}) {
  if (!fold.canFold) return null;
  const label = fold.allFolded ? "Expand all" : "Collapse all";
  return (
    <button
      type="button"
      className={`btn btn--small btn--icon${labeled ? "" : " btn--square"}`}
      aria-label={label}
      title={label}
      onClick={fold.toggleAll}
    >
      {fold.allFolded ? <ExpandAllIcon /> : <CollapseAllIcon />}
      {labeled && label}
    </button>
  );
}

/** One JSON value of a row: its name, what it is, the buttons, and the JSON itself, foldable. */
export function JsonSection({
  name,
  field,
  startFolded,
  onExpand,
  ranges = NONE,
  current = -1,
}: {
  name: string;
  field: JsonField;
  /** Open with the blocks inside the outermost one folded. */
  startFolded: boolean;
  /** Shows the expand button, which opens this value alone in a dialog. */
  onExpand?: () => void;
  /** Search matches in this value, and which one the search is on (-1: none here). */
  ranges?: readonly Range[];
  current?: number;
}) {
  const fold = useJsonFold(field.pretty, startFolded);
  useRevealHit(fold, field.pretty, ranges, current);
  return (
    <section className="rowjson">
      <div className="rowjson__head">
        <span className="mono">{name}</span>
        <span className="badge mono">
          {field.source === "json" ? "json" : "text"}
        </span>
        {field.source === "text" && (
          <span className="badge mono">json detected</span>
        )}
        <span className="rowjson__spacer" />
        <FoldAllButton fold={fold} />
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void copyText(field.pretty, name)}
        >
          Copy JSON
        </button>
        {onExpand && (
          <button
            type="button"
            className="btn btn--small btn--icon btn--square"
            aria-label={`Expand ${name} in a dialog`}
            title="Expand"
            onClick={onExpand}
          >
            <ExpandIcon />
          </button>
        )}
      </div>
      <JsonText
        text={field.pretty}
        ranges={ranges}
        current={current}
        folding={fold.folding}
      />
    </section>
  );
}
