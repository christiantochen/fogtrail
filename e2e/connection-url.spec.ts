import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { stubBackend } from "./stub";

const URL_FULL =
  "redis://default:xxxxxxxx@skilled-jam-canvas-38099.db.redis.io:13946";

// Pastes text into the Host field the way a user does, so onPaste runs. Returns
// whether the app took over the paste (true) or left it to the browser (false).
async function paste(page: Page, text: string): Promise<boolean> {
  return page.getByLabel("Host").evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    const ev = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, text);
}

async function newForm(page: Page) {
  await stubBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "New connection" }).click();
  await page.getByRole("heading", { name: "New connection" }).waitFor();
}

async function editForm(page: Page) {
  await stubBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByRole("heading", { name: "Edit connection" }).waitFor();
}

const tls = (page: Page) => page.getByRole("switch", { name: "Use TLS" });
const saved = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __saved: { profile: unknown; password: unknown }[];
        }
      ).__saved,
  );

test.describe("paste a connection URL", () => {
  test("a full URL fills host, port, username and password, and says so", async ({
    page,
  }) => {
    await newForm(page);
    await page.getByLabel("Name", { exact: true }).fill("redis cloud");
    expect(await paste(page, URL_FULL)).toBe(true);
    await expect(page.getByLabel("Host")).toHaveValue(
      "skilled-jam-canvas-38099.db.redis.io",
    );
    await expect(page.getByLabel("Port", { exact: true })).toHaveValue("13946");
    await expect(page.getByLabel(/^Username/)).toHaveValue("default");
    await expect(page.getByLabel("Password")).toHaveValue("xxxxxxxx");
    await expect(page.getByLabel("Database")).toHaveValue("0");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "redis cloud",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "Filled from URL" }),
    ).toContainText("host, TLS off, port, database, username, password");
  });

  test("rediss:// turns TLS on and redis:// leaves it off", async ({
    page,
  }) => {
    await newForm(page);
    await paste(page, "rediss://h.example.com:6380");
    await expect(tls(page)).toBeChecked();
    await paste(page, "redis://h.example.com:6380");
    await expect(tls(page)).not.toBeChecked();
  });

  test("no port means 6379 and no path means database 0", async ({ page }) => {
    await newForm(page);
    await page.getByLabel("Port", { exact: true }).fill("7000");
    await page.getByLabel("Database").fill("5");
    await paste(page, "redis://cache.example.com");
    await expect(page.getByLabel("Port", { exact: true })).toHaveValue("6379");
    await expect(page.getByLabel("Database")).toHaveValue("0");
  });

  test("the path sets the database", async ({ page }) => {
    await newForm(page);
    await paste(page, "redis://cache.example.com:6379/2");
    await expect(page.getByLabel("Database")).toHaveValue("2");
  });

  test("no username keeps AUTH to the password only", async ({ page }) => {
    await newForm(page);
    await paste(page, "redis://:s3cret@cache.example.com:6379");
    await expect(page.getByLabel(/^Username/)).toHaveValue("");
    await expect(page.getByLabel("Password")).toHaveValue("s3cret");
  });

  test("a percent-encoded password is decoded and saved decoded", async ({
    page,
  }) => {
    await newForm(page);
    await page.getByLabel("Name", { exact: true }).fill("enc");
    await paste(page, "redis://u:p%40ss%2Fw@h.example.com:6379");
    await expect(page.getByLabel("Password")).toHaveValue("p@ss/w");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saved(page)).toHaveLength(1);
    const [call] = await saved(page);
    expect(call.password).toBe("p@ss/w");
    expect(call.profile).toMatchObject({
      host: "h.example.com",
      port: 6379,
      username: "u",
      tls: false,
    });
  });

  test("an ordinary hostname pastes as usual", async ({ page }) => {
    await newForm(page);
    expect(await paste(page, "cache.example.com")).toBe(false);
    await expect(page.getByText("Filled from URL")).toHaveCount(0);
  });
});

