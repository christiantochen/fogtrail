// The keyboard rules of the dropdown list, kept apart from the component so they can be tested.

/** The option to highlight after a key press, or null when the key does nothing here. */
export function moveActive(
  key: string,
  active: number,
  count: number,
): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, active + 1);
    case "ArrowUp":
      return Math.max(0, active - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Type-ahead: the next option whose label starts with what was typed, looking after
 * the highlighted one first and wrapping round. Typing the same letter again steps
 * through the options that start with it.
 */
export function typeahead(
  labels: readonly string[],
  active: number,
  typed: string,
): number | null {
  const want = typed.toLowerCase();
  if (!want) return null;
  // "aaa" means the same as "a" pressed again.
  const repeated = [...want].every((c) => c === want[0]);
  const prefix = repeated ? want[0] : want;
  const from = repeated || want.length === 1 ? active + 1 : active;
  for (let n = 0; n < labels.length; n++) {
    const i = (from + n) % labels.length;
    if (labels[i].toLowerCase().startsWith(prefix)) return i;
  }
  return null;
}

/** Where the list goes: under the box, or above it when there is no room below. */
export function listPlacement(
  box: { top: number; bottom: number; left: number; width: number },
  list: { height: number; width: number },
  view: { height: number; width: number },
  gap = 4,
  margin = 8,
): { top: number; left: number; minWidth: number } {
  const below = view.height - box.bottom - margin;
  const above = box.top - margin;
  const flip = list.height > below && above > below;
  const top = flip
    ? Math.max(margin, box.top - gap - list.height)
    : box.bottom + gap;
  const wide = Math.max(box.width, list.width);
  const left = Math.max(margin, Math.min(box.left, view.width - margin - wide));
  return { top, left, minWidth: box.width };
}
