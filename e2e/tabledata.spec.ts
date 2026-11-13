import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function openOrders(page: Page) {
  await stubBackend(page, [], { mysql: true });
  await page.goto("/");
  await page
    .locator(".card")
    .filter({ hasText: "shop-prod" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByRole("list", { name: "Tables" }).waitFor();
  await page
    .getByRole("list", { name: "Tables" })
    .getByRole("button", { name: /^orders/ })
    .click();
  await page.getByRole("table", { name: "Rows of orders" }).waitFor();
}

const filterBox = (page: Page) => page.getByLabel("WHERE filter");
const apply = (page: Page) => page.getByRole("button", { name: /^Apply/ });
const views = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __rowViews: unknown[] }).__rowViews,
  );

test.describe("the table's data view", () => {
  test("shows JSON as a chip and a timestamp with a quiet time", async ({
    page,
  }) => {
    await openOrders(page);
    const grid = page.getByRole("table", { name: "Rows of orders" });
    const first = grid.locator("tbody tr").nth(0);
    await expect(first.locator(".jchip")).toHaveText("{ } 2 items");
    await expect(grid.locator("tbody tr").nth(1).locator(".jchip")).toHaveText(
      "{ } 1 key",
    );
    await expect(first.locator(".sqlgrid__time")).toHaveText("09:42:07");
    // The full value is still there on hover.
    await expect(first.locator("td").nth(6)).toHaveAttribute(
      "title",
      "2026-11-11 09:42:07",
    );
  });

  test("a click on a heading sorts up, then down, then back", async ({
    page,
  }) => {
    await openOrders(page);
    const total = page.getByRole("columnheader", { name: /total/ });
    const ids = () =>
      page
        .getByRole("table", { name: "Rows of orders" })
        .locator("tbody tr td:first-child")
        .allTextContents();
    await expect(await ids()).toEqual(["48213", "48212", "48211"]);

    await total.getByRole("button", { name: /^total/ }).click();
    await expect(total).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(ids).toEqual(["48212", "48213", "48211"]);

    await total.getByRole("button", { name: /^total/ }).click();
    await expect(total).toHaveAttribute("aria-sort", "descending");
    await expect.poll(ids).toEqual(["48211", "48213", "48212"]);

    await total.getByRole("button", { name: /^total/ }).click();
    await expect(total).not.toHaveAttribute("aria-sort", /.+/);
    await expect.poll(ids).toEqual(["48213", "48212", "48211"]);

    const last = (await views(page)).at(-1);
    expect(last).toEqual({});
  });
});

