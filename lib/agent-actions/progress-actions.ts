import {
  pushProgressEvent,
  type AgentRecord,
} from "@/lib/agent-registry";
import { appendEvidence } from "@/lib/evidence/server-store";
import type { ProgressUpdateInput } from "@/lib/progress/types";
import {
  getProgress,
  updateProgress,
} from "@/lib/progress/server-store";
import { writePersistedProgress } from "@/lib/progress/file-store";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const PROGRESS_EVIDENCE_ACTIONS = new Set([
  "progress_update",
  "evidence_record_browser_observation",
]);

export function isProgressEvidencePostAction(type: string): boolean {
  return PROGRESS_EVIDENCE_ACTIONS.has(type);
}

export function parseProgressUpdate(
  body: Record<string, unknown>
): ProgressUpdateInput {
  return {
    steps: Array.isArray(body.steps)
      ? (body.steps as ProgressUpdateInput["steps"])
      : undefined,
    artifacts: Array.isArray(body.artifacts)
      ? (body.artifacts as ProgressUpdateInput["artifacts"])
      : undefined,
    replaceSteps: body.replaceSteps === true,
    replaceArtifacts: body.replaceArtifacts === true,
  };
}

export async function persistProgressForAgent(
  rec: AgentRecord,
  progress: ReturnType<typeof getProgress>
): Promise<void> {
  try {
    await writePersistedProgress(rec.session.sessionId, progress);
  } catch {
    // Progress persistence is best-effort; UI should not fail a tool/run because
    // the auxiliary runtime cache cannot be written.
  }
}

export async function handleProgressEvidencePostAction({
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
    case "progress_update": {
      const progress = updateProgress(agentId, parseProgressUpdate(body));
      await persistProgressForAgent(rec, progress);
      pushProgressEvent(rec, progress);
      return okAction({ ok: true, progress });
    }

    case "evidence_record_browser_observation": {
      const passed = body.passed === true;
      const title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, 140)
          : passed
            ? "Host browser observation passed"
            : "Host browser observation failed";
      const url =
        typeof body.url === "string" && body.url.trim()
          ? body.url.trim().slice(0, 1000)
          : undefined;
      const textPreview =
        typeof body.textPreview === "string"
          ? body.textPreview.slice(0, 1200)
          : undefined;
      const createdAt = Date.now();
      const evidence = appendEvidence({
        id: `host-browser-observation:${agentId}:${createdAt}`,
        kind: "browser_snapshot",
        title,
        agentId,
        sessionId: rec.session.sessionId,
        browserId: `agent:${agentId}`,
        url,
        textPreview,
        trustLevel: "host_observed",
        source: { type: "browser", id: `agent:${agentId}` },
        criteria: [{ requiredEvidence: "browser_observation" }],
        metadata: {
          status: passed ? "passed" : "failed",
          outcome: passed ? "passed" : "failed",
          observedBy: "provider-dogfood-runner",
        },
        createdAt,
        updatedAt: createdAt,
      });
      return okAction({ ok: true, evidence });
    }

    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}
