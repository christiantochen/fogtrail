import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { KeyNode } from "../api/types";
import { copyText, readCommand } from "../lib/clipboard";
import { formatTtlShort, typeBadge } from "../lib/format";
import { buildTree, type TreeNode } from "../lib/tree";
import { useUi } from "../state/ui";
import { getKey } from "../api/browse";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Chevron } from "./Icons";
import { valueAsText } from "./ValueView";

// The same shortcut, written the way each platform's users read it.
const shortcutHint = /Mac|iPhone|iPad/.test(navigator.platform)
  ? "⇧⌘C"
  : "Ctrl+Shift+C";

/** `keys` are already filtered by the server, so everything here is a match. */
export function KeyTree({
  keys,
  searching,
}: {
  keys: KeyNode[];
  searching: boolean;
}) {
  const delimiter = useUi((s) => s.delimiter);
  const tree = useMemo(() => buildTree(keys, delimiter), [keys, delimiter]);

  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // One tooltip for the whole tree. It only appears for a name that is cut off,
  // and it shows the complete key so it can be read (and recognised) in full.
  const show = (target: EventTarget) => {
    window.clearTimeout(timer.current);
    const row = (target as HTMLElement).closest<HTMLElement>("button.row");
    const label = row?.querySelector<HTMLElement>(".row__label");
    if (!row || !label || label.scrollWidth <= label.clientWidth) {
      setTip(null);
      return;
    }
    const text = label.dataset.full ?? label.textContent ?? "";
    timer.current = window.setTimeout(() => {
      const r = row.getBoundingClientRect();
      setTip({ text, left: r.left + 24, top: r.bottom + 4 });
    }, 250);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };

  // Right-click on a row: copy its name, value or read command.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const openMenu = (e: MouseEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("button.row");
    if (!row) return;
    e.preventDefault();
    hide();
    const { name, kind, folder } = row.dataset;
    const items: MenuItem[] = [];
    if (name) {
      items.push(
        {
          label: "Copy key name",
          hint: shortcutHint,
          run: () => void copyText(name, "key name"),
        },
        {
          label: useUi.getState().pins.includes(name) ? "Unpin key" : "Pin key",
          run: () => useUi.getState().togglePin(name),
        },
        {
          label: "Copy value",
          run: () =>
            void getKey(name).then(
              (d) => copyText(valueAsText(d.value), "value"),
              () => copyText("", "value"),
            ),
        },
        {
          label: "Copy as redis-cli command",
          run: () => void copyText(readCommand(kind ?? "", name), "command"),
        },
      );
    }
    if (folder) {
      items.push({
        label: "Copy folder path",
        run: () => void copyText(folder, "folder path"),
      });
    }
    if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (tree.length === 0) {
    return <p className="note">{searching ? "No keys match." : "No keys."}</p>;
  }
  return (
    <>
      <ul
        className="tree"
        role="tree"
        aria-label="Keys"
        onKeyDown={onTreeKey}
        onMouseOver={(e) => show(e.target)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.target)}
        onBlur={hide}
        onScroll={hide}
        onClick={hide}
        onContextMenu={openMenu}
      >
        {tree.map((n) => (
          <Row key={n.path} node={n} depth={0} searching={searching} />
        ))}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {tip && !menu && (
        <div
          role="tooltip"
          className="tip mono"
          style={{ left: tip.left, top: tip.top }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}

interface Tip {
  text: string;
  left: number;
  top: number;
}

/** Arrow keys move between rows; Right opens a folder, Left closes it. */
function onTreeKey(e: KeyboardEvent<HTMLUListElement>) {
  if (
    ![
      "ArrowDown",
      "ArrowUp",
      "ArrowRight",
      "ArrowLeft",
      "Home",
      "End",
    ].includes(e.key)
  )
    return;
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.row"),
  ];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  const item = rows[at].closest("li");
  const expanded = item?.getAttribute("aria-expanded");
  e.preventDefault();

  if (e.key === "ArrowDown") rows[Math.min(at + 1, rows.length - 1)]?.focus();
  else if (e.key === "ArrowUp") rows[Math.max(at - 1, 0)]?.focus();
  else if (e.key === "Home") rows[0]?.focus();
  else if (e.key === "End") rows[rows.length - 1]?.focus();
  else if (e.key === "ArrowRight" && expanded === "false") rows[at].click();
  else if (e.key === "ArrowRight" && expanded === "true") rows[at + 1]?.focus();
  else if (e.key === "ArrowLeft" && expanded === "true") rows[at].click();
  else if (e.key === "ArrowLeft") {
    // Jump to the parent folder's row.
    const parent = item?.parentElement
      ?.closest("li")
      ?.querySelector<HTMLButtonElement>(":scope > button.row");
    parent?.focus();
  }
}

function Row({
  node,
  depth,
  searching,
}: {
  node: TreeNode;
  depth: number;
  searching: boolean;
}) {
  const expanded = useUi((s) => s.expanded.has(node.path));
  const selected = useUi(
    (s) => s.selected === node.key?.name && node.key !== null,
  );
  const toggle = useUi((s) => s.toggle);
  const select = useUi((s) => s.select);

  const isFolder = node.children.length > 0;
  // While searching, everything is open so matches are visible.
  const open = isFolder && (expanded || searching);
  const key = node.key;

  const onClick = () => {
    if (key) select(key.name);
    if (isFolder) toggle(node.path);
  };

  return (
    <li
      role="treeitem"
      aria-expanded={isFolder ? open : undefined}
      aria-selected={selected}
    >
      <button
        type="button"
        className="row"
        data-name={key?.name}
        data-kind={key?.kind}
        data-folder={isFolder ? node.path : undefined}
        aria-current={selected}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={onClick}
      >
        {isFolder ? (
          <Chevron className={`row__chev${open ? " row__chev--open" : ""}`} />
        ) : (
          <span className="row__chev" />
        )}
        <span className="row__label mono" data-full={key?.name ?? node.path}>
          {node.label || "∅"}
        </span>
        {key && <span className="badge">{typeBadge(key.kind)}</span>}
        {key?.ttlSeconds != null && (
          <span className="row__ttl">{formatTtlShort(key.ttlSeconds)}</span>
        )}
        {isFolder && <span className="row__count">{node.count}</span>}
      </button>
      {open && (
        <ul role="group">
          {node.children.map((c) => (
            <Row
              key={c.path}
              node={c}
              depth={depth + 1}
              searching={searching}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
