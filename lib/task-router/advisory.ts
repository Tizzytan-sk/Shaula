import { createHash } from "node:crypto";
import type {
  AdvisoryRouteDecision,
  AdvisoryRouteKind,
  InferAdvisoryRouteInput,
} from "./types";

function cleanText(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function stableId(input: InferAdvisoryRouteInput, createdAt: number): string {
  const digest = createHash("sha1")
    .update([input.agentId, input.text, createdAt].join(":"))
    .digest("hex")
    .slice(0, 10);
  return `route-${createdAt}-${digest}`;
}

function route(
  input: InferAdvisoryRouteInput,
  routeKind: AdvisoryRouteKind,
  confidence: number,
  reasons: string[],
  createdAt: number
): AdvisoryRouteDecision {
  return {
    id: stableId(input, createdAt),
    agentId: input.agentId,
    route: routeKind,
    confidence,
    reasons,
    inputPreview: cleanText(input.text, 240),
    createdAt,
  };
}

export function inferAdvisoryRouteDecision(
  input: InferAdvisoryRouteInput
): AdvisoryRouteDecision {
  const createdAt = input.createdAt ?? Date.now();
  const text = cleanText(input.text, 4000);
  const lower = normalize(text);
  let decision: AdvisoryRouteDecision;

  if (!text || text.length < 3) {
    decision = route(input, "ask_user", 0.75, ["The request is too short to route safely."], createdAt);
  } else if ((input.mentionedAgents?.length ?? 0) > 0 || /subagent|parallel|并行|多个agent|多个 agent|专家/.test(lower)) {
    decision = route(input, "subagent_batch", 0.82, ["The request mentions specialist or parallel agent work."], createdAt);
  } else if (/browser|网页|浏览器|click|screenshot|localhost|打开页面|页面检查/.test(lower)) {
    decision = route(input, "browser_task", 0.78, ["The request appears to need browser observation or interaction."], createdAt);
  } else if (/workflow template|模板工作流|template/.test(lower)) {
    decision = route(input, "workflow_template", 0.72, ["The request explicitly references a workflow template."], createdAt);
  } else if (/workflow|harness|工作流|编排|脚本/.test(lower)) {
    decision = route(input, "workflow_script", 0.68, ["The request appears to need a repeatable workflow or harness."], createdAt);
  } else if (
    input.hasActiveGoal ||
    /执行|实现|改代码|修复|优化|按文档|继续|完成|落地|多步|计划/.test(lower) ||
    (input.attachments?.length ?? 0) > 0
  ) {
    decision = route(input, "goal", 0.7, ["The request likely requires multi-step execution and evidence."], createdAt);
  } else {
    decision = route(input, "direct", 0.62, ["The request looks answerable in the current turn."], createdAt);
  }

  const overrideRoute = input.override?.route;
  const overrideReason = cleanText(input.override?.reason, 500);
  if (overrideRoute && overrideReason) {
    return {
      ...decision,
      route: overrideRoute,
      confidence: Math.max(decision.confidence, 0.8),
      reasons: [...decision.reasons, `Override: ${overrideReason}`],
      overriddenFrom: decision.route,
      overrideReason,
    };
  }
  return decision;
}
