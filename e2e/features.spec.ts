import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { box, choose, optionTexts } from "./dropdown";
import { stubBackend } from "./stub";

// Specs for the quality-of-life work planned after v0.2.0. They are marked
// fixme so CI stays green; each one is switched on (fixme removed) in the same
// change that builds its feature.

const keys = [
  "shop:cart:123",
  "shop:cart:124",
  "shop/orders/7",
  "shop/orders/9",
  "config",
];

async function openBrowse(page: Page) {
  await stubBackend(page, keys);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page.getByLabel("Switch connection").waitFor();
}

// Records what the app writes to the clipboard, which WebKit won't let a test read.
async function captureClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void w.__copied.push(t) },
      configurable: true,
    });
  });
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test.describe("split on several characters", () => {
  test("':/' puts keys with either separator in one tree", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill(":/");
    const tree = page.getByRole("tree", { name: "Keys" });
    await expect(tree.getByRole("treeitem", { name: /^shop/ })).toHaveCount(1);
    await tree.getByRole("button", { name: /^shop/ }).click();
    await expect(tree.getByRole("button", { name: /^cart/ })).toBeVisible();
    await expect(tree.getByRole("button", { name: /^orders/ })).toBeVisible();
  });

  test("a single ':' keeps '/' keys as plain names", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill(":");
    await expect(
      page.getByRole("button", { name: "shop/orders/9" }),
    ).toBeVisible();
  });
});

test.describe("copying", () => {
  test("right-click copies the key name and confirms it", async ({ page }) => {
    await captureClipboard(page);
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page
      .getByRole("button", { name: "shop/orders/9" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy key name" }).click();
    expect(await copied(page)).toEqual(["shop/orders/9"]);
    await expect(page.getByRole("status")).toContainText("Copied");
  });

  test("the notice floats and does not move the page", async ({ page }) => {
    await captureClipboard(page);
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    const top = () =>
      page.locator(".app").evaluate((el) => el.getBoundingClientRect().top);
    const before = await top();
    await page.getByRole("button", { name: "Copy key" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCSS("position", "fixed");
    expect(await top()).toBe(before);
  });

  test("Shift+Cmd/Ctrl+C copies the selected key", async ({ page }) => {
    await captureClipboard(page);
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.keyboard.press("ControlOrMeta+Shift+C");
    expect(await copied(page)).toEqual(["config"]);
  });

  test("the Copy buttons confirm too", async ({ page }) => {
    await captureClipboard(page);
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.getByRole("button", { name: "Copy value" }).click();
    expect(await copied(page)).toEqual(["hello world"]);
    await expect(page.getByRole("status")).toContainText("Copied");
  });
});

test.describe("resume on launch", () => {
  test("reopening goes back to the same connection, folder and key", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.locator('button.row[data-folder="shop"]').click();
    await page.locator('button.row[data-folder="shop:cart"]').click();
    await page.getByRole("button", { name: "123" }).click();
    await page.reload();
    await expect(box(page, "Switch connection")).toHaveAttribute(
      "data-value",
      "1",
    );
    await expect(
      page.getByRole("heading", { name: "shop:cart:123" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "123" })).toBeVisible();
  });

  test("a server that is down lands on the picker with the reason", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.addInitScript(() => {
      (window as unknown as { __FAIL_CONNECT__: boolean }).__FAIL_CONNECT__ =
        true;
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Pick a connection" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("Connection refused");
  });

  test("Choose another cancels the automatic reconnect", async ({ page }) => {
    await openBrowse(page);
    await page.addInitScript(() => {
      (window as unknown as { __CONNECT_DELAY__: number }).__CONNECT_DELAY__ =
        1500;
    });
    await page.reload();
    await page.getByRole("button", { name: "Choose another" }).click();
    await expect(
      page.getByRole("heading", { name: "Pick a connection" }),
    ).toBeVisible();
    // The late connection must not pull the user into browsing afterwards.
    await page.waitForTimeout(2000);
    await expect(
      page.getByRole("heading", { name: "Pick a connection" }),
    ).toBeVisible();
  });

  test("disconnecting on purpose is not resumed", async ({ page }) => {
    await openBrowse(page);
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Pick a connection" }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("quick open", () => {
  const dialog = (page: Page) =>
    page.getByRole("dialog", { name: "Quick open" });

  test("Cmd/Ctrl+K finds a key by a few letters and reveals it", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.keyboard.press("ControlOrMeta+K");
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole("combobox").fill("orders");
    await expect(dialog(page).getByRole("option")).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "shop/orders/9" }),
    ).toBeVisible();
  });

  test("Escape closes it without changing the selection", async ({ page }) => {
    await openBrowse(page);
    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });

  test("with nothing typed it lists recent keys", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.keyboard.press("ControlOrMeta+K");
    await expect(
      dialog(page).getByRole("option", { name: "config" }),
    ).toBeVisible();
  });

  test("it can switch connection", async ({ page }) => {
    await openBrowse(page);
    await page.keyboard.press("ControlOrMeta+K");
    await dialog(page).getByRole("combobox").fill("valkey");
    await dialog(page)
      .getByRole("option", { name: /local-valkey/ })
      .click();
    await expect(box(page, "Switch connection")).toHaveAttribute(
      "data-value",
      "2",
    );
  });

  test("a miss says so", async ({ page }) => {
    await openBrowse(page);
    await page.keyboard.press("ControlOrMeta+K");
    await dialog(page).getByRole("combobox").fill("zzzz");
    await expect(dialog(page).getByText("No matches.")).toBeVisible();
  });
});

test.describe("live TTL", () => {
  async function openTemp(page: Page) {
    await page.clock.install();
    await stubBackend(page, ["temp:token"]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "temp:token" }).click();
  }

  test("the TTL counts down while you watch", async ({ page }) => {
    await openTemp(page);
    await expect(page.getByText("TTL 1m 30s")).toBeVisible();
    await page.clock.fastForward(30_000);
    await expect(page.getByText("TTL 1m")).toBeVisible();
  });

  test("when the time is up the page says the key is gone", async ({
    page,
  }) => {
    await openTemp(page);
    await page.clock.fastForward(95_000);
    await expect(
      page.getByRole("heading", { name: "This key no longer exists" }),
    ).toBeVisible();
    await expect(page.getByText("hello world")).toHaveCount(0);
  });

  test("the tree row counts down and then says expired", async ({ page }) => {
    await openTemp(page);
    const ttl = page.locator(".row__ttl");
    await expect(ttl).toHaveText("2m");
    await page.clock.fastForward(40_000);
    await expect(ttl).toHaveText("50s");
    await page.clock.fastForward(60_000);
    await expect(ttl).toHaveText("expired");
  });

  test("the refresh button rescans and the caption shows the scan age", async ({
    page,
  }) => {
    await openTemp(page);
    await expect(page.getByText("Scanned just now")).toBeVisible();
    await page.clock.fastForward(125_000);
    await expect(page.getByText("Scanned 2m ago")).toBeVisible();
    await page.getByRole("button", { name: "Refresh keys" }).click();
    await expect(page.getByText("Scanned just now")).toBeVisible();
  });

  test("a key with no expiry shows it and does not tick", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await expect(page.getByText("No expiry")).toBeVisible();
  });
});

