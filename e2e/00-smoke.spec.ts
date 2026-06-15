import { installApiFixtures, test, expect } from "./fixtures";

test("smoke: ChatApp 挂载成功", async ({ bootedPage: page }) => {
  await expect(page.getByTestId("shaula-app-shell")).toBeVisible();
  // 输入框存在
  const editor = page.locator("textarea, [contenteditable]").first();
  await expect(editor).toBeVisible();
});

test("fixtures: unhandled API routes fail fast", async ({ page }) => {
  await installApiFixtures(page);
  await page.goto("/browser-target-a.html");

  const result = await page.evaluate(async () => {
    const res = await fetch("/api/e2e-unhandled-route");
    return {
      status: res.status,
      body: await res.json(),
    };
  });

  expect(result.status).toBe(500);
  expect(result.body.error).toContain("Unhandled E2E API fixture");
});
