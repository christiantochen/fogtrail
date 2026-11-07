import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

const long =
  "tenant:00000000-aaaa-bbbb-cccc-111111111111:cache:product-catalog:category-listing:page-2";

test("a cut-off key name shows in full on hover, a short one does not", async ({
  page,
}) => {
  await stubBackend(page, [long]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page.getByLabel("Switch connection").waitFor();
  await page.getByRole("button", { name: "config" }).hover();
  await page.waitForTimeout(450);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  // The long key is one flat entry when the delimiter is cleared.
  await page.getByLabel("Folder delimiter").fill("");
  const row = page.locator("button.row", { hasText: "tenant" }).first();
  await row.hover();
  await expect(page.getByRole("tooltip")).toHaveText(long);
  await page.mouse.move(700, 400);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
