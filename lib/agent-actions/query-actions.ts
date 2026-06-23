import type { AgentRecord } from "@/lib/agent-registry";
import { stripContextAside } from "@/lib/context-aside";
import { listEvaluationActions } from "@/lib/evaluation-actions/store";
import { listEvidence } from "@/lib/evidence/server-store";
import type {
  EvidenceKind,
  EvidenceRef,
  EvidenceSourceType,
  EvidenceTrustLevel,
} from "@/lib/evidence/types";
import { getExecutionContract } from "@/lib/execution-contract/store";
import {
  getGoal,
  listGoalEvidence,
  listGoalTurns,
} from "@/lib/goal/server-store";
import {
  latestRouteDecision,
  listRouteDecisions,
} from "@/lib/task-router/server-store";
import { listRuntimeEvents } from "@/lib/runtime/event-store";
import { listTeamTasks } from "@/lib/team-state/server-store";
import {
  fingerprintTeamSynthesis,
  synthesizeTeamTasks,
} from "@/lib/team-state/synthesis";
import {
  getTeamSynthesisAssistance,
  teamSynthesisAssistanceWithMeta,
} from "@/lib/team-state/synthesis-assistance-store";
import { verifyTeamTasks } from "@/lib/team-state/verifier";
import type {
  RuntimeEvent,
  RuntimeEventSource,
  RuntimeEventStatus,
} from "@/lib/runtime/events";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const QUERY_ACTIONS = new Set([
  "get_tools",
  "thinking_levels",
  "user_messages_for_forking",
  "tree",
  "system_prompt",
  "goal_timeline",
  "route_decisions",
  "runtime_events",
  "evidence",
  "stats",
]);

export function isAgentQueryAction(action: string | null): action is string {
  return typeof action === "string" && QUERY_ACTIONS.has(action);
}

export async function handleAgentQueryAction({
  action,
  agentId,
  rec,
  url,
}: {
  action: string;
  agentId: string;
  rec: AgentRecord;
  url: URL;
}): Promise<AgentPostActionResult> {
  switch (action) {
    case "get_tools":
      return getTools(rec);
    case "thinking_levels":
      return okAction({
        levels: rec.session.getAvailableThinkingLevels(),
        current: rec.session.thinkingLevel,
        supports: rec.session.supportsThinking(),
      });
    case "user_messages_for_forking": {
      const messages = rec.session.getUserMessagesForForking().map((m) => ({
        ...m,
        text: typeof m.text === "string" ? stripContextAside(m.text) : m.text,
      }));
      return okAction({ messages });
    }
    case "tree":
      return getTree(rec);
    case "system_prompt":
      return getSystemPrompt(rec);
    case "goal_timeline":
      return getGoalTimeline(agentId, rec);
    case "route_decisions":
      return okAction({
        decisions: listRouteDecisions({ agentId }),
      });
    case "runtime_events":
      return getRuntimeEvents(agentId, rec, url);
    case "evidence":
      return getEvidence(agentId, rec, url);
    case "stats":
      return getStats(rec);
    default:
      return errorAction(`unknown query action: ${action}`, 400);
  }
}

function getTools(rec: AgentRecord): AgentPostActionResult {
  try {
    const all = rec.session.getAllTools();
    const active = rec.session.getActiveToolNames();
    return okAction({ tools: all, active });
  } catch (e) {
    return {
      body: { error: (e as Error).message, tools: [], active: [] },
      status: 500,
    };
  }
}

function getTree(rec: AgentRecord): AgentPostActionResult {
  try {
    const sm = rec.session.sessionManager;
    const tree = sm.getTree();
    const leafId = sm.getLeafId();
    return okAction({ tree, leafId });
  } catch (e) {
    return {
      body: { error: (e as Error).message, tree: [], leafId: null },
      status: 500,
    };
  }
}

function getSystemPrompt(rec: AgentRecord): AgentPostActionResult {
  try {
    return okAction({
      systemPrompt: rec.session.systemPrompt ?? "",
    });
  } catch (e) {
    return {
      body: { error: (e as Error).message, systemPrompt: "" },
      status: 500,
    };
  }
}

function getGoalTimeline(
  agentId: string,
  rec: AgentRecord
): AgentPostActionResult {
  const goal = getGoal(agentId);
  const contract = getExecutionContract(goal?.contractId);
  const ledgerEvidence = mergeEvidenceRefs(
    listEvidence({ agentId }),
    listEvidence({ sessionId: rec.session.sessionId })
  );
  const teamTasks = listTeamTasks({ agentId });
  const teamTaskVerification = verifyTeamTasks({
    tasks: teamTasks,
    evidence: ledgerEvidence,
    requiredEvidence: teamTasks.length > 0 ? contract?.requiredEvidence : undefined,
  });
  const teamTaskSynthesis = synthesizeTeamTasks({
    tasks: teamTasks,
    evidence: ledgerEvidence,
    verification: teamTaskVerification,
  });
  const cachedAssistance = teamTaskSynthesis
    ? getTeamSynthesisAssistance(
        agentId,
        fingerprintTeamSynthesis(teamTaskSynthesis)
      )
    : null;
  const assistance = cachedAssistance
    ? teamSynthesisAssistanceWithMeta(cachedAssistance, true)
    : null;
  return okAction({
    goal,
    contract,
    lastClosure: goal?.lastClosure ?? null,
    turns: listGoalTurns(agentId),
    evidence: listGoalEvidence(agentId),
    ledgerEvidence,
    teamTasks,
    teamTaskVerification,
    teamTaskSynthesis:
      teamTaskSynthesis && assistance
        ? { ...teamTaskSynthesis, assistance }
        : teamTaskSynthesis,
    actions: listEvaluationActions({ agentId, status: "open" }),
    routeDecision: latestRouteDecision(agentId),
  });
}

