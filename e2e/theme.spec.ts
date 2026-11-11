import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function open(page: Page, custom = false) {
  if (custom)
    await page.addInitScript(() => {
      (window as unknown as { __customTitleBar: boolean }).__customTitleBar =
        true;
    });
  await stubBackend(page);
  await page.goto("/");
  await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
}

const scheme = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const told = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __themes?: string[] }).__themes ?? [],
  );
/** What the native menu does when the person clicks Theme > Dark, and so on. */
const nativeClick = (page: Page, id: string) =>
  page.evaluate(
    (i) => (window as unknown as { __menu: (id: string) => void }).__menu(i),
    id,
  );
const pick = async (page: Page, name: string) => {
  const bar = page.locator("header.titlebar");
  await bar.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitemradio", { name }).click();
};

test.describe("theme", () => {
  test("follows the OS by default, and live when the OS changes", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page);
    expect(await scheme(page)).toBe("light");
    const light = await background(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => scheme(page)).toBe("dark");
    expect(await background(page)).not.toBe(light);
  });

  test("a pick beats the OS, and System goes back to following it", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    await nativeClick(page, "theme-light");
    await expect.poll(() => scheme(page)).toBe("light");
    // The OS flipping now changes nothing.
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await scheme(page)).toBe("light");
    await nativeClick(page, "theme-dark");
    await expect.poll(() => scheme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    expect(await scheme(page)).toBe("dark");
    await nativeClick(page, "theme-system");
    await expect.poll(() => scheme(page)).toBe("light");
  });

  test("the pick is remembered across a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page);
    await nativeClick(page, "theme-dark");
    await expect.poll(() => scheme(page)).toBe("dark");
    await page.reload();
    await page.getByRole("heading", { name: "Pick a connection" }).waitFor();
    expect(await scheme(page)).toBe("dark");
  });

  test("the shell is told about each pick", async ({ page }) => {
    await open(page);
    await nativeClick(page, "theme-dark");
    await nativeClick(page, "theme-system");
    await expect.poll(() => told(page)).toEqual(["system", "dark", "system"]);
  });

  test("a saved value it doesn't know falls back to the OS", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem("fogtrail.theme", "purple"),
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await open(page);
    expect(await scheme(page)).toBe("dark");
  });

  test.describe("the Windows menu bar", () => {
    test("View lists the three choices and ticks the current one", async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await open(page, true);
      await page
        .locator("header.titlebar")
        .getByRole("menuitem", { name: "View", exact: true })
        .click();
      const system = page.getByRole("menuitemradio", { name: /System/ });
      await expect(system).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByRole("menuitemradio", { name: /Dark/ }),
      ).toHaveAttribute("aria-checked", "false");
    });

    test("choosing Dark changes the page and moves the tick", async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await open(page, true);
      await pick(page, "Theme: Dark");
      await expect.poll(() => scheme(page)).toBe("dark");
      await page
        .locator("header.titlebar")
        .getByRole("menuitem", { name: "View", exact: true })
        .click();
      await expect(
        page.getByRole("menuitemradio", { name: /Dark/ }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByRole("menuitemradio", { name: /System/ }),
      ).toHaveAttribute("aria-checked", "false");
    });

    test("the keyboard can pick it", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await open(page, true);
      await page
        .locator("header.titlebar")
        .getByRole("menuitem", { name: "View", exact: true })
        .click();
      const active = () =>
        page.locator('[role="menuitemradio"][aria-current="true"]');
      await page.getByRole("menuitemradio", { name: /Light/ }).hover();
      await expect(active()).toContainText("Light");
      await page.keyboard.press("Enter");
      await expect.poll(() => scheme(page)).toBe("light");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });
  });
});
