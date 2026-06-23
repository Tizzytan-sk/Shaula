import type { AdvisoryRouteDecision } from "@/lib/task-router/types";
import type { ExecutionModeKind, ExecutionModeSummary } from "./types";

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function executionModeForRoute(
  route: AdvisoryRouteDecision["route"]
): ExecutionModeKind {
  if (route === "subagent_batch") return "subagent_coordinator";
  if (route === "workflow_script" || route === "workflow_template") {
    return "workflow_team";
  }
  if (route === "browser_task") return "browser_verify";
  if (route === "ask_user") return "ask_user";
  return "single_agent";
}

export function summarizeExecutionMode(
  decision: AdvisoryRouteDecision | null | undefined
): ExecutionModeSummary | null {
  if (!decision) return null;
  const mode = executionModeForRoute(decision.route);
  const confidence = clampConfidence(decision.confidence);
  const base = {
    confidence,
    reasons: decision.reasons,
    advisoryOnly: true,
    canSwitch: true,
  };
  if (mode === "subagent_coordinator") {
    return {
      ...base,
      mode,
      label: "子任务协作",
      detail: "建议把独立读取、审查或调研切成 bounded subagent tasks。",
      tone: "running",
      requiresConfirmation: confidence < 0.9,
      contextBoundary: "每个子任务只接收相关文件、任务边界和输出要求。",
      permissionProfile: "默认只读；写入必须声明 writePaths。",
    };
  }
  if (mode === "workflow_team") {
    return {
      ...base,
      mode,
      label: "Team 工作流",
      detail: "建议使用 workflow/checkpoint/artifact 承载多阶段协作。",
      tone: "warning",
      requiresConfirmation: true,
      contextBoundary: "按阶段传递 context packet，避免 worker 共享完整聊天历史。",
      permissionProfile: "高风险能力继续走 approval；实现任务走 worktree。",
    };
  }
  if (mode === "browser_verify") {
    return {
      ...base,
      mode,
      label: "浏览器验收",
      detail: "建议保留 host-observed browser evidence，而不是文本自述。",
      tone: "running",
      requiresConfirmation: false,
      contextBoundary: "只传目标 URL、selector/text 和验收期望。",
      permissionProfile: "浏览器动作仍按工具策略和 host observation 记录。",
    };
  }
  if (mode === "ask_user") {
    return {
      ...base,
      mode,
      label: "等待澄清",
      detail: "当前请求信息不足，先收敛目标或边界再执行。",
      tone: "warning",
      requiresConfirmation: true,
      contextBoundary: "不应拆分执行；先补齐缺失决策。",
      permissionProfile: "不授予新工具或写入权限。",
    };
  }
  return {
    ...base,
    mode,
    label: decision.route === "goal" ? "单 Agent / Goal" : "单 Agent",
    detail:
      decision.route === "goal"
        ? "建议由主 agent 按任务契约推进，并通过 evidence verifier 收尾。"
        : "建议保持当前上下文连续执行，不引入额外 agent 编排。",
    tone: decision.route === "goal" ? "running" : "idle",
    requiresConfirmation: false,
    contextBoundary: "主 agent 保留完整当前上下文；必要时再生成更窄 context packet。",
    permissionProfile: "沿用当前 session 工具策略和 goal verifier。",
  };
}
