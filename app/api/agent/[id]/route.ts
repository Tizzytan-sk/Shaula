/**
 * /api/agent/[id]
 *
 * 单口多 action（对齐 @agegr/pi-web）。
 *
 * POST body 形如 { type: "<action>", ...args }
 * 支持的 action（snake_case）：
 *   - prompt              { text }                            发送一条 user message
 *   - steer               { text }                            打断当前 turn，立即插入
 *   - follow_up           { text }                            追加到当前 turn 后
 *   - abort                                                   中止当前 agent 操作
 *   - abort_compaction                                        取消进行中的压缩
 *   - compact             { customInstructions? }             手动触发压缩
 *   - set_model           { provider, modelId }               切换模型
 *   - set_thinking_level  { level }                           切换 thinking level
 *   - get_tools                                               读取当前工具列表（GET 形态在下方）
 *   - set_tools           { tools: string[] }                 设置工具白名单（暂未接 SDK，预留）
 *   - navigate_tree       { targetId, summarize?, ... }       fork/分支跳转
 */
import { NextResponse } from "next/server";
import {
  describeAgentRuntime,
  disposeAgent,
  getAgent,
} from "@/lib/agent-registry";
import {
  getGoal,
} from "@/lib/goal/server-store";
import { getExecutionContract } from "@/lib/execution-contract/store";
import {
  getProgress,
} from "@/lib/progress/server-store";
import { readPersistedProgress } from "@/lib/progress/file-store";
import { listPendingClarifications } from "@/lib/clarification/server-store";
import { assertRemoteAuth } from "@/lib/remote/auth";
import {
  handleGoalPostAction,
  isGoalPostAction,
} from "@/lib/agent-actions/goal-actions";
import {
  handleProgressEvidencePostAction,
  isProgressEvidencePostAction,
} from "@/lib/agent-actions/progress-actions";
import {
  handleModelToolPostAction,
  isModelToolPostAction,
} from "@/lib/agent-actions/model-tool-actions";
import {
  handlePromptPostAction,
  isPromptPostAction,
} from "@/lib/agent-actions/prompt-actions";
import {
  handleAgentQueryAction,
  isAgentQueryAction,
} from "@/lib/agent-actions/query-actions";
import {
  handleTeamPostAction,
  isTeamPostAction,
} from "@/lib/agent-actions/team-actions";
import {
  handleLifecyclePostAction,
  isLifecyclePostAction,
} from "@/lib/agent-actions/lifecycle-actions";
import type { AgentPostActionResult } from "@/lib/agent-actions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: agent meta + 可选 ?action=<query_action> */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertRemoteAuth(req);
  if (auth) return auth;
  const { id } = await params;
  const rec = getAgent(id);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (isAgentQueryAction(action)) {
    return actionResultResponse(
      await handleAgentQueryAction({ action, agentId: id, rec, url })
    );
  }

  const memoryProgress = getProgress(id);
  const persistedProgress =
    memoryProgress.groups.length === 0 &&
    memoryProgress.steps.length === 0 &&
    memoryProgress.artifacts.length === 0
      ? await readPersistedProgress(rec.session.sessionId)
      : null;
  const goal = getGoal(id);

  return NextResponse.json({
    id: rec.id,
    sessionId: rec.session.sessionId,
    sessionFile: rec.session.sessionFile,
    isStreaming: rec.isStreaming || rec.isPromptStarting,
    isPromptStarting: rec.isPromptStarting,
    pendingClarificationCount: listPendingClarifications(id).length,
    isCompacting: (rec.session as unknown as { isCompacting?: boolean })
      .isCompacting,
    thinkingLevel: rec.session.thinkingLevel,
    supportsThinking: rec.session.supportsThinking(),
    availableThinkingLevels: rec.session.getAvailableThinkingLevels(),
    model: rec.session.model
      ? {
          provider: rec.session.model.provider,
          id: rec.session.model.id,
          name: rec.session.model.name,
          contextWindow: rec.session.model.contextWindow,
        }
      : null,
    pendingMessageCount: rec.session.pendingMessageCount,
    nextSeq: rec.nextSeq,
    goal,
    contract: getExecutionContract(goal?.contractId ?? rec.activeContractId),
    progress: persistedProgress ?? memoryProgress,
    runtimeProfile: describeAgentRuntime(rec),
  });
}

function actionResultResponse(result: AgentPostActionResult) {
  return result.status
    ? NextResponse.json(result.body, { status: result.status })
    : NextResponse.json(result.body);
}

/** POST: 多 action 派发 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertRemoteAuth(req);
  if (auth) return auth;
  const { id } = await params;
  const rec = getAgent(id);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // 允许空 body（abort 等）
  }

  // 兼容老字段 action（驼峰），新字段 type（snake_case）
  const type =
    (body.type as string | undefined) ?? (body.action as string | undefined);

  if (!type) {
    return NextResponse.json(
      { error: "missing 'type' field" },
      { status: 400 }
    );
  }

  try {
    if (isPromptPostAction(type)) {
      return actionResultResponse(
        await handlePromptPostAction({ type, agentId: id, rec, body })
      );
    }
    if (isGoalPostAction(type)) {
      return actionResultResponse(
        await handleGoalPostAction({ type, agentId: id, rec, body })
      );
    }
    if (isProgressEvidencePostAction(type)) {
      return actionResultResponse(
        await handleProgressEvidencePostAction({
          type,
          agentId: id,
          rec,
          body,
        })
      );
    }
    if (isModelToolPostAction(type)) {
      return actionResultResponse(
        await handleModelToolPostAction({ type, agentId: id, rec, body })
      );
    }

    if (isTeamPostAction(type)) {
      return actionResultResponse(
        await handleTeamPostAction({ type, agentId: id, rec, body })
      );
    }

    if (isLifecyclePostAction(type)) {
      return actionResultResponse(
        await handleLifecyclePostAction({ type, agentId: id, rec, body })
      );
    }

    return NextResponse.json(
      { error: `unknown action: ${type}` },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, stack: (e as Error).stack },
      { status: 500 }
    );
  }
}

/** DELETE: dispose agent */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await assertRemoteAuth(req);
  if (auth) return auth;
  const { id } = await params;
  disposeAgent(id);
  return NextResponse.json({ ok: true });
}
