import { useEffect, useState, type RefObject } from "react";

const same = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = Object.keys(b);
  return (
    keys.length === Object.keys(a).length && keys.every((k) => a[k] === b[k])
  );
};

/**
 * How far from the left edge each pinned column sticks: the widths of the pinned
 * columns before it. Read from the heading cells after they are drawn, and again
 * whenever the table changes size, because columns are as wide as their content.
 * `watch` is anything that can change those widths, such as the rows on screen.
 */
export function useColumnPins(
  table: RefObject<HTMLTableElement | null>,
  pinned: string[],
  watch: unknown,
): Record<string, number> {
  const [lefts, setLefts] = useState<Record<string, number>>({});
  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const measure = () => {
      let left = 0;
      const next: Record<string, number> = {};
      for (const name of pinned) {
        const th = el.querySelector<HTMLElement>(
          `thead th[data-col="${CSS.escape(name)}"]`,
        );
        if (!th) continue;
        next[name] = left;
        left += th.offsetWidth;
      }
      setLefts((old) => (same(old, next) ? old : next));
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [table, pinned, watch]);
  return lefts;
}
