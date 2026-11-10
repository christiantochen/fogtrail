import type { KeyNode } from "../api/types";

export interface TreeNode {
  /** Last segment, shown in the row. */
  label: string;
  /** Full path up to and including this segment, used as the React key. */
  path: string;
  /** Set when a real key ends here. A node can be a key and a folder at once. */
  key: KeyNode | null;
  children: TreeNode[];
  /** Number of real keys at or below this node. */
  count: number;
}

/**
 * Splits a key name into segments. Every character of `delimiter` is a
 * separator, so ":/" splits on both. An empty delimiter means "don't group".
 */
export function splitName(name: string, delimiter: string): string[] {
  if (!delimiter) return [name];
  const separators = new Set(delimiter);
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < name.length; i++) {
    if (separators.has(name[i])) {
      parts.push(name.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(name.slice(start));
  return parts;
}

/** One row per key, in the order given: for lists the tree would only reshuffle. */
export function flatNodes(keys: KeyNode[]): TreeNode[] {
  return keys.map((key) => ({
    label: key.name,
    path: key.name,
    key,
    children: [],
    count: 1,
  }));
}

/** Groups flat key names into a tree by splitting on the characters of `delimiter`. */
export function buildTree(keys: KeyNode[], delimiter = ":"): TreeNode[] {
  // Paths are joined with the first separator, so `a:b` and `a/b` share a folder.
  const joiner = delimiter[0] ?? "";
  const split = (name: string) => splitName(name, delimiter);
  const root: TreeNode = {
    label: "",
    path: "",
    key: null,
    children: [],
    count: 0,
  };
  const index = new Map<string, TreeNode>();

  for (const key of keys) {
    const parts = split(key.name);
    let parent = root;
    let path = "";
    parts.forEach((part, i) => {
      path = i === 0 ? part : path + joiner + part;
      let node = index.get(path);
      if (!node) {
        node = { label: part, path, key: null, children: [], count: 0 };
        index.set(path, node);
        parent.children.push(node);
      }
      node.count += 1;
      if (i === parts.length - 1) node.key = key;
      parent = node;
    });
  }

  sort(root.children);
  return root.children;
}

function sort(nodes: TreeNode[]) {
  // Folders first, then leaves, each alphabetical, so the tree reads like a file list.
  nodes.sort((a, b) => {
    const af = a.children.length > 0 ? 0 : 1;
    const bf = b.children.length > 0 ? 0 : 1;
    return af - bf || a.label.localeCompare(b.label);
  });
  for (const node of nodes) sort(node.children);
}

/** Path segments for the breadcrumb trail: `user:1:name` -> `user`, `1`, `name`. */
export function trailOf(name: string, delimiter = ":") {
  const parts = splitName(name, delimiter);
  const joiner = delimiter[0] ?? "";
  return parts.map((label, i) => ({
    label,
    path: parts.slice(0, i + 1).join(joiner),
  }));
}

/**
 * A SCAN MATCH pattern for "contains `needle`, ignoring case". Redis globs are
 * case-sensitive, so each letter becomes a class like `[aA]`, and glob
 * metacharacters are escaped.
 */
export function globFor(needle: string): string {
  const body = [...needle.trim()]
    .map((ch) => {
      if ("\\*?[]^-".includes(ch)) return "\\" + ch;
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      return lower !== upper && lower.length === 1 && upper.length === 1
        ? `[${lower}${upper}]`
        : ch;
    })
    .join("");
  return `*${body}*`;
}

/** Folder paths above a key, so they can all be opened to show it in the tree. */
export function ancestorsOf(name: string, delimiter = ":"): string[] {
  return trailOf(name, delimiter)
    .slice(0, -1)
    .map((c) => c.path);
}
