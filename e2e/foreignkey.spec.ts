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

const views = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __rowViews: { filter?: string }[] }).__rowViews,
  );

/** The link on the customer_id value of the first row. */
const customerLink = (page: Page) =>
  page.getByRole("button", { name: /customer_id 9021, open customers\.id/ });

test.describe("following a foreign key", () => {
  test("a foreign key value in the grid is a link; other columns are not", async ({
    page,
  }) => {
    await openOrders(page);
    await expect(customerLink(page)).toBeVisible();
    await expect(customerLink(page)).toHaveAttribute("class", /fklink/);
    // Only the key's column has links: 3 rows, 3 links.
    await expect(page.locator(".fklink")).toHaveCount(3);
  });

  test("clicking it opens the referenced table filtered to that row, with the row open", async ({
    page,
  }) => {
    await openOrders(page);
    await customerLink(page).click();
    await expect(
      page.getByRole("table", { name: "Rows of customers" }),
    ).toBeVisible();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 9021");
    await expect(page.getByText("Filtered · Rows 1–1")).toBeVisible();
    // The row that was found is open in the side panel, without another click.
    await expect(page.locator(".rowpanel")).toContainText(
      "Example Customer One",
    );
    expect((await views(page)).at(-1)).toEqual({ filter: "`id` = 9021" });
    // One panel, for the customer that was found, not the order the click came from.
    await expect(page.locator(".rowpanel")).toHaveCount(1);
    await expect(page.locator(".rowpanel")).not.toContainText("48213");
    await expect(
      page.getByRole("button", { name: "Back to orders" }),
    ).toBeVisible();
  });

  test("Back to orders returns to the same table, sort and filter", async ({
    page,
  }) => {
    await openOrders(page);
    await page.getByLabel("WHERE filter").fill("status = 'paid'");
    await page.getByLabel("WHERE filter").press("Enter");
    await expect(page.getByText("Filtered · Rows 1–2")).toBeVisible();
    await page.locator('thead th[data-col="total"] .sorthead').click();
    await expect(page.locator('thead th[data-col="total"]')).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await page
      .getByRole("button", { name: /customer_id \d+, open customers\.id/ })
      .first()
      .click();
    await page.getByRole("table", { name: "Rows of customers" }).waitFor();
    await page.getByRole("button", { name: "Back to orders" }).click();
    await expect(
      page.getByRole("table", { name: "Rows of orders" }),
    ).toBeVisible();
    await expect(page.getByLabel("WHERE filter")).toHaveValue(
      "status = 'paid'",
    );
    await expect(page.locator('thead th[data-col="total"]')).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    // Back is used up: no button now.
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  });

  test("clearing the filter drops the Back button", async ({ page }) => {
    await openOrders(page);
    await customerLink(page).click();
    await expect(
      page.getByRole("button", { name: "Back to orders" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page.getByText("Rows 1–3")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  });

  test("opening another table drops the Back button", async ({ page }) => {
    await openOrders(page);
    await customerLink(page).click();
    await expect(
      page.getByRole("button", { name: "Back to orders" }),
    ).toBeVisible();
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^events/ })
      .click();
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  });

  test("the row dialog has a chip that follows the key", async ({ page }) => {
    await openOrders(page);
    await page.getByRole("row").nth(1).click();
    await page.getByRole("button", { name: "Expand row in a dialog" }).click();
    const dialog = page.getByRole("dialog", { name: "Row details" });
    const chip = dialog.getByRole("button", { name: "Open customers.id" });
    await expect(chip).toHaveText("→ customers.id");
    // Only the key's column has one.
    await expect(dialog.locator(".fkchip")).toHaveCount(1);
    await chip.click();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 9021");
    await expect(page.getByRole("dialog", { name: "Row details" })).toHaveCount(
      0,
    );
  });

  test("rows that are still the old page's cannot be followed", async ({
    page,
  }) => {
    await openOrders(page);
    await page.evaluate(() => {
      (window as unknown as { __rowDelay: number }).__rowDelay = 2000;
    });
    await page.locator('thead th[data-col="total"] .sorthead').click();
    await expect(page.locator(".fklink")).toHaveCount(0);
    // And they come back with the new rows.
    await expect(page.locator(".fklink")).toHaveCount(3);
  });

  test("a key into its own table can be followed again and again; Back is one step", async ({
    page,
  }) => {
    await openOrders(page);
    await page
      .getByRole("button", { name: /customer_id 4417, open customers\.id/ })
      .click();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 4417");
    await expect(page.locator(".rowpanel")).toContainText(
      "Example Customer Two",
    );
    // Customer 4417 was referred by 9021: the same table, a new row, and it opens too.
    await page
      .getByRole("button", { name: /referred_by 9021, open customers\.id/ })
      .click();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 9021");
    await expect(page.locator(".rowpanel")).toContainText(
      "Example Customer One",
    );
    // Back goes to the place left last, in customers, and not to orders.
    await page.getByRole("button", { name: "Back to customers" }).click();
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 4417");
    await expect(
      page.getByRole("table", { name: "Rows of customers" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
  });

  test("a customer with no referrer has no link on that column", async ({
    page,
  }) => {
    await openOrders(page);
    await page
      .getByRole("button", { name: /customer_id 9021, open customers\.id/ })
      .click();
    await expect(page.locator(".rowpanel")).toContainText(
      "Example Customer One",
    );
    await expect(page.locator(".fklink")).toHaveCount(0);
  });

  test("Enter on the link follows it; the arrow keys still move between rows", async ({
    page,
  }) => {
    await openOrders(page);
    const first = customerLink(page);
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("row").nth(2)).toBeFocused();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("WHERE filter")).toHaveValue("`id` = 9021");
  });
});