test.describe("the WHERE filter", () => {
  test("starts empty and says what it is", async ({ page }) => {
    await openOrders(page);
    await expect(filterBox(page)).toHaveValue("");
    await expect(page.getByText("WHERE", { exact: true })).toBeVisible();
    // Nothing to clear yet, and no hint line under the box.
    await expect(
      page.getByRole("button", { name: "Clear filter" }),
    ).toHaveCount(0);
    await expect(page.getByText(/checked like the query editor/)).toHaveCount(
      0,
    );
  });

  test("the button says Refresh until the text changes, then Apply", async ({
    page,
  }) => {
    await openOrders(page);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeVisible();
    await expect(apply(page)).toHaveCount(0);
    const before = (await views(page)).length;
    await refresh.click();
    await expect
      .poll(async () => (await views(page)).length)
      .toBeGreaterThan(before);
    await filterBox(page).fill("status = 'paid'");
    await expect(apply(page)).toBeVisible();
    await expect(refresh).toHaveCount(0);
    await apply(page).click();
    // Applied and unchanged again: back to Refresh.
    await expect(refresh).toBeVisible();
  });

  test("Esc in the box clears and applies in one step", async ({ page }) => {
    await openOrders(page);
    await filterBox(page).fill("status = 'paid'");
    await filterBox(page).press("Enter");
    await expect(page.getByText("Filtered · Rows 1–2")).toBeVisible();
    await filterBox(page).press("Escape");
    await expect(filterBox(page)).toHaveValue("");
    await expect(
      page.getByRole("table", { name: "Rows of orders" }).locator("tbody tr"),
    ).toHaveCount(3);
    expect((await views(page)).at(-1)).toEqual({});
  });

  test("Enter applies it, the rows narrow, and the backend is asked", async ({
    page,
  }) => {
    await openOrders(page);
    await filterBox(page).fill("status = 'paid'");
    await filterBox(page).press("Enter");
    const rows = page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("Filtered · Rows 1–2")).toBeVisible();
    expect((await views(page)).at(-1)).toEqual({ filter: "status = 'paid'" });
  });

  test("the × in the box brings every row back", async ({ page }) => {
    await openOrders(page);
    await filterBox(page).fill("status = 'paid'");
    await apply(page).click();
    await expect(page.getByText("Filtered · Rows 1–2")).toBeVisible();
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(filterBox(page)).toHaveValue("");
    await expect(
      page.getByRole("table", { name: "Rows of orders" }).locator("tbody tr"),
    ).toHaveCount(3);
    expect((await views(page)).at(-1)).toEqual({});
  });

  test("colours the text as it is typed", async ({ page }) => {
    await openOrders(page);
    await filterBox(page).fill("status = 'paid' AND total > 100");
    const colors = page.locator(".filterbar__colors");
    await expect(colors.locator(".tk-str")).toHaveText("'paid'");
    await expect(colors.locator(".tk-kw")).toHaveText("AND");
    await expect(colors.locator(".tk-num")).toHaveText("100");
  });

  test("no matches says so and keeps the filter to clear", async ({ page }) => {
    await openOrders(page);
    await filterBox(page).fill("nomatch = 1");
    await apply(page).click();
    await expect(
      page.getByText("No rows match this filter. Clear it to see all rows."),
    ).toBeVisible();
    await expect(page.getByText("Filtered · No rows")).toBeVisible();
  });

  test("a blocked filter says nothing was sent and keeps the text", async ({
    page,
  }) => {
    await openOrders(page);
    await filterBox(page).fill("1=1; DROP TABLE orders");
    await apply(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Blocked.");
    await expect(alert).toContainText("Nothing was sent to the server.");
    await expect(filterBox(page)).toHaveValue("1=1; DROP TABLE orders");
    await expect(
      page.getByRole("table", { name: "Rows of orders" }),
    ).toHaveCount(0);
    // No retry button for a filter: fixing the text is the way forward.
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
      0,
    );
  });

  test("a server error is shown in the server's words, and fixing it recovers", async ({
    page,
  }) => {
    await openOrders(page);
    await filterBox(page).fill("boom > 1");
    await apply(page).click();
    await expect(page.getByRole("alert")).toContainText(
      "Unknown column 'boom' in 'where clause'",
    );
    await expect(page.getByRole("alert")).not.toContainText("Blocked.");
    await filterBox(page).fill("status = 'paid'");
    await apply(page).click();
    await expect(
      page.getByRole("table", { name: "Rows of orders" }).locator("tbody tr"),
    ).toHaveCount(2);
  });

  test("a different table starts with no filter", async ({ page }) => {
    await openOrders(page);
    await filterBox(page).fill("status = 'paid'");
    await apply(page).click();
    await expect(page.getByText("Filtered · Rows 1–2")).toBeVisible();
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^events/ })
      .click();
    await expect(filterBox(page)).toHaveValue("");
  });

  test("the query editor has no filter bar", async ({ page }) => {
    await openOrders(page);
    await page.getByRole("button", { name: "Query editor" }).click();
    await expect(filterBox(page)).toHaveCount(0);
  });
});

