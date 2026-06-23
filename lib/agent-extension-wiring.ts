import "server-only";
import type {
  AgentSessionEvent,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createBrowserExtension } from "./browser/extension";
import type { BrowserStateEvent } from "./browser/types";
import { agentBrowserId } from "./browser/browser-id";
import { createClipboardExtension } from "./clipboard/extension";
import { createClarificationExtension } from "./clarification/extension";
import type {
  ClarificationRequestEvent,
  ClarificationResolvedEvent,
} from "./clarification/types";
import { registerPendingClarification } from "./clarification/server-store";
import { createCollabExtension } from "./collab/extension";
import { DEFAULT_RULES } from "./collab/rules";
import {
  hasSessionRemember,
  registerPendingApproval,
} from "./collab/server-store";
import {
  runApprovalRequest,
  type ApprovalResolutionContext,
} from "./collab/approval-broker";
import type {
  ApprovalRequest,
  ApprovalRequestEvent,
  ApprovalResolvedEvent,
  ApprovalResponse,
} from "./collab/types";
import { appendEvidence } from "./evidence/server-store";
import { getExecutionContract } from "./execution-contract/store";
import { getGoal } from "./goal/server-store";
import { bridgeProgressEvidence } from "./goal/evidence-bridge";
import { createGoalExtension } from "./goal/extension";
import { applyGoalUpdate } from "./goal/update";
import type { AgentGoal, GoalUpdatedEvent } from "./goal/types";
import { pauseGoalForUserInput, type AgentLifecycleDeps } from "./agent-lifecycle";
import {
  buildAgentCustomTools,
  loadAgentMcpTools,
  type LoadAgentMcpToolsInput,
} from "./agent-tool-assembly";
import {
  listMcpTools as listMcpToolsRuntime,
  callMcpTool as callMcpToolRuntime,
} from "./mcp/runtime";
import { listEnabledMcpServers } from "./mcp/registry";
import { createProgressExtension } from "./progress/extension";
import { updateProgress } from "./progress/server-store";
import { writePersistedProgress } from "./progress/file-store";
import type { AgentProgress, ProgressUpdatedEvent } from "./progress/types";
import { getDefinition } from "./subagents/registry";
import { createDelegateSubagentsTool } from "./subagents/extension";
import { runSubagentBatch } from "./subagents/orchestrator";
import type {
  CreatedChildAgent,
  CreateChildAgentOptions,
  SubagentEvent,
} from "./subagents/types";
import { ensureBrowserVerificationForGoal } from "./verification/goal-runner";
import { createDynamicWorkflowTool, createWorkflowScriptTool } from "./workflows/extension";
import { runDynamicWorkflow } from "./workflows/orchestrator";
import { runWorkflowScript } from "./workflows/script-runtime";
import { createGitWorktreeManager } from "./workflows/git-worktree";
import { getWorkflowNetworkPolicy } from "./workflows/network-policy";
import type { WorkflowEvent } from "./workflows/types";
import type { ThinkingLevel } from "./types";

export type AgentExtensionExternalEvent =
  | ApprovalRequestEvent
  | ApprovalResolvedEvent
  | ClarificationRequestEvent
  | ClarificationResolvedEvent
  | BrowserStateEvent
  | SubagentEvent
  | WorkflowEvent
  | GoalUpdatedEvent
  | ProgressUpdatedEvent;

export interface AgentExtensionRecord {
  id: string;
  isStreaming: boolean;
  isPromptStarting: boolean;
  updatedAt: number;
  finishWatchdog: ReturnType<typeof setTimeout> | null;
  pendingFinishMessage: unknown | null;
  session: {
    sessionId: string;
    sessionFile: string | undefined;
    model?: { provider: string; id: string } | null;
    thinkingLevel?: ThinkingLevel;
    prompt(text: string): Promise<void>;
    abort(): Promise<void>;
    dispose(): void;
    subscribe(listener: (event: AgentSessionEvent) => void): () => void;
    getSessionStats?: () => {
      userMessages?: number;
      assistantMessages?: number;
      cost?: number;
      tokens?: {
        input?: number;
        output?: number;
      };
    };
  };
}

