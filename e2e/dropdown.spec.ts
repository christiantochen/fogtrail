import type { Page } from "@playwright/test";
import { box, choose } from "./dropdown";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function open(page: Page, key = false) {
  await stubBackend(page, ["a", "b"]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await box(page, "Switch connection").waitFor();
  // Auto-refresh sits in the panel of an open key.
  if (key) await page.getByRole("button", { name: /^a STR/ }).click();
}
const list = (page: Page, label: string) =>
  page.getByRole("listbox", { name: label, exact: true });
const value = (page: Page, label: string) =>
  box(page, label).getAttribute("data-value");

test.describe("dropdown", () => {
  test("opens on click, shows the current choice ticked, and lists connection types", async ({
    page,
  }) => {
    await open(page);
    await box(page, "Switch connection").click();
    const options = list(page, "Switch connection").getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(options.first()).toContainText("✓");
    await expect(options.first()).toContainText("Redis");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "false");
  });

  test("the list is drawn by the app, in the card colour, not the OS", async ({
    page,
  }) => {
    await open(page);
    await box(page, "Sort keys").click();
    const l = list(page, "Sort keys");
    const colours = await l.evaluate((el) => ({
      list: getComputedStyle(el).backgroundColor,
      card: getComputedStyle(document.body).getPropertyValue("--card").trim(),
      shown: getComputedStyle(el).position,
    }));
    expect(colours.shown).toBe("fixed");
    // A grey OS list would not use the card colour.
    const probe = await page.evaluate(() => {
      const d = document.createElement("div");
      d.style.background = "var(--card)";
      document.body.append(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    });
    expect(colours.list).toBe(probe);
  });

  test("the row under the pointer is highlighted, and a click picks it", async ({
    page,
  }) => {
    await open(page);
    await box(page, "Sort keys").click();
    const expiry = list(page, "Sort keys").getByRole("option", {
      name: /Expiry/,
    });
    await expiry.hover();
    await expect(expiry).toHaveClass(/dropdown__opt--active/);
    await expiry.click();
    await expect(list(page, "Sort keys")).toHaveCount(0);
    expect(await value(page, "Sort keys")).toBe("expiry");
    await expect(box(page, "Sort keys")).toHaveText("Expiry");
  });

  test("the keyboard opens it, moves, and picks with Enter", async ({
    page,
  }) => {
    await open(page, true);
    await box(page, "Auto-refresh").focus();
    await page.keyboard.press("ArrowDown");
    await expect(list(page, "Auto-refresh")).toBeVisible();
    // The highlight starts on the current choice (Off).
    await expect(
      list(page, "Auto-refresh").locator(".dropdown__opt--active"),
    ).toHaveText(/Off/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(list(page, "Auto-refresh")).toHaveCount(0);
    expect(await value(page, "Auto-refresh")).toBe("5");
    // Focus never left the box.
    await expect(box(page, "Auto-refresh")).toBeFocused();
  });

  test("Home and End jump, and the arrows stop at the ends", async ({
    page,
  }) => {
    await open(page, true);
    await box(page, "Auto-refresh").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await expect(
      list(page, "Auto-refresh").locator(".dropdown__opt--active"),
    ).toHaveText(/Every 30s/);
    await page.keyboard.press("ArrowDown");
    await expect(
      list(page, "Auto-refresh").locator(".dropdown__opt--active"),
    ).toHaveText(/Every 30s/);
    await page.keyboard.press("Home");
    await expect(
      list(page, "Auto-refresh").locator(".dropdown__opt--active"),
    ).toHaveText(/Off/);
  });

  test("typing a letter jumps to a matching name", async ({ page }) => {
    await open(page);
    await box(page, "Sort keys").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("e");
    await expect(
      list(page, "Sort keys").locator(".dropdown__opt--active"),
    ).toHaveText(/Expiry/);
    await page.keyboard.press("Enter");
    expect(await value(page, "Sort keys")).toBe("expiry");
  });

  test("Esc closes it and changes nothing", async ({ page }) => {
    await open(page);
    await box(page, "Sort keys").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(list(page, "Sort keys")).toHaveCount(0);
    expect(await value(page, "Sort keys")).toBe("name");
    await expect(box(page, "Sort keys")).toBeFocused();
  });

  test("a click elsewhere closes it and changes nothing", async ({ page }) => {
    await open(page);
    await box(page, "Sort keys").click();
    await page.getByLabel("Search keys").click();
    await expect(list(page, "Sort keys")).toHaveCount(0);
    expect(await value(page, "Sort keys")).toBe("name");
  });

  test("choosing the current option does nothing but close", async ({
    page,
  }) => {
    await open(page);
    await choose(page, "Sort keys", "name");
    await expect(list(page, "Sort keys")).toHaveCount(0);
    expect(await value(page, "Sort keys")).toBe("name");
  });

  test("the list stays inside the window", async ({ page }) => {
    await open(page, true);
    await box(page, "Auto-refresh").click();
    const r = await list(page, "Auto-refresh").boundingBox();
    const view = page.viewportSize()!;
    expect(r!.y).toBeGreaterThanOrEqual(0);
    expect(r!.y + r!.height).toBeLessThanOrEqual(view.height);
    expect(r!.x + r!.width).toBeLessThanOrEqual(view.width);
  });

  test("keys are announced: combobox, listbox and options with a selected one", async ({
    page,
  }) => {
    await open(page);
    const b = box(page, "Sort keys");
    await expect(b).toHaveAttribute("aria-haspopup", "listbox");
    await expect(b).toHaveAttribute("aria-expanded", "false");
    await b.click();
    await expect(b).toHaveAttribute("aria-expanded", "true");
    const active = await b.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute(
      "role",
      "option",
    );
  });

  test("scrolling a long list keeps it open, scrolling the page closes it", async ({
    page,
  }) => {
    await stubBackend(page, [], { mysql: true, extraSchemas: 40 });
    await page.goto("/");
    await page
      .locator(".card")
      .filter({ hasText: "shop-prod" })
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await page.getByRole("list", { name: "Tables" }).waitFor();
    await box(page, "Database").click();
    const l = list(page, "Database");
    await expect(l).toBeVisible();
    // The list is taller than its box, so it scrolls.
    const scrolls = await l.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    await l.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => l.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await expect(l).toBeVisible();
    // Something else scrolling still closes it.
    await page.evaluate(() => document.body.dispatchEvent(new Event("scroll")));
    await expect(l).toHaveCount(0);
  });
});
