import type { EvidenceRef } from "@/lib/evidence/types";
import { appendEvidenceMany as appendEvidenceManyToStore } from "@/lib/evidence/server-store";
import { deriveTeamTaskUpdatesFromAgentEvent } from "@/lib/team-state/event-adapter";
import { upsertTeamTasks as upsertTeamTasksToStore } from "@/lib/team-state/server-store";
import type { TeamTask, TeamTaskUpdate } from "@/lib/team-state/types";
import type { RuntimeEvent } from "./events";
import { appendRuntimeEvent as appendRuntimeEventToStore } from "./event-store";
import {
  bridgeAgentEventToRuntime as bridgeAgentEventToRuntimeEvent,
  type AgentEventBridgeContext,
  type AgentEventBridgeResult,
} from "./agent-event-bridge";

export interface AgentEventMirrorDeps {
  bridgeAgentEventToRuntime?: (
    ctx: AgentEventBridgeContext,
    rawEvent: unknown
  ) => AgentEventBridgeResult | null;
  appendEvidenceMany?: (items: EvidenceRef[]) => EvidenceRef[];
  appendRuntimeEvent?: <TPayload>(
    event: RuntimeEvent<TPayload>
  ) => RuntimeEvent<TPayload>;
  deriveTeamTaskUpdates?: (
    ctx: AgentEventBridgeContext,
    rawEvent: unknown,
    evidence: EvidenceRef[]
  ) => TeamTaskUpdate[];
  upsertTeamTasks?: (updates: TeamTaskUpdate[]) => TeamTask[];
  onError?: (err: unknown) => void;
}

export type AgentEventMirrorResult =
  | {
      status: "mirrored";
      event: RuntimeEvent;
      evidence: EvidenceRef[];
      teamTasks: TeamTask[];
    }
  | { status: "skipped" }
  | { status: "failed"; error: unknown };

function defaultMirrorErrorHandler(err: unknown): void {
  console.error("[runtime-event-bridge] mirror failed:", err);
}

export function mirrorAgentEventToRuntimeLedger(
  ctx: AgentEventBridgeContext,
  rawEvent: unknown,
  deps: AgentEventMirrorDeps = {}
): AgentEventMirrorResult {
  const bridge =
    deps.bridgeAgentEventToRuntime ?? bridgeAgentEventToRuntimeEvent;
  const appendEvidenceMany =
    deps.appendEvidenceMany ?? appendEvidenceManyToStore;
  const appendRuntimeEvent =
    deps.appendRuntimeEvent ?? appendRuntimeEventToStore;
  const deriveTeamTaskUpdates =
    deps.deriveTeamTaskUpdates ?? deriveTeamTaskUpdatesFromAgentEvent;
  const upsertTeamTasks = deps.upsertTeamTasks ?? upsertTeamTasksToStore;
  const onError = deps.onError ?? defaultMirrorErrorHandler;

  try {
    const bridged = bridge(ctx, rawEvent);
    if (!bridged) return { status: "skipped" };
    const evidence = appendEvidenceMany(bridged.evidence);
    const event = appendRuntimeEvent(
      evidence.length > 0 ? { ...bridged.event, evidence } : bridged.event
    );
    const teamTaskUpdates = deriveTeamTaskUpdates(ctx, rawEvent, evidence);
    const teamTasks =
      teamTaskUpdates.length > 0 ? upsertTeamTasks(teamTaskUpdates) : [];
    return { status: "mirrored", event, evidence, teamTasks };
  } catch (err) {
    onError(err);
    return { status: "failed", error: err };
  }
}