export interface AgentExtensionRecordHolder {
  current: AgentExtensionRecord | null;
}

export interface BuildAgentExtensionWiringInput {
  id: string;
  cwd: string;
  parentAgentId?: string;
  taskId?: string;
  taskTitle?: string;
  enableSubagents?: boolean;
  mcpServers?: string[];
  createAgent: (
    opts: CreateChildAgentOptions
  ) => Promise<CreatedChildAgent>;
  getAgent: (agentId: string) => AgentExtensionRecord | undefined;
  disposeAgent: (agentId: string) => void;
  pushExternalEvent: (
    record: AgentExtensionRecord,
    event: AgentExtensionExternalEvent
  ) => void;
  pushGoalEvent: (
    record: AgentExtensionRecord,
    goal: AgentGoal | null
  ) => void;
  pushProgressEvent: (
    record: AgentExtensionRecord,
    progress: AgentProgress
  ) => void;
  lifecycleDepsFor: (record: AgentExtensionRecord) => AgentLifecycleDeps;
  loadMcpTools?: (
    input: LoadAgentMcpToolsInput
  ) => Promise<ToolDefinition[]>;
  now?: () => number;
}

export interface AgentExtensionWiring {
  recordHolder: AgentExtensionRecordHolder;
  extensionFactories: ExtensionFactory[];
  customTools: ToolDefinition[];
}

export function workflowFetchUrlRuleId(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!host) return "workflow-fetch-url";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `workflow-fetch-url:${parsed.protocol}//${host}${port}`;
  } catch {
    return "workflow-fetch-url";
  }
}

export interface WorkflowClarificationInput {
  title?: string;
  question: string;
  context?: string;
  options: Array<{
    id?: string;
    label: string;
    description?: string;
    value?: string;
  }>;
  recommendedOptionId?: string;
}

export function buildWorkflowClarificationRequest(input: {
  agentId: string;
  workflowId: string;
  body: WorkflowClarificationInput;
  now: number;
}) {
  const requestId = `workflow-ask-user:${input.workflowId}:${input.now}`;
  const options = input.body.options.map((option, index) => ({
    id: option.id || `option-${index + 1}`,
    label: option.label.slice(0, 48),
    description: option.description?.slice(0, 160),
    value: (option.value?.trim() || option.label).slice(0, 500),
  }));
  return {
    requestId,
    request: {
      id: `${input.agentId}:${requestId}`,
      agentId: input.agentId,
      requestId,
      title: input.body.title?.slice(0, 80) || "需要你确认下一步",
      question: input.body.question.slice(0, 500),
      context: input.body.context?.slice(0, 500),
      options,
      recommendedOptionId:
        input.body.recommendedOptionId &&
        options.some((option) => option.id === input.body.recommendedOptionId)
          ? input.body.recommendedOptionId
          : options[0]?.id,
      createdAt: input.now,
    },
  };
}

