import { MAX_PINS } from "../lib/sql";
import { Pin } from "./Icons";

/** The small pin beside a column heading. Hidden until the heading is hovered or focused, unless pinned. */
export function PinButton({
  name,
  pinned,
  full,
  onToggle,
}: {
  name: string;
  pinned: boolean;
  /** The limit is reached, so another column can't be pinned. */
  full: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`pinbtn${pinned ? " pinbtn--on" : ""}`}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`}
      aria-pressed={pinned}
      disabled={full && !pinned}
      title={
        pinned
          ? "Unpin this column"
          : full
            ? `${MAX_PINS} of ${MAX_PINS} columns pinned. Unpin one to pin another.`
            : "Pin this column to the left"
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Pin fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}
