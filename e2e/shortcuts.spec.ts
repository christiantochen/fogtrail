import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function connect(page: Page, name: string, opts?: { mysql?: boolean }) {
  await stubBackend(page, [], opts ?? {});
  await page.goto("/");
  await page
    .locator(".card")
    .filter({ hasText: name })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
}

const sheet = (page: Page) =>
  page.getByRole("dialog", { name: "Keyboard shortcuts" });

test.describe("the keyboard shortcuts sheet", () => {
  test("? opens it on a SQL connection with the SQL groups and no key browser", async ({
    page,
  }) => {
    await connect(page, "shop-prod", { mysql: true });
    await page.getByRole("list", { name: "Tables" }).waitFor();
    await page.keyboard.press("Shift+Slash");
    const d = sheet(page);
    await expect(d).toBeVisible();
    for (const g of [
      "Everywhere",
      "Table rows",
      "Row panel and dialog",
      "Query editor",
    ])
      await expect(d.getByRole("heading", { name: g })).toBeVisible();
    await expect(d.getByRole("heading", { name: /Key browser/ })).toHaveCount(
      0,
    );
  });

  test("a Redis connection shows the key browser and not table rows", async ({
    page,
  }) => {
    await connect(page, "local");
    await page.keyboard.press("Shift+Slash");
    const d = sheet(page);
    await expect(d.getByRole("heading", { name: /Key browser/ })).toBeVisible();
    await expect(d.getByRole("heading", { name: "Table rows" })).toHaveCount(0);
  });

  test("not connected, only Everywhere is listed", async ({ page }) => {
    await stubBackend(page, [], {});
    await page.goto("/");
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    await page.keyboard.press("Shift+Slash");
    const d = sheet(page);
    await expect(d.getByRole("heading", { name: "Everywhere" })).toBeVisible();
    await expect(d.getByRole("heading")).toHaveCount(2); // title + Everywhere
  });

  test("? while typing in a field does not open it", async ({ page }) => {
    await connect(page, "shop-prod", { mysql: true });
    await page.getByRole("list", { name: "Tables" }).waitFor();
    await page.getByRole("searchbox").first().focus();
    await page.keyboard.type("?");
    await expect(sheet(page)).toHaveCount(0);
  });

  test("Esc and the Close button close it", async ({ page }) => {
    await stubBackend(page, [], {});
    await page.goto("/");
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    await page.keyboard.press("Shift+Slash");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await page.keyboard.press("Shift+Slash");
    await sheet(page).getByRole("button", { name: /Close/ }).click();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("the Help menu item opens it", async ({ page }) => {
    await stubBackend(page, [], {});
    await page.goto("/");
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    await page.evaluate(() =>
      (window as unknown as { __menu: (id: string) => void }).__menu(
        "shortcuts",
      ),
    );
    await expect(sheet(page)).toBeVisible();
  });

  test("Esc closes only the sheet, not the row dialog under it", async ({
    page,
  }) => {
    await connect(page, "shop-prod", { mysql: true });
    await page
      .getByRole("list", { name: "Tables" })
      .getByRole("button", { name: /^orders/ })
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
    const row = page.getByRole("dialog", { name: "Row details" });
    await expect(row).toBeVisible();
    await page.keyboard.press("Shift+Slash");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(row).toBeVisible();
  });
});
