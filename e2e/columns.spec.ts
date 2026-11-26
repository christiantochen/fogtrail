import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function open(page: Page, tableName: RegExp = /^orders/) {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void w.__copied.push(t) },
      configurable: true,
    });
  });
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
    .getByRole("button", { name: tableName })
    .click();
}

const grid = (page: Page, name = "orders") =>
  page.getByRole("table", { name: `Rows of ${name}` });
const header = (page: Page, column: string) =>
  page.locator(`thead th[data-col="${column}"]`);
const menuButton = (page: Page) =>
  page.getByRole("button", { name: /^Columns/ });
const menu = (page: Page) => page.getByRole("group", { name: "Columns" });
const tick = (page: Page, column: string) =>
  menu(page).getByRole("checkbox", { name: new RegExp(`^${column}\\b`) });
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

test.describe("hiding columns", () => {
  test("the menu lists every column and a tick hides one from the grid", async ({
    page,
  }) => {
    await open(page);
    await grid(page).waitFor();
    await menuButton(page).click();
    await expect(menu(page).getByRole("checkbox")).toHaveCount(8);
    await expect(menu(page)).toContainText("8 of 8 showing");
    await tick(page, "notes").uncheck({ force: true });
    await expect(header(page, "notes")).toHaveCount(0);
    await expect(header(page, "status")).toHaveCount(1);
    await expect(menu(page)).toContainText("7 of 8 showing");
    // The button says how many show, once some are hidden.
    await expect(menuButton(page)).toContainText("7/8");
    // The others stay in the order the table has them.
    const names = await page
      .locator("thead th[data-col]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-col")));
    expect(names).toEqual([
      "id",
      "customer_id",
      "status",
      "total",
      "items",
      "created_at",
      "meta",
    ]);
  });

  test("Show all brings everything back", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await tick(page, "notes").uncheck({ force: true });
    await tick(page, "meta").uncheck({ force: true });
    await expect(menuButton(page)).toContainText("6/8");
    await menu(page).getByRole("button", { name: "Show all" }).click();
    await expect(header(page, "notes")).toHaveCount(1);
    await expect(header(page, "meta")).toHaveCount(1);
    await expect(menuButton(page)).not.toContainText("/");
    await expect(
      menu(page).getByRole("button", { name: "Show all" }),
    ).toBeDisabled();
  });

  test("the search box narrows the list", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await menu(page).getByRole("searchbox").fill("CUST");
    await expect(menu(page).getByRole("checkbox")).toHaveCount(1);
    await expect(tick(page, "customer_id")).toBeAttached();
    await menu(page).getByRole("searchbox").fill("zzz");
    await expect(menu(page)).toContainText("No column matches.");
  });

  test("Escape closes the menu and keeps what was chosen", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await tick(page, "notes").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
    await expect(header(page, "notes")).toHaveCount(0);
  });

  test("it is remembered for the table, after a restart, and not for another table", async ({
    page,
  }) => {
    await open(page);
    await menuButton(page).click();
    // Both tables have an id column, so a list that leaked across tables would show here.
    await tick(page, "id").uncheck({ force: true });
    await tick(page, "notes").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await page.reload();
    await grid(page).waitFor();
    await expect(header(page, "id")).toHaveCount(0);
    await expect(header(page, "notes")).toHaveCount(0);
    await expect(menuButton(page)).toContainText("6/8");
    // Another table is untouched.
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^customers/ })
      .click();
    await grid(page, "customers").waitFor();
    await expect(menuButton(page)).not.toContainText("/");
    await expect(header(page, "id")).toHaveCount(1);
    // And back again, it is still as it was left.
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^orders/ })
      .click();
    await grid(page).waitFor();
    await expect(header(page, "id")).toHaveCount(0);
    // The saved entry is for this connection.
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("fogtrail.hidden.")),
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("shop");
    expect(keys[0]).toContain("orders");
  });

  test("a pinned column cannot be hidden until it is unpinned", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Pin total" }).click();
    await menuButton(page).click();
    await expect(tick(page, "total")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Unpin total" }).click();
    await menuButton(page).click();
    await expect(tick(page, "total")).toBeEnabled();
  });

  test("the last column showing cannot be hidden", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    for (const c of [
      "customer_id",
      "status",
      "total",
      "notes",
      "items",
      "created_at",
      "meta",
    ]) {
      await tick(page, c).uncheck({ force: true });
    }
    await expect(tick(page, "id")).toBeDisabled();
    await expect(header(page, "id")).toHaveCount(1);
  });

  test("hidden columns leave Copy rows and the row dialog", async ({
    page,
  }) => {
    await open(page);
    await menuButton(page).click();
    await tick(page, "notes").uncheck({ force: true });
    await tick(page, "meta").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Copy rows" }).click();
    const text = (await copied(page)).at(-1) ?? "";
    const lines = text.split("\n");
    expect(lines[0]).toBe("id\tcustomer_id\tstatus\ttotal\titems\tcreated_at");
    for (const line of lines) expect(line.split("\t")).toHaveLength(6);
    expect(text).not.toContain("called twice");
    expect(text).not.toContain("Leave at front desk");
    await page.getByRole("row").nth(1).click();
    await page.getByRole("button", { name: "Expand row in a dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Row details" });
    await expect(dialog).toContainText("6 columns · 2 hidden");
    await expect(dialog.locator('[data-col="notes"]')).toHaveCount(0);
    await expect(dialog.locator('[data-col="total"]')).toHaveCount(1);
  });

  test("the dialog says nothing about hidden columns when none are", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("row").nth(1).click();
    await page.getByRole("button", { name: "Expand row in a dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Row details" });
    await expect(dialog).toContainText("8 columns");
    await expect(dialog).not.toContainText("hidden");
  });

  test("hidden columns leave the side panel too", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await tick(page, "notes").uncheck({ force: true });
    await tick(page, "meta").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await page.getByRole("row").nth(2).click();
    const panel = page.locator(".rowpanel");
    await expect(panel).toContainText("total");
    await expect(panel).not.toContainText("Leave at front desk");
    await expect(panel).not.toContainText("called twice");
  });

  test("hiding the column the table is sorted by ends the sort", async ({
    page,
  }) => {
    await open(page);
    await header(page, "total").locator(".sorthead").click();
    await expect(header(page, "total")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await menuButton(page).click();
    await tick(page, "total").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await expect(header(page, "total")).toHaveCount(0);
    await expect(page.locator("thead th[aria-sort]")).toHaveCount(0);
    // Showing it again does not bring the sort back.
    await menuButton(page).click();
    await tick(page, "total").check({ force: true });
    await expect(header(page, "total")).not.toHaveAttribute("aria-sort", /.+/);
  });

  test("Enter in the search box does not apply the filter or leave the page", async ({
    page,
  }) => {
    await open(page);
    await page.getByLabel("WHERE filter").fill("status = 'paid'");
    await menuButton(page).click();
    await menu(page).getByRole("searchbox").fill("cust");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Rows 1–3")).toBeVisible();
    await expect(page.getByText(/^Filtered/)).toHaveCount(0);
  });

  test("clicking away closes the menu", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await page.getByRole("table", { name: "Rows of orders" }).click();
    await expect(menu(page)).toHaveCount(0);
  });

  test("the keyboard can tick a column, and skips one that cannot be hidden", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("button", { name: "Pin id" }).click();
    await menuButton(page).click();
    await expect(menu(page).getByRole("searchbox")).toBeFocused();
    // The first column is pinned, so Tab goes past it to the second.
    await page.keyboard.press("Tab");
    await expect(tick(page, "customer_id")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(header(page, "customer_id")).toHaveCount(0);
    await expect(tick(page, "id")).toBeDisabled();
    await expect(tick(page, "id")).toHaveAccessibleDescription(
      "Pinned. Unpin it to hide it.",
    );
  });

  test("a stored list that hides every column hides none", async ({ page }) => {
    await page.addInitScript(() => {
      const all = [
        "id",
        "customer_id",
        "status",
        "total",
        "notes",
        "items",
        "created_at",
        "meta",
      ];
      localStorage.setItem(
        "fogtrail.hidden." + JSON.stringify(["3", "shop", "orders"]),
        JSON.stringify(all),
      );
    });
    await open(page);
    await grid(page).waitFor();
    await expect(page.locator("thead th[data-col]")).toHaveCount(8);
    await expect(menuButton(page)).not.toContainText("/");
  });

  test("the menu stays inside the smallest window (800 wide)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await open(page);
    await menuButton(page).click();
    const box = await menu(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(800);
  });

  test("a foreign key link still goes to the right row when other columns are hidden", async ({
    page,
  }) => {
    await open(page);
    await menuButton(page).click();
    await tick(page, "status").uncheck({ force: true });
    await tick(page, "notes").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /customer_id 4417, open customers\.id/ })
      .click();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 4417");
  });

  test("hiding the key column removes its links and leaves the others", async ({
    page,
  }) => {
    await open(page);
    await menuButton(page).click();
    // Hiding the key column removes its links; the other columns' links are unaffected.
    await tick(page, "customer_id").uncheck({ force: true });
    await page.keyboard.press("Escape");
    await expect(page.locator(".fklink")).toHaveCount(0);
    await expect(header(page, "status")).toHaveCount(1);
  });
});

test("a key with a hidden part has no link, so the hidden value never reaches the filter box", async ({
  page,
}) => {
  await open(page);
  await menuButton(page).click();
  await tick(page, "customer_id").uncheck({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.locator(".fklink")).toHaveCount(0);
  await menuButton(page).click();
  await tick(page, "customer_id").check({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.locator(".fklink")).toHaveCount(3);
});