test.describe("pinned keys", () => {
  const pinned = (page: Page) =>
    page.getByRole("region", { name: "Pinned keys" });

  test("the Pin button pins the open key and lists it in the sidebar", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pinned" })).toBeVisible();
    await expect(
      pinned(page).getByRole("button", { name: "config", exact: true }),
    ).toBeVisible();
  });

  test("right-click pins, and a pin jumps to its key inside folders", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.locator('button.row[data-folder="shop"]').click();
    await page.locator('button.row[data-folder="shop:cart"]').click();
    await page.getByRole("button", { name: "123" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin key" }).click();
    await page.getByRole("button", { name: "config" }).click();
    await pinned(page)
      .getByRole("button", { name: "shop:cart:123", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "shop:cart:123" }),
    ).toBeVisible();
  });

  test("unpinning removes it", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await page.getByRole("button", { name: "Unpin config" }).click();
    await expect(pinned(page)).toHaveCount(0);
  });

  test("pins stay after a reload and belong to one connection", async ({
    page,
  }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await page.reload();
    await expect(
      pinned(page).getByRole("button", { name: "config", exact: true }),
    ).toBeVisible();
    await choose(page, "Switch connection", "2");
    await expect(pinned(page)).toHaveCount(0);
  });

  test("quick open lists pins first", async ({ page }) => {
    await openBrowse(page);
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "config" }).click();
    await page.getByRole("button", { name: "Pin", exact: true }).click();
    await page.keyboard.press("ControlOrMeta+K");
    const box = page.getByRole("dialog", { name: "Quick open" });
    await expect(box.getByText("Pinned")).toBeVisible();
    await expect(box.getByRole("option", { name: "config" })).toBeVisible();
  });
});

