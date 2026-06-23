import {
  claimClientRequest,
  clearClientRequest,
  isLocalCodingAssistantAgent,
  promptLocalCodingAssistantAgent,
  pushProgressEvent,
  type AgentRecord,
} from "@/lib/agent-registry";
import {
  CONTEXT_ASIDE_CLOSE,
  CONTEXT_ASIDE_OPEN,
} from "@/lib/context-aside";
import { buildExecutionContract } from "@/lib/execution-contract/build";
import { putExecutionContract } from "@/lib/execution-contract/store";
import type {
  ExecutionContract,
  ExecutionMainArtifact,
} from "@/lib/execution-contract/types";
import { getGoal } from "@/lib/goal/server-store";
import { getProgress, updateProgress } from "@/lib/progress/server-store";
import { listDefinitions } from "@/lib/subagents/registry";
import {
  buildAgentMentionDirective,
  stripAgentMentions,
} from "@/lib/subagents/router";
import { inferAdvisoryRouteDecision } from "@/lib/task-router/advisory";
import { recordRouteDecision } from "@/lib/task-router/server-store";
import type { AdvisoryRouteKind } from "@/lib/task-router/types";
import type { ImageContentLite } from "@/lib/types";
import {
  buildPromptRunProtocol,
  initialPromptProgress,
} from "./goal-actions";
import { persistProgressForAgent } from "./progress-actions";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const PROMPT_ACTIONS = new Set([
  "prompt",
  "steer",
  "steering",
  "follow_up",
  "followUp",
]);

export function isPromptPostAction(type: string): boolean {
  return PROMPT_ACTIONS.has(type);
}

