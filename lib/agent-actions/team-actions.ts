import { completeSimple } from "@earendil-works/pi-ai";
import {
  getModelRegistry,
  type AgentRecord,
} from "@/lib/agent-registry";
import { listEvidence } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import { getExecutionContract } from "@/lib/execution-contract/store";
import { getGoal } from "@/lib/goal/server-store";
import { classifyProviderReadiness } from "@/lib/auth/readiness";
import { listTeamTasks } from "@/lib/team-state/server-store";
import {
  applyTeamSynthesisAssistance,
  buildTeamSynthesisAssistancePrompt,
  fingerprintTeamSynthesis,
  synthesizeTeamTasks as stateSynthesizeTeamTasks,
  type TeamTaskSynthesisAssistanceDraft,
} from "@/lib/team-state/synthesis";
import {
  getTeamSynthesisAssistance,
  putTeamSynthesisAssistance,
  teamSynthesisAssistanceWithMeta,
  type TeamSynthesisAssistanceModelInfo,
} from "@/lib/team-state/synthesis-assistance-store";
import { verifyTeamTasks } from "@/lib/team-state/verifier";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const TEAM_POST_ACTIONS = new Set(["team_synthesis_assist"]);

interface TeamAssistUserError {
  code:
    | "missing_credential"
    | "quota_or_resources"
    | "timeout"
    | "provider_error"
    | "invalid_model_output"
    | "local_model_unsupported"
    | "no_synthesis";
  title: string;
  message: string;
  actionLabel: string;
  retryable: boolean;
}

export function isTeamPostAction(type: string): boolean {
  return TEAM_POST_ACTIONS.has(type);
}

export interface TeamSynthesisAssistModelCallerInput {
  prompt: string;
  rec: AgentRecord;
  signal: AbortSignal;
  onResponse?: (status?: number) => void;
}

export type TeamSynthesisAssistModelCaller = (
  input: TeamSynthesisAssistModelCallerInput
) => Promise<AssistantMessage>;

