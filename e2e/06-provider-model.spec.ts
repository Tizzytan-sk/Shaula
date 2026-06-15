import {
  expect,
  installApiFixtures,
  installSseMock,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";

const editor = (page: Page) => page.locator("textarea").first();
const sendBtn = (page: Page) => page.getByRole("button", { name: /^Send$/ });
const providerSelect = (page: Page) => page.getByTestId("provider-select");
const modelSelect = (page: Page) => page.getByTestId("model-select");

const providersResponse = {
  providers: [
    {
      provider: "openai-codex",
      displayName: "ChatGPT Plus/Pro (Codex Subscription)",
      hasAuth: true,
      authSource: "runtime",
      authLabel: "mock",
      models: [
        {
          id: "gpt-5.5",
          name: "GPT-5.5",
          reasoning: true,
          contextWindow: 200_000,
          maxTokens: 8192,
        },
      ],
    },
    {
      provider: "minimax-cn",
      displayName: "MiniMax",
      hasAuth: true,
      authSource: "models_json_key",
      authLabel: "models.json",
      models: [
        {
          id: "MiniMax-M2.7-highspeed",
          name: "MiniMax 2.7 highspeed",
          reasoning: true,
          contextWindow: 200_000,
          maxTokens: 8192,
        },
      ],
    },
  ],
  total: 2,
  authedCount: 2,
  defaultProvider: "openai-codex",
  defaultModelId: "gpt-5.5",
};

test("provider switch selects the provider's first model before set_model", async ({
  page,
}) => {
  await installSseMock(page);
  await installApiFixtures(page, { providersResponse });

  await page.goto("/?e2e=1");
  await page.evaluate(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.reload();
  await page.waitForSelector('[data-testid="shaula-app-shell"]', { timeout: 10_000 });

  await editor(page).fill("hello");
  await sendBtn(page).click();

  let setModelBody: unknown = null;
  await page.route("**/api/agent/agent-1", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          id: "agent-1",
          thinkingLevel: "medium",
          supportsThinking: true,
          availableThinkingLevels: ["low", "medium", "high"],
        },
      });
    }
    let body: { type?: string } | null = null;
    try {
      body = route.request().postDataJSON() as { type?: string };
    } catch {
      body = null;
    }
    if (body?.type === "set_model") setModelBody = body;
    return route.fulfill({ json: { ok: true } });
  });

  const providers = providerSelect(page);
  const models = modelSelect(page);
  await expect(providers).toHaveValue("openai-codex");
  await expect(models).toHaveValue("gpt-5.5");

  await providers.selectOption("minimax-cn");

  await expect(models).toHaveValue("MiniMax-M2.7-highspeed");
  await expect
    .poll(() => setModelBody)
    .toEqual({
      type: "set_model",
      provider: "minimax-cn",
      modelId: "MiniMax-M2.7-highspeed",
    });
  await expect(page.getByText("provider and modelId required")).toBeHidden();
});

test("provider/model selection resets stale localStorage to curated default", async ({
  page,
}) => {
  await installSseMock(page);
  await installApiFixtures(page, { providersResponse });
  await page.addInitScript(() => {
    localStorage.setItem("pi-provider-id", "minimax-cn");
    localStorage.setItem("pi-model-id", "gpt-5.2");
  });

  let createBody: unknown = null;
  await page.route("**/api/agent/new", async (route) => {
    createBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
        id: "agent-1",
        sessionId: "00000000-0000-0000-0000-000000000001",
        sessionFile:
          "/tmp/e2e-sessions/00000000-0000-0000-0000-000000000001.jsonl",
        thinkingLevel: "medium",
        supportsThinking: true,
        availableThinkingLevels: ["low", "medium", "high"],
      },
    });
  });

  await page.goto("/?e2e=1");
  await page.waitForSelector('[data-testid="shaula-app-shell"]', { timeout: 10_000 });

  await expect(providerSelect(page)).toHaveValue("openai-codex");
  await expect(modelSelect(page)).toHaveValue("gpt-5.5");

  await editor(page).fill("hello");
  await sendBtn(page).click();

  await expect
    .poll(() => createBody)
    .toEqual(
      expect.objectContaining({
        provider: "openai-codex",
        modelId: "gpt-5.5",
      })
    );
  await expect(page.getByText("model not found")).toBeHidden();
});
