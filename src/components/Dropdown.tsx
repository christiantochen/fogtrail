import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { listPlacement, moveActive, typeahead } from "../lib/dropdown";
import { Chevron } from "./Icons";

export interface DropdownOption<T> {
  value: T;
  /** Text in the list. */
  label: string;
  /** What the closed box shows instead of the label, when that is shorter. */
  shown?: string;
  /** Quiet text at the right of the row. */
  meta?: string;
}

/**
 * A dropdown drawn by the app, in the same style as the menu bar, instead of the
 * list the OS paints for a native select (grey, cramped, and blind to the theme).
 * Focus stays on the box the whole time; the highlighted row is announced with
 * aria-activedescendant.
 */
export function Dropdown<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  title,
  className,
  children,
}: {
  /** Accessible name. */
  label: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Replaces the text in the closed box. */
  children?: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);

  const selected = options.findIndex((o) => o.value === value);
  const current = options[selected];

  const show = () => {
    if (disabled || options.length === 0) return;
    setActive(Math.max(0, selected));
    setAt(null);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const commit = (i: number) => {
    const o = options[i];
    close();
    if (o && o.value !== value) onChange(o.value);
  };

  // Place the list once it has a size, so it can flip up near the bottom edge.
  useLayoutEffect(() => {
    if (!open || !box.current || !list.current) return;
    const b = box.current.getBoundingClientRect();
    setAt(
      listPlacement(
        { top: b.top, bottom: b.bottom, left: b.left, width: b.width },
        {
          height: list.current.offsetHeight,
          width: list.current.offsetWidth,
        },
        { height: window.innerHeight, width: window.innerWidth },
      ),
    );
  }, [open, options.length]);

  // Clicking away, scrolling or resizing closes it; the choice stays as it was.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !list.current?.contains(t)) close();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    // Scrolling the page closes the list (it is placed against the window), but
    // scrolling the list itself, to reach a row in a long one, must not.
    const scrolled = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);

  // The highlighted row stays in view in a long list.
  useEffect(() => {
    if (open)
      document.getElementById(`${id}-${active}`)?.scrollIntoView?.({
        block: "nearest",
      });
  }, [open, active, id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    const moved = moveActive(e.key, active, options.length);
    if (moved !== null) {
      e.preventDefault();
      setActive(moved);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(active);
    } else if (e.key === "Escape") {
      // Only this list closes, not whatever is behind it.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at < 700 ? t.text + e.key : e.key;
      t.at = now;
      const hit = typeahead(
        options.map((o) => o.label),
        active,
        t.text,
      );
      if (hit !== null) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={box}
        type="button"
        role="combobox"
        className={`dropdown__box${className ? ` ${className}` : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        data-value={String(value)}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown__value">
          {children ?? current?.shown ?? current?.label ?? ""}
        </span>
        <Chevron className="dropdown__chev" width={12} height={12} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="dropdown__list"
            style={{
              top: at?.top ?? 0,
              left: at?.left ?? 0,
              minWidth: at?.minWidth,
              visibility: at ? "visible" : "hidden",
            }}
          >
            {options.map((o, i) => (
              <li
                key={String(o.value)}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === selected}
                data-value={String(o.value)}
                className={`dropdown__opt${i === active ? " dropdown__opt--active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
              >
                <span className="dropdown__tick" aria-hidden="true">
                  {i === selected ? "✓" : ""}
                </span>
                <span>{o.label}</span>
                {o.meta && <span className="dropdown__meta">{o.meta}</span>}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
