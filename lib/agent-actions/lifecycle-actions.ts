import {
  abortLocalCodingAssistantAgent,
  abortSubagentsForParent,
  abortWorkflowsForParent,
  isLocalCodingAssistantAgent,
  pushProgressEvent,
  type AgentRecord,
} from "@/lib/agent-registry";
import { failOpenProgress } from "@/lib/progress/server-store";
import { persistProgressForAgent } from "./progress-actions";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

const LIFECYCLE_ACTIONS = new Set([
  "abort",
  "abort_compaction",
  "abortCompaction",
  "compact",
  "navigate_tree",
  "navigateTree",
]);

export function isLifecyclePostAction(type: string): boolean {
  return LIFECYCLE_ACTIONS.has(type);
}

export async function handleLifecyclePostAction({
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
    case "abort": {
      const progress = failOpenProgress(agentId, "用户已中止当前任务。");
      await persistProgressForAgent(rec, progress);
      pushProgressEvent(rec, progress);
      await abortWorkflowsForParent(agentId);
      await abortSubagentsForParent(agentId);
      if (isLocalCodingAssistantAgent(rec)) {
        await abortLocalCodingAssistantAgent(rec);
      } else {
        await rec.session.abort();
      }
      // SDK 不一定会再送 agent_end（底层 stream 已被拆）。为避免 sidebar 黄点
      // 一直亮着，这里主动将 record.isStreaming 扯低。
      rec.isStreaming = false;
      rec.isPromptStarting = false;
      rec.updatedAt = Date.now();
      return okAction({ ok: true, progress });
    }

    case "abort_compaction":
    case "abortCompaction":
      rec.session.abortCompaction();
      return okAction({ ok: true });

    case "compact": {
      const customInstructions = body.customInstructions as
        | string
        | undefined;
      const result = await rec.session.compact(customInstructions);
      return okAction({ ok: true, result });
    }

    case "navigate_tree":
    case "navigateTree": {
      const targetId = body.targetId as string;
      if (!targetId) return errorAction("targetId required", 400);
      const result = await rec.session.navigateTree(targetId, {
        summarize: body.summarize as boolean | undefined,
        customInstructions: body.customInstructions as string | undefined,
        replaceInstructions: body.replaceInstructions as boolean | undefined,
        label: body.label as string | undefined,
      });
      return okAction({ ok: true, result });
    }

    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}
