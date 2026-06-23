import { buildContextPacket } from "@/lib/agent-mode/context-packet";
import type { AgentEventBridgeContext } from "@/lib/runtime/agent-event-bridge";
import type { EvidenceRef } from "@/lib/evidence/types";
import type {
  SubagentBatch,
  SubagentResult,
} from "@/lib/subagents/types";
import type {
  WorkflowArtifact,
  WorkflowCheckpoint,
  WorkflowRun,
  WorkflowTraceEvent,
} from "@/lib/workflows/types";
import type { TeamTask, TeamTaskEvent, TeamTaskStatus, TeamTaskUpdate } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanText(value: unknown, fallback: string, max = 240): string {
  return (typeof value === "string" && value.trim() ? value.trim() : fallback)
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function subagentStatus(value: unknown): TeamTaskStatus {
  if (value === "running") return "running";
  if (value === "pending") return "pending";
  if (value === "completed") return "completed";
  if (value === "aborted" || value === "timeout" || value === "failed") return "failed";
  return "pending";
}

function workflowStatus(value: unknown): TeamTaskStatus {
  if (value === "running" || value === "pending") return "running";
  if (value === "completed") return "completed";
  if (value === "failed" || value === "aborted") return "failed";
  return "running";
}

function verificationStatus(value: unknown): TeamTaskStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = (value as { status?: unknown }).status;
  if (status === "passed") return "completed";
  if (status === "warning") return "warning";
  if (status === "failed") return "failed";
  return null;
}

function eventTypeForStatus(
  existing: boolean,
  status: TeamTaskStatus,
  evidenceIds: string[],
  artifactRefs: string[]
): TeamTaskEvent["type"] {
  if (!existing) return "task_created";
  if (evidenceIds.length > 0) return "evidence_linked";
  if (artifactRefs.length > 0) return "artifact_linked";
  if (status) return "status_changed";
  return "task_updated";
}