export async function handleTeamPostAction({
  type,
  agentId,
  rec,
  body,
  callModel = callCurrentModelForTeamSynthesis,
}: {
  type: string;
  agentId: string;
  rec: AgentRecord;
  body: Record<string, unknown>;
  callModel?: TeamSynthesisAssistModelCaller;
}): Promise<AgentPostActionResult> {
  switch (type) {
    case "team_synthesis_assist":
      return handleTeamSynthesisAssist({ agentId, rec, body, callModel });
    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}

async function handleTeamSynthesisAssist({
  agentId,
  rec,
  body,
  callModel,
}: {
  agentId: string;
  rec: AgentRecord;
  body: Record<string, unknown>;
  callModel: TeamSynthesisAssistModelCaller;
}): Promise<AgentPostActionResult> {
  const force = body.force === true;
  const state = buildTeamSynthesisAssistState(agentId, rec);
  if (!state.synthesis) {
    return teamAssistErrorAction("no team synthesis available for this agent", 400);
  }
  const fingerprint = fingerprintTeamSynthesis(state.synthesis);
  const cached = getTeamSynthesisAssistance(agentId, fingerprint);
  if (cached && !force) {
    const assistance = teamSynthesisAssistanceWithMeta(cached, true);
    return okAction({
      ok: true,
      cached: true,
      fingerprint,
      assistance,
      teamTaskSynthesis: {
        ...state.synthesis,
        assistance,
      },
      model: cached.model ?? null,
    });
  }

  const prompt = buildTeamSynthesisAssistancePrompt({
    synthesis: state.synthesis,
    tasks: state.teamTasks,
    evidence: state.ledgerEvidence,
    verification: state.teamTaskVerification,
  });
  const startedAt = Date.now();
  let httpStatus: number | undefined;
  const ac = new AbortController();
  const timeoutMs =
    typeof body.timeoutMs === "number"
      ? Math.max(1_000, Math.min(body.timeoutMs, 60_000))
      : 20_000;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const message = await callModel({
      prompt,
      rec,
      signal: ac.signal,
      onResponse: (status) => {
        httpStatus = status;
      },
    });
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return teamAssistErrorAction(
        message.errorMessage ??
          (ac.signal.aborted
            ? "Team synthesis assistance timed out"
            : "Model returned an error"),
        502,
        httpStatus
      );
    }
    const draft = parseTeamSynthesisAssistanceDraft(extractText(message));
    const assisted = applyTeamSynthesisAssistance(
      state.synthesis,
      draft,
      Date.now()
    );
    const model = modelInfo(rec);
    const usage = usageInfo(message);
    const latencyMs = Date.now() - startedAt;
    const record = putTeamSynthesisAssistance({
      agentId,
      fingerprint,
      assistance: assisted.assistance!,
      model,
      latencyMs,
      httpStatus,
      tokenCount: usage.tokenCount,
      estimatedCost: usage.estimatedCost,
      createdAt: assisted.assistance!.generatedAt,
      updatedAt: assisted.assistance!.generatedAt,
    });
    const assistance = teamSynthesisAssistanceWithMeta(record, false);
    return okAction({
      ok: true,
      cached: false,
      fingerprint,
      latencyMs,
      status: httpStatus,
      assistance,
      teamTaskSynthesis: { ...assisted, assistance },
      model: model ?? null,
    });
  } catch (error) {
    return teamAssistErrorAction(error, teamAssistStatus(error, httpStatus), httpStatus);
  } finally {
    clearTimeout(timer);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function teamAssistStatus(error: unknown, httpStatus?: number): number {
  if (httpStatus && httpStatus >= 400) return httpStatus;
  const message = errorText(error).toLowerCase();
  if (/no api key|oauth token|auth failed|unauthorized|invalid api key/.test(message)) {
    return 401;
  }
  if (/quota|billing|balance|insufficient|rate limit|429/.test(message)) {
    return 429;
  }
  if (/timeout|timed out|aborted/.test(message)) return 504;
  if (/no team synthesis/.test(message)) return 400;
  if (/local cli/.test(message)) return 400;
  return 502;
}

function classifyTeamAssistError(
  error: unknown,
  status: number,
  httpStatus?: number
): TeamAssistUserError {
  const raw = errorText(error);
  const text = raw.toLowerCase();
  if (/no team synthesis/.test(text)) {
    return {
      code: "no_synthesis",
      title: "Team synthesis 尚不可用",
      message: "当前会话还没有可汇总的 Team task。先运行 Team review 或 implementation 后再试。",
      actionLabel: "稍后重试",
      retryable: true,
    };
  }
  if (/local cli/.test(text)) {
    return {
      code: "local_model_unsupported",
      title: "当前模型不支持 Team assist",
      message: "本地 CLI 模型没有可调用的 provider 接口。请切换到已配置的 API 或 OAuth 模型后再试。",
      actionLabel: "切换模型",
      retryable: true,
    };
  }
  if (/json object|json\.parse|did not return.*json|model did not return/.test(text)) {
    return {
      code: "invalid_model_output",
      title: "模型输出格式不对",
      message: "Team assist 需要模型返回 JSON。缓存没有更新，你可以重试或切换模型。",
      actionLabel: "重试",
      retryable: true,
    };
  }
  const classified = classifyProviderReadiness({
    error: raw,
    status: httpStatus ?? status,
  });
  if (classified.category === "missing_credential") {
    return {
      code: "missing_credential",
      title: "模型凭证不可用",
      message: "当前 provider 的 API key 或 OAuth 凭证缺失、过期或被拒绝。修复凭证后再试。",
      actionLabel: "去设置",
      retryable: true,
    };
  }
  if (classified.category === "quota_or_resources") {
    return {
      code: "quota_or_resources",
      title: "模型额度不可用",
      message: "Provider 返回限流、欠费或额度不足。稍后重试，或切换到其他可用模型。",
      actionLabel: "切换模型",
      retryable: true,
    };
  }
  if (classified.category === "timeout") {
    return {
      code: "timeout",
      title: "Team assist 超时",
      message: "模型响应超时，缓存没有更新。可以直接重试，或换一个响应更快的模型。",
      actionLabel: "重试",
      retryable: true,
    };
  }
  return {
    code: "provider_error",
    title: "模型服务返回错误",
    message: "Team assist 没有更新缓存。已有的 deterministic synthesis 和旧缓存不会被覆盖。",
    actionLabel: "重试",
    retryable: true,
  };
}

function teamAssistErrorAction(
  error: unknown,
  status: number,
  httpStatus?: number
): AgentPostActionResult {
  const userError = classifyTeamAssistError(error, status, httpStatus);
  return {
    status,
    body: {
      error: userError.message,
      rawError: errorText(error),
      userError,
    },
  };
}

function buildTeamSynthesisAssistState(agentId: string, rec: AgentRecord) {
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
  const synthesis = teamTasks.length
    ? stateSynthesizeTeamTasks({
        tasks: teamTasks,
        evidence: ledgerEvidence,
        verification: teamTaskVerification,
      })
    : null;
  return {
    teamTasks,
    ledgerEvidence,
    teamTaskVerification,
    synthesis,
  };
}

function modelInfo(rec: AgentRecord): TeamSynthesisAssistanceModelInfo | undefined {
  return rec.session.model
    ? {
        provider: rec.session.model.provider,
        id: rec.session.model.id,
        name: rec.session.model.name,
      }
    : undefined;
}

function usageInfo(message: AssistantMessage): {
  tokenCount?: number;
  estimatedCost?: number;
} {
  const usage = message.usage as
    | {
        totalTokens?: unknown;
        cost?: { total?: unknown };
      }
    | undefined;
  return {
    tokenCount:
      typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined,
    estimatedCost:
      typeof usage?.cost?.total === "number" ? usage.cost.total : undefined,
  };
}

async function callCurrentModelForTeamSynthesis({
  prompt,
  rec,
  signal,
  onResponse,
}: TeamSynthesisAssistModelCallerInput): Promise<AssistantMessage> {
  const model = rec.session.model;
  if (!model) throw new Error("model not ready");
  if (model.baseUrl === "local-cli") {
    throw new Error("team_synthesis_assist is not available for local CLI models");
  }
  const registry = getModelRegistry();
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`auth failed: ${auth.error}`);
  if (!auth.apiKey) {
    throw new Error(`No API key or OAuth token found for "${model.provider}"`);
  }
  return completeSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      maxTokens: 900,
      timeoutMs: 20_000,
      maxRetries: 0,
      cacheRetention: "none",
      signal,
      onResponse: (response: { status?: number }) => {
        onResponse?.(response?.status);
      },
    }
  );
}

function extractText(message: AssistantMessage): string {
  type TextBlock = Extract<AssistantMessage["content"][number], { type: "text" }>;
  return message.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseTeamSynthesisAssistanceDraft(
  text: string
): TeamTaskSynthesisAssistanceDraft {
  const parsed = parseJsonObject(text);
  return {
    headline: typeof parsed.headline === "string" ? parsed.headline : undefined,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    status:
      parsed.status === "ready" ||
      parsed.status === "warning" ||
      parsed.status === "failed"
        ? parsed.status
        : undefined,
    itemIds: stringArray(parsed.itemIds),
    taskIds: stringArray(parsed.taskIds),
    evidenceIds: stringArray(parsed.evidenceIds),
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map(
      (match) => match[1]?.trim() ?? ""
    ),
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new Error("model did not return a JSON object");
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length ? out : undefined;
}

function compareByCreatedAt<T extends { id: string; createdAt: number }>(
  a: T,
  b: T
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function mergeEvidenceRefs(...lists: EvidenceRef[][]): EvidenceRef[] {
  const byId = new Map<string, EvidenceRef>();
  for (const list of lists) {
    for (const item of list) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareByCreatedAt);
}
