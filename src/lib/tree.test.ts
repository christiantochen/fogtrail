import { describe, expect, it } from "vitest";
import type { KeyNode } from "../api/types";
import { ancestorsOf, buildTree, globFor, splitName, trailOf } from "./tree";

const k = (name: string, kind = "string"): KeyNode => ({
  name,
  kind,
  ttlSeconds: null,
});

describe("buildTree", () => {
  it("groups by prefix and counts keys below each node", () => {
    const tree = buildTree([
      k("user:1"),
      k("user:2"),
      k("session:a"),
      k("greeting"),
    ]);
    const user = tree.find((n) => n.label === "user")!;
    expect(user.count).toBe(2);
    expect(user.children.map((c) => c.label)).toEqual(["1", "2"]);
    expect(user.key).toBeNull();
  });

  it("puts folders before leaves, each alphabetical", () => {
    const tree = buildTree([k("zeta"), k("alpha"), k("b:1"), k("a:1")]);
    expect(tree.map((n) => n.label)).toEqual(["a", "b", "alpha", "zeta"]);
  });

  it("lets a node be both a key and a folder", () => {
    const tree = buildTree([k("user"), k("user:1")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].key?.name).toBe("user");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].count).toBe(2);
  });

  it("keeps full paths so rows have stable keys", () => {
    const tree = buildTree([k("a:b:c")]);
    expect(tree[0].children[0].children[0].path).toBe("a:b:c");
  });

  it("handles empty segments without crashing", () => {
    expect(() => buildTree([k(":lead"), k("trail:"), k("a::b")])).not.toThrow();
  });
});

describe("several separators", () => {
  it("splits on every character in the delimiter", () => {
    expect(splitName("shop:cart/123", ":/")).toEqual(["shop", "cart", "123"]);
    expect(splitName("shop/orders:9", ":")).toEqual(["shop/orders", "9"]);
    expect(splitName("flat:name", "")).toEqual(["flat:name"]);
  });

  it("puts keys with different separators in one folder", () => {
    const tree = buildTree(
      [k("shop:cart:1"), k("shop/orders/9"), k("shop/cart/2")],
      ":/",
    );
    expect(tree).toHaveLength(1);
    const shop = tree[0];
    expect(shop.count).toBe(3);
    expect(shop.children.map((c) => c.label)).toEqual(["cart", "orders"]);
    expect(shop.children[0].count).toBe(2);
    expect(shop.children[1].children[0].key?.name).toBe("shop/orders/9");
  });

  it("builds a trail with the same paths as the tree", () => {
    expect(trailOf("shop/orders:9", ":/")).toEqual([
      { label: "shop", path: "shop" },
      { label: "orders", path: "shop:orders" },
      { label: "9", path: "shop:orders:9" },
    ]);
  });
});

describe("trailOf", () => {
  it("builds cumulative paths", () => {
    expect(trailOf("user:1:name")).toEqual([
      { label: "user", path: "user" },
      { label: "1", path: "user:1" },
      { label: "name", path: "user:1:name" },
    ]);
  });
});

describe("globFor", () => {
  it("matches case-insensitively by turning letters into classes", () => {
    expect(globFor("user")).toBe("*[uU][sS][eE][rR]*");
    expect(globFor("a:1")).toBe("*[aA]:1*");
  });
  it("escapes glob metacharacters", () => {
    expect(globFor("a*b?")).toBe("*[aA]\\*[bB]\\?*");
    expect(globFor("[x]")).toBe("*\\[[xX]\\]*");
  });
  it("trims, and leaves non-letters alone", () => {
    expect(globFor("  7 ")).toBe("*7*");
  });
});

describe("custom delimiters", () => {
  it("groups on any delimiter, and an empty one gives a flat list", () => {
    const keys = [k("a/b"), k("a/c")];
    expect(buildTree(keys, "/")[0].children).toHaveLength(2);
    expect(buildTree(keys, "")).toHaveLength(2);
    expect(trailOf("a/b", "/").map((c) => c.label)).toEqual(["a", "b"]);
    expect(trailOf("a:b", "")).toEqual([{ label: "a:b", path: "a:b" }]);
  });
});

describe("ancestorsOf", () => {
  it("lists the folders above a key, with the tree's own paths", () => {
    expect(ancestorsOf("shop/orders:9", ":/")).toEqual(["shop", "shop:orders"]);
    expect(ancestorsOf("config")).toEqual([]);
  });
});
