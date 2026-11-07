import { useUi } from "../state/ui";

/** Keys the user pinned on this connection, one click from anywhere in the tree. */
export function Pinned() {
  const pins = useUi((s) => s.pins);
  const selected = useUi((s) => s.selected);
  const reveal = useUi((s) => s.reveal);
  const togglePin = useUi((s) => s.togglePin);
  if (pins.length === 0) return null;
  return (
    <section className="pins" aria-label="Pinned keys">
      <div className="section-label">Pinned · {pins.length}</div>
      <ul className="pins__list">
        {pins.map((name) => (
          <li
            key={name}
            className={`pin${name === selected ? " pin--on" : ""}`}
          >
            <button
              type="button"
              className="pin__name mono"
              title={name}
              onClick={() => reveal(name)}
            >
              {name}
            </button>
            <button
              type="button"
              className="pin__x"
              aria-label={`Unpin ${name}`}
              onClick={() => togglePin(name)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
