import { describe, expect, it } from "vitest";
import { classifyProviderReadiness } from "./readiness";

describe("classifyProviderReadiness", () => {
  it("classifies successful provider tests as usable", () => {
    expect(classifyProviderReadiness({ ok: true })).toMatchObject({
      category: "usable",
    });
  });

  it("classifies missing models", () => {
    expect(
      classifyProviderReadiness({
        error: "model not found: deepseek/deepseek-chat",
      })
    ).toMatchObject({
      category: "model_not_found",
    });
  });

  it("classifies missing or invalid credentials", () => {
    expect(
      classifyProviderReadiness({
        error: 'No API key or OAuth token found for "deepseek"',
      })
    ).toMatchObject({
      category: "missing_credential",
    });
    expect(
      classifyProviderReadiness({
        status: 401,
        error: "Unauthorized",
      })
    ).toMatchObject({
      category: "missing_credential",
    });
  });

  it("classifies quota and resource-package errors", () => {
    expect(
      classifyProviderReadiness({
        status: 429,
        error: "429 余额不足或无可用资源包,请充值。",
      })
    ).toMatchObject({
      category: "quota_or_resources",
    });
  });

  it("classifies timeouts", () => {
    expect(
      classifyProviderReadiness({
        error: "Test timed out",
      })
    ).toMatchObject({
      category: "timeout",
    });
  });
});
