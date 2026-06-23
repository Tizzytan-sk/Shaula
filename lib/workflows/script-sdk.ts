import "server-only";
import { lookup } from "node:dns/promises";
import type {
  RunWorkflowScriptDeps,
  RunWorkflowScriptInput,
  WorkflowAgentInput,
  WorkflowAgentResult,
  WorkflowAgentType,
  WorkflowArtifact,
  WorkflowAskUserInput,
  WorkflowAskUserResult,
  WorkflowCallToolInput,
  WorkflowCallToolResult,
  WorkflowCheckpoint,
  WorkflowCapability,
  WorkflowCreateWorktreeInput,
  WorkflowFetchUrlInput,
  WorkflowFetchUrlResult,
  WorkflowManifest,
  WorkflowMcpToolDescriptor,
  WorkflowNetworkPolicy,
  WorkflowRun,
  WorkflowScriptLog,
  WorkflowSpawnAgentInput,
  WorkflowTraceEvent,
  WorkflowWorktree,
  WorkflowWorktreeDiff,
  WorkflowWorktreeMergeResult,
} from "./types";
import {
  appendWorkflowCheckpoint,
  appendWorkflowLog,
  appendWorkflowTraceEvent,
  putWorkflowArtifact,
} from "./server-store";
import { appendWorkflowNetworkAudit } from "./network-policy";
import { schemaInstruction, validateJsonSchema } from "./json-schema";
import { requireCapability, safeAllowedTools } from "./script-capabilities";
import { createWorkflowScriptWorktreeRuntime } from "./script-worktree-manager";

const DEFAULT_FETCH_MAX_BYTES = 128 * 1024;
const HARD_FETCH_MAX_BYTES = 1024 * 1024;

export type WorkflowResumeState = {
  fromWorkflowId: string;
  objective: string;
  status: WorkflowRun["status"];
  lastCheckpoint?: WorkflowCheckpoint;
  checkpointNames: string[];
  artifactNames: string[];
};

export type WorkflowSdk = {
  readonly workflowId: string;
  readonly objective: string;
  readonly capabilities: readonly WorkflowCapability[];
  readonly resume?: WorkflowResumeState;
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  checkpoint(name: string, value: unknown): unknown;
  artifact(name: string, value: unknown): unknown;
  readArtifact(name: string): unknown;
  listArtifacts(): WorkflowArtifact[];
  createWorktree(input?: WorkflowCreateWorktreeInput): Promise<WorkflowWorktree>;
  diffWorktree(worktree: WorkflowWorktree): Promise<WorkflowWorktreeDiff>;
  mergeWorktree(worktree: WorkflowWorktree): Promise<WorkflowWorktreeMergeResult>;
  removeWorktree(worktree: WorkflowWorktree): Promise<void>;
  askUser(input: WorkflowAskUserInput): Promise<WorkflowAskUserResult>;
  fetchUrl(input: WorkflowFetchUrlInput): Promise<WorkflowFetchUrlResult>;
  listTools(serverId?: string): Promise<WorkflowMcpToolDescriptor[]>;
  callTool(input: WorkflowCallToolInput): Promise<WorkflowCallToolResult>;
  agent<T = unknown>(
    prompt: string,
    input?: Omit<WorkflowAgentInput, "prompt">
  ): Promise<WorkflowAgentResult<T>>;
  spawnAgent(input: WorkflowSpawnAgentInput): Promise<unknown>;
  parallel<T>(items: Array<Promise<T> | (() => Promise<T> | T)>): Promise<T[]>;
  stage<T>(title: string, fn: () => Promise<T> | T): Promise<T>;
  sleep(ms: number): Promise<void>;
};

interface CreateWorkflowSdkArgs {
  deps: RunWorkflowScriptDeps;
  input: RunWorkflowScriptInput;
  manifest: WorkflowManifest;
  workflowId: string;
  signal: AbortSignal;
  artifacts: Map<string, WorkflowArtifact>;
  checkpoints: WorkflowCheckpoint[];
  logs: WorkflowScriptLog[];
  traceEvents: WorkflowTraceEvent[];
  resumeState?: WorkflowResumeState;
}

function now() {
  return Date.now();
}

function cleanText(raw: string | undefined, limit: number): string {
  return (raw?.trim() ?? "").slice(0, limit);
}

function serializeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function roleForAgentType(agentType: WorkflowAgentType | undefined): WorkflowSpawnAgentInput["role"] {
  switch (agentType) {
    case "classifier":
    case "researcher":
      return "research";
    case "implementer":
      return "implementation";
    case "reviewer":
    case "verifier":
      return "code-review";
    case "general":
    default:
      return "general";
  }
}

function extractJsonValue(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error("schema output was empty");
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const start = Math.min(
      ...[text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0)
    );
    if (Number.isFinite(start)) {
      const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
      if (end > start) return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("schema output was not valid JSON");
  }
}

/**
 * Whether an MCP server is usable by this workflow. `undefined` allowedMcpServers
 * means "all enabled servers" (parent decides). An explicit list restricts to it.
 */
function isServerInScope(
  allowedMcpServers: string[] | undefined,
  serverId: string
): boolean {
  if (allowedMcpServers === undefined) return true;
  return allowedMcpServers.includes(serverId);
}

function normalizeFetchHeaders(raw: Record<string, string> | undefined) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw ?? {})) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "proxy-authorization"
    ) {
      throw new Error(`workflow.fetchUrl does not allow sensitive header: ${key}`);
    }
    if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) {
      throw new Error(`workflow.fetchUrl invalid header name: ${key}`);
    }
    headers.set(key.slice(0, 80), String(value).slice(0, 2000));
  }
  return headers;
}

function isPrivateOrLocalHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function isPrivateOrLocalIp(address: string): boolean {
  const lower = address.toLowerCase();
  if (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  ) {
    return true;
  }
  if (lower.startsWith("::ffff:")) {
    return isPrivateOrLocalIp(lower.slice("::ffff:".length));
  }
  const parts = lower.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168
  );
}

function assertPublicHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("workflow.fetchUrl only supports http(s) URLs");
  }
  const host = url.hostname.toLowerCase();
  if (isPrivateOrLocalHostname(host) || isPrivateOrLocalIp(host)) {
    throw new Error("workflow.fetchUrl does not allow localhost or private-network URLs");
  }
  return url;
}

async function defaultResolveFetchHost(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true, verbatim: false });
  return records.map((record) => record.address);
}

async function assertPublicDnsResolution(
  url: URL,
  resolveHost: (host: string) => Promise<string[]>
): Promise<void> {
  const host = url.hostname.toLowerCase();
  if (isPrivateOrLocalIp(host)) return;
  const addresses = await resolveHost(host);
  if (addresses.some((address) => isPrivateOrLocalIp(address))) {
    throw new Error(
      "workflow.fetchUrl does not allow URLs that resolve to localhost or private-network addresses"
    );
  }
}

function normalizeOriginRule(rule: string): string {
  const cleaned = cleanText(rule, 500).toLowerCase().replace(/\/+$/, "");
  if (!cleaned) return "";
  try {
    return new URL(cleaned).origin.toLowerCase();
  } catch {
    return cleaned;
  }
}

function originMatches(rules: string[] | undefined, url: URL): boolean {
  const candidates = new Set([
    url.origin.toLowerCase(),
    url.host.toLowerCase(),
    url.hostname.toLowerCase(),
  ]);
  return (rules ?? [])
    .map(normalizeOriginRule)
    .filter(Boolean)
    .some((rule) => candidates.has(rule));
}

