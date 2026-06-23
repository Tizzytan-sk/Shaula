import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentLifecycleDeps } from "./agent-lifecycle";
import {
  buildAgentExtensionWiring,
  buildWorkflowClarificationRequest,
  workflowFetchUrlRuleId,
} from "./agent-extension-wiring";

describe("agent extension wiring", () => {
  it("normalizes workflow fetch approval rule ids by origin", () => {
    expect(workflowFetchUrlRuleId("https://Example.COM/path?q=1")).toBe(
      "workflow-fetch-url:https://example.com"
    );
    expect(workflowFetchUrlRuleId("http://localhost:3333/a")).toBe(
      "workflow-fetch-url:http://localhost:3333"
    );
    expect(workflowFetchUrlRuleId("not a url")).toBe("workflow-fetch-url");
  });

  it("builds bounded workflow clarification requests", () => {
    const { requestId, request } = buildWorkflowClarificationRequest({
      agentId: "agent-1",
      workflowId: "workflow-1",
      now: 123,
      body: {
        title: "Pick a path",
        question: "Which branch should the workflow take?",
        context: "Some context",
        recommendedOptionId: "missing",
        options: [
          {
            label: "Recommended option with a label that is intentionally long",
            description: "Short description",
            value: "  use-this-value  ",
          },
          {
            id: "second",
            label: "Second",
          },
        ],
      },
    });

    expect(requestId).toBe("workflow-ask-user:workflow-1:123");
    expect(request.id).toBe("agent-1:workflow-ask-user:workflow-1:123");
    expect(request.options[0]).toMatchObject({
      id: "option-1",
      value: "use-this-value",
    });
    expect(request.options[0].label.length).toBeLessThanOrEqual(48);
    expect(request.recommendedOptionId).toBe("option-1");
  });

  it("assembles extension factories and defers MCP loading to the injected loader", async () => {
    const fakeMcpTool = { name: "mcp_fake" } as ToolDefinition;
    const loadMcpTools = vi.fn(async () => [fakeMcpTool]);

    const wiring = await buildAgentExtensionWiring({
      id: "agent-1",
      cwd: "C:/repo",
      enableSubagents: false,
      mcpServers: ["server-a"],
      createAgent: vi.fn(async () => ({
        id: "child-1",
        sessionId: "session-child",
        sessionFile: undefined,
      })),
      getAgent: vi.fn(() => undefined),
      disposeAgent: vi.fn(),
      pushExternalEvent: vi.fn(),
      pushGoalEvent: vi.fn(),
      pushProgressEvent: vi.fn(),
      lifecycleDepsFor: vi.fn(() => ({} as AgentLifecycleDeps)),
      loadMcpTools,
    });

    expect(wiring.recordHolder.current).toBeNull();
    expect(wiring.extensionFactories).toHaveLength(6);
    expect(wiring.customTools).toEqual([fakeMcpTool]);
    expect(loadMcpTools).toHaveBeenCalledWith({
      allowedMcpServers: ["server-a"],
      requestApproval: expect.any(Function),
    });
  });
});
