import {
  createAgent,
  disposeAgent,
  getModelRegistry,
  isLocalCodingAssistantAgent,
  type AgentRecord,
} from "@/lib/agent-registry";
import {
  LOCAL_CODING_ASSISTANT_MODELS,
  LOCAL_CODING_ASSISTANT_PROVIDER_ID,
  buildLocalCodingAssistantSessionModel,
  localCodingAssistantModelPayload,
} from "@/lib/local-coding-assistant/adapter";
import type { ThinkingLevel } from "@/lib/types";
import { errorAction, okAction, type AgentPostActionResult } from "./types";

export { buildLocalCodingAssistantSessionModel } from "@/lib/local-coding-assistant/adapter";

const MODEL_TOOL_ACTIONS = new Set([
  "set_model",
  "setModel",
  "set_thinking_level",
  "setThinkingLevel",
  "set_tools",
]);

export function isModelToolPostAction(type: string): boolean {
  return MODEL_TOOL_ACTIONS.has(type);
}

export async function handleModelToolPostAction({
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
    case "set_model":
    case "setModel": {
      const provider = body.provider as string;
      const modelId = body.modelId as string;
      if (!provider || !modelId) {
        return errorAction("provider and modelId required", 400);
      }
      if (provider === LOCAL_CODING_ASSISTANT_PROVIDER_ID) {
        const model = LOCAL_CODING_ASSISTANT_MODELS.find(
          (item) => item.id === modelId
        );
        if (!model) return errorAction(`model not found: ${provider}/${modelId}`, 404);
        if (!isLocalCodingAssistantAgent(rec)) {
          const replacement = await createAgent({
            provider,
            modelId,
            cwd: rec.cwd,
            thinkingLevel: rec.session.thinkingLevel,
          });
          disposeAgent(agentId);
          return okAction({
            ok: true,
            replacementAgent: replacement,
            model: localCodingAssistantModelPayload(model),
          });
        }
        const nextModel = buildLocalCodingAssistantSessionModel(model);
        await rec.session.setModel(nextModel as never);
        return okAction({
          ok: true,
          model: localCodingAssistantModelPayload(model),
        });
      }

      const mr = getModelRegistry();
      const model = mr.find(provider, modelId);
      if (!model) return errorAction(`model not found: ${provider}/${modelId}`, 404);
      if (isLocalCodingAssistantAgent(rec)) {
        const replacement = await createAgent({
          provider,
          modelId,
          cwd: rec.cwd,
          thinkingLevel: rec.session.thinkingLevel,
        });
        disposeAgent(agentId);
        return okAction({
          ok: true,
          replacementAgent: replacement,
          model: { provider: model.provider, id: model.id, name: model.name },
        });
      }
      await rec.session.setModel(model);
      return okAction({
        ok: true,
        model: { provider: model.provider, id: model.id, name: model.name },
      });
    }

    case "set_thinking_level":
    case "setThinkingLevel": {
      const level = body.level as ThinkingLevel;
      if (!level) return errorAction("level required", 400);
      rec.session.setThinkingLevel(level);
      return okAction({
        ok: true,
        thinkingLevel: rec.session.thinkingLevel,
      });
    }

    case "set_tools": {
      const raw = body.tools as unknown;
      if (!Array.isArray(raw)) return errorAction("tools (string[]) required", 400);
      const names = raw.filter((x): x is string => typeof x === "string");
      rec.session.setActiveToolsByName(names);
      return okAction({
        ok: true,
        active: rec.session.getActiveToolNames(),
      });
    }

    default:
      return errorAction(`unknown action: ${type}`, 400);
  }
}
