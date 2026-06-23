import { describe, expect, it } from "vitest";
import { inferAdvisoryRouteDecision } from "@/lib/task-router/advisory";
import { buildContextPacket, renderContextPacketForPrompt } from "./context-packet";
import { summarizeExecutionMode } from "./execution-mode";

describe("agent mode context packets", () => {
  it("derives bounded context packets from advisory execution mode", () => {
    const decision = inferAdvisoryRouteDecision({
      agentId: "agent-mode-test",
      text: "让多个 subagent 并行审查 app 和 lib",
      mentionedAgents: ["reviewer"],
      createdAt: 1,
    });
    const mode = summarizeExecutionMode(decision);
    const packet = buildContextPacket({
      objective: "并行审查 app 和 lib 的风险",
      taskTitle: "Review app components",
      includeContext: [
        { kind: "file", ref: "app/ChatApp.tsx", summary: "main chat shell" },
      ],
      excludeContext: ["不要修改文件"],
      relevantPaths: ["app", "lib"],
      requiredEvidence: ["review_notes"],
      outputFormat: "review",
      mustInclude: ["结论", "依据", "风险"],
      modeSummary: mode ?? undefined,
      routeDecision: decision,
    });

    expect(mode).toMatchObject({
      mode: "subagent_coordinator",
      advisoryOnly: true,
      permissionProfile: expect.stringContaining("只读"),
    });
    expect(packet).toMatchObject({
      mode: "subagent_coordinator",
      routeDecisionId: decision.id,
      taskBoundary: expect.stringContaining("每个子任务"),
      writePaths: [],
      requiredEvidence: ["review_notes"],
      outputContract: {
        format: "review",
        mustInclude: ["结论", "依据", "风险"],
        mustNotDo: [],
      },
    });
  });

  it("renders prompt text that makes write and evidence boundaries explicit", () => {
    const packet = buildContextPacket({
      objective: "实现 Team 工作流模板",
      taskTitle: "Implement workflow template",
      taskBoundary: "只实现 workflow template，不修改 provider routing。",
      relevantPaths: ["lib/workflows", "docs/examples/workflow-templates"],
      writePaths: ["docs/examples/workflow-templates"],
      requiredEvidence: ["diff", "test_result"],
      outputFormat: "patch",
      mustNotDo: ["不要改 provider/model routing"],
    });

    const rendered = renderContextPacketForPrompt(packet);

    expect(rendered).toContain("write boundary: docs/examples/workflow-templates");
    expect(rendered).toContain("required evidence: diff, test_result");
    expect(rendered).toContain("不要改 provider/model routing");
  });
});