test.describe("a URL that cannot be used", () => {
  async function filledForm(page: Page) {
    await newForm(page);
    await page.getByLabel("Name", { exact: true }).fill("keep me");
    await page.getByLabel("Host").fill("my.host");
    await page.getByLabel("Port", { exact: true }).fill("7001");
    await page.getByLabel(/^Username/).fill("alice");
  }
  async function untouched(page: Page) {
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "keep me",
    );
    await expect(page.getByLabel("Host")).toHaveValue("my.host");
    await expect(page.getByLabel("Port", { exact: true })).toHaveValue("7001");
    await expect(page.getByLabel(/^Username/)).toHaveValue("alice");
    await expect(page.getByText("Filled from URL")).toHaveCount(0);
  }

  test("an unsupported scheme is named and nothing is wiped", async ({
    page,
  }) => {
    await filledForm(page);
    await paste(page, "http://example.com:80");
    await expect(page.getByRole("alert")).toContainText(
      "Unsupported scheme “http://”",
    );
    await untouched(page);
  });

  test("a missing host is reported", async ({ page }) => {
    await filledForm(page);
    await paste(page, "redis://user:pw@:6379");
    await expect(page.getByRole("alert")).toContainText("no host");
    await untouched(page);
  });

  test("an invalid port is reported", async ({ page }) => {
    await filledForm(page);
    await paste(page, "redis://h.example.com:99999");
    await expect(page.getByRole("alert")).toContainText("Port “99999”");
    await untouched(page);
  });

  test("the message clears when the host is edited", async ({ page }) => {
    await filledForm(page);
    await paste(page, "http://example.com");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByLabel("Host").fill("other.host");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("editing a connection", () => {
  test("a pasted URL overwrites only the fields it has", async ({ page }) => {
    await editForm(page);
    await page.getByLabel("Port", { exact: true }).fill("7000");
    await page.getByLabel(/^Username/).fill("alice");
    await paste(page, "redis://new.example.com");
    await expect(page.getByLabel("Host")).toHaveValue("new.example.com");
    await expect(page.getByLabel("Port", { exact: true })).toHaveValue("7000");
    await expect(page.getByLabel(/^Username/)).toHaveValue("alice");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "eCMS Standard - UAT",
    );
    await expect(tls(page)).not.toBeChecked();
    await expect(page.getByLabel("Password")).toHaveValue("");
  });
});

test.describe("copy as URL", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => void w.__copied.push(t) },
        configurable: true,
      });
    });
  });
  const copied = (page: Page) =>
    page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

  test("the password is left out until you include it", async ({ page }) => {
    await newForm(page);
    await paste(page, URL_FULL);
    await page.getByRole("button", { name: "Copy as URL" }).click();
    const box = page.getByLabel("Connection URL");
    await expect(box).toHaveText(
      "redis://default@skilled-jam-canvas-38099.db.redis.io:13946",
    );
    await page.getByRole("button", { name: "Copy URL" }).click();
    expect((await copied(page))[0]).not.toContain("xxxxxxxx");
    await page.getByLabel("Include the password in the URL").check();
    await expect(box).toHaveText(URL_FULL);
    await page.getByRole("button", { name: "Copy URL" }).click();
    expect((await copied(page))[1]).toBe(URL_FULL);
  });

  test("a copied URL pastes back without inventing a password", async ({
    page,
  }) => {
    await newForm(page);
    await paste(page, URL_FULL);
    await page.getByRole("button", { name: "Copy as URL" }).click();
    await page.getByRole("button", { name: "Copy URL" }).click();
    const [url] = await copied(page);
    await page.getByLabel("Password", { exact: true }).fill("");
    expect(await paste(page, url)).toBe(true);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  });

  test("a saved connection explains why its password is missing", async ({
    page,
  }) => {
    await editForm(page);
    await page.getByRole("button", { name: "Copy as URL" }).click();
    await expect(page.getByLabel("Connection URL")).toContainText(
      "rediss://redis-standard.uat.example.dev:6379",
    );
    await expect(page.getByText("can’t be read back here")).toBeVisible();
    await expect(
      page.getByLabel("Include the password in the URL"),
    ).toHaveCount(0);
  });
});
