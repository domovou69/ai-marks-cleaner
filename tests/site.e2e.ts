import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const SITE = "/ai-marks-cleaner/";

test("cleans pasted text and an Office file on the built site, offline, with no foreign requests", async ({ page, context }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:4173/") && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) {
      foreign.push(r.url());
    }
  });

  await page.goto(SITE);
  await expect(page.locator("#status-text")).toHaveText(/Ready/, { timeout: 90_000 });

  // Text: a zero-width space and an astral tag character (U+E0041) are removed and marked; a later one tests the offset mapping.
  await page.locator("#input").fill("he​llo \u{E0041}world");
  await expect(page.locator("#preview mark")).toHaveCount(2);
  await expect(page.locator("#file-verdict")).toBeHidden();
  await expect(page.locator("#preview mark").first()).toHaveText("U+200B");
  await expect(page.locator("#preview")).toContainText("world");
  const textDownload = page.waitForEvent("download");
  await page.locator("#download-text").click();
  const textFile = await textDownload.then((d) => d.path());
  expect(readFileSync(textFile!, "utf8")).toBe("hello world");

  // Office: the file has its own report and the text result stays untouched. The download is a valid ZIP.
  await page.locator("#file").setInputFiles("tests/fixtures/sample.docx");
  await expect(page.locator("#file-result")).toBeVisible();
  await expect(page.locator("#file-verdict")).toContainText("Found");
  expect(await page.locator("#notes li").count()).toBeGreaterThan(0);
  await expect(page.locator("#preview mark")).toHaveCount(2);
  await expect(page.locator("#text-verdict")).toContainText("Found");
  const fileDownload = page.waitForEvent("download");
  await page.locator("#download-file").click();
  const download = await fileDownload;
  expect(download.suggestedFilename()).toBe("sample.cleaned.docx");
  const bytes = readFileSync((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(bytes.includes(Buffer.from("​"))).toBe(false);

  // Legacy format is rejected with a message.
  await page.locator("#file-remove").click();
  await expect(page.locator("#file-result")).toBeHidden();
  await expect(page.locator("#preview mark")).toHaveCount(2);
  await page.locator("#file").setInputFiles({ name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("x") });
  await expect(page.locator("#file-error")).toContainText("old binary Office format");

  // Offline: after a reload the service worker serves the whole app, engine included.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status-text")).toHaveText(/Ready/, { timeout: 90_000 });
  await page.locator("#input").fill("a​b");
  await expect(page.locator("#preview mark")).toHaveCount(1);

  expect(foreign).toEqual([]);
});
