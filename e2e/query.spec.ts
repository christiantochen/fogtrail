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
}

const sql = (page: Page) => page.getByLabel("SQL");
const run = (page: Page) =>
  page.getByRole("button", { name: "Run", exact: true });
const calls = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __queryCalls?: { sql: string; schema: string | null }[];
        }
      ).__queryCalls ?? [],
  );

test.describe("the query editor", () => {
  test("opens empty, says what it will and won't do, and can't run nothing", async ({
    page,
  }) => {
    await openEditor(page);
    await expect(
      page.getByRole("heading", { name: "Query", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only"),
    ).toBeVisible();
    await expect(page.getByText("Row limit 1,000")).toBeVisible();
    await expect(page.getByText("Timeout 30 s")).toBeVisible();
    await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No results yet" }),
    ).toBeVisible();
    await expect(run(page)).toBeDisabled();
    await sql(page).fill("   \n ");
    await expect(run(page)).toBeDisabled();
    // The trail says where you are.
    await expect(page.getByRole("navigation", { name: "Trail" })).toContainText(
      "Query editor",
    );
  });

  test("runs a query and shows the rows, with NULL apart from empty text", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("SELECT * FROM orders");
    await run(page).click();

    const grid = page.getByRole("table", { name: "Query results" });
    await expect(grid.getByRole("columnheader")).toHaveText([
      /^id\s*bigint$/,
      /^status\s*enum$/,
      /^total\s*decimal$/,
      /^notes\s*varchar$/,
    ]);
    await expect(grid.locator("tbody tr")).toHaveCount(3);
    // NULL is drawn as NULL, the empty string as nothing.
    await expect(
      grid.locator("tbody tr").nth(0).locator("td").nth(3),
    ).toHaveText("NULL");
    await expect(
      grid.locator("tbody tr").nth(2).locator("td").nth(3),
    ).toHaveText("");
    await expect(page.getByText("3 rows · 12 ms")).toBeVisible();
    // The open database is sent along, so plain table names work.
    expect(await calls(page)).toEqual([
      { sql: "SELECT * FROM orders", schema: "shop" },
    ]);
  });

  test("Ctrl+Enter runs the statement", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT 1");
    await sql(page).press("Control+Enter");
    await expect(
      page.getByRole("table", { name: "Query results" }),
    ).toBeVisible();
    expect(await calls(page)).toHaveLength(1);
  });

  test("a statement that writes is blocked, and says nothing was sent", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("DELETE FROM orders WHERE status = 'pending'");
    await run(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Blocked.");
    await expect(alert).toContainText("DELETE is not allowed.");
    await expect(alert).toContainText(
      "Fogtrail runs SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only. Nothing was sent to the server.",
    );
    await expect(
      page.getByRole("table", { name: "Query results" }),
    ).toHaveCount(0);
    // The editor keeps what was typed, so it can be fixed.
    await expect(sql(page)).toHaveValue(
      "DELETE FROM orders WHERE status = 'pending'",
    );
  });

  test("two statements at once are blocked", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT 1; SELECT 2");
    await run(page).click();
    await expect(page.getByRole("alert")).toContainText(
      "Running more than one statement at once is not allowed.",
    );
  });

  test("a server error is shown in the server's own words", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("SELECT broken");
    await run(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("You have an error in your SQL syntax");
    await expect(alert).not.toContainText("Blocked.");
  });

  test("the Messages tab keeps what each run did, newest first", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("SELECT * FROM orders");
    await run(page).click();
    await expect(page.getByText("3 rows · 12 ms")).toBeVisible();
    await sql(page).fill("DROP TABLE orders");
    await run(page).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByRole("tab", { name: /Messages/ }).click();
    const log = page
      .getByRole("list", { name: "Messages" })
      .getByRole("listitem");
    await expect(log).toHaveCount(2);
    await expect(log.nth(0)).toContainText("DROP TABLE orders");
    await expect(log.nth(0)).toContainText("Blocked. DROP is not allowed.");
    await expect(log.nth(1)).toContainText("SELECT * FROM orders");
    await expect(log.nth(1)).toContainText("3 rows in 12 ms");
  });

  test("a result cut at the row limit says so", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT n FROM huge");
    await run(page).click();
    await expect(page.getByText("1,000 rows · 1.8 s")).toBeVisible();
    await expect(
      page.getByText("Showing the first 1,000 rows. The query has more."),
    ).toBeVisible();
  });

  test("an empty result still shows its columns", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT * FROM nothing");
    await run(page).click();
    await expect(page.getByText("The query returned no rows.")).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: "Query results" })
        .getByRole("columnheader"),
    ).toHaveCount(2);
    await expect(page.getByText("No rows · 3 ms")).toBeVisible();
  });

  test("a running query can be cancelled", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT slow");
    await run(page).click();
    await expect(page.getByRole("button", { name: "Running…" })).toBeDisabled();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alert")).toHaveText("Stopped.");
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(run(page)).toBeEnabled();
    expect(
      await page.evaluate(
        () => (window as unknown as { __cancelled: string[] }).__cancelled,
      ),
    ).toHaveLength(1);
  });

  test("leaving the editor while a query runs cancels it", async ({ page }) => {
    await openEditor(page);
    await sql(page).fill("SELECT slow");
    await run(page).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^orders/ })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __cancelled?: string[] }).__cancelled
              ?.length ?? 0,
        ),
      )
      .toBe(1);
  });

  test("Copy results copies the rows as tab-separated text", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void w.__copied.push(t) },
        configurable: true,
      });
    });
    await openEditor(page);
    await sql(page).fill("SELECT * FROM orders");
    await run(page).click();
    await page.getByRole("button", { name: "Copy results" }).click();
    expect(
      await page.evaluate(
        () => (window as unknown as { __copied: string[] }).__copied,
      ),
    ).toEqual([
      [
        "id\tstatus\ttotal\tnotes",
        "48213\tpaid\t184.50\t",
        "48212\tpending\t62.00\tLeave at front desk",
        "48211\tpaid\t310.25\t",
      ].join("\n"),
    ]);
  });

  test("the text is kept while you look at a table and come back", async ({
    page,
  }) => {
    await openEditor(page);
    await sql(page).fill("SELECT id\nFROM orders\nWHERE total > 100");
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^orders/ })
      .click();
    // A table replaces the editor.
    await expect(sql(page)).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Structure" })).toBeVisible();
    await page.getByRole("button", { name: "Query editor" }).click();
    await expect(sql(page)).toHaveValue(
      "SELECT id\nFROM orders\nWHERE total > 100",
    );
  });

  test("the line numbers follow the text", async ({ page }) => {
    await openEditor(page);
    await expect(page.locator(".editor__lines div")).toHaveCount(1);
    await sql(page).fill("a\nb\nc\nd");
    await expect(page.locator(".editor__lines div")).toHaveCount(4);
  });

  test("a Redis connection has no query editor", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/");
    await page
      .locator(".card")
      .first()
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await page.getByLabel("Search keys").waitFor();
    await expect(
      page.getByRole("button", { name: "Query editor" }),
    ).toHaveCount(0);
  });
});