test.describe("the row panel", () => {
  test("a click opens the row, JSON is laid out, Esc closes it", async ({
    page,
  }) => {
    await openOrders(page);
    await page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .nth(0)
      .click();
    const panel = page.getByRole("complementary", { name: "Row details" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Row 1 of 3");
    await expect(panel).toContainText("orders · id 48213");
    await expect(panel.getByText("184.50")).toBeVisible();
    await expect(panel.getByText("NULL")).toBeVisible();
    // The JSON is folded one level: the items are there, their fields are not.
    const code = panel.locator(".code").first();
    await expect(code).toContainText("2 fields");
    await expect(code).not.toContainText('"sku"');
    await code.getByRole("button", { name: "Expand block" }).first().click();
    await expect(code).toContainText('"sku": "BK-114"');
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("a text column that holds JSON is shown as JSON, plain words are not", async ({
    page,
  }) => {
    await openOrders(page);
    const rows = page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr");
    const panel = page.getByRole("complementary", { name: "Row details" });
    await rows.nth(0).click();
    const meta = panel.locator("section.rowjson").filter({ hasText: "meta" });
    await expect(meta).toContainText("json detected");
    await expect(meta.locator(".code")).toContainText('"source": "web"');
    // The grid cell is still plain text.
    await expect(rows.nth(0).locator(".jchip")).toHaveCount(1);
    await rows.nth(1).click();
    await expect(panel.locator("section.rowjson")).toHaveCount(1);
    await expect(panel).toContainText("called twice");
    await expect(panel).not.toContainText("json detected");
  });

  test("Collapse all folds the blocks and Expand all opens them again", async ({
    page,
  }) => {
    await openOrders(page);
    const rows = page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr");
    await rows.nth(0).click();
    const panel = page.getByRole("complementary", { name: "Row details" });
    const items = panel.locator("section.rowjson").first();
    await items.getByRole("button", { name: "Expand all" }).click();
    await expect(items.locator(".code")).toContainText('"sku": "BK-207"');
    await items.getByRole("button", { name: "Collapse all" }).click();
    await expect(items.locator(".code")).not.toContainText('"sku"');
  });
});

test.describe("the row dialog", () => {
  const dialog = (page: Page) =>
    page.getByRole("dialog", { name: "Row details" });
  const panel = (page: Page) =>
    page.getByRole("complementary", { name: "Row details" });

  async function openRow(page: Page, n = 0) {
    await openOrders(page);
    await page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .nth(n)
      .click();
  }

  test("Expand opens the whole row with its JSON open, and Esc closes the dialog before the panel", async ({
    page,
  }) => {
    await openRow(page);
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d).toContainText("Row 1 of 3");
    await expect(d).toContainText("orders · id 48213");
    await expect(d.getByText("184.50")).toBeVisible();
    // Opened in full: no fold clicks needed.
    await expect(d.locator(".code").first()).toContainText('"sku": "BK-207"');
    await expect(d.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    // The panel is still there, and focus went back to the button that opened the dialog.
    await expect(panel(page)).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Expand row in a dialog" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  });

  test("the arrows move between rows inside the dialog", async ({ page }) => {
    await openRow(page);
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    await expect(
      d.getByRole("button", { name: "Previous row" }),
    ).toBeDisabled();
    await d.getByRole("button", { name: "Next row" }).click();
    await expect(d).toContainText("Row 2 of 3");
    await expect(d).toContainText("orders · id 48212");
    await expect(d.locator(".code").first()).toContainText('"gift": true');
  });

  test("E opens the dialog from the panel and from a focused row", async ({
    page,
  }) => {
    await openRow(page);
    await panel(page).getByRole("button", { name: "Next row" }).focus();
    await page.keyboard.press("e");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const row = page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .nth(1);
    await row.focus();
    await row.press("e");
    await expect(dialog(page)).toContainText("orders · id 48212");
  });

  test("a JSON value opens alone, and the fold button works there", async ({
    page,
  }) => {
    await openRow(page);
    await panel(page)
      .getByRole("button", { name: "Expand items in a dialog" })
      .click();
    const d = page.getByRole("dialog", { name: "items" });
    await expect(d).toBeVisible();
    await expect(d).toContainText("orders · id 48213 · Row 1 of 3");
    await expect(d.locator(".code")).toContainText('"sku": "BK-114"');
    await expect(d).not.toContainText("184.50");
    await d.getByRole("button", { name: "Collapse all" }).click();
    await expect(d.locator(".code")).not.toContainText('"sku"');
    await d.getByRole("button", { name: "Expand all" }).click();
    await expect(d.locator(".code")).toContainText('"sku": "BK-207"');
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
  });

  test("a click outside closes it, and Tab stays inside", async ({ page }) => {
    await openRow(page);
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      ),
    ).toBe(true);
    await page.mouse.click(5, 5);
    await expect(d).toHaveCount(0);
  });

  // Every place a column name wraps must be right after an underscore, never inside a word.
  const midWordBreaks = (page: Page) =>
    page.evaluate(() => {
      const bad: string[] = [];
      for (const dt of document.querySelectorAll(
        '[role="dialog"] .rowfields dt',
      )) {
        const node = dt.firstChild ? dt : null;
        if (!node) continue;
        const walker = document.createTreeWalker(dt, NodeFilter.SHOW_TEXT);
        let top: number | null = null;
        let prev = "";
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = t.textContent ?? "";
          for (let i = 0; i < text.length; i++) {
            const r = document.createRange();
            r.setStart(t, i);
            r.setEnd(t, i + 1);
            const rect = r.getClientRects()[0];
            if (!rect) continue;
            if (top !== null && rect.top > top + 4 && prev !== "_")
              bad.push(dt.textContent ?? "");
            top = rect.top;
            prev = text[i];
          }
        }
      }
      return bad;
    });

  test("a wide row with no JSON flows into several columns, wraps names after underscores and values in their cell", async ({
    page,
  }) => {
    await openOrders(page);
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^settings/ })
      .click();
    await page
      .getByRole("table", { name: "Rows of settings" })
      .locator("tbody tr")
      .first()
      .click();
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    await expect(d).toContainText("Columns");
    await expect(d.locator(".rowdialog__count")).toHaveText("24");
    // At this width the columns sit side by side: more than one left edge.
    const lefts = await d
      .locator(".rowfields__item")
      .evaluateAll((els) => [
        ...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))),
      ]);
    expect(lefts.length).toBeGreaterThanOrEqual(2);
    expect(await midWordBreaks(page)).toEqual([]);
    // The long location stays inside its own cell.
    const fits = await d
      .locator(".rowfields__item", { hasText: "Opposite Sample Park" })
      .locator("dd")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
  });

  test("with JSON the columns list is a fixed 360px side and names still break cleanly", async ({
    page,
  }) => {
    await openRow(page);
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    const box = await d.locator(".rowdialog__fields").boundingBox();
    expect(Math.round(box!.width)).toBe(360);
    await expect(d.locator(".rowdialog__count")).toHaveText("8");
    expect(await midWordBreaks(page)).toEqual([]);
  });

  test("a row without JSON still opens, with its columns in one list", async ({
    page,
  }) => {
    await openRow(page, 2);
    await panel(page)
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = dialog(page);
    await expect(d).toContainText("orders · id 48211");
    await expect(d.locator(".code")).toHaveCount(1);
  });

  test("the arrows move between rows, and stop at the ends", async ({
    page,
  }) => {
    await openOrders(page);
    await page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .nth(0)
      .click();
    const panel = page.getByRole("complementary", { name: "Row details" });
    await expect(
      panel.getByRole("button", { name: "Previous row" }),
    ).toBeDisabled();
    await panel.getByRole("button", { name: "Next row" }).click();
    await expect(panel).toContainText("Row 2 of 3");
    await expect(panel).toContainText("orders · id 48212");
    await panel.getByRole("button", { name: "Next row" }).click();
    await expect(
      panel.getByRole("button", { name: "Next row" }),
    ).toBeDisabled();
  });

  test("a row opens from the keyboard", async ({ page }) => {
    await openOrders(page);
    const row = page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .nth(1);
    await row.focus();
    await row.press("Enter");
    await expect(
      page.getByRole("complementary", { name: "Row details" }),
    ).toContainText("id 48212");
  });

  test("Copy rows copies the page as tab-separated text", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void w.__copied.push(t) },
        configurable: true,
      });
    });
    await openOrders(page);
    await page.getByRole("button", { name: "Copy rows" }).click();
    const copied = await page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied,
    );
    expect(copied).toHaveLength(1);
    expect(copied[0].split("\n")[0]).toBe(
      "id\tcustomer_id\tstatus\ttotal\tnotes\titems\tcreated_at\tmeta",
    );
    expect(copied[0].split("\n")).toHaveLength(4);
  });
});