function getRuntimeEvents(
  agentId: string,
  rec: AgentRecord,
  url: URL
): AgentPostActionResult {
  const baseFilter = {
    source: parseRuntimeEventSource(url.searchParams.get("source")),
    status: parseRuntimeEventStatus(url.searchParams.get("status")),
    browserId: url.searchParams.get("browserId") ?? undefined,
    taskId: url.searchParams.get("taskId") ?? undefined,
    workflowId: url.searchParams.get("workflowId") ?? undefined,
    parentId: url.searchParams.get("parentId") ?? undefined,
  };
  return okAction({
    events: mergeRuntimeEvents(
      listRuntimeEvents({ ...baseFilter, agentId }),
      listRuntimeEvents({ ...baseFilter, sessionId: rec.session.sessionId })
    ),
  });
}

function getEvidence(
  agentId: string,
  rec: AgentRecord,
  url: URL
): AgentPostActionResult {
  const baseFilter = {
    kind: parseEvidenceKind(url.searchParams.get("kind")),
    trustLevel: parseEvidenceTrustLevel(url.searchParams.get("trustLevel")),
    sourceType: parseEvidenceSourceType(url.searchParams.get("sourceType")),
    contractCriterionId:
      url.searchParams.get("contractCriterionId") ?? undefined,
    rubricCriterionId: url.searchParams.get("rubricCriterionId") ?? undefined,
    browserId: url.searchParams.get("browserId") ?? undefined,
    taskId: url.searchParams.get("taskId") ?? undefined,
    workflowId: url.searchParams.get("workflowId") ?? undefined,
  };
  return okAction({
    evidence: mergeEvidenceRefs(
      listEvidence({ ...baseFilter, agentId }),
      listEvidence({ ...baseFilter, sessionId: rec.session.sessionId })
    ),
  });
}

function getStats(rec: AgentRecord): AgentPostActionResult {
  try {
    const stats = rec.session.getSessionStats();
    const ctxUsage = rec.session.getContextUsage();
    const model = rec.session.model;
    return okAction({
      stats,
      contextUsage: ctxUsage ?? null,
      contextWindow: model?.contextWindow ?? null,
      model: model
        ? { provider: model.provider, id: model.id, name: model.name }
        : null,
    });
  } catch (e) {
    return { body: { error: (e as Error).message }, status: 500 };
  }
}

export function parseRuntimeEventSource(
  value: string | null
): RuntimeEventSource | undefined {
  return value === "agent" ||
    value === "browser" ||
    value === "workflow" ||
    value === "subagent" ||
    value === "goal" ||
    value === "approval" ||
    value === "progress"
    ? value
    : undefined;
}

export function parseRuntimeEventStatus(
  value: string | null
): RuntimeEventStatus | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "done" ||
    value === "error" ||
    value === "blocked" ||
    value === "aborted"
    ? value
    : undefined;
}

export function parseEvidenceKind(value: string | null): EvidenceKind | undefined {
  return value === "browser_snapshot" ||
    value === "browser_step" ||
    value === "browser_annotation" ||
    value === "workflow_artifact" ||
    value === "subagent_result" ||
    value === "goal_turn" ||
    value === "approval_decision" ||
    value === "progress_artifact" ||
    value === "verification_result" ||
    value === "log"
    ? value
    : undefined;
}

export function parseEvidenceTrustLevel(
  value: string | null
): EvidenceTrustLevel | undefined {
  return value === "agent_reported" ||
    value === "textual_log" ||
    value === "artifact_reference" ||
    value === "deterministic_check" ||
    value === "host_observed" ||
    value === "user_confirmed"
    ? value
    : undefined;
}

export function parseEvidenceSourceType(
  value: string | null
): EvidenceSourceType | undefined {
  return value === "agent" ||
    value === "browser" ||
    value === "progress" ||
    value === "workflow" ||
    value === "subagent" ||
    value === "approval" ||
    value === "goal" ||
    value === "task" ||
    value === "system" ||
    value === "unknown"
    ? value
    : undefined;
}

function compareByCreatedAt<T extends { id: string; createdAt: number }>(
  a: T,
  b: T
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

export function mergeEvidenceRefs(...lists: EvidenceRef[][]): EvidenceRef[] {
  const byId = new Map<string, EvidenceRef>();
  for (const list of lists) {
    for (const item of list) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareByCreatedAt);
}

export function mergeRuntimeEvents(...lists: RuntimeEvent[][]): RuntimeEvent[] {
  const byId = new Map<string, RuntimeEvent>();
  for (const list of lists) {
    for (const item of list) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareByCreatedAt);
}
