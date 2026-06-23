import {
  isLocalCodingAssistantAgent,
  promptLocalCodingAssistantAgent,
  pushGoalEvent,
  pushProgressEvent,
  type AgentRecord,
} from "@/lib/agent-registry";
import {
  clearGoal,
  getGoal,
  normalizeObjective,
  setGoal,
  setGoalStatus,
} from "@/lib/goal/server-store";
import { applyGoalUpdate } from "@/lib/goal/update";
import { buildExecutionContract } from "@/lib/execution-contract/build";
import {
  getExecutionContract,
  putExecutionContract,
} from "@/lib/execution-contract/store";
import type {
  ExecutionContract,
  ExecutionMainArtifact,
} from "@/lib/execution-contract/types";
import {
  clearProgress,
  failOpenProgress,
  getProgress,
  updateProgress,
} from "@/lib/progress/server-store";
import {
  ensureBrowserVerificationForGoal,
  runGoalVerificationPlanForAgent,
} from "@/lib/verification/goal-runner";
import type { ProgressUpdateInput } from "@/lib/progress/types";
import { inferAdvisoryRouteDecision } from "@/lib/task-router/advisory";
import {
  latestRouteDecision,
  recordRouteDecision,
} from "@/lib/task-router/server-store";
import {
  persistProgressForAgent,
} from "./progress-actions";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const GOAL_ACTIONS = new Set([
  "goal_status",
  "goal_run_verification",
  "goal_set",
  "goal_pause",
  "goal_resume",
  "goal_clear",
  "goal_update",
]);

export function isGoalPostAction(type: string): boolean {
  return GOAL_ACTIONS.has(type);
}

function parseStringList(raw: unknown, maxItems = 12): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return values.length > 0 ? values : undefined;
}

function shortText(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function parseMainArtifact(
  raw: unknown
): string | Partial<ExecutionMainArtifact> | undefined {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    return raw as Partial<ExecutionMainArtifact>;
  }
  return undefined;
}

export function buildPromptRunProtocol(contract: ExecutionContract): string {
  return [
    "Shaula task contract:",
    `- id: ${contract.id}`,
    `- objective: ${contract.objective}`,
    ...(contract.mainArtifact
      ? [
          `- main artifact: ${contract.mainArtifact.label} (${contract.mainArtifact.kind})`,
        ]
      : []),
    `- rubric profile: ${contract.rubricProfile}`,
    `- required evidence: ${
      contract.requiredEvidence.join(", ") || "goal_evidence"
    }`,
    "",
    "Execution protocol:",
    "1. Confirm the active project surface and main artifact before meaningful edits.",
    "2. For product/UI tasks, decide information architecture and acceptance criteria before visual patching.",
    "3. If two iterations were rejected or the user says it is still wrong/乱/没改好, diagnose structure before more edits.",
    "4. Keep update_progress current and attach useful artifacts/evidence.",
    "5. Verify frontend/UI with browser observation or screenshot when possible.",
    "6. Reply concisely in the user's language. For Chinese users, use Chinese and do not stream long internal reasoning.",
    "7. When calling goal_update with status=complete, include finalSummary and evidenceIds that cite recorded evidence.",
    "8. Handoff with changed artifact, verification, satisfied criteria, and known gaps.",
    "",
    "File governance:",
    "- Do not create sibling project directories, temporary leading-space folders, or multiple unexplained versions.",
    "- If exploration versions are necessary, label exactly one as active and explain archive/draft paths.",
  ].join("\n");
}