function taskEvent(input: {
  id: string;
  task: TeamTask;
  status: TeamTaskStatus;
  evidenceIds?: string[];
  artifactRefs?: string[];
  note?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  existing?: boolean;
}): TeamTaskEvent {
  const evidenceIds = input.evidenceIds ?? [];
  const artifactRefs = input.artifactRefs ?? [];
  return {
    id: input.id,
    taskId: input.task.id,
    agentId: input.task.agentId,
    sessionId: input.task.sessionId,
    type: eventTypeForStatus(Boolean(input.existing), input.status, evidenceIds, artifactRefs),
    status: input.status,
    evidenceIds: evidenceIds.length > 0 ? evidenceIds : undefined,
    artifactRefs: artifactRefs.length > 0 ? artifactRefs : undefined,
    note: input.note,
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

function subagentEvidenceFor(
  evidence: EvidenceRef[],
  batchId: string | null,
  resultOrTask: { taskId?: string; agentId?: string }
): EvidenceRef[] {
  return evidence.filter((item) => {
    if (item.kind !== "subagent_result") return false;
    if (resultOrTask.taskId && item.taskId !== resultOrTask.taskId) return false;
    if (batchId && !item.id.includes(`subagent-result:${batchId}:`)) return false;
    const childAgentId =
      typeof item.metadata?.childAgentId === "string"
        ? item.metadata.childAgentId
        : undefined;
    return !resultOrTask.agentId || childAgentId === resultOrTask.agentId;
  });
}

function workflowEvidenceFor(
  evidence: EvidenceRef[],
  workflowId: string,
  refName?: string
): EvidenceRef[] {
  return evidence.filter((item) => {
    if (item.kind !== "workflow_artifact") return false;
    if (item.workflowId !== workflowId) return false;
    return !refName || item.id.endsWith(`:${refName}`);
  });
}

function subagentTaskUpdate(input: {
  ctx: AgentEventBridgeContext;
  batchId: string;
  taskId: string;
  title?: string;
  prompt?: string;
  status: TeamTaskStatus;
  ownerId?: string;
  writePaths?: string[];
  evidenceIds?: string[];
  artifactRefs?: string[];
  verification?: unknown;
  createdAt: number;
  eventSuffix: string;
  existing?: boolean;
}): TeamTaskUpdate {
  const taskTitle = cleanText(input.title, input.taskId, 160);
  const requiredEvidence =
    input.evidenceIds && input.evidenceIds.length > 0 ? ["subagent_result"] : [];
  const task: TeamTask = {
    id: `subagent:${input.batchId}:${input.taskId}`,
    agentId: input.ctx.agentId,
    sessionId: input.ctx.sessionId ?? null,
    batchId: input.batchId,
    title: taskTitle,
    status: verificationStatus(input.verification) ?? input.status,
    ownerType: "subagent",
    ownerId: input.ownerId,
    dependsOn: [],
    contextPacketId: `context-packet:subagent:${input.batchId}:${input.taskId}`,
    contextPacket: buildContextPacket({
      objective: `Subagent batch ${input.batchId}`,
      taskTitle,
      taskBoundary: cleanText(
        input.prompt,
        "Run only the assigned subagent task and report evidence separately.",
        1000
      ),
      writePaths: input.writePaths,
      requiredEvidence,
      outputFormat: "summary",
      mustInclude: ["status", "findings", "evidence references"],
      mustNotDo: [
        "claim deterministic tests or browser checks passed without real evidence ids",
      ],
    }),
    writePaths: input.writePaths ?? [],
    requiredEvidence,
    evidenceIds: input.evidenceIds ?? [],
    artifactRefs: input.artifactRefs ?? [],
    blockedBy: input.status === "failed" ? "Subagent task failed or was aborted." : undefined,
    source: { type: "subagent", id: input.taskId, parentId: input.batchId },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return {
    task,
    event: taskEvent({
      id: `team-task-event:${task.id}:${input.eventSuffix}`,
      task,
      status: task.status,
      evidenceIds: input.evidenceIds,
      artifactRefs: input.artifactRefs,
      createdAt: input.createdAt,
      existing: input.existing,
      metadata: {
        sourceType: "subagent",
        batchId: input.batchId,
        taskId: input.taskId,
      },
    }),
  };
}

function workflowTaskUpdate(input: {
  ctx: AgentEventBridgeContext;
  workflowId: string;
  title: string;
  objective?: string;
  status: TeamTaskStatus;
  ownerId?: string;
  evidenceIds?: string[];
  artifactRefs?: string[];
  createdAt: number;
  eventSuffix: string;
  existing?: boolean;
  sourceId?: string;
}): TeamTaskUpdate {
  const taskTitle = cleanText(input.title, input.workflowId, 160);
  const requiredEvidence =
    input.evidenceIds && input.evidenceIds.length > 0 ? ["workflow_artifact"] : [];
  const task: TeamTask = {
    id: input.sourceId
      ? `workflow:${input.workflowId}:${input.sourceId}`
      : `workflow:${input.workflowId}`,
    agentId: input.ctx.agentId,
    sessionId: input.ctx.sessionId ?? null,
    workflowId: input.workflowId,
    title: taskTitle,
    status: input.status,
    ownerType: "workflow",
    ownerId: input.ownerId ?? input.workflowId,
    dependsOn: [],
    contextPacketId: `context-packet:workflow:${input.workflowId}`,
    contextPacket: buildContextPacket({
      objective: cleanText(input.objective, taskTitle, 2000),
      taskTitle,
      taskBoundary:
        "Track the workflow-backed team task, artifacts, checkpoints, and evidence references.",
      requiredEvidence,
      outputFormat: "summary",
      mustInclude: ["status", "artifacts", "evidence references"],
      mustNotDo: ["treat workflow notes as deterministic test or browser evidence"],
    }),
    writePaths: [],
    requiredEvidence,
    evidenceIds: input.evidenceIds ?? [],
    artifactRefs: input.artifactRefs ?? [],
    blockedBy: input.status === "failed" ? "Workflow task failed or was aborted." : undefined,
    source: {
      type: "workflow",
      id: input.sourceId ?? input.workflowId,
      parentId: input.sourceId ? input.workflowId : undefined,
    },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return {
    task,
    event: taskEvent({
      id: `team-task-event:${task.id}:${input.eventSuffix}`,
      task,
      status: input.status,
      evidenceIds: input.evidenceIds,
      artifactRefs: input.artifactRefs,
      createdAt: input.createdAt,
      existing: input.existing,
      metadata: {
        sourceType: "workflow",
        workflowId: input.workflowId,
      },
    }),
  };
}

function updatesForSubagent(
  ctx: AgentEventBridgeContext,
  event: Record<string, unknown>,
  evidence: EvidenceRef[]
): TeamTaskUpdate[] {
  const updates: TeamTaskUpdate[] = [];
  const batch = event.batch as SubagentBatch | undefined;
  const batchId = asString(event.batchId) ?? batch?.id ?? null;
  if (!batchId) return updates;
  const now = Date.now();

  if (event.type === "subagent_batch_start" && batch) {
    for (const task of batch.tasks) {
      updates.push(
        subagentTaskUpdate({
          ctx,
          batchId,
          taskId: task.id,
          title: task.title,
          prompt: task.prompt,
          status: subagentStatus(task.status),
          ownerId: task.agentId,
          writePaths: task.writePaths,
          createdAt: batch.createdAt ?? now,
          eventSuffix: "created",
        })
      );
    }
    return updates;
  }

  if (event.type === "subagent_task_start") {
    const taskId = asString(event.taskId);
    if (!taskId) return updates;
    updates.push(
      subagentTaskUpdate({
        ctx,
        batchId,
        taskId,
        title: asString(event.title) ?? taskId,
        status: "running",
        ownerId: asString(event.agentId) ?? undefined,
        createdAt: typeof event.startedAt === "number" ? event.startedAt : now,
        eventSuffix: "started",
        existing: true,
      })
    );
    return updates;
  }

  if (event.type === "subagent_task_update") {
    const taskId = asString(event.taskId);
    if (!taskId) return updates;
    updates.push(
      subagentTaskUpdate({
        ctx,
        batchId,
        taskId,
        title: taskId,
        status: "running",
        createdAt: now,
        eventSuffix: `updated:${ctx.seq}`,
        existing: true,
      })
    );
    return updates;
  }

  if (event.type === "subagent_task_end") {
    const taskId = asString(event.taskId);
    if (!taskId) return updates;
    const ownerId = asString(event.agentId) ?? undefined;
    const linkedEvidence = subagentEvidenceFor(evidence, batchId, {
      taskId,
      agentId: ownerId,
    });
    updates.push(
      subagentTaskUpdate({
        ctx,
        batchId,
        taskId,
        title: taskId,
        status: subagentStatus(event.status),
        ownerId,
        evidenceIds: linkedEvidence.map((item) => item.id),
        artifactRefs: asString(event.sessionFile) ? [String(event.sessionFile)] : [],
        verification: event.verification,
        createdAt: typeof event.endedAt === "number" ? event.endedAt : now,
        eventSuffix: "ended",
        existing: true,
      })
    );
    return updates;
  }

  const results = Array.isArray(event.results)
    ? (event.results as SubagentResult[])
    : [];
  for (const result of results) {
    const linkedEvidence = subagentEvidenceFor(evidence, batchId, result);
    updates.push(
      subagentTaskUpdate({
        ctx,
        batchId,
        taskId: result.taskId,
        title: result.taskId,
        status: subagentStatus(result.status),
        ownerId: result.agentId,
        evidenceIds: linkedEvidence.map((item) => item.id),
        artifactRefs: result.sessionFile ? [result.sessionFile] : [],
        createdAt: result.endedAt ?? now,
        eventSuffix: "result",
        existing: true,
      })
    );
  }
  return updates;
}

function updatesForWorkflow(
  ctx: AgentEventBridgeContext,
  event: Record<string, unknown>,
  evidence: EvidenceRef[]
): TeamTaskUpdate[] {
  const workflowId =
    asString(event.workflowId) ?? ((event.run as WorkflowRun | undefined)?.id ?? null);
  if (!workflowId) return [];
  const run = event.run as WorkflowRun | undefined;
  const now = Date.now();

  if (event.type === "workflow_start") {
    return [
      workflowTaskUpdate({
        ctx,
        workflowId,
        title: run?.objective ?? workflowId,
        objective: run?.objective,
        status: "running",
        createdAt: run?.createdAt ?? now,
        eventSuffix: "started",
      }),
    ];
  }

  if (event.type === "workflow_artifact" || event.type === "workflow_checkpoint") {
    const artifact = event.artifact as WorkflowArtifact | undefined;
    const checkpoint = event.checkpoint as WorkflowCheckpoint | undefined;
    const name = artifact?.name ?? checkpoint?.name ?? "artifact";
    const linkedEvidence = workflowEvidenceFor(evidence, workflowId, name);
    return [
      workflowTaskUpdate({
        ctx,
        workflowId,
        title: run?.objective ?? `Workflow ${workflowId}`,
        status: "running",
        evidenceIds: linkedEvidence.map((item) => item.id),
        artifactRefs: [name],
        createdAt: artifact?.createdAt ?? checkpoint?.createdAt ?? now,
        eventSuffix: `${event.type}:${name}`,
        existing: true,
      }),
    ];
  }

  if (event.type === "workflow_trace") {
    const trace = event.trace as WorkflowTraceEvent | undefined;
    if (!trace || !("agentRunId" in trace)) return [];
    const agentRunId = asString(trace.agentRunId);
    if (!agentRunId) return [];
    const traceTitle = "title" in trace ? asString(trace.title) : null;
    return [
      workflowTaskUpdate({
        ctx,
        workflowId,
        title: traceTitle ?? agentRunId,
        status:
          trace.type === "agent_end"
            ? workflowStatus(trace.status)
            : "running",
        ownerId: agentRunId,
        createdAt: trace.createdAt,
        eventSuffix: `${trace.type}:${agentRunId}`,
        existing: trace.type !== "agent_start",
        sourceId: `agent:${agentRunId}`,
      }),
    ];
  }

  if (event.type === "workflow_end") {
    const linkedEvidence = evidence.filter(
      (item) => item.kind === "workflow_artifact" && item.workflowId === workflowId
    );
    return [
      workflowTaskUpdate({
        ctx,
        workflowId,
        title: run?.objective ?? `Workflow ${workflowId}`,
        status: workflowStatus(event.status),
        evidenceIds: linkedEvidence.map((item) => item.id),
        createdAt: typeof event.endedAt === "number" ? event.endedAt : now,
        eventSuffix: "ended",
        existing: true,
      }),
    ];
  }

  return [];
}

export function deriveTeamTaskUpdatesFromAgentEvent(
  ctx: AgentEventBridgeContext,
  rawEvent: unknown,
  evidence: EvidenceRef[]
): TeamTaskUpdate[] {
  const event = asRecord(rawEvent);
  const type = asString(event?.type);
  if (!event || !type) return [];
  if (type.startsWith("subagent_")) return updatesForSubagent(ctx, event, evidence);
  if (type.startsWith("workflow_")) return updatesForWorkflow(ctx, event, evidence);
  return [];
}