test.describe("find in value", () => {
  async function open(page: Page, key: string) {
    await stubBackend(page, [key]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: key }).first().click();
  }
  const find = (page: Page) => page.getByLabel("Find in value");

  test("highlights matches in JSON and counts them", async ({ page }) => {
    await open(page, "doc:1");
    await find(page).fill("sku");
    await expect(page.locator("mark")).toHaveCount(2);
    await expect(page.getByRole("status").filter({ hasText: "of" })).toHaveText(
      "1 of 2",
    );
  });

  test("Enter steps to the next match and wraps; Shift+Enter goes back", async ({
    page,
  }) => {
    await open(page, "doc:1");
    await find(page).fill("sku");
    const status = page.locator(".find__count");
    await find(page).press("Enter");
    await expect(status).toHaveText("2 of 2");
    await find(page).press("Enter");
    await expect(status).toHaveText("1 of 2");
    await find(page).press("Shift+Enter");
    await expect(status).toHaveText("2 of 2");
    await expect(page.locator('mark[data-current="true"]')).toHaveCount(1);
  });

  test("says when nothing matches, and Escape clears", async ({ page }) => {
    await open(page, "doc:1");
    await find(page).fill("zzz");
    await expect(page.locator(".find__count")).toHaveText("No matches");
    await find(page).press("Escape");
    await expect(find(page)).toHaveValue("");
    await expect(page.locator(".find__count")).toHaveCount(0);
  });

  test("a hash is filtered to the rows that match", async ({ page }) => {
    await open(page, "user:7");
    await expect(page.getByRole("row")).toHaveCount(5);
    await find(page).fill("example.com");
    await expect(page.getByRole("row")).toHaveCount(2);
    await expect(page.locator(".find__count")).toHaveText("1 of 4 rows");
    await expect(
      page.getByRole("cell", { name: "ayu@example.com" }),
    ).toBeVisible();
  });

  test("Cmd/Ctrl+Shift+F puts the cursor in the box", async ({ page }) => {
    await open(page, "doc:1");
    await expect(find(page)).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+F");
    await expect(find(page)).toBeFocused();
  });

  test("the box is searched fresh for the next key", async ({ page }) => {
    await open(page, "doc:1");
    await find(page).fill("sku");
    await page.getByRole("button", { name: "config" }).click();
    await expect(find(page)).toHaveValue("");
  });
});

test.describe("JSON folding", () => {
  async function open(page: Page) {
    await stubBackend(page, ["doc:1"]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "doc:1" }).first().click();
    await page.getByLabel("Find in value").waitFor();
  }
  // Lines of the pretty value: 3 is "items": [ , 4 and 8 are its two objects.
  const arrow = (page: Page, line: number) =>
    page.locator(`.fl[data-line="${line}"] button.fl__g`);

  test("the arrow folds a block to one line with its size and back", async ({
    page,
  }) => {
    await open(page);
    await expect(page.getByText("A-1")).toBeVisible();
    await arrow(page, 3).click();
    await expect(page.getByText("… 2 items")).toBeVisible();
    await expect(page.getByText("A-1")).toHaveCount(0);
    await arrow(page, 3).click();
    await expect(page.getByText("A-1")).toBeVisible();
    await expect(page.getByText("… 2 items")).toHaveCount(0);
  });

  test("Collapse all keeps the top level open; Expand all opens everything", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByText("… 2 items")).toBeVisible();
    await expect(page.getByText('"status"')).toBeVisible();
    await expect(page.getByText("A-1")).toHaveCount(0);
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(page.getByText("A-1")).toBeVisible();
    await expect(page.getByText("B-2")).toBeVisible();
  });

  test("find opens the fold that hides a match", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(page.getByText("B-2")).toHaveCount(0);
    await page.getByLabel("Find in value").fill("B-2");
    await expect(page.getByText("B-2")).toBeVisible();
    await expect(page.locator('mark[data-current="true"]')).toHaveCount(1);
    await expect(page.locator(".find__count")).toHaveText("1 of 1");
  });

  test("Enter steps into a folded block too", async ({ page }) => {
    await open(page);
    await page.getByLabel("Find in value").fill("sku");
    await page.getByRole("button", { name: "Collapse all" }).click();
    await page.getByLabel("Find in value").press("Enter");
    await expect(page.locator(".find__count")).toHaveText("2 of 2");
    await expect(page.getByText("B-2")).toBeVisible();
  });

  test("the Raw view has nothing to fold", async ({ page }) => {
    await open(page);
    await page.getByRole("tab", { name: "Raw" }).click();
    await expect(
      page.getByRole("button", { name: "Collapse all" }),
    ).toHaveCount(0);
    await expect(page.locator("button.fl__g")).toHaveCount(0);
  });
});