test.describe("the database picker", () => {
  test("draws one focus ring, on the row, not on the box inside it", async ({
    page,
  }) => {
    await openOrders(page);
    await page.getByLabel("Database").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const rings = await page.evaluate(() => {
      const select = document.querySelector<HTMLElement>(
        '.schemapick [role="combobox"][aria-label="Database"]',
      )!;
      const row = select.closest<HTMLElement>(".schemapick")!;
      return {
        select: getComputedStyle(select).outlineStyle,
        row: getComputedStyle(row).outlineStyle,
      };
    });
    expect(rings).toEqual({ select: "none", row: "solid" });
  });
});

test.describe("a table with few columns", () => {
  test("starts at the left edge, and the row lines still reach the right", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await stubBackend(page, [], { mysql: true });
    await page.goto("/");
    await page
      .locator(".card")
      .filter({ hasText: "shop-prod" })
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await page.getByRole("list", { name: "Tables" }).waitFor();
    // `events` has two columns: id and kind.
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^events/ })
      .click();
    const grid = page.getByRole("table", { name: "Rows of events" });
    await grid.waitFor();

    const wrap = await page.locator(".sqlwrap").boundingBox();
    const id = await grid
      .getByRole("columnheader", { name: /^id/ })
      .boundingBox();
    const kind = await grid
      .getByRole("columnheader", { name: /^kind/ })
      .boundingBox();
    const row = await grid.locator("tbody tr").first().boundingBox();
    // The id column is as wide as its content (and the pin's room), not stretched across the panel.
    expect(id!.width).toBeLessThan(180);
    // The data starts at the left edge, and kind sits right next to id.
    expect(id!.x - wrap!.x).toBeLessThan(2);
    expect(kind!.x - (id!.x + id!.width)).toBeLessThan(2);
    // The row still spans the whole panel.
    expect(row!.width).toBeGreaterThan(wrap!.width - 20);
  });

  test("the query results hug their content the same way", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await stubBackend(page, [], { mysql: true });
    await page.goto("/");
    await page
      .locator(".card")
      .filter({ hasText: "shop-prod" })
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await page.getByRole("list", { name: "Tables" }).waitFor();
    await page.getByRole("button", { name: "Query editor" }).click();
    await page.getByLabel("SQL", { exact: true }).fill("SELECT * FROM orders");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const grid = page.getByRole("table", { name: "Query results" });
    await grid.waitFor();
    const wrap = await page.locator(".sqlwrap").boundingBox();
    const id = await grid.getByRole("columnheader").first().boundingBox();
    const row = await grid.locator("tbody tr").first().boundingBox();
    expect(id!.width).toBeLessThan(160);
    expect(row!.width).toBeGreaterThan(wrap!.width - 20);
  });

  test.describe("pinned columns", () => {
    const head = (page: Page, name: string) =>
      page
        .getByRole("table", { name: "Rows of orders" })
        .locator(`thead th[data-col="${name}"]`);
    const pin = (page: Page, name: string, on = true) =>
      head(page, name)
        .getByRole("button", { name: `${on ? "Pin" : "Unpin"} ${name}` })
        .click({ force: true });

    test("pinning moves a column first, and unpinning puts it back", async ({
      page,
    }) => {
      await openOrders(page);
      await pin(page, "status");
      const heads = page
        .getByRole("table", { name: "Rows of orders" })
        .locator("thead th[data-col]");
      await expect(heads.first()).toHaveAttribute("data-col", "status");
      await expect(head(page, "status")).toHaveClass(/pinned/);
      await pin(page, "status", false);
      await expect(heads.first()).toHaveAttribute("data-col", "id");
    });

    test("the pin has its own room, always shows, and never sits on the sort button", async ({
      page,
    }) => {
      await openOrders(page);
      for (const name of ["id", "status", "total", "created_at"]) {
        const h = head(page, name);
        const sort = h.locator(".sorthead");
        const pinBtn = h.getByRole("button", { name: `Pin ${name}` });
        const s = (await sort.boundingBox())!;
        const p = (await pinBtn.boundingBox())!;
        // Side by side, not overlapping.
        expect(s.x + s.width).toBeLessThanOrEqual(p.x + 0.5);
        // Visible without hovering the heading.
        expect(
          await pinBtn.evaluate((el) => Number(getComputedStyle(el).opacity)),
        ).toBeGreaterThan(0.3);
      }
    });

    test("clicking the pin pins, and does not sort", async ({ page }) => {
      await openOrders(page);
      await head(page, "status")
        .getByRole("button", { name: "Pin status" })
        .click();
      await expect(head(page, "status")).toHaveClass(/pinned/);
      await expect(head(page, "status")).not.toHaveAttribute("aria-sort", /.+/);
      expect((await views(page)).at(-1)).toEqual({});
    });

    test("a pinned column stays put when the table scrolls sideways", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 700, height: 700 });
      await openOrders(page);
      await pin(page, "id");
      const wrap = page.locator(".sqlwrap");
      const cell = page
        .getByRole("table", { name: "Rows of orders" })
        .locator("tbody tr")
        .first()
        .locator("td")
        .first();
      const before = await cell.boundingBox();
      await wrap.evaluate((el) => (el.scrollLeft = 400));
      const after = await cell.boundingBox();
      expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
    });

    test("at most three can be pinned", async ({ page }) => {
      await openOrders(page);
      for (const c of ["id", "status", "total"]) await pin(page, c);
      await expect(
        page.getByText("3 of 3 columns pinned. Unpin one to pin another."),
      ).toBeVisible();
      await expect(
        head(page, "customer_id").getByRole("button", {
          name: "Pin customer_id",
        }),
      ).toBeDisabled();
    });

    test("pins reset when another table opens", async ({ page }) => {
      await openOrders(page);
      await pin(page, "status");
      await page
        .getByRole("list", { name: "Tables" })
        .getByRole("button", { name: /^customers/ })
        .click();
      await page.getByRole("table", { name: "Rows of customers" }).waitFor();
      await expect(page.locator("th.pinned")).toHaveCount(0);
    });

    test("query results can be pinned too", async ({ page }) => {
      await stubBackend(page, [], { mysql: true });
      await page.goto("/");
      await page
        .locator(".card")
        .filter({ hasText: "shop-prod" })
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await page.getByRole("list", { name: "Tables" }).waitFor();
      await page.getByRole("button", { name: "Query editor" }).click();
      await page
        .getByLabel("SQL", { exact: true })
        .fill("SELECT * FROM orders");
      await page.getByRole("button", { name: "Run", exact: true }).click();
      const grid = page.getByRole("table", { name: "Query results" });
      await grid.waitFor();
      await grid
        .locator('thead th[data-col="status"]')
        .getByRole("button", { name: "Pin status" })
        .click({ force: true });
      await expect(grid.locator("thead th[data-col]").first()).toHaveAttribute(
        "data-col",
        "status",
      );
    });

    test("the header band is a different shade from the rows", async ({
      page,
    }) => {
      await openOrders(page);
      const bg = (sel: string) =>
        page
          .locator(sel)
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      const th = await bg(".sqlgrid thead th");
      const td = await bg(".sqlgrid tbody td");
      expect(th).not.toBe(td);
    });
  });
});
