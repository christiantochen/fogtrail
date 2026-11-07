import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(async ({ page }) => {
      await stubBackend(page, [
        "tenant:00000000-aaaa-bbbb-cccc-111111111111:cache:product-catalog:category-listing:page-2",
        "temp:token",
        "doc:order",
        "live:counter",
      ]);
      await page.goto("/");
      await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    });

    test("connections picker", async ({ page }) => {
      await settle(page);
      await expect(page).toHaveScreenshot(`picker-${scheme}.png`);
    });

    test("edit form with toggles", async ({ page }) => {
      await page.getByRole("button", { name: "Edit" }).first().click();
      await page.getByRole("heading", { name: "Edit connection" }).waitFor();
      await page
        .getByRole("switch", { name: "Read-only" })
        .scrollIntoViewIfNeeded();
      await settle(page);
      await expect(page).toHaveScreenshot(`form-${scheme}.png`);
    });

    test("browse sidebar with connection switcher", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Switch connection").waitFor();
      await page.getByText("cache").first().waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`browse-${scheme}.png`);
    });

    test("key context menu", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByText("config").first().waitFor();
      await page
        .getByRole("button", { name: "config" })
        .click({ button: "right" });
      await page.getByRole("menu").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`context-menu-${scheme}.png`);
    });

    test("reconnecting at launch", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Switch connection").waitFor();
      await page.addInitScript(() => {
        (window as unknown as { __CONNECT_DELAY__: number }).__CONNECT_DELAY__ =
          60_000;
      });
      await page.reload();
      await page
        .getByRole("heading", { name: /^Reconnecting to eCMS/ })
        .waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`resuming-${scheme}.png`);
    });

    test("copy confirmation", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async () => undefined },
          configurable: true,
        });
      });
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByText("config").first().waitFor();
      await page.getByRole("button", { name: "config" }).click();
      await page.getByRole("button", { name: "Copy key" }).click();
      await page.getByRole("status").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`copied-${scheme}.png`);
    });

    test("quick open", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByText("config").first().waitFor();
      await page.keyboard.press("ControlOrMeta+K");
      const box = page.getByRole("dialog", { name: "Quick open" });
      await box.getByRole("combobox").fill("cache");
      await box.getByRole("option").first().waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`quick-open-${scheme}.png`);
    });

    test("about", async ({ page }) => {
      await page.waitForFunction(() => "__menu" in window);
      await page.evaluate(() =>
        (window as unknown as { __menu: (id: string) => void }).__menu("about"),
      );
      await page.getByRole("dialog", { name: "About Fogtrail" }).waitFor();
      await page.getByText("Version 0.2.1").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`about-${scheme}.png`);
    });

    test("key about to expire", async ({ page }) => {
      await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Folder delimiter").fill("");
      await page.getByRole("button", { name: "temp:token" }).click();
      await page.clock.fastForward(95_000);
      await page.getByText("Expired").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`expired-${scheme}.png`);
    });

    test("pinned keys", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByText("config").first().waitFor();
      await page.getByRole("button", { name: "config" }).click();
      await page.getByRole("button", { name: "Pin", exact: true }).click();
      await page.getByRole("button", { name: "jobs/daily" }).click();
      await page.getByRole("button", { name: "Pin", exact: true }).click();
      await page.getByRole("button", { name: "Pinned" }).waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`pinned-${scheme}.png`);
    });

    test("find in value", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Folder delimiter").fill("");
      await page.getByRole("button", { name: "doc:order" }).click();
      await page.getByLabel("Find in value").fill("sku");
      await page.getByLabel("Find in value").press("Enter");
      await page.locator("mark").first().waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`find-${scheme}.png`);
    });

    test("folded JSON", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Folder delimiter").fill("");
      await page.getByRole("button", { name: "doc:order" }).click();
      await page.getByRole("button", { name: "Collapse all" }).click();
      await page.locator('.fl[data-line="3"] button.fl__g').click();
      await page.locator('.fl[data-line="8"] button.fl__g').click();
      await page.getByText("B-2").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`fold-${scheme}.png`);
    });

    test("auto-refresh on", async ({ page }) => {
      await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Folder delimiter").fill("");
      await page.getByRole("button", { name: "live:counter" }).click();
      await page.getByLabel("Auto-refresh").selectOption("5");
      await page.clock.fastForward(5_100);
      await page.getByText("Live · updated").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`auto-refresh-${scheme}.png`);
    });

    const pasteUrl = (page: Page, text: string) =>
      page.getByLabel("Host").evaluate((el, t) => {
        const data = new DataTransfer();
        data.setData("text/plain", t);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
      }, text);
    const newForm = async (page: Page) => {
      await page.getByRole("button", { name: "New connection" }).click();
      await page.getByRole("heading", { name: "New connection" }).waitFor();
    };

    test("new connection, empty", async ({ page }) => {
      await newForm(page);
      await settle(page);
      await expect(page).toHaveScreenshot(`url-empty-${scheme}.png`);
    });

    test("new connection, URL pasted", async ({ page }) => {
      await newForm(page);
      await page.getByLabel("Name", { exact: true }).fill("Redis Cloud");
      await pasteUrl(
        page,
        "rediss://default:xxxxxxxx@skilled-jam-canvas-38099.db.redis.io:13946/2",
      );
      await page.getByText("Filled from URL").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`url-filled-${scheme}.png`);
    });

    test("new connection, URL refused", async ({ page }) => {
      await newForm(page);
      await page.getByLabel("Name", { exact: true }).fill("Redis Cloud");
      await page.getByLabel("Host").fill("my.host");
      await pasteUrl(page, "http://example.com:80");
      await page.getByRole("alert").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`url-error-${scheme}.png`);
    });

    test("copy as URL", async ({ page }) => {
      await newForm(page);
      await pasteUrl(page, "redis://default:xxxxxxxx@h.example.com:6379");
      await page.getByRole("button", { name: "Copy as URL" }).click();
      await page.getByLabel("Connection URL").scrollIntoViewIfNeeded();
      await settle(page);
      await expect(page).toHaveScreenshot(`url-copy-${scheme}.png`);
    });

    test("long key name tooltip", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Folder delimiter").fill("");
      const row = page.locator("button.row", { hasText: "tenant" }).first();
      await row.hover();
      await page.getByRole("tooltip").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`tooltip-${scheme}.png`);
    });

    test("reconnect failed", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByLabel("Switch connection").waitFor();
      await page.addInitScript(() => {
        (window as unknown as { __FAIL_CONNECT__: boolean }).__FAIL_CONNECT__ =
          true;
      });
      await page.reload();
      await page.getByRole("alert").waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`reconnect-failed-${scheme}.png`);
    });

    test("connections while connected", async ({ page }) => {
      await page
        .getByRole("button", { name: "Connect", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Manage" }).click();
      await page.getByRole("button", { name: "Disconnect" }).waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`connected-picker-${scheme}.png`);
    });
  });
}