test.describe("auto-refresh", () => {
  async function open(page: Page) {
    await page.clock.install();
    await stubBackend(page, ["live:counter"]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "live:counter" }).first().click();
    await expect(page.getByText('"count"')).toBeVisible();
  }
  const pick = (page: Page, v: string) => choose(page, "Auto-refresh", v);

  test("it is off by default and the value stays put", async ({ page }) => {
    await open(page);
    await expect(box(page, "Auto-refresh")).toHaveAttribute("data-value", "0");
    await expect(page.locator(".live")).toHaveCount(0);
    await page.clock.fastForward(30_000);
    await expect(page.locator(".fl", { hasText: '"count": 1' })).toBeVisible();
  });

  test("on, it re-reads the key every N seconds", async ({ page }) => {
    await open(page);
    await pick(page, "2");
    await expect(page.locator(".live")).toContainText("Live");
    await page.clock.fastForward(2_100);
    await expect(page.locator(".fl", { hasText: '"count": 2' })).toBeVisible();
    await page.clock.fastForward(2_100);
    await expect(page.locator(".fl", { hasText: '"count": 3' })).toBeVisible();
  });

  test("a changed line flashes and an unchanged one does not", async ({
    page,
  }) => {
    await open(page);
    await pick(page, "2");
    await page.clock.fastForward(2_100);
    await expect(page.locator(".fl--fresh")).toHaveCount(1);
    await expect(page.locator(".fl--fresh")).toContainText("count");
  });

  test("a value that did not change does not flash", async ({ page }) => {
    await page.clock.install();
    await stubBackend(page, ["doc:1"]);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Folder delimiter").fill("");
    await page.getByRole("button", { name: "doc:1" }).first().click();
    await choose(page, "Auto-refresh", "2");
    await page.clock.fastForward(6_100);
    await expect(page.locator(".live")).toContainText("Live");
    await expect(page.locator(".fl--fresh")).toHaveCount(0);
  });

  test("the choice is remembered after a reload", async ({ page }) => {
    await open(page);
    await pick(page, "5");
    await page.reload();
    await expect(box(page, "Auto-refresh")).toHaveAttribute("data-value", "5");
  });

  test("a failed read pauses it and keeps the last value on screen", async ({
    page,
  }) => {
    await open(page);
    await pick(page, "2");
    await page.evaluate(() => {
      (window as unknown as { __FAIL_GET__: boolean }).__FAIL_GET__ = true;
    });
    await page.clock.fastForward(2_100);
    await expect(page.locator(".live--paused")).toContainText("Paused");
    await expect(page.getByText('"count"')).toBeVisible();
    // It stays paused instead of retrying forever.
    await page.clock.fastForward(10_000);
    await expect(page.locator(".live--paused")).toBeVisible();
  });
});