export function initialPromptProgress(
  contract: ExecutionContract
): ProgressUpdateInput {
  const objective = shortText(contract.objective, 140);
  const mainArtifact = contract.mainArtifact;
  return {
    replaceSteps: true,
    replaceArtifacts: true,
    steps: [
      {
        id: "task-contract",
        title: `确认任务契约：${objective}`,
        status: "completed",
        summary: `${contract.rubricProfile} · evidence: ${
          contract.requiredEvidence.join(", ") || "goal_evidence"
        }`,
      },
      {
        id: "main-artifact",
        title: mainArtifact
          ? `锁定主产物：${shortText(mainArtifact.label, 96)}`
          : "锁定主产物",
        status: mainArtifact ? "completed" : "running",
        summary: mainArtifact
          ? `${mainArtifact.kind} · ${mainArtifact.source}${
              mainArtifact.href ? ` · ${mainArtifact.href}` : ""
            }`
          : "先确认用户最终应该打开或检查的文件、URL、页面或输出路径。",
      },
      {
        id: "execute-work",
        title: "执行改动或分析",
        status: "pending",
        summary: "按契约范围推进，不做无关重构。",
      },
      {
        id: "verify-handoff",
        title: "验证并交付",
        status: "pending",
        summary: "跑必要检查，交付主产物、验证结果和剩余缺口。",
      },
    ],
    artifacts: [
      {
        id: `contract-${contract.id}`,
        kind: "other",
        title: "任务契约",
        summary: `${objective} · ${contract.rubricProfile}`,
        requiredEvidence: contract.requiredEvidence,
        contractCriterionId: "objective-met",
      },
    ],
  };
}

export function buildGoalStartPrompt(
  objective: string,
  contract: ExecutionContract
): string {
  return [
    "Start working toward this active goal:",
    "",
    objective,
    "",
    "Execution contract:",
    `- id: ${contract.id}`,
    ...(contract.mainArtifact
      ? [
          `- main artifact: ${contract.mainArtifact.label} (${contract.mainArtifact.kind})`,
        ]
      : []),
    `- rubric profile: ${contract.rubricProfile}`,
    `- required evidence: ${contract.requiredEvidence.join(", ")}`,
    "",
    "The goal text is both the starting prompt and the completion criteria.",
    "Use the execution contract as the source of scope, non-goals, evidence expectations, and completion judgment.",
    "For multi-step work, call update_progress early with concrete progress nodes and keep it current as milestones finish.",
    "Attach evidence artifacts with update_progress when you create files, URLs, screenshots, tests, diffs, logs, or browser observations.",
    "If the full goal is achieved, call goal_update with status=complete and include finalSummary plus evidenceIds that cite recorded evidence.",
    "If you are truly blocked and cannot make meaningful progress without user input or an external change, call goal_update with status=blocked and include a short blockedReason.",
  ].join("\n");
}

function messageFromError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Goal prompt failed to start.";
}

function startGoalPromptInBackground(rec: AgentRecord, prompt: string): void {
  if (!rec.isStreaming) {
    rec.isPromptStarting = true;
    rec.updatedAt = Date.now();
    setTimeout(() => {
      if (rec.isPromptStarting && !rec.isStreaming) {
        rec.isPromptStarting = false;
        rec.updatedAt = Date.now();
      }
    }, 30_000);
  }
  queueMicrotask(() => {
    void (async () => {
      try {
        if (isLocalCodingAssistantAgent(rec)) {
          await promptLocalCodingAssistantAgent(rec, prompt);
        } else if (rec.isStreaming) {
          await rec.session.followUp(prompt);
        } else {
          await rec.session.prompt(prompt);
        }
      } catch (error) {
        const message = messageFromError(error);
        console.error("[goal_set] background prompt failed:", error);
        const progress = failOpenProgress(
          rec.id,
          `Goal start failed: ${message}`
        );
        await persistProgressForAgent(rec, progress);
        pushProgressEvent(rec, progress);
        const goal = getGoal(rec.id);
        if (goal?.status === "active") {
          const paused = setGoalStatus(rec.id, "paused", {
            pauseReason: `Goal start failed: ${message}`,
          });
          pushGoalEvent(rec, paused);
        }
        if (rec.isPromptStarting) {
          rec.isPromptStarting = false;
          rec.updatedAt = Date.now();
        }
      }
    })();
  });
}

