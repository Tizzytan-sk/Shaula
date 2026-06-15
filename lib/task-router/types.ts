export type AdvisoryRouteKind =
  | "direct"
  | "goal"
  | "workflow_template"
  | "workflow_script"
  | "subagent_batch"
  | "browser_task"
  | "ask_user";

export interface AdvisoryRouteOverride {
  route: AdvisoryRouteKind;
  reason: string;
}

export interface AdvisoryRouteDecision {
  id: string;
  agentId: string;
  route: AdvisoryRouteKind;
  confidence: number;
  reasons: string[];
  inputPreview: string;
  overriddenFrom?: AdvisoryRouteKind;
  overrideReason?: string;
  createdAt: number;
}

export interface InferAdvisoryRouteInput {
  agentId: string;
  text: string;
  hasActiveGoal?: boolean;
  attachments?: string[];
  mentionedAgents?: string[];
  override?: Partial<AdvisoryRouteOverride>;
  createdAt?: number;
}

export interface AdvisoryRouteDecisionFilter {
  agentId?: string;
  route?: AdvisoryRouteKind;
  limit?: number;
}
