import { describe, expect, it } from "vitest";
import {
  curateProviderModels,
  pickDefaultProviderModel,
} from "./default-model";

type TestProvider = {
  provider: string;
  hasAuth?: boolean;
  models: Array<{ id: string; name?: string }>;
};

describe("default model helpers", () => {
  it("keeps authenticated providers that are not in curated defaults", () => {
    const providers: TestProvider[] = [
      {
        provider: "deepseek",
        hasAuth: true,
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
        ],
      },
      {
        provider: "zhipu",
        hasAuth: true,
        models: [{ id: "glm-5.1", name: "GLM-5.1" }],
      },
      {
        provider: "anthropic",
        hasAuth: false,
        models: [{ id: "claude-sonnet-4-5" }],
      },
    ];

    expect(curateProviderModels(providers).map((provider) => provider.provider)).toEqual([
      "deepseek",
      "zhipu",
    ]);
  });

  it("picks the first authenticated provider when the curated default is not available", () => {
    const providers: TestProvider[] = [
      {
        provider: "deepseek",
        hasAuth: true,
        models: [
          { id: "deepseek-v4-flash" },
          { id: "deepseek-v4-pro" },
        ],
      },
    ];

    expect(pickDefaultProviderModel(providers)).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
    });
  });
});