export async function handleGoalPostAction({
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
    case "goal_status": {
      const goal = getGoal(agentId);
      return okAction({
        ok: true,
        goal,
        contract: getExecutionContract(goal?.contractId ?? rec.activeContractId),
        progress: getProgress(agentId),
        routeDecision: latestRouteDecision(agentId),
      });
    }

    case "goal_run_verification": {
      const result = await runGoalVerificationPlanForAgent({
        agentId,
        cwd: rec.cwd,
        sessionId: rec.session.sessionId,
        browserId:
          typeof body.browserId === "string" ? body.browserId : undefined,
        targetUrl:
          typeof body.targetUrl === "string" ? body.targetUrl : undefined,
        targetSelector:
          typeof body.targetSelector === "string"
            ? body.targetSelector
            : undefined,
        targetText:
          typeof body.targetText === "string" ? body.targetText : undefined,
        requiredOnly: true,
      });
      if (result.goal) pushGoalEvent(rec, result.goal);
      return okAction({ ok: true, ...result });
    }

    case "goal_set": {
      const objective = normalizeObjective(body.objective);
      if (!objective) return errorAction("objective required", 400);

      const tokenBudget =
        typeof body.tokenBudget === "number" ? body.tokenBudget : undefined;
      const contract = putExecutionContract(
        buildExecutionContract({
          agentId,
          objective,
          tokenBudget,
          rubricProfile:
            typeof body.rubricProfile === "string"
              ? body.rubricProfile
              : undefined,
          requiredEvidence: parseStringList(body.requiredEvidence),
          mainArtifact: parseMainArtifact(body.mainArtifact),
        })
      );
      rec.activeContractId = contract.id;
      const goal = setGoal(agentId, objective, tokenBudget, {
        contractId: contract.id,
      });
      const routeDecision = recordRouteDecision(
        inferAdvisoryRouteDecision({
          agentId,
          text: objective,
          override: {
            route: "goal",
            reason: "User explicitly started a goal.",
          },
        })
      );
      pushGoalEvent(rec, goal);
      const progress = updateProgress(agentId, initialPromptProgress(contract));
      await persistProgressForAgent(rec, progress);
      pushProgressEvent(rec, progress);

      startGoalPromptInBackground(
        rec,
        buildGoalStartPrompt(objective, contract)
      );
      return okAction({
        ok: true,
        goal,
        contract,
        routeDecision,
        promptStarted: "background",
      });
    }

    case "goal_pause": {
      const goal = setGoalStatus(agentId, "paused", {
        pauseReason:
          typeof body.reason === "string" ? body.reason : "Paused by user.",
      });
      pushGoalEvent(rec, goal);
      return okAction({ ok: true, goal });
    }

    case "goal_resume": {
      const goal = setGoalStatus(agentId, "active");
      pushGoalEvent(rec, goal);
      if (goal && !rec.isStreaming) {
        await rec.session.prompt(
          [
            "Resume working toward the active goal:",
            "",
            goal.objective,
            "",
            "Do the next useful step. When complete, call goal_update with status=complete, finalSummary, and evidenceIds. Use status=blocked only when truly blocked.",
          ].join("\n")
        );
      }
      return okAction({ ok: true, goal });
    }

    case "goal_clear": {
      clearGoal(agentId);
      rec.activeContractId = undefined;
      const progress = clearProgress(agentId);
      await persistProgressForAgent(rec, progress);
      pushGoalEvent(rec, null);
      pushProgressEvent(rec, progress);
      return okAction({ ok: true, goal: null, contract: null, progress });
    }

    case "goal_update": {
      const status = body.status;
      if (status !== "complete" && status !== "blocked") {
        return errorAction("status must be complete or blocked", 400);
      }
      if (status === "complete") {
        await ensureBrowserVerificationForGoal({
          agentId,
          cwd: rec.cwd,
          sessionId: rec.session.sessionId,
          browserId:
            typeof body.browserId === "string" ? body.browserId : undefined,
          targetUrl:
            typeof body.targetUrl === "string" ? body.targetUrl : undefined,
          targetSelector:
            typeof body.targetSelector === "string"
              ? body.targetSelector
              : undefined,
          targetText:
            typeof body.targetText === "string" ? body.targetText : undefined,
        });
      }
      const result = applyGoalUpdate(
        agentId,
        {
          status,
          blockedReason:
            typeof body.blockedReason === "string"
              ? body.blockedReason
              : undefined,
          finalSummary:
            typeof body.finalSummary === "string"
              ? body.finalSummary
              : undefined,
          evidenceIds: parseStringList(body.evidenceIds, 50),
        },
        {
          sessionId: rec.session.sessionId,
        }
      );
      if (result.goal) pushGoalEvent(rec, result.goal);
      return okAction({
        ok: true,
        goal: result.goal,
        accepted: result.accepted,
        ...(result.rejectionNote
          ? { rejectionNote: result.rejectionNote }
          : {}),
        ...(result.evaluation ? { evaluation: result.evaluation } : {}),
      });
    }

    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}
