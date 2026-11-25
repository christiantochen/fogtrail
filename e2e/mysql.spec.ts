import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { box, choose, optionTexts } from "./dropdown";
import { stubBackend } from "./stub";

async function openShop(page: Page) {
  await stubBackend(page, [], { mysql: true });
  await page.goto("/");
  await page
    .locator(".card")
    .filter({ hasText: "shop-prod" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByRole("list", { name: "Tables" }).waitFor();
}

const table = (page: Page, name: string) =>
  page.getByRole("list", { name: "Tables" }).getByRole("button", { name });
const rowCalls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __rowCalls: { table: string; offset: number; count?: number }[];
        }
      ).__rowCalls,
  );

test.describe("browsing MySQL", () => {
  test("opens the profile's database and lists its tables with estimates", async ({
    page,
  }) => {
    await openShop(page);
    await expect(box(page, "Database")).toHaveAttribute("data-value", "shop");
    await expect(table(page, /^orders/)).toContainText("~48k");
    await expect(table(page, /^paying_customers/)).toContainText("view");
    await expect(table(page, /^paying_customers/)).not.toContainText("~");
    // It is a SQL screen, not the key browser.
    await expect(page.getByLabel("Search keys")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Pick a table to read it" }),
    ).toBeVisible();
    await expect(
      page.getByText("Read-only transaction. Writes blocked."),
    ).toBeVisible();
  });

  test("a table shows its rows, with NULL kept apart from an empty string", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    await expect(page.getByRole("heading", { name: "orders" })).toBeVisible();
    // The header carries no chips any more; the facts moved to the Structure tab.
    await expect(page.locator(".chip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy name" })).toHaveCount(
      0,
    );
    const grid = page.getByRole("table", { name: "Rows of orders" });
    await expect(
      grid.getByRole("columnheader", { name: /id bigint unsigned · PK/ }),
    ).toBeVisible();
    await expect(
      grid.getByRole("columnheader", { name: /notes varchar\(255\) · null/ }),
    ).toBeVisible();
    // Row 1 has NULL notes; row 3 has an empty string, which is blank, not NULL.
    await expect(grid.getByRole("cell", { name: "NULL" })).toHaveCount(1);
    await expect(grid.getByRole("cell", { name: "184.50" })).toHaveClass(/num/);
    await expect(page.getByText("Rows 1–3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next 100" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  test("MySQL has no separate Indexes tab", async ({ page }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    await expect(page.getByRole("tab", { name: "Structure" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Indexes" })).toHaveCount(0);
  });

  test("Structure lists columns, indexes and foreign keys", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    await page.getByRole("tab", { name: "Structure" }).click();
    const cols = page.getByRole("table", { name: "Columns" });
    await expect(
      cols.getByRole("row", { name: /^id bigint unsigned NO PRI/ }),
    ).toContainText("auto_increment");
    await expect(cols.getByRole("row", { name: /^status enum/ })).toContainText(
      "pending",
    );
    // A NOT NULL column has no default to show; only a nullable one defaults to NULL.
    await expect(
      cols.getByRole("row", { name: /^notes varchar\(255\) YES NULL/ }),
    ).toBeVisible();
    await expect(
      cols.getByRole("row", { name: /^total decimal\(10,2\) NO$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Indexes" }).getByRole("row", {
        name: /idx_customer customer_id NO BTREE/,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: "Foreign keys" })
        .getByRole("cell", { name: "shop.customers (id)" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Data" }).click();
    await expect(
      page.getByRole("table", { name: "Rows of orders" }),
    ).toBeVisible();
  });

  test("a long table pages 100 rows at a time", async ({ page }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await expect(page.getByText("Rows 1–100")).toBeVisible();
    const next = page.getByRole("button", { name: "Next 100" });
    const prev = page.getByRole("button", { name: "Previous" });
    await expect(prev).toBeDisabled();
    await next.click();
    await expect(page.getByText("Rows 101–200")).toBeVisible();
    await next.click();
    await expect(page.getByText("Rows 201–250")).toBeVisible();
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(page.getByText("Rows 101–200")).toBeVisible();
    expect((await rowCalls(page)).map((c) => c.offset)).toEqual([
      0, 100, 200, 100,
    ]);
  });

  test("the page size can be 250 or 500, and the footer says when rows were read", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await expect(page.getByText("Rows 1–100")).toBeVisible();
    await expect(page.getByText(/Updated \d\d:\d\d:\d\d/)).toBeVisible();
    expect(await optionTexts(page, "Rows per page")).toEqual([
      "100",
      "250",
      "500",
    ]);
    await choose(page, "Rows per page", "250");
    await expect(page.getByText("Rows 1–250")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next 250" })).toBeDisabled();
    expect((await rowCalls(page)).map((c) => c.count)).toEqual([100, 250]);
  });

  test("a new page size goes back to the first page and is kept per connection", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await page.getByRole("button", { name: "Next 100" }).click();
    await expect(page.getByText("Rows 101–200")).toBeVisible();
    await choose(page, "Rows per page", "250");
    await expect(page.getByText("Rows 1–250")).toBeVisible();
    // Another table, and back: the size is still 250.
    await table(page, /^orders/).click();
    await expect(page.getByText("Rows 1–3")).toBeVisible();
    await table(page, /^events/).click();
    await expect(page.getByText("Rows 1–250")).toBeVisible();
    // It is saved under this connection's id, not for every connection.
    const saved = await page.evaluate(() =>
      Object.entries(localStorage).filter(([k]) =>
        k.startsWith("fogtrail.pageSize."),
      ),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0][0]).toMatch(/^fogtrail\.pageSize\.\S+$/);
    expect(saved[0][1]).toBe("250");
  });

  test("the saved page size comes back when the connection is opened again", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await choose(page, "Rows per page", "250");
    await expect(page.getByText("Rows 1–250")).toBeVisible();
    // A restart reconnects on its own; the size comes back with the connection.
    await page.reload();
    await page.getByRole("list", { name: "Tables" }).waitFor();
    await table(page, /^events/).click();
    await expect(page.getByText("Rows 1–250")).toBeVisible();
  });

  test("the page size cannot change while rows are loading", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await expect(page.getByText("Rows 1–100")).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __rowDelay: number }).__rowDelay = 1500;
    });
    await page.getByRole("button", { name: "Next 100" }).click();
    await expect(box(page, "Rows per page")).toBeDisabled();
    await expect(page.getByText("Rows 101–200")).toBeVisible();
    await expect(box(page, "Rows per page")).toBeEnabled();
  });

  test("opening another table starts at its first page", async ({ page }) => {
    await openShop(page);
    await table(page, /^events/).click();
    await page.getByRole("button", { name: "Next 100" }).click();
    await expect(page.getByText("Rows 101–200")).toBeVisible();
    await table(page, /^orders/).click();
    await expect(page.getByText("Rows 1–3")).toBeVisible();
  });

  test("the filter narrows the list, and says so when nothing matches", async ({
    page,
  }) => {
    await openShop(page);
    await page.getByLabel("Filter tables").fill("ORD");
    await expect(
      page.getByRole("list", { name: "Tables" }).getByRole("listitem"),
    ).toHaveCount(1);
    await expect(page.getByText("Tables · 1")).toBeVisible();
    await page.getByLabel("Filter tables").fill("zzz");
    await expect(page.getByText("No table matches.")).toBeVisible();
  });

  test("a table name with a space and a keyword-like column both work", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^weird name/).click();
    await expect(
      page.getByRole("heading", { name: "weird name" }),
    ).toBeVisible();
  });

  test("built-in databases stay hidden until asked for", async ({ page }) => {
    await openShop(page);
    expect(await optionTexts(page, "Database")).toEqual(["analytics", "shop"]);
    await page.getByRole("button", { name: "Show system databases" }).click();
    expect(await optionTexts(page, "Database")).toEqual([
      "analytics",
      "information_schema",
      "mysql",
      "shop",
    ]);
    await expect(
      page.getByRole("button", { name: "Show system databases" }),
    ).toHaveCount(0);
  });

  test("another database with no tables says so, and clears the open table", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    await choose(page, "Database", "analytics");
    await expect(page.getByText("This database has no tables.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pick a table to read it" }),
    ).toBeVisible();
  });

  test("a failed read shows the server's message and can be retried", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __FAIL_ROWS__: boolean }).__FAIL_ROWS__ = true;
    });
    await openShop(page);
    await table(page, /^orders/).click();
    await expect(page.getByRole("alert")).toContainText(
      "SELECT command denied to user",
    );
    await page.evaluate(() => {
      (window as unknown as { __FAIL_ROWS__: boolean }).__FAIL_ROWS__ = false;
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Rows 1–3")).toBeVisible();
  });

  test("the trail names the connection, database and table", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    const trail = page.getByRole("navigation", { name: "Trail" });
    await expect(trail).toContainText("shop-prod");
    await expect(
      trail.getByRole("button", { name: "shop", exact: true }),
    ).toBeVisible();
    await expect(trail.getByText("orders")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await trail.getByRole("button", { name: "shop", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Pick a table to read it" }),
    ).toBeVisible();
  });

  test("Ctrl+K opens table search, and Enter opens the table", async ({
    page,
  }) => {
    await openShop(page);
    await page.keyboard.press("Control+k");
    const quick = page.getByRole("dialog", { name: "Quick open" });
    const input = quick.getByRole("combobox");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute(
      "placeholder",
      "Search tables and connections",
    );
    await input.fill("cust");
    await expect(quick.getByRole("option")).toContainText([
      "shop.customers",
      "shop.paying_customers",
    ]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(quick).toHaveCount(0);
    await expect(
      page.getByRole("table", { name: "Rows of paying_customers" }),
    ).toBeVisible();
  });

  test("the Structure tab holds the engine and kind that used to be chips", async ({
    page,
  }) => {
    await openShop(page);
    await table(page, /^orders/).click();
    await page.getByRole("tab", { name: "Structure" }).click();
    const facts = page.locator(".sqlfacts");
    await expect(facts).toContainText("Table");
    await expect(facts).toContainText("InnoDB");
  });

  test("Shift+Ctrl+C copies database.table", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void w.__copied.push(t) },
        configurable: true,
      });
    });
    await openShop(page);
    await table(page, /^orders/).click();
    await page.keyboard.press("Control+Shift+C");
    expect(
      await page.evaluate(
        () => (window as unknown as { __copied: string[] }).__copied,
      ),
    ).toEqual(["shop.orders"]);
  });
});

test.describe("the connection list", () => {
  test("marks MySQL connections", async ({ page }) => {
    await stubBackend(page, [], { mysql: true });
    await page.goto("/");
    const row = page
      .getByRole("navigation", { name: "Saved connections" })
      .getByRole("button", { name: /shop-prod/ });
    await expect(row).toContainText("MySQL");
    await expect(row).toContainText("db.internal:3306");
  });
});
