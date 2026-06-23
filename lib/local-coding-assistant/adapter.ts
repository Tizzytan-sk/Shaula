import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentRuntimeProfile } from "@/lib/types";

export const LOCAL_CODING_ASSISTANT_PROVIDER_ID = "local-coding-assistant";
export const LOCAL_CODING_ASSISTANT_MODEL_ID = "local-coding-assistant";

export const SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE = [
  "Shaula operating rules:",
  "- Identity: you are Shaula, the local coding agent in this desktop app. If asked who you are, say Shaula; never say Pi or pi-coding-agent.",
  "- Language: if the user writes Chinese, reply in Chinese. Keep code, commands, paths, API names, and quoted source text unchanged.",
  "- Style: be short and outcome-focused. Do not expose hidden reasoning, self-dialogue, or long exploratory notes. Progress updates should say only what is being checked, changed, or blocked.",
  "- Scope: make surgical changes that trace to the request. Avoid unrelated refactors, speculative abstractions, and unrelated cleanup.",
  "- Product/UI work: identify the active project surface, main artifact, information architecture, acceptance criteria, and verification target before visual patching. After two rejected iterations, diagnose structure instead of making more cosmetic tweaks.",
  "- Evidence: keep progress current, run the narrowest useful checks, and hand off with changed artifact, verification, and remaining risk.",
].join("\n");

export const LOCAL_CODING_ASSISTANT_CLI = String.fromCharCode(
  99,
  111,
  100,
  101,
  119,
  105,
  122,
  45,
  99,
  99
);

export const LOCAL_CODING_ASSISTANT_MODELS = [
  {
    id: LOCAL_CODING_ASSISTANT_MODEL_ID,
    name: "自研 Coding 助手 默认模型",
    cliModel: undefined,
  },
  {
    id: "opus",
    name: "Claude Opus (自研助手)",
    cliModel: "opus",
  },
  {
    id: "sonnet",
    name: "Claude Sonnet (自研助手)",
    cliModel: "sonnet",
  },
  {
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8 (自研助手)",
    cliModel: "claude-opus-4-8",
  },
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5 (自研助手)",
    cliModel: "claude-sonnet-4-5",
  },
] as const;

export const SDK_AGENT_RUNTIME_PROFILE: AgentRuntimeProfile = {
  kind: "sdk_agent",
  label: "SDK-backed agent",
  details:
    "Full SDK-backed runtime with structured tool, progress, evidence, approval, and verifier events.",
  structuredTools: true,
  structuredProgress: true,
  structuredEvidence: true,
  verifier: "full",
};

export const LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE: AgentRuntimeProfile = {
  kind: "external_text_runner",
  label: "External text-only runner",
  details:
    "local-coding-assistant runs through a CLI shim; structured tools, progress, evidence, and approval timeline are limited.",
  structuredTools: false,
  structuredProgress: false,
  structuredEvidence: false,
  verifier: "host_only",
};

export function isLocalCodingAssistantModelId(modelId: string): boolean {
  return LOCAL_CODING_ASSISTANT_MODELS.some((model) => model.id === modelId);
}

export function getLocalCodingAssistantModelOption(
  modelId = LOCAL_CODING_ASSISTANT_MODEL_ID
) {
  return (
    LOCAL_CODING_ASSISTANT_MODELS.find((model) => model.id === modelId) ??
    LOCAL_CODING_ASSISTANT_MODELS[0]
  );
}

export function localCodingAssistantModelPayload(model: {
  id: string;
  name: string;
}) {
  return {
    provider: LOCAL_CODING_ASSISTANT_PROVIDER_ID,
    id: model.id,
    name: model.name,
  };
}

export function buildLocalCodingAssistantSessionModel(model: {
  id: string;
  name: string;
}) {
  return {
    provider: LOCAL_CODING_ASSISTANT_PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: "local-cli",
    baseUrl: "local-cli",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
  };
}

export function localCodingAssistantModel(
  modelId = LOCAL_CODING_ASSISTANT_MODEL_ID
) {
  return buildLocalCodingAssistantSessionModel(
    getLocalCodingAssistantModelOption(modelId)
  );
}

export function localCodingAssistantCliModelArg(
  modelId: string
): string | undefined {
  return LOCAL_CODING_ASSISTANT_MODELS.find((model) => model.id === modelId)
    ?.cliModel;
}

export function createLocalCodingAssistantSession(
  sessionId: string,
  modelId: string
) {
  const session = {
    sessionId,
    sessionFile: undefined,
    model: localCodingAssistantModel(modelId),
    thinkingLevel: "medium",
    pendingMessageCount: 0,
    systemPrompt: SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE,
    prompt: async () => undefined,
    followUp: async () => undefined,
    steer: async () => undefined,
    abort: async () => undefined,
    abortCompaction: () => undefined,
    compact: async () => undefined,
    dispose: () => undefined,
    subscribe: () => () => undefined,
    supportsThinking: () => false,
    getAvailableThinkingLevels: () => [],
    getAllTools: () => [],
    getActiveToolNames: () => [],
    setActiveToolsByName: () => undefined,
    setModel: (nextModel: ReturnType<typeof localCodingAssistantModel>) => {
      session.model = nextModel;
    },
    getSessionStats: () => ({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    }),
    getContextUsage: () => null,
    getUserMessagesForForking: () => [],
    sessionManager: {
      getTree: () => [],
      getLeafId: () => null,
    },
  };
  return session as unknown as AgentSession;
}

export function buildLocalCodingAssistantPrompt(userPrompt: string): string {
  return [
    SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE,
    "",
    "User task:",
    userPrompt,
  ].join("\n");
}

export function buildLocalCodingAssistantCliArgs(
  userPrompt: string,
  modelId: string
): string[] {
  const modelArg = localCodingAssistantCliModelArg(modelId);
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "default",
    ...(modelArg ? ["--model", modelArg] : []),
    buildLocalCodingAssistantPrompt(userPrompt),
  ];
}

export function localCodingAssistantMessage(
  role: "user" | "assistant",
  text: string,
  responseId?: string,
  modelId = LOCAL_CODING_ASSISTANT_MODEL_ID
) {
  return {
    role,
    responseId,
    provider: LOCAL_CODING_ASSISTANT_PROVIDER_ID,
    model: modelId,
    api: "local-cli",
    timestamp: Date.now(),
    content: text
      ? [
          {
            type: "text",
            text,
          },
        ]
      : [],
  };
}

export function extractLocalCodingAssistantText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const item = obj as {
    type?: unknown;
    delta?: unknown;
    text?: unknown;
    result?: unknown;
    message?: { content?: Array<{ type?: string; text?: string }> };
    content?: Array<{ type?: string; text?: string }>;
  };
  if (typeof item.delta === "string") return item.delta;
  if (typeof item.text === "string") return item.text;
  const blocks = item.message?.content ?? item.content;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }
  if (item.type === "result" && typeof item.result === "string") {
    return item.result;
  }
  return "";
}
