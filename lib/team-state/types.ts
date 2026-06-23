import type { ContextPacket } from "@/lib/agent-mode/types";

export type TeamTaskStatus =
  | "pending"
  | "running"
  | "blocked"
  | "completed"
  | "warning"
  | "failed";

export type TeamTaskOwnerType = "main" | "subagent" | "workflow" | "human";

export type TeamTaskSourceType = "manual" | "subagent" | "workflow";

export interface TeamTaskSource {
  type: TeamTaskSourceType;
  id: string;
  parentId?: string;
}

export interface TeamTask {
  id: string;
  agentId: string;
  sessionId?: string | null;
  goalId?: string;
  workflowId?: string;
  batchId?: string;
  title: string;
  status: TeamTaskStatus;
  ownerType: TeamTaskOwnerType;
  ownerId?: string;
  dependsOn: string[];
  contextPacketId?: string;
  contextPacket?: ContextPacket;
  writePaths: string[];
  requiredEvidence: string[];
  evidenceIds: string[];
  artifactRefs: string[];
  blockedBy?: string;
  source: TeamTaskSource;
  createdAt: number;
  updatedAt: number;
}

export type TeamTaskEventType =
  | "task_created"
  | "task_updated"
  | "evidence_linked"
  | "artifact_linked"
  | "status_changed"
  | "note_added";

export interface TeamTaskEvent {
  id: string;
  taskId: string;
  agentId: string;
  sessionId?: string | null;
  type: TeamTaskEventType;
  status?: TeamTaskStatus;
  evidenceIds?: string[];
  artifactRefs?: string[];
  note?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface TeamTaskUpdate {
  task: TeamTask;
  event: TeamTaskEvent;
}

export interface TeamTaskListFilter {
  agentId?: string;
  sessionId?: string | null;
  goalId?: string;
  workflowId?: string;
  batchId?: string;
  status?: TeamTaskStatus;
  ownerType?: TeamTaskOwnerType;
}