function wildcardPatternMatches(pattern: string, value: string): boolean {
  const cleaned = cleanText(pattern, 1000);
  if (!cleaned) return false;
  const escaped = cleaned.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function urlPatternMatches(patterns: string[] | undefined, url: URL): boolean {
  const value = url.toString();
  return (patterns ?? []).some((pattern) => wildcardPatternMatches(pattern, value));
}

function assertNetworkPolicyAllows(
  input: WorkflowFetchUrlInput,
  url: URL,
  policy: WorkflowNetworkPolicy | undefined
): void {
  if (!policy) return;
  const method = input.method === "POST" ? "POST" : "GET";
  if (
    Array.isArray(policy.allowedMethods) &&
    policy.allowedMethods.length > 0 &&
    !policy.allowedMethods.includes(method)
  ) {
    throw new Error(`workflow.fetchUrl network policy does not allow method: ${method}`);
  }
  if (originMatches(policy.deniedOrigins, url)) {
    throw new Error(`workflow.fetchUrl network policy denies origin: ${url.origin}`);
  }
  if (urlPatternMatches(policy.deniedUrlPatterns, url)) {
    throw new Error(`workflow.fetchUrl network policy denies URL: ${url.toString()}`);
  }
  const hasAllowRules =
    (policy.allowedOrigins?.length ?? 0) > 0 ||
    (policy.allowedUrlPatterns?.length ?? 0) > 0;
  if (
    hasAllowRules &&
    !originMatches(policy.allowedOrigins, url) &&
    !urlPatternMatches(policy.allowedUrlPatterns, url)
  ) {
    throw new Error(`workflow.fetchUrl network policy does not allow URL: ${url.toString()}`);
  }
}

async function assertFetchRequestAllowed(
  input: WorkflowFetchUrlInput,
  policy: WorkflowNetworkPolicy | undefined,
  resolveHost: (host: string) => Promise<string[]>
): Promise<URL> {
  const url = assertPublicHttpUrl(cleanText(input.url, 2000));
  assertNetworkPolicyAllows(input, url, policy);
  await assertPublicDnsResolution(url, resolveHost);
  return url;
}

async function defaultFetchUrl(
  input: WorkflowFetchUrlInput,
  signal: AbortSignal,
  resolveHost: (host: string) => Promise<string[]> = defaultResolveFetchHost,
  policy?: WorkflowNetworkPolicy
): Promise<WorkflowFetchUrlResult> {
  const url = await assertFetchRequestAllowed(input, policy, resolveHost);
  const method = input.method === "POST" ? "POST" : "GET";
  const maxBytes = Math.max(
    1,
    Math.min(Math.floor(input.maxBytes ?? DEFAULT_FETCH_MAX_BYTES), HARD_FETCH_MAX_BYTES)
  );
  const body = method === "POST" ? cleanText(input.body, 64 * 1024) : undefined;
  const response = await fetch(url.toString(), {
    method,
    headers: normalizeFetchHeaders(input.headers),
    body,
    signal,
    redirect: "follow",
  });
  const contentType = response.headers.get("content-type") ?? undefined;
  const text = await response.text();
  const truncated = text.length > maxBytes;
  return {
    url: response.url,
    status: response.status,
    ok: response.ok,
    statusText: response.statusText,
    contentType,
    text: truncated ? text.slice(0, maxBytes) : text,
    truncated,
  };
}

export function createWorkflowSdk({
  deps,
  input,
  manifest,
  workflowId,
  signal,
  artifacts,
  checkpoints,
  logs,
  traceEvents,
  resumeState,
}: CreateWorkflowSdkArgs): WorkflowSdk {
  let spawnedAgents = 0;
  const worktreeRuntime = createWorkflowScriptWorktreeRuntime({
    deps,
    manifest,
    workflowId,
    objective: input.objective,
    rationale: input.rationale,
    signal,
    artifacts,
  });

  function pushLog(level: WorkflowScriptLog["level"], message: string) {
    const log = {
      level,
      message: cleanText(message, 4000),
      createdAt: now(),
    };
    logs.push(log);
    appendWorkflowLog(workflowId, log);
    deps.onEvent?.({ type: "workflow_log", workflowId, log });
  }

  function pushTrace(trace: WorkflowTraceEvent) {
    traceEvents.push(trace);
    appendWorkflowTraceEvent(workflowId, trace);
    deps.onEvent?.({ type: "workflow_trace", workflowId, trace });
  }

  async function runSpawnAgent(agentInput: WorkflowSpawnAgentInput) {
    if (signal.aborted) throw new Error("Workflow script aborted");
    requireCapability(manifest, "spawn_agent");
    spawnedAgents += 1;
    if (spawnedAgents > manifest.maxAgents) {
      throw new Error(
        `workflow.spawnAgent exceeded manifest maxAgents=${manifest.maxAgents}`
      );
    }
    const title = cleanText(agentInput.title, 120);
    const prompt = cleanText(agentInput.prompt, 12000);
    if (!title) throw new Error("workflow.spawnAgent requires a title");
    if (!prompt) throw new Error("workflow.spawnAgent requires a prompt");
    const { results } = await deps.runSubagents(
      {
        reason: [
          input.rationale,
          `Workflow ${workflowId} spawned agent: ${title}`,
        ].join("\n"),
        concurrency: 1,
        tasks: [
          {
            id: cleanText(agentInput.id, 80) || title,
            title,
            prompt: [`Workflow objective: ${input.objective}`, prompt].join("\n\n"),
            role: agentInput.role,
            cwd: agentInput.cwd,
            allowedTools: safeAllowedTools(manifest, agentInput.allowedTools),
            maxTurns: agentInput.maxTurns,
            timeoutMs: agentInput.timeoutMs,
          },
        ],
      },
      signal
    );
    const result = results[0];
    if (!result) throw new Error(`No subagent result returned for ${title}`);
    return result;
  }

  return Object.freeze({
    workflowId,
    objective: input.objective,
    capabilities: Object.freeze(manifest.capabilities.slice()),
    resume: resumeState ? Object.freeze({ ...resumeState }) : undefined,

    log(message: string) {
      pushLog("info", message);
    },

    warn(message: string) {
      pushLog("warn", message);
    },

    error(message: string) {
      pushLog("error", message);
    },

    checkpoint(name: string, value: unknown) {
      const checkpoint = {
        name: cleanText(name, 160),
        value,
        createdAt: now(),
      };
      checkpoints.push(checkpoint);
      appendWorkflowCheckpoint(workflowId, checkpoint);
      deps.onEvent?.({ type: "workflow_checkpoint", workflowId, checkpoint });
      return value;
    },

    artifact(name: string, value: unknown) {
      const artifact = {
        name: cleanText(name, 160),
        value,
        createdAt: now(),
      };
      artifacts.set(artifact.name, artifact);
      putWorkflowArtifact(workflowId, artifact);
      deps.onEvent?.({ type: "workflow_artifact", workflowId, artifact });
      return value;
    },

    readArtifact(name: string) {
      return artifacts.get(name)?.value;
    },

    listArtifacts() {
      return Array.from(artifacts.values());
    },

    createWorktree: worktreeRuntime.createWorktree,
    diffWorktree: worktreeRuntime.diffWorktree,
    mergeWorktree: worktreeRuntime.mergeWorktree,
    removeWorktree: worktreeRuntime.removeWorktree,

    async askUser(askInput: WorkflowAskUserInput) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "ask_user");
      if (!deps.askUser) {
        throw new Error("workflow.askUser requires a user clarification runtime");
      }
      const options = Array.isArray(askInput.options)
        ? askInput.options
            .slice(0, 4)
            .map((option, index) => ({
              id: cleanText(option.id, 80) || undefined,
              label: cleanText(option.label, 80) || `Option ${index + 1}`,
              description: cleanText(option.description, 200) || undefined,
              value: cleanText(option.value, 1000) || undefined,
            }))
        : [];
      if (options.length === 0) {
        throw new Error("workflow.askUser requires at least one option");
      }
      return deps.askUser({
        workflowId,
        manifest,
        objective: input.objective,
        rationale: input.rationale,
        input: {
          title: cleanText(askInput.title, 100) || undefined,
          question: cleanText(askInput.question, 800),
          context: cleanText(askInput.context, 1000) || undefined,
          options,
          recommendedOptionId:
            cleanText(askInput.recommendedOptionId, 80) || undefined,
        },
      });
    },

    async fetchUrl(fetchInput: WorkflowFetchUrlInput) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "network");
      const fetchRequest: WorkflowFetchUrlInput = {
        url: cleanText(fetchInput.url, 2000),
        method: fetchInput.method === "POST" ? "POST" : "GET",
        headers: fetchInput.headers,
        body: fetchInput.body,
        maxBytes: fetchInput.maxBytes,
      };
      if (!fetchRequest.url) throw new Error("workflow.fetchUrl requires a url");
      if (!deps.approveNetworkRequest) {
        throw new Error("workflow.fetchUrl requires per-request network approval");
      }
      const method = fetchRequest.method ?? "GET";
      const resp = await deps.approveNetworkRequest({
        workflowId,
        manifest,
        objective: input.objective,
        rationale: input.rationale,
        input: fetchRequest,
      });
      if (resp.decision !== "allow") {
        appendWorkflowNetworkAudit({
          workflowId,
          url: fetchRequest.url,
          method,
          outcome: "denied",
          reason: resp.denyReason ?? "Workflow network request denied by user",
        });
        pushLog(
          "warn",
          `[network] denied by user: ${method} ${fetchRequest.url} (${resp.denyReason ?? "no reason"})`
        );
        throw new Error(resp.denyReason ?? "Workflow network request denied");
      }
      try {
        if (deps.fetchUrl) {
          await assertFetchRequestAllowed(
            fetchRequest,
            deps.networkPolicy,
            deps.resolveFetchHost ?? defaultResolveFetchHost
          );
        }
        const result = deps.fetchUrl
          ? await deps.fetchUrl(fetchRequest, signal)
          : await defaultFetchUrl(
              fetchRequest,
              signal,
              deps.resolveFetchHost,
              deps.networkPolicy
            );
        pushLog(
          "info",
          `[network] fetched: ${method} ${fetchRequest.url} -> ${result.status} ${result.statusText}`
        );
        appendWorkflowNetworkAudit({
          workflowId,
          url: fetchRequest.url,
          method,
          outcome: "allowed",
          status: result.status,
          reason: result.statusText,
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushLog("warn", `[network] blocked or failed: ${method} ${fetchRequest.url} (${message})`);
        appendWorkflowNetworkAudit({
          workflowId,
          url: fetchRequest.url,
          method,
          outcome: "failed",
          reason: message,
        });
        throw error;
      }
    },

    async listTools(serverId?: string): Promise<WorkflowMcpToolDescriptor[]> {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "mcp");
      if (!deps.listMcpTools) {
        throw new Error("workflow.listTools requires an MCP runtime");
      }
      const requested = cleanText(serverId, 120) || undefined;
      if (requested && !isServerInScope(deps.allowedMcpServers, requested)) {
        throw new Error(
          `workflow.listTools: MCP server "${requested}" is not in this workflow's scope`
        );
      }
      const tools = await deps.listMcpTools(requested);
      // Defense-in-depth: even when no serverId was given, the broker already
      // scopes to allowedMcpServers; filter again so a scope leak can't slip a
      // tool through.
      return tools.filter((tool) =>
        isServerInScope(deps.allowedMcpServers, tool.serverId)
      );
    },

    async callTool(toolInput: WorkflowCallToolInput): Promise<WorkflowCallToolResult> {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "mcp");
      if (!deps.callMcpTool) {
        throw new Error("workflow.callTool requires an MCP runtime");
      }
      const server = cleanText(toolInput?.server, 120);
      const tool = cleanText(toolInput?.tool, 200);
      if (!server) throw new Error("workflow.callTool requires a server id");
      if (!tool) throw new Error("workflow.callTool requires a tool name");
      if (!isServerInScope(deps.allowedMcpServers, server)) {
        throw new Error(
          `workflow.callTool: MCP server "${server}" is not in this workflow's scope`
        );
      }
      const callRequest: WorkflowCallToolInput = {
        server,
        tool,
        input:
          toolInput?.input && typeof toolInput.input === "object"
            ? (toolInput.input as Record<string, unknown>)
            : {},
      };
      // Every MCP call surfaces an approval, mirroring fetchUrl: the worker can
      // never call an MCP tool without an explicit user (or policy) decision.
      if (!deps.approveMcpTool) {
        throw new Error("workflow.callTool requires per-call MCP approval");
      }
      const resp = await deps.approveMcpTool({
        workflowId,
        manifest,
        objective: input.objective,
        rationale: input.rationale,
        input: callRequest,
      });
      if (resp.decision !== "allow") {
        pushLog(
          "warn",
          `[mcp] denied by user: ${server}/${tool} (${resp.denyReason ?? "no reason"})`
        );
        throw new Error(resp.denyReason ?? "Workflow MCP tool call denied");
      }
      const result = await deps.callMcpTool(callRequest);
      pushLog(
        "info",
        `[mcp] called: ${server}/${tool} -> ${result.isError ? "error" : "ok"}`
      );
      return result;
    },

    async agent<T = unknown>(
      prompt: string,
      agentInput?: Omit<WorkflowAgentInput, "prompt">
    ): Promise<WorkflowAgentResult<T>> {
      if (signal.aborted) throw new Error("Workflow script aborted");
      const title = cleanText(agentInput?.title, 120) || "Workflow agent";
      const agentRunId = cleanText(agentInput?.id, 80) || `${title}-${spawnedAgents + 1}`;
      const agentType = agentInput?.agentType;
      const role = roleForAgentType(agentType);
      const isolation = agentInput?.isolation ?? "none";
      if (agentInput?.model) {
        throw new Error("workflow.agent model routing is not implemented yet");
      }
      let worktree: WorkflowWorktree | undefined;
      let cwd = cleanText(agentInput?.cwd, 1000) || undefined;
      if (isolation === "worktree") {
        requireCapability(manifest, "worktree");
        worktree = await worktreeRuntime.createWorktree({ name: title });
        cwd = worktree.path;
      }
      const schema = agentInput?.schema;
      const fullPrompt = [
        prompt,
        schema ? schemaInstruction(schema) : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      pushTrace({
        type: "agent_start",
        workflowId,
        agentRunId,
        title,
        agentType,
        role,
        model: agentInput?.model,
        isolation,
        createdAt: now(),
      });
      let schemaValid: boolean | undefined;
      try {
        const result = await runSpawnAgent({
          id: agentRunId,
          title,
          prompt: fullPrompt,
          role,
          cwd,
          allowedTools: agentInput?.tools ?? agentInput?.allowedTools,
          maxTurns: agentInput?.maxTurns,
          timeoutMs: agentInput?.timeoutMs,
        });
        const text = result.answer ?? "";
        let data: T | undefined;
        const localArtifacts: WorkflowArtifact[] = [];
        if (schema) {
          const parsed = extractJsonValue(text);
          const errors = validateJsonSchema(parsed, schema);
          schemaValid = errors.length === 0;
          const trace: WorkflowTraceEvent = {
            type: "schema_validation",
            workflowId,
            agentRunId,
            valid: schemaValid,
            errors,
            createdAt: now(),
          };
          pushTrace(trace);
          const artifact: WorkflowArtifact = {
            name: `schema-output:${agentRunId}`,
            value: { valid: schemaValid, data: parsed, errors },
            kind: "schema_output",
            createdAt: trace.createdAt,
          };
          artifacts.set(artifact.name, artifact);
          localArtifacts.push(artifact);
          putWorkflowArtifact(workflowId, artifact);
          deps.onEvent?.({ type: "workflow_artifact", workflowId, artifact });
          if (!schemaValid) {
            throw new Error(`workflow.agent schema validation failed: ${errors.join("; ")}`);
          }
          data = parsed as T;
        }
        pushTrace({
          type: "agent_end",
          workflowId,
          agentRunId,
          title,
          status: result.status,
          schemaValid,
          error: result.error,
          createdAt: now(),
        });
        return {
          title,
          status: result.status,
          text,
          data,
          error: result.error,
          taskId: result.taskId,
          agentId: result.agentId,
          worktree,
          artifacts: localArtifacts,
        };
      } catch (error) {
        pushTrace({
          type: "agent_end",
          workflowId,
          agentRunId,
          title,
          status: "failed",
          schemaValid,
          error: serializeError(error),
          createdAt: now(),
        });
        throw error;
      }
    },

    async spawnAgent(agentInput: WorkflowSpawnAgentInput) {
      return runSpawnAgent(agentInput);
    },

    async parallel<T>(items: Array<Promise<T> | (() => Promise<T> | T)>) {
      if (!Array.isArray(items)) {
        throw new Error("workflow.parallel requires an array");
      }
      if (items.length > manifest.maxConcurrency) {
        throw new Error(
          `workflow.parallel supports at most ${manifest.maxConcurrency} item(s) for this manifest`
        );
      }
      return Promise.all(
        items.map((item) => (typeof item === "function" ? item() : item))
      );
    },

    async stage<T>(title: string, fn: () => Promise<T> | T) {
      pushLog("info", `stage:start:${cleanText(title, 160)}`);
      try {
        const result = await fn();
        pushLog("info", `stage:end:${cleanText(title, 160)}`);
        return result;
      } catch (err) {
        pushLog("error", `stage:failed:${cleanText(title, 160)}:${serializeError(err)}`);
        throw err;
      }
    },

    async sleep(ms: number) {
      const safeMs = Math.max(0, Math.min(Math.floor(ms), 30000));
      await new Promise((resolve) => setTimeout(resolve, safeMs));
    },
  });
}