export function parseImages(raw: unknown): ImageContentLite[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ImageContentLite[] = [];
  for (const it of raw) {
    if (
      it &&
      typeof it === "object" &&
      typeof (it as { data?: unknown }).data === "string" &&
      typeof (it as { mimeType?: unknown }).mimeType === "string"
    ) {
      out.push({
        type: "image",
        data: (it as { data: string }).data,
        mimeType: (it as { mimeType: string }).mimeType,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseAdvisoryRouteKind(value: unknown): AdvisoryRouteKind | undefined {
  return value === "direct" ||
    value === "goal" ||
    value === "workflow_template" ||
    value === "workflow_script" ||
    value === "subagent_batch" ||
    value === "browser_task" ||
    value === "ask_user"
    ? value
    : undefined;
}

export function parseRouteOverride(
  body: Record<string, unknown>
): { route?: AdvisoryRouteKind; reason?: string } | undefined {
  const raw =
    body.routeOverride && typeof body.routeOverride === "object"
      ? (body.routeOverride as Record<string, unknown>)
      : body;
  const route = parseAdvisoryRouteKind(raw.route);
  const reason =
    typeof raw.routeOverrideReason === "string"
      ? raw.routeOverrideReason
      : typeof raw.reason === "string"
        ? raw.reason
        : undefined;
  return route || reason ? { route, reason } : undefined;
}

function parseAttachments(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === "string")
    : [];
}

function mainArtifactFromAttachments(
  attachments: string[]
): Partial<ExecutionMainArtifact> | undefined {
  const first = attachments.find((item) => item.trim());
  return first
    ? {
        label: first.trim().slice(0, 500),
        href: first.trim().slice(0, 1000),
        source: "attachment",
      }
    : undefined;
}

function textRequired(): AgentPostActionResult {
  return errorAction("text required", 400);
}

export async function handlePromptPostAction({
  type,
  agentId,
  rec,
  body,
}: {
  type: string;
  agentId: string;
  rec: AgentRecord;
  body: Record<string, unknown>;
}): Promise<AgentPostActionResult> {
  switch (type) {
    case "prompt":
      return handlePrompt({ agentId, rec, body });
    case "steer":
    case "steering":
      return handleSteer({ rec, body });
    case "follow_up":
    case "followUp":
      return handleFollowUp({ rec, body });
    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}

async function handlePrompt({
  agentId,
  rec,
  body,
}: {
  agentId: string;
  rec: AgentRecord;
  body: Record<string, unknown>;
}): Promise<AgentPostActionResult> {
  const text = body.text as string;
  if (!text || typeof text !== "string") return textRequired();

  const clientRequestId =
    typeof body.clientRequestId === "string"
      ? body.clientRequestId.trim().slice(0, 128)
      : "";
  if (clientRequestId && !claimClientRequest(rec.id, clientRequestId)) {
    return okAction({ ok: true, deduped: true });
  }

  const images = parseImages(body.images);
  const attachments = parseAttachments(body.attachments);
  const specialistIds = listDefinitions(rec.cwd).map((d) => d.id);
  const mentionDirective = buildAgentMentionDirective(text, specialistIds);
  const displayText = mentionDirective
    ? stripAgentMentions(text, specialistIds) || text
    : text;

  const asideSections: string[] = [];
  if (attachments.length > 0) {
    asideSections.push(
      `Referenced files/folders (read or list as needed):\n${attachments
        .map((p) => `@${p}`)
        .join(" ")}`
    );
  }
  if (mentionDirective) {
    asideSections.push(mentionDirective.directive);
  }

  const activeGoal = getGoal(agentId);
  const routeDecision = recordRouteDecision(
    inferAdvisoryRouteDecision({
      agentId,
      text,
      hasActiveGoal: activeGoal?.status === "active",
      attachments,
      mentionedAgents: mentionDirective?.agentIds,
      override: parseRouteOverride(body),
    })
  );

  let promptContract: ExecutionContract | null = null;
  let promptProgress: ReturnType<typeof getProgress> | null = null;
  if (!rec.isStreaming && activeGoal?.status !== "active") {
    promptContract = putExecutionContract(
      buildExecutionContract({
        agentId,
        objective: text,
        mainArtifact: mainArtifactFromAttachments(attachments),
      })
    );
    rec.activeContractId = promptContract.id;
    asideSections.push(buildPromptRunProtocol(promptContract));
    promptProgress = updateProgress(
      agentId,
      initialPromptProgress(promptContract)
    );
    await persistProgressForAgent(rec, promptProgress);
    pushProgressEvent(rec, promptProgress);
  }

  const asideContext = asideSections.join("\n\n");
  const finalText = asideContext
    ? `${displayText}\n\n${CONTEXT_ASIDE_OPEN}\n${asideContext}\n${CONTEXT_ASIDE_CLOSE}`
    : displayText;

  try {
    if (isLocalCodingAssistantAgent(rec)) {
      await promptLocalCodingAssistantAgent(rec, finalText);
      return promptOk({ routeDecision, promptContract, promptProgress, mentionDirective });
    }
    if (rec.isStreaming) {
      await rec.session.prompt(finalText, {
        streamingBehavior: "followUp",
        images,
      });
    } else {
      await rec.session.prompt(finalText, images ? { images } : undefined);
    }
  } catch (e) {
    clearClientRequest(rec.id, clientRequestId);
    throw e;
  }
  return promptOk({ routeDecision, promptContract, promptProgress, mentionDirective });
}

function promptOk({
  routeDecision,
  promptContract,
  promptProgress,
  mentionDirective,
}: {
  routeDecision: unknown;
  promptContract: ExecutionContract | null;
  promptProgress: ReturnType<typeof getProgress> | null;
  mentionDirective: ReturnType<typeof buildAgentMentionDirective> | null;
}): AgentPostActionResult {
  return okAction({
    ok: true,
    routeDecision,
    ...(promptContract ? { contract: promptContract } : {}),
    ...(promptProgress ? { progress: promptProgress } : {}),
    ...(mentionDirective
      ? { routedSpecialists: mentionDirective.agentIds }
      : {}),
  });
}

async function handleSteer({
  rec,
  body,
}: {
  rec: AgentRecord;
  body: Record<string, unknown>;
}): Promise<AgentPostActionResult> {
  const text = body.text as string;
  if (!text || typeof text !== "string") return textRequired();
  const images = parseImages(body.images);
  if (isLocalCodingAssistantAgent(rec)) {
    void images;
    await promptLocalCodingAssistantAgent(rec, text);
    return okAction({ ok: true });
  }
  await rec.session.steer(text, images);
  return okAction({ ok: true });
}

async function handleFollowUp({
  rec,
  body,
}: {
  rec: AgentRecord;
  body: Record<string, unknown>;
}): Promise<AgentPostActionResult> {
  const text = body.text as string;
  if (!text || typeof text !== "string") return textRequired();
  const images = parseImages(body.images);
  if (isLocalCodingAssistantAgent(rec)) {
    void images;
    await promptLocalCodingAssistantAgent(rec, text);
    return okAction({ ok: true });
  }
  await rec.session.followUp(text, images);
  return okAction({ ok: true });
}