test.describe("about", () => {
  const dialog = (page: Page) =>
    page.getByRole("dialog", { name: "About Fogtrail" });
  const open = async (page: Page) => {
    await stubBackend(page);
    await page.goto("/");
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    await page.waitForFunction(() => "__menu" in window);
    await page.evaluate(() =>
      (window as unknown as { __menu: (id: string) => void }).__menu("about"),
    );
  };

  test("Help > About shows the app version", async ({ page }) => {
    await open(page);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText("Version 0.2.1")).toBeVisible();
    await expect(dialog(page).getByText("MIT OR Apache-2.0")).toBeVisible();
  });

  test("Escape and Close both dismiss it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { __menu: (id: string) => void }).__menu("about"),
    );
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("Check for updates closes it and starts a check", async ({ page }) => {
    await open(page);
    await dialog(page)
      .getByRole("button", { name: "Check for updates" })
      .click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe("title bar (Windows)", () => {
  const bar = (page: Page) => page.locator("header.titlebar");
  const open = async (page: Page, custom = true) => {
    if (custom)
      await page.addInitScript(() => {
        (window as unknown as { __customTitleBar: boolean }).__customTitleBar =
          true;
      });
    await stubBackend(page);
    await page.goto("/");
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
  };
  const win = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __win?: string[] }).__win ?? [],
    );

  test("a native frame means no custom bar", async ({ page }) => {
    await open(page, false);
    await expect(bar(page)).toHaveCount(0);
  });

  test("draws the menus, a search box and window buttons", async ({ page }) => {
    await open(page);
    for (const m of ["File", "Edit", "View", "Window", "Help"])
      await expect(
        bar(page).getByRole("menuitem", { name: m, exact: true }),
      ).toBeVisible();
    await expect(
      bar(page).getByRole("button", { name: "Quick open" }),
    ).toContainText("Search keys and connections");
    for (const b of ["Minimize", "Maximize", "Close"])
      await expect(bar(page).getByRole("button", { name: b })).toBeVisible();
  });

  test("a menu item runs its action", async ({ page }) => {
    await open(page);
    await bar(page)
      .getByRole("menuitem", { name: "File", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /New Connection/ }).click();
    await expect(
      page.getByRole("heading", { name: "New connection" }),
    ).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("hovering across the bar switches the open menu", async ({ page }) => {
    await open(page);
    await bar(page)
      .getByRole("menuitem", { name: "File", exact: true })
      .click();
    await bar(page)
      .getByRole("menuitem", { name: "View", exact: true })
      .hover();
    await expect(page.getByRole("menu", { name: "View" })).toBeVisible();
    await expect(page.getByRole("menu", { name: "File" })).toHaveCount(0);
  });

  test("Alt+F opens File and the keyboard drives it", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Alt+F");
    await expect(page.getByRole("menu", { name: "File" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu", { name: "Edit" })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // The second File item is Connections: with no connection it shows the picker.
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Escape and clicking away close a menu", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Alt+V");
    await expect(page.getByRole("menu", { name: "View" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("Alt+H");
    await expect(page.getByRole("menu", { name: "Help" })).toBeVisible();
    await page.mouse.click(600, 400);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Help > About opens the About dialog", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Alt+H");
    await page.getByRole("menuitem", { name: "About Fogtrail" }).click();
    await expect(
      page.getByRole("dialog", { name: "About Fogtrail" }),
    ).toBeVisible();
  });

  test("the search box opens Quick open", async ({ page }) => {
    await open(page);
    await bar(page).getByRole("button", { name: "Quick open" }).click();
    await expect(
      page.getByRole("dialog", { name: "Quick open" }),
    ).toBeVisible();
  });

  test("shortcuts the native menu gave still work", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+N");
    await expect(
      page.getByRole("heading", { name: "New connection" }),
    ).toBeVisible();
  });

  test("the window buttons ask the window", async ({ page }) => {
    await open(page);
    await bar(page).getByRole("button", { name: "Minimize" }).click();
    await bar(page).getByRole("button", { name: "Maximize" }).click();
    await bar(page).getByRole("button", { name: "Close" }).click();
    expect(await win(page)).toEqual(["minimize", "toggle_maximize", "close"]);
  });

  test("F11 hides the bar in full screen and brings it back", async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press("F11");
    await expect(bar(page)).toBeHidden();
    // No menu to open while the bar is hidden.
    await page.keyboard.press("Alt+F");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.keyboard.press("F11");
    await expect(bar(page)).toBeVisible();
    // The bar hides before the window goes full screen, and shows before it leaves.
    expect(await win(page)).toEqual([
      "toggle_fullscreen (bar hidden)",
      "toggle_fullscreen (bar shown)",
    ]);
  });

  // The backend restores and re-maximizes (src-tauri/src/window.rs); the page
  // only asks once each way and doesn't touch maximize itself.
  test("full screen from maximized is one call each way", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __maximized: boolean }).__maximized = true;
    });
    await open(page);
    await page.keyboard.press("F11");
    await expect(bar(page)).toBeHidden();
    await page.keyboard.press("F11");
    await expect(bar(page)).toBeVisible();
    await expect(
      bar(page).getByRole("button", { name: "Restore" }),
    ).toBeVisible();
    expect(await win(page)).toEqual([
      "toggle_fullscreen (bar hidden)",
      "toggle_fullscreen (bar shown)",
    ]);
  });

  test("shows the connection and key once browsing", async ({ page }) => {
    await open(page);
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByText("config").first().waitFor();
    await expect(
      bar(page).getByRole("button", { name: "Quick open" }),
    ).toContainText("eCMS Standard - UAT");
    await page.getByText("config").first().click();
    await expect(
      bar(page).getByRole("button", { name: "Quick open" }),
    ).toContainText("› config");
  });
});

