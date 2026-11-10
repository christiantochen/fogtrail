import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

async function newForm(page: Page) {
  await stubBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).click();
  await page.getByRole("heading", { name: "New connection" }).waitFor();
}

const store = (page: Page, name: "Redis" | "MySQL") =>
  page
    .getByRole("radiogroup", { name: "Data store" })
    .getByRole("radio", { name });
const saved = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __saved: { profile: Record<string, unknown>; password: unknown }[];
        }
      ).__saved,
  );

test.describe("the MySQL connection form", () => {
  test("starts on Redis and offers MySQL", async ({ page }) => {
    await newForm(page);
    await expect(store(page, "Redis")).toHaveAttribute("aria-checked", "true");
    await expect(store(page, "MySQL")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByLabel("Port")).toHaveValue("6379");
    await expect(page.getByLabel("Database", { exact: true })).toBeVisible();
  });

  test("choosing MySQL changes the port, fields and shows the read-only user tip", async ({
    page,
  }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await expect(store(page, "MySQL")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Port")).toHaveValue("3306");
    await expect(page.getByLabel("User")).toBeVisible();
    await expect(page.getByLabel("Database (optional)")).toBeVisible();
    await expect(
      page.getByText("Safer with a read-only MySQL user"),
    ).toBeVisible();
    await page.getByLabel("User").fill("ro");
    await page.getByLabel("Database (optional)").fill("shop");
    const tip = page.locator(".code--tip");
    await expect(tip).toContainText("CREATE USER 'ro'@'%'");
    await expect(tip).toContainText(
      "GRANT SELECT, SHOW VIEW ON `shop`.* TO 'ro'@'%';",
    );
    // Back to Redis: the port follows, and the tip goes.
    await store(page, "Redis").click();
    await expect(page.getByLabel("Port")).toHaveValue("6379");
    await expect(
      page.getByText("Safer with a read-only MySQL user"),
    ).toHaveCount(0);
  });

  test("a port the user changed is kept when switching", async ({ page }) => {
    await newForm(page);
    await page.getByLabel("Port").fill("7000");
    await store(page, "MySQL").click();
    await expect(page.getByLabel("Port")).toHaveValue("7000");
  });

  test("pasting a mysql:// URL fills the form", async ({ page }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    const prevented = await page.getByLabel("Host").evaluate((el, t) => {
      const data = new DataTransfer();
      data.setData("text/plain", t);
      const ev = new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, "mysql://fogtrail:s3cret@db.internal:3307/shop?ssl-mode=required");
    expect(prevented).toBe(true);
    await expect(page.getByLabel("Host")).toHaveValue("db.internal");
    await expect(page.getByLabel("Port")).toHaveValue("3307");
    await expect(page.getByLabel("User")).toHaveValue("fogtrail");
    await expect(page.getByLabel("Database (optional)")).toHaveValue("shop");
    await expect(page.getByRole("switch", { name: "Use TLS" })).toBeChecked();
    await expect(page.getByRole("status")).toContainText("Filled from URL");
  });

  test("a redis:// URL pasted into the MySQL form is refused with a MySQL message", async ({
    page,
  }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await page.getByLabel("Host").evaluate((el, t) => {
      const data = new DataTransfer();
      data.setData("text/plain", t);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, "redis://h:6379");
    await expect(page.getByRole("alert")).toContainText("Use mysql://");
    await expect(page.getByLabel("Host")).toHaveValue("127.0.0.1");
  });

  test("a MySQL connection needs a user", async ({ page }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await page.getByLabel("Name").fill("shop");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Enter a user.")).toBeVisible();
    expect(await saved(page)).toBeUndefined();
  });

  test("Test connection reports the detected MySQL version", async ({
    page,
  }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await page.getByLabel("Name").fill("shop");
    await page.getByLabel("User").fill("ro");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Connected. Detected MySQL 8.0.36.",
    );
  });

  test("Save sends a MySQL profile with its database, and the password on its own", async ({
    page,
  }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await page.getByLabel("Name").fill("shop-prod");
    await page.getByLabel("Host").fill("db.internal");
    await page.getByLabel("User").fill("fogtrail");
    await page.getByLabel("Database (optional)").fill("shop");
    await page.getByLabel("Password").fill("s3cret");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saved(page)).toHaveLength(1);
    const [call] = await saved(page);
    expect(call.profile).toMatchObject({
      driver: "mysql",
      name: "shop-prod",
      host: "db.internal",
      port: 3306,
      username: "fogtrail",
      schema: "shop",
      database: 0,
      tls: false,
    });
    // The password travels beside the profile, never inside it.
    expect(call.password).toBe("s3cret");
    expect(JSON.stringify(call.profile)).not.toContain("s3cret");
  });

  test("Copy as URL builds a mysql:// URL without the password", async ({
    page,
  }) => {
    await newForm(page);
    await store(page, "MySQL").click();
    await page.getByLabel("User").fill("ro");
    await page.getByLabel("Database (optional)").fill("shop");
    await page.getByLabel("Password").fill("pw");
    await page.getByRole("button", { name: "Copy as URL" }).click();
    await expect(page.getByLabel("Connection URL")).toHaveText(
      "mysql://ro@127.0.0.1:3306/shop",
    );
    await page.getByLabel("Include the password in the URL").check();
    await expect(page.getByLabel("Connection URL")).toHaveText(
      "mysql://ro:pw@127.0.0.1:3306/shop",
    );
  });

  test("an existing MySQL connection is edited as MySQL, with no store picker", async ({
    page,
  }) => {
    await stubBackend(page, [], { mysql: true });
    await page.goto("/");
    await page
      .locator(".card")
      .filter({ hasText: "shop-prod" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByRole("heading", { name: "Edit connection" }).waitFor();
    await expect(
      page.getByRole("radiogroup", { name: "Data store" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Database (optional)")).toHaveValue("shop");
    await expect(page.getByLabel("User")).toHaveValue("fogtrail");
  });
});
