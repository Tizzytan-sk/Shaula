import { beforeEach, describe, expect, it } from "vitest";
import { inferAdvisoryRouteDecision } from "./advisory";
import {
  __resetRouteDecisionsForTest,
  latestRouteDecision,
  listRouteDecisions,
  recordRouteDecision,
} from "./server-store";

describe("advisory task router", () => {
  beforeEach(() => {
    __resetRouteDecisionsForTest();
  });

  it("routes browser-shaped requests to browser_task", () => {
    const decision = inferAdvisoryRouteDecision({
      agentId: "agent-1",
      text: "打开 localhost 页面并检查截图",
      createdAt: 1,
    });

    expect(decision.route).toBe("browser_task");
    expect(decision.reasons.join(" ")).toMatch(/browser/i);
  });

  it("routes mentioned specialist requests to subagent_batch", () => {
    const decision = inferAdvisoryRouteDecision({
      agentId: "agent-1",
      text: "让专家并行检查这几个模块",
      mentionedAgents: ["reviewer"],
      createdAt: 1,
    });

    expect(decision.route).toBe("subagent_batch");
  });

  it("applies route override only when a reason is provided", () => {
    const ignored = inferAdvisoryRouteDecision({
      agentId: "agent-1",
      text: "hello",
      override: { route: "goal" },
      createdAt: 1,
    });
    const applied = inferAdvisoryRouteDecision({
      agentId: "agent-1",
      text: "hello",
      override: { route: "goal", reason: "User explicitly started a goal." },
      createdAt: 2,
    });

    expect(ignored.route).not.toBe("goal");
    expect(applied.route).toBe("goal");
    expect(applied.overriddenFrom).toBeTruthy();
  });

  it("stores latest route decisions per agent", () => {
    recordRouteDecision(
      inferAdvisoryRouteDecision({
        agentId: "agent-1",
        text: "hello",
        createdAt: 1,
      })
    );
    const second = recordRouteDecision(
      inferAdvisoryRouteDecision({
        agentId: "agent-1",
        text: "按文档继续执行",
        createdAt: 2,
      })
    );

    expect(latestRouteDecision("agent-1")?.id).toBe(second.id);
    expect(listRouteDecisions({ agentId: "agent-1" })).toHaveLength(2);
  });
});