test.describe("database picker and server info", () => {
  async function open(page: Page, count?: number | null) {
    if (count !== undefined) {
      await page.addInitScript((n) => {
        (window as unknown as { __DB_COUNT__: number | null }).__DB_COUNT__ = n;
      }, count);
    }
    await openBrowse(page);
  }

  test("a server with several databases gets a small picker beside search", async ({
    page,
  }) => {
    await open(page);
    const picker = box(page, "Database");
    await expect(picker).toBeAttached();
    const texts = await optionTexts(page, "Database");
    expect(texts).toHaveLength(16);
    expect(texts[0]).toMatch(/^db0 · \d+ keys$/);
    // Closed, it shows only the name, and it sits in the search row.
    await expect(picker).toHaveText("db0");
    await expect(
      page.locator(".filter").getByLabel("Search keys"),
    ).toBeVisible();
  });

  test("a one-database server has no picker at all", async ({ page }) => {
    await open(page, 1);
    await expect(page.getByLabel("Search keys")).toBeVisible();
    await expect(page.getByLabel("Database")).toHaveCount(0);
  });

  test("a server that will not say lists only databases with keys", async ({
    page,
  }) => {
    await open(page, null);
    // The stub has keys in db0 only, so there is nothing to choose.
    await expect(page.getByLabel("Database")).toHaveCount(0);
  });

  test("the version in the card opens and closes Server info", async ({
    page,
  }) => {
    await open(page, 1);
    const version = page.getByRole("button", { name: "Redis 6.2.14" });
    await expect(version).toHaveAttribute("aria-pressed", "false");
    await version.click();
    await expect(version).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: /Redis/ }).first(),
    ).toBeVisible();
    await version.click();
    await expect(version).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("memory meter", () => {
  test("Server info shows how full memory is", async ({ page }) => {
    await openBrowse(page);
    await page.getByRole("button", { name: "Redis 6.2.14" }).click();
    await expect(page.getByText("24.6 MB of 28.6 MB")).toBeVisible();
    const meter = page.getByRole("meter", { name: "Memory used" });
    await expect(meter).toHaveAttribute("aria-valuenow", "86");
    await expect(meter).toHaveClass(/meter--warn/);
    await expect(page.getByText("· 86%")).toBeVisible();
  });
});

test.describe("type filter and sort", () => {
  async function open(page: Page, names: string[]) {
    await page.clock.install();
    await stubBackend(page, names);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect", exact: true })
      .first()
      .click();
    await page.getByLabel("Switch connection").waitFor();
    await page.getByLabel("Folder delimiter").fill("");
  }
  const rows = (page: Page) => page.locator("button.row .row__label");

  test("a type chip limits the list to that type, and All brings it back", async ({
    page,
  }) => {
    await open(page, ["hash:a", "hash:b", "plain"]);
    await expect(rows(page).filter({ hasText: "plain" })).toHaveCount(1);
    await page.getByRole("button", { name: "HASH", exact: true }).click();
    await expect(rows(page)).toHaveText(["hash:a", "hash:b"]);
    await expect(page.getByText("Hashes · 2")).toBeVisible();
    await page.getByRole("button", { name: "All" }).click();
    await expect(rows(page).filter({ hasText: "plain" })).toHaveCount(1);
  });

  test("Expiry shows keys with a TTL, soonest first, as a flat list", async ({
    page,
  }) => {
    await open(page, ["plain", "temp:x", "soon:y"]);
    await choose(page, "Sort keys", "expiry");
    await expect(rows(page)).toHaveText(["soon:y", "temp:x"]);
    await expect(page.getByText(/Expiring · 2/)).toBeVisible();
    await choose(page, "Sort keys", "name");
    await expect(rows(page).filter({ hasText: "plain" })).toHaveCount(1);
  });

  test("filter and sort are forgotten on a new connection", async ({
    page,
  }) => {
    await open(page, ["hash:a", "plain"]);
    await page.getByRole("button", { name: "HASH", exact: true }).click();
    await choose(page, "Sort keys", "expiry");
    await choose(page, "Switch connection", "2");
    await expect(box(page, "Switch connection")).toHaveAttribute(
      "data-value",
      "2",
    );
    await expect(box(page, "Sort keys")).toHaveAttribute("data-value", "name");
    await expect(page.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
