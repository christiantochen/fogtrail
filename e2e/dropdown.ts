import type { Page } from "@playwright/test";

/** The closed box of a dropdown, found by its accessible name. */
export const box = (page: Page, label: string) =>
  page.getByRole("combobox", { name: label, exact: true });

/** Opens a dropdown and picks the option with this value. */
export async function choose(page: Page, label: string, value: string) {
  await box(page, label).click();
  await page
    .getByRole("listbox", { name: label, exact: true })
    .locator(`[role="option"][data-value="${value}"]`)
    .click();
}

/** The text of every option in a dropdown's list, read by opening it and closing it again. */
export async function optionTexts(page: Page, label: string) {
  await box(page, label).click();
  const list = page.getByRole("listbox", { name: label, exact: true });
  const texts = (await list.getByRole("option").allTextContents()).map((t) =>
    t.replace(/^✓/, "").trim(),
  );
  await page.keyboard.press("Escape");
  await list.waitFor({ state: "detached" });
  return texts;
}
