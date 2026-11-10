import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function openEditor(page: Page) {
  await stubBackend(page, [], { mysql: true });
  await page.goto("/");
  await page
    .locator(".card")
    .filter({ hasText: "shop-prod" })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.getByRole("list", { name: "Tables" }).waitFor();
  await page.getByRole("button", { name: "Query editor" }).click();
  await page.getByLabel("SQL").click();
}

const sql = (page: Page) => page.getByLabel("SQL");
const list = (page: Page) => page.getByRole("listbox", { name: "Suggestions" });
const options = (page: Page) => list(page).getByRole("option");
const type = (page: Page, text: string) => sql(page).pressSequentially(text);
const structureCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __structureCalls?: string[] }).__structureCalls ??
      [],
  );

test.describe("suggestions in the query editor", () => {
  test("offers tables after FROM, and Tab takes the first", async ({
    page,
  }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await expect(options(page)).toHaveText([/orders/]);
    await sql(page).press("Tab");
    await expect(sql(page)).toHaveValue("SELECT * FROM orders");
    await expect(list(page)).toHaveCount(0);
    // Focus stays in the box.
    await expect(sql(page)).toBeFocused();
  });

  test("offers the columns of a table through its alias", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM orders o WHERE o.st");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).first()).toContainText("status");
    await expect(options(page).first()).toContainText("enum('paid','pending')");
    await sql(page).press("Tab");
    await expect(sql(page)).toHaveValue(
      "SELECT * FROM orders o WHERE o.status",
    );
    // Tab took the suggestion; it did not add a line.
    await expect(page.locator(".editor__lines div")).toHaveCount(1);
  });

  test("offers the columns of a table that is named after the caret", async ({
    page,
  }) => {
    await openEditor(page);
    await type(page, "SELECT  FROM orders");
    await sql(page).press("Home");
    for (let i = 0; i < 7; i++) await sql(page).press("ArrowRight");
    await type(page, "cust");
    await expect(options(page).first()).toContainText("customer_id");
  });

  test("arrow keys move, Enter takes the highlighted one", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM c");
    await expect(options(page)).toHaveText([/customers/, /paying_customers/]);
    await expect(options(page).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await sql(page).press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await sql(page).press("Enter");
    await expect(sql(page)).toHaveValue("SELECT * FROM paying_customers");
  });

  test("Enter adds a line until you have moved in the list", async ({
    page,
  }) => {
    await openEditor(page);
    // `o` could start ORDER BY, but here it is an alias and Enter must start a new line.
    await type(page, "SELECT * FROM orders o");
    await expect(list(page)).toBeVisible();
    await sql(page).press("Enter");
    await expect(sql(page)).toHaveValue("SELECT * FROM orders o\n");
    await expect(list(page)).toHaveCount(0);
    await expect(page.locator(".editor__lines div")).toHaveCount(2);
  });

  test("a name with a space is put in backticks", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM we");
    await sql(page).press("Tab");
    await expect(sql(page)).toHaveValue("SELECT * FROM `weird name`");
  });

  test("Escape closes the list and keeps the text", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await expect(list(page)).toBeVisible();
    await sql(page).press("Escape");
    await expect(list(page)).toHaveCount(0);
    await expect(sql(page)).toHaveValue("SELECT * FROM or");
  });

  test("a click on a row takes it", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await options(page).first().click();
    await expect(sql(page)).toHaveValue("SELECT * FROM orders");
    await expect(sql(page)).toBeFocused();
  });

  test("nothing is offered inside a string or a comment", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT 'or");
    await expect(list(page)).toHaveCount(0);
    await sql(page).fill("");
    await type(page, "SELECT 1 -- or");
    await expect(list(page)).toHaveCount(0);
  });

  test("nothing is offered before a letter, and Ctrl+Space asks for it", async ({
    page,
  }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM ");
    await expect(list(page)).toHaveCount(0);
    await sql(page).press("Control+Space");
    await expect(list(page)).toContainText("customers");
  });

  test("deleting does not open the list", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM orders");
    await sql(page).press("Escape");
    await sql(page).press("Backspace");
    await expect(list(page)).toHaveCount(0);
  });

  test("moving the caret by hand closes the list", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await expect(list(page)).toBeVisible();
    await sql(page).press("ArrowLeft");
    await expect(list(page)).toHaveCount(0);
  });

  test("Ctrl+Enter runs while the list is open", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await expect(list(page)).toBeVisible();
    await sql(page).press("Control+Enter");
    await expect(
      page.getByRole("table", { name: "Query results" }),
    ).toBeVisible();
  });

  test("undo takes a suggestion back", async ({ page }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM or");
    await sql(page).press("Tab");
    await expect(sql(page)).toHaveValue("SELECT * FROM orders");
    await sql(page).press("Control+z");
    await expect(sql(page)).toHaveValue("SELECT * FROM or");
  });

  test("columns are fetched only for tables that exist, once", async ({
    page,
  }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM orde");
    await expect(list(page)).toBeVisible();
    expect(await structureCalls(page)).toEqual([]);
    await type(page, "rs o WHERE o.");
    await expect(options(page).first()).toBeVisible();
    await type(page, "st");
    await expect(options(page)).toHaveCount(1);
    expect(await structureCalls(page)).toEqual(["orders"]);
  });

  test("a table of another database is offered after its name", async ({
    page,
  }) => {
    await openEditor(page);
    await type(page, "SELECT * FROM mysql.");
    // The stub has no tables for `mysql`, so there is nothing to show, and no error.
    await expect(list(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("colours in the query editor", () => {
  test("keywords, strings, numbers and comments are coloured", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("SELECT 'a', 42 -- note\nFROM orders");
    const hl = page.locator(".editor__hl");
    await expect(hl.locator(".tk-kw")).toHaveText(["SELECT", "FROM"]);
    await expect(hl.locator(".tk-str")).toHaveText(["'a'"]);
    await expect(hl.locator(".tk-num")).toHaveText(["42"]);
    await expect(hl.locator(".tk-cm")).toHaveText(["-- note"]);
    // Table names stay plain.
    await expect(hl).toContainText("orders");
  });

  test("the colours sit exactly under the text", async ({ page }) => {
    await openEditor(page);
    const same = await page.evaluate(() => {
      const a = getComputedStyle(document.querySelector(".editor__hl")!);
      const b = getComputedStyle(document.querySelector(".editor__text")!);
      return [
        "fontFamily",
        "fontSize",
        "lineHeight",
        "paddingLeft",
        "paddingTop",
        "tabSize",
      ].map((k) => [k, (a as never)[k], (b as never)[k]]);
    });
    for (const [key, a, b] of same) expect(a, key).toBe(b);
  });

  test("the colours scroll with the text", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill(
      Array.from({ length: 60 }, (_, i) => `SELECT ${i}`).join("\n"),
    );
    await sql(page).evaluate((el) => {
      el.scrollTop = 200;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() =>
        page
          .locator(".editor__hl")
          .evaluate((el) => (el as HTMLElement).style.transform),
      )
      .toContain("-200px");
    await expect
      .poll(() =>
        page
          .locator(".editor__lines")
          .evaluate((el) => (el as HTMLElement).style.transform),
      )
      .toContain("-200px");
  });

  test("an empty last line is as tall in the colour layer as in the text box", async ({
    page,
  }) => {
    await openEditor(page);
    // Three lines, the last two empty: 3 x 20px of text and 20px of padding.
    await sql(page).fill("SELECT 1\n\n");
    const hl = await page
      .locator(".editor__hl")
      .evaluate((el) => el.scrollHeight);
    expect(hl).toBe(3 * 20 + 20);
    await expect(page.locator(".editor__lines div")).toHaveCount(3);
  });
});
