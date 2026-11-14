import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function openTable(page: Page, table: string) {
  await stubBackend(page, [], { mysql: true });
  await page.goto("/");
  await page
    .locator(".card")
    .filter({ hasText: "shop-prod" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Tables" })
    .getByRole("button", { name: new RegExp(`^${table}`) })
    .click();
  await page.getByRole("table", { name: `Rows of ${table}` }).waitFor();
}

async function openDialog(page: Page, table: string) {
  await openTable(page, table);
  await page
    .getByRole("table", { name: `Rows of ${table}` })
    .locator("tbody tr")
    .first()
    .click();
  await page
    .getByRole("complementary", { name: "Row details" })
    .getByRole("button", { name: "Expand row in a dialog" })
    .click();
  return page.getByRole("dialog", { name: "Row details" });
}

test.describe("the row dialog list", () => {
  test("a short table's dialog is only as tall as its rows, with no groups rail or kind filter", async ({
    page,
  }) => {
    const d = await openDialog(page, "orders");
    await expect(
      d.getByRole("navigation", { name: "Column groups" }),
    ).toHaveCount(0);
    await expect(d.getByRole("group", { name: "Column kind" })).toHaveCount(0);
    expect((await d.boundingBox())!.height).toBeLessThan(560);
  });

  test("a wide table's dialog is the full height", async ({ page }) => {
    const d = await openDialog(page, "ledger");
    expect((await d.boundingBox())!.height).toBeGreaterThan(600);
  });

  test("the header says which table, which row and how many columns", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    await expect(d).toContainText("shop.ledger · Row 1 of 1 · 126 columns");
    await expect(
      d.getByRole("button", { name: "Copy row as JSON" }),
    ).toBeVisible();
    await expect(d.locator(".rowdialog__count")).toHaveText(
      "Showing 126 of 126 columns",
    );
  });

  test("a wide table has a groups rail that jumps to a group, with set counts", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    const rail = d.getByRole("navigation", { name: "Column groups" });
    await expect(rail.getByRole("button")).toHaveText([
      /^core\s*8\/9$/,
      /^billing_\s*9\/22$/,
      /^shipping_\s*11\/24$/,
      /^audit_\s*7\/9$/,
      /^flags_\s*9\/31$/,
      /^other\s*8\/31$/,
    ]);
    await expect(rail).toContainText("52 of 126 columns have a value");
    await expect(rail.getByRole("button", { name: /^core/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await rail.getByRole("button", { name: /^shipping_/ }).click();
    const list = d.locator(".rowdialog__fieldsbody");
    await expect
      .poll(async () => {
        const head = await d.locator('[data-group="shipping_"]').boundingBox();
        const top = (await list.boundingBox())!.y;
        return Math.abs(head!.y - top);
      })
      .toBeLessThan(40);
    await expect(
      rail.getByRole("button", { name: /^shipping_/ }),
    ).toHaveAttribute("aria-current", "true");
  });

  test("the kind filter keeps only columns of one kind", async ({ page }) => {
    const d = await openDialog(page, "ledger");
    const kinds = d.getByRole("group", { name: "Column kind" });
    await expect(kinds.getByRole("button")).toHaveText([
      "All",
      "Text",
      "Numbers",
      "Dates",
      "JSON",
      "Arrays",
    ]);
    await kinds.getByRole("button", { name: "Arrays" }).click();
    await expect(d.locator(".rowfields__item")).toHaveCount(1);
    await expect(d.locator(".rowfields__item")).toContainText("tags");
    await expect(d.locator(".rowdialog__count")).toHaveText(
      "Showing 1 of 126 columns",
    );
    await kinds.getByRole("button", { name: "JSON" }).click();
    const names = await d.locator(".rowfields__id").allTextContents();
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("meta");
    expect(names).not.toContain("tags");
    await kinds.getByRole("button", { name: "All" }).click();
    await expect(d.locator(".rowdialog__count")).toHaveText(
      "Showing 126 of 126 columns",
    );
  });

  test("a group folds, Collapse all folds every group, and a search opens them again", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    const head = d.locator('[data-group="core"]');
    await expect(head).toHaveAttribute("aria-expanded", "true");
    const before = await d.locator(".rowfields__item").count();
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    expect(await d.locator(".rowfields__item").count()).toBeLessThan(before);

    await d.getByRole("button", { name: "Collapse all groups" }).click();
    await expect(d.locator(".rowfields__item")).toHaveCount(0);
    await expect(
      d.getByRole("button", { name: "Expand all groups" }),
    ).toBeVisible();

    await d
      .getByRole("searchbox", { name: "Find in row" })
      .fill("shipping_city");
    // The group is open again while searching, and holds only what matches.
    await expect(d.locator(".rowfields__item")).toHaveCount(3);
    await expect(d.locator('[data-group="shipping_"]')).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await d.getByRole("searchbox", { name: "Find in row" }).fill("");
    await d.getByRole("button", { name: "Expand all groups" }).click();
    expect(await d.locator(".rowfields__item").count()).toBe(before);
  });

  test("a column pins to a band at the top, up to three, and unpins", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    const list = d.locator(".rowdialog__fieldsbody");
    await d.getByRole("button", { name: "Pin total" }).click();
    const band = d.locator(".rowband");
    await expect(band).toContainText("Pinned · 1");
    await expect(band.locator(".rowfields__id")).toHaveText(["total"]);
    // The pinned column is in the band, not twice.
    await expect(list.locator('[data-col="total"]')).toHaveCount(0);
    await d.getByRole("button", { name: "Pin status" }).click();
    await d.getByRole("button", { name: "Pin channel" }).click();
    await expect(band).toContainText("Pinned · 3");
    await expect(d.getByRole("button", { name: "Pin placed" })).toBeDisabled();
    // It stays put while the list scrolls.
    await list.evaluate((el) => (el.scrollTop = 600));
    await expect(band).toBeInViewport();
    await band.getByRole("button", { name: "Unpin total" }).click();
    await expect(band).toContainText("Pinned · 2");
    await expect(list.locator('[data-col="total"]')).toHaveCount(1);
  });

  test("a pin in the grid shows in the dialog", async ({ page }) => {
    await openTable(page, "orders");
    await page
      .getByRole("table", { name: "Rows of orders" })
      .getByRole("button", { name: /^Pin status/ })
      .click();
    await page
      .getByRole("table", { name: "Rows of orders" })
      .locator("tbody tr")
      .first()
      .click();
    await page
      .getByRole("complementary", { name: "Row details" })
      .getByRole("button", { name: "Expand row in a dialog" })
      .click();
    const d = page.getByRole("dialog", { name: "Row details" });
    await expect(d.locator(".rowband .rowfields__id")).toHaveText(["status"]);
  });

  test("a pinned column stays when Hide null or a kind filter would remove it", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    await d.getByRole("button", { name: "Pin ref" }).click();
    await d.getByRole("checkbox", { name: "Hide null" }).check();
    await d
      .getByRole("group", { name: "Column kind" })
      .getByRole("button", {
        name: "Numbers",
      })
      .click();
    await expect(d.locator(".rowband .rowfields__id")).toHaveText(["ref"]);
  });

  test("Hide NULL in the footer leaves the empty columns out, and a slash goes to the search", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    await d.getByRole("button", { name: "Hide NULL columns" }).click();
    await expect(d.getByRole("checkbox", { name: "Hide null" })).toBeChecked();
    await expect(d.locator(".rowdialog__count")).toHaveText(
      "Showing 52 of 126 columns · 74 NULL hidden",
    );
    await expect(
      d.getByRole("button", { name: "Show NULL columns" }),
    ).toBeVisible();
    await d.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("/");
    await expect(
      d.getByRole("searchbox", { name: "Find in row" }),
    ).toBeFocused();
  });

  test("a type shows next to each name, and a long value opens on a click", async ({
    page,
  }) => {
    const d = await openDialog(page, "ledger");
    const note = d.locator('[data-col="note"]');
    await expect(note.locator(".badge")).toHaveText("varchar");
    const text = note.locator(".rowfields__text");
    await expect(text).toHaveAttribute("aria-expanded", "false");
    await text.click();
    await expect(text).toHaveAttribute("aria-expanded", "true");
  });
});