export async function buildAgentExtensionWiring(
  input: BuildAgentExtensionWiringInput
): Promise<AgentExtensionWiring> {
  const now = input.now ?? Date.now;
  const recordHolder: AgentExtensionRecordHolder = { current: null };

  const runUiApproval = (
    rec: AgentExtensionRecord,
    req: ApprovalRequest,
    mapResponse?: (context: ApprovalResolutionContext) => ApprovalResponse
  ) =>
    runApprovalRequest({
      request: req,
      registerPendingApproval,
      pushEvent: (event) => input.pushExternalEvent(rec, event),
      ...(mapResponse ? { mapResponse } : {}),
    });

  const collabExtension = createCollabExtension({
    getRules: () => DEFAULT_RULES,
    getAgentId: () => input.id,
    hasRemember: (ruleId: string) => hasSessionRemember(input.id, ruleId),
    onApprovalNeeded: async (req) => {
      const rec = recordHolder.current;
      if (!rec) {
        console.error(
          "[collab] onApprovalNeeded called but record not ready; defaulting allow",
          req
        );
        return { decision: "allow" as const };
      }
      return runUiApproval(rec, req);
    },
  });

  async function requestWorkflowCapabilityApproval(params: {
    workflowId: string;
    capability: string;
    manifest: unknown;
    objective: string;
    rationale: string;
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      console.error(
        "[workflow] capability approval called but record not ready; defaulting deny",
        params.workflowId,
        params.capability
      );
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const toolCallId = `workflow-capability:${params.workflowId}:${params.capability}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: `workflow:${params.capability}`,
      input: {
        workflowId: params.workflowId,
        capability: params.capability,
        objective: params.objective,
        rationale: params.rationale,
        manifest: params.manifest,
      },
      reason: "manual",
      ruleId: `workflow-capability:${params.capability}`,
      defaultDecision: "deny",
      createdAt: now(),
    };
    return runUiApproval(rec, req, ({ response, resolvedBy }) =>
      resolvedBy === "timeout" && response.decision === "deny"
        ? {
            ...response,
            denyReason: `Workflow capability approval timed out: ${params.capability}`,
          }
        : response
    );
  }

  async function requestWorkflowWorktreeMergeApproval(params: {
    workflowId: string;
    objective: string;
    rationale: string;
    manifest: unknown;
    worktree: {
      id: string;
      path: string;
      branchName: string;
      baseRef: string;
    };
    diff: {
      stat: string;
      diff: string;
      path: string;
      branchName: string;
      baseRef: string;
    };
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      console.error(
        "[workflow] worktree merge approval called but record not ready; defaulting deny",
        params.workflowId,
        params.worktree.id
      );
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const toolCallId = `workflow-merge:${params.workflowId}:${params.worktree.id}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: "workflow:merge_worktree",
      input: {
        workflowId: params.workflowId,
        objective: params.objective,
        rationale: params.rationale,
        manifest: params.manifest,
        worktree: params.worktree,
        stat: params.diff.stat,
        diffPreview: params.diff.diff.slice(0, 12000),
        truncated: params.diff.diff.length > 12000,
      },
      reason: "manual",
      ruleId: "workflow-merge-worktree",
      defaultDecision: "deny",
      createdAt: now(),
    };
    return runUiApproval(rec, req);
  }

  async function requestSubagentWorktreeMergeApproval(params: {
    taskId: string;
    title: string;
    worktree: { id: string; path: string; branchName: string; baseRef: string };
    diff: { stat: string; diff: string };
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const toolCallId = `subagent-merge:${params.taskId}:${params.worktree.id}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: "subagent:merge_worktree",
      input: {
        taskId: params.taskId,
        title: params.title,
        worktree: params.worktree,
        stat: params.diff.stat,
        diffPreview: params.diff.diff.slice(0, 12000),
        truncated: params.diff.diff.length > 12000,
      },
      reason: "manual",
      ruleId: "subagent-merge-worktree",
      defaultDecision: "deny",
      createdAt: now(),
    };
    return runUiApproval(rec, req);
  }

  async function requestMcpToolApproval(params: {
    serverId: string;
    tool: string;
    input: Record<string, unknown>;
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const ruleId = `mcp:${params.serverId}:${params.tool}`;
    if (hasSessionRemember(input.id, ruleId)) {
      return { decision: "allow" as const };
    }
    const stamp = now();
    const toolCallId = `mcp:${params.serverId}:${params.tool}:${stamp}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: `mcp:${params.serverId}/${params.tool}`,
      input: {
        serverId: params.serverId,
        tool: params.tool,
        argsPreview: JSON.stringify(params.input).slice(0, 800),
      },
      reason: "manual",
      ruleId,
      defaultDecision: "deny",
      createdAt: stamp,
    };
    return runUiApproval(rec, req);
  }

  async function requestBrowserSiteApproval(params: { origin: string; url: string }) {
    const rec = recordHolder.current;
    if (!rec) return false;
    const ruleId = `browser-site:${params.origin}`;
    if (hasSessionRemember(input.id, ruleId)) return true;
    const stamp = now();
    const toolCallId = `browser-site:${params.origin}:${stamp}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: "browser:open_external_site",
      input: {
        origin: params.origin,
        url: params.url.slice(0, 500),
      },
      reason: "manual",
      ruleId,
      defaultDecision: "deny",
      createdAt: stamp,
    };
    const resp = await runUiApproval(rec, req);
    return resp.decision === "allow";
  }

  async function requestBrowserActionApproval(params: {
    action: string;
    detail: string;
    url: string | null;
  }) {
    const rec = recordHolder.current;
    if (!rec) return false;
    const stamp = now();
    const toolCallId = `browser-action:${params.action}:${stamp}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: "browser:sensitive_action",
      input: {
        action: params.action,
        detail: params.detail,
        url: params.url ?? "(none)",
      },
      reason: "manual",
      ruleId: `browser-action:${params.action}`,
      defaultDecision: "deny",
      createdAt: stamp,
    };
    const resp = await runUiApproval(rec, req);
    return resp.decision === "allow";
  }

  function activeGoalRequiresBrowserEvidence(): boolean {
    const goal = getGoal(input.id);
    if (!goal?.contractId) return false;
    const contract = getExecutionContract(goal.contractId);
    return (contract?.requiredEvidence ?? []).some((item) =>
      item.toLowerCase().includes("browser")
    );
  }

  async function requestWorkflowMcpToolApproval(params: {
    workflowId: string;
    objective: string;
    rationale: string;
    manifest: unknown;
    input: { server: string; tool: string; input?: Record<string, unknown> };
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const ruleId = `mcp:${params.input.server}:${params.input.tool}`;
    if (hasSessionRemember(input.id, ruleId)) {
      return { decision: "allow" as const };
    }
    const stamp = now();
    const toolCallId = `workflow-mcp:${params.workflowId}:${params.input.server}:${params.input.tool}:${stamp}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: `workflow:mcp:${params.input.server}/${params.input.tool}`,
      input: {
        workflowId: params.workflowId,
        objective: params.objective,
        rationale: params.rationale,
        manifest: params.manifest,
        server: params.input.server,
        tool: params.input.tool,
        argsPreview: JSON.stringify(params.input.input ?? {}).slice(0, 800),
      },
      reason: "manual",
      ruleId,
      defaultDecision: "deny",
      createdAt: stamp,
    };
    return runUiApproval(rec, req);
  }

  async function requestWorkflowNetworkApproval(params: {
    workflowId: string;
    objective: string;
    rationale: string;
    manifest: unknown;
    input: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      maxBytes?: number;
    };
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      console.error(
        "[workflow] network approval called but record not ready; defaulting deny",
        params.workflowId,
        params.input.url
      );
      return {
        decision: "deny" as const,
        denyReason: "No UI approval channel was available.",
      };
    }
    const safeUrl = params.input.url.slice(0, 500);
    const ruleId = workflowFetchUrlRuleId(params.input.url);
    if (hasSessionRemember(input.id, ruleId)) {
      return { decision: "allow" as const };
    }
    const stamp = now();
    const toolCallId = `workflow-fetch:${params.workflowId}:${stamp}`;
    const req: ApprovalRequest = {
      id: `${input.id}:${toolCallId}`,
      agentId: input.id,
      toolCallId,
      toolName: "workflow:fetch_url",
      input: {
        workflowId: params.workflowId,
        objective: params.objective,
        rationale: params.rationale,
        manifest: params.manifest,
        url: safeUrl,
        method: params.input.method ?? "GET",
        headerNames: Object.keys(params.input.headers ?? {}),
        bodyPreview: params.input.body?.slice(0, 500),
        bodyTruncated: Boolean(params.input.body && params.input.body.length > 500),
        maxBytes: params.input.maxBytes,
      },
      reason: "manual",
      ruleId,
      defaultDecision: "deny",
      createdAt: stamp,
    };
    return runUiApproval(rec, req);
  }

  async function requestWorkflowUserClarification(params: {
    workflowId: string;
    input: WorkflowClarificationInput;
  }) {
    const rec = recordHolder.current;
    if (!rec) {
      console.error(
        "[workflow] askUser called but record not ready; returning empty response",
        params.workflowId
      );
      return {
        requestId: `workflow-ask-user:${params.workflowId}`,
        customText: "No UI channel was available.",
        answer: "No UI channel was available.",
      };
    }
    const { requestId, request } = buildWorkflowClarificationRequest({
      agentId: input.id,
      workflowId: params.workflowId,
      body: params.input,
      now: now(),
    });
    input.pushExternalEvent(rec, { type: "clarification_request", request });
    pauseGoalForUserInput(
      rec,
      `Waiting for user input: ${request.question}`,
      input.lifecycleDepsFor(rec)
    );
    const resp = await registerPendingClarification(request);
    input.pushExternalEvent(rec, {
      type: "clarification_resolved",
      id: request.id,
      requestId: request.requestId,
      selectedOptionId: resp.selectedOptionId,
      customText: resp.customText,
      resolvedBy: "user",
    });
    const selected = resp.selectedOptionId
      ? request.options.find((option) => option.id === resp.selectedOptionId)
      : null;
    const answer = resp.customText?.trim() || selected?.value || "";
    return {
      requestId,
      selectedOptionId: resp.selectedOptionId,
      customText: resp.customText,
      answer,
    };
  }

  const clarificationExtension = createClarificationExtension({
    getAgentId: () => input.id,
    onClarificationNeeded: async (req) => {
      const parentRec = input.parentAgentId
        ? input.getAgent(input.parentAgentId)
        : undefined;
      if (parentRec) {
        const parentReq = {
          ...req,
          id: `${parentRec.id}:child:${input.id}:${req.requestId}`,
          agentId: parentRec.id,
          originAgentId: input.id,
          taskId: input.taskId,
          taskTitle: input.taskTitle,
        };
        input.pushExternalEvent(parentRec, {
          type: "clarification_request",
          request: parentReq,
        });
        pauseGoalForUserInput(
          parentRec,
          `Waiting for user input: ${parentReq.question}`,
          input.lifecycleDepsFor(parentRec)
        );
        const resp = await registerPendingClarification(parentReq);
        input.pushExternalEvent(parentRec, {
          type: "clarification_resolved",
          id: parentReq.id,
          requestId: parentReq.requestId,
          selectedOptionId: resp.selectedOptionId,
          customText: resp.customText,
          resolvedBy: "user",
        });
        return resp;
      }

      const rec = recordHolder.current;
      if (!rec) {
        console.error(
          "[clarification] ask_user called but record not ready; returning empty response",
          req.id
        );
        return { customText: "No UI channel was available." };
      }
      input.pushExternalEvent(rec, {
        type: "clarification_request",
        request: req,
      });
      pauseGoalForUserInput(
        rec,
        `Waiting for user input: ${req.question}`,
        input.lifecycleDepsFor(rec)
      );
      const resp = await registerPendingClarification(req);
      input.pushExternalEvent(rec, {
        type: "clarification_resolved",
        id: req.id,
        requestId: req.requestId,
        selectedOptionId: resp.selectedOptionId,
        customText: resp.customText,
        resolvedBy: "user",
      });
      return resp;
    },
  });

  const goalExtension = createGoalExtension({
    getAgentId: () => input.id,
    getGoal,
    onGoalUpdate: async (_agentId, goalInput) => {
      const rec = recordHolder.current;
      if (goalInput.status === "complete") {
        await ensureBrowserVerificationForGoal({
          agentId: input.id,
          cwd: input.cwd,
          sessionId: rec?.session.sessionId,
        });
      }
      const result = applyGoalUpdate(input.id, goalInput, {
        sessionId: rec?.session.sessionId,
      });
      if (rec && result.goal) input.pushGoalEvent(rec, result.goal);
      return result;
    },
  });

  const progressExtension = createProgressExtension({
    getAgentId: () => input.id,
    onProgressUpdate: async (_agentId, progressInput) => {
      const progress = updateProgress(input.id, progressInput);
      bridgeProgressEvidence(input.id, progress);
      const rec = recordHolder.current;
      if (rec) {
        try {
          await writePersistedProgress(rec.session.sessionId, progress);
        } catch {
          // Best-effort runtime cache; do not fail the tool call if persistence
          // is temporarily unavailable.
        }
        input.pushProgressEvent(rec, progress);
      }
      return progress;
    },
  });

  const browserExtension = createBrowserExtension({
    getAgentId: () => input.id,
    onBrowserState: (snapshot) => {
      const rec = recordHolder.current;
      if (!rec) return;
      input.pushExternalEvent(rec, { type: "browser_state", snapshot });
    },
    onBrowserEvidence: ({ toolName, snapshot, evidence, result }) => {
      if (toolName !== "browser_verify" || !result) return;
      const rec = recordHolder.current;
      const browserId = agentBrowserId(input.id);
      const createdAt = now();
      const passed = result.passed === true;
      const required = activeGoalRequiresBrowserEvidence();
      appendEvidence({
        id: `browser-tool:${browserId}:${toolName}:${createdAt}`,
        kind: "browser_snapshot",
        title: `Browser verification ${passed ? "passed" : "failed"}: ${result.expectation}`,
        sessionId: rec?.session.sessionId ?? null,
        agentId: input.id,
        browserId,
        url: result.url ?? evidence.url ?? snapshot.url,
        screenshotDataUrl: evidence.screenshotDataUrl ?? snapshot.screenshotDataUrl,
        textPreview: result.evidence,
        summary: `${toolName}: ${passed ? "passed" : "failed"}`,
        trustLevel: "host_observed",
        source: {
          type: "browser",
          id: browserId,
        },
        criteria: [{ requiredEvidence: "browser_observation" }],
        metadata: {
          tool: toolName,
          verificationKind: "browser_observation",
          verificationCheckId: "browser-verify",
          status: passed ? "passed" : "failed",
          outcome: passed ? "passed" : "failed",
          passed,
          required,
          evidenceRequired: ["browser_observation"],
          expectation: result.expectation,
          url: result.url,
          title: result.title,
        },
        createdAt,
        updatedAt: createdAt,
      });
    },
    ...(input.parentAgentId
      ? {}
      : {
          requestSiteApproval: (request) => requestBrowserSiteApproval(request),
          requestActionApproval: (request) =>
            requestBrowserActionApproval(request),
        }),
  });

  const clipboardExtension = createClipboardExtension();

  const delegateSubagentsTool = createDelegateSubagentsTool({
    onDelegate: async (delegateInput, signal) => {
      const rec = recordHolder.current;
      if (!rec) throw new Error("agent record not ready");
      const model = rec.session.model;
      if (!model) throw new Error("model not ready");
      return runSubagentBatch(
        {
          parentAgentId: input.id,
          parentSessionPath: rec.session.sessionFile,
          provider: model.provider,
          modelId: model.id,
          cwd: input.cwd,
          thinkingLevel: rec.session.thinkingLevel,
          createChild: input.createAgent,
          getChild: input.getAgent,
          disposeChild: input.disposeAgent,
          pushParentEvent: (event) => input.pushExternalEvent(rec, event),
          resolveDefinition: (sid) => getDefinition(input.cwd, sid),
          worktrees: createGitWorktreeManager(input.cwd),
          approveSubagentMerge: (params) =>
            requestSubagentWorktreeMergeApproval({
              taskId: params.taskId,
              title: params.title,
              worktree: params.worktree,
              diff: params.diff,
            }),
        },
        delegateInput,
        signal
      );
    },
  });

  const dynamicWorkflowTool = createDynamicWorkflowTool({
    onRunWorkflow: async (workflowInput, signal) => {
      const rec = recordHolder.current;
      if (!rec) throw new Error("agent record not ready");
      const model = rec.session.model;
      if (!model) throw new Error("model not ready");
      return runDynamicWorkflow(
        {
          runSubagents: (subagentInput, subagentSignal) =>
            runSubagentBatch(
              {
                parentAgentId: input.id,
                parentSessionPath: rec.session.sessionFile,
                provider: model.provider,
                modelId: model.id,
                cwd: input.cwd,
                thinkingLevel: rec.session.thinkingLevel,
                createChild: input.createAgent,
                getChild: input.getAgent,
                disposeChild: input.disposeAgent,
                pushParentEvent: (event) => input.pushExternalEvent(rec, event),
                resolveDefinition: (sid) => getDefinition(input.cwd, sid),
              },
              subagentInput,
              subagentSignal
            ),
        },
        workflowInput,
        signal
      );
    },
  });

  const workflowScriptTool = createWorkflowScriptTool({
    onRunWorkflow: async (workflowInput, signal) => {
      const rec = recordHolder.current;
      if (!rec) throw new Error("agent record not ready");
      const model = rec.session.model;
      if (!model) throw new Error("model not ready");
      return runDynamicWorkflow(
        {
          runSubagents: (subagentInput, subagentSignal) =>
            runSubagentBatch(
              {
                parentAgentId: input.id,
                parentSessionPath: rec.session.sessionFile,
                provider: model.provider,
                modelId: model.id,
                cwd: input.cwd,
                thinkingLevel: rec.session.thinkingLevel,
                createChild: input.createAgent,
                getChild: input.getAgent,
                disposeChild: input.disposeAgent,
                pushParentEvent: (event) => input.pushExternalEvent(rec, event),
                resolveDefinition: (sid) => getDefinition(input.cwd, sid),
              },
              subagentInput,
              subagentSignal
            ),
        },
        workflowInput,
        signal
      );
    },
    onRunWorkflowScript: async (scriptInput, signal) => {
      const rec = recordHolder.current;
      if (!rec) throw new Error("agent record not ready");
      const model = rec.session.model;
      if (!model) throw new Error("model not ready");
      return runWorkflowScript(
        {
          parentAgentId: input.id,
          onEvent: (event) => input.pushExternalEvent(rec, event),
          approveCapability: (request) =>
            requestWorkflowCapabilityApproval(request),
          approveWorktreeMerge: (request) =>
            requestWorkflowWorktreeMergeApproval(request),
          approveNetworkRequest: (request) =>
            requestWorkflowNetworkApproval(request),
          approveMcpTool: (request) =>
            requestWorkflowMcpToolApproval(request),
          askUser: (request) => requestWorkflowUserClarification(request),
          worktrees: createGitWorktreeManager(input.cwd),
          networkPolicy: getWorkflowNetworkPolicy(),
          allowedMcpServers: undefined,
          listMcpTools: async (serverId) => {
            const ids = serverId
              ? [serverId]
              : listEnabledMcpServers().map((server) => server.id);
            const out: Array<{
              serverId: string;
              name: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
            }> = [];
            for (const sid of ids) {
              try {
                const tools = await listMcpToolsRuntime(sid);
                for (const tool of tools) {
                  out.push({
                    serverId: tool.serverId,
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                  });
                }
              } catch {
                // skip a broken server (best-effort, never throw into worker)
              }
            }
            return out;
          },
          callMcpTool: async (callInput) => {
            const result = await callMcpToolRuntime(
              callInput.server,
              callInput.tool,
              callInput.input ?? {}
            );
            return {
              server: callInput.server,
              tool: callInput.tool,
              text: result.text,
              isError: result.isError,
            };
          },
          runSubagents: (subagentInput, subagentSignal) =>
            runSubagentBatch(
              {
                parentAgentId: input.id,
                parentSessionPath: rec.session.sessionFile,
                provider: model.provider,
                modelId: model.id,
                cwd: input.cwd,
                thinkingLevel: rec.session.thinkingLevel,
                createChild: input.createAgent,
                getChild: input.getAgent,
                disposeChild: input.disposeAgent,
                pushParentEvent: (event) => input.pushExternalEvent(rec, event),
                resolveDefinition: (sid) => getDefinition(input.cwd, sid),
              },
              subagentInput,
              subagentSignal
            ),
        },
        scriptInput,
        signal
      );
    },
  });

  const mcpTools = await (input.loadMcpTools ?? loadAgentMcpTools)({
    allowedMcpServers: input.mcpServers,
    requestApproval: (params) => requestMcpToolApproval(params),
  });

  return {
    recordHolder,
    extensionFactories: [
      collabExtension,
      clarificationExtension,
      goalExtension,
      progressExtension,
      browserExtension,
      clipboardExtension,
    ],
    customTools: buildAgentCustomTools({
      enableSubagents: input.enableSubagents,
      delegateSubagentsTool,
      dynamicWorkflowTool,
      workflowScriptTool,
      mcpTools,
    }),
  };
}
