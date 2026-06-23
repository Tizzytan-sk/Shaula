/**
 * AgentSession 进程内注册表。
 *
 * 负责：
 * 1. 创建/复用 AgentSession（用 createAgentSession 工厂）
 * 2. 把每个 AgentSession 的事件流缓存到内存 ring buffer，让 SSE 路由能"回放 + 续传"
 *
 * 注意：Next dev 模式下 module 会被 hot-reload，用 globalThis 持久化避免每次代码改动就丢 state。
 */
import "server-only";
import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  ModelRegistry,
  AuthStorage,
  SettingsManager,
  DefaultPackageManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import { disposeBrowser } from "./browser/runtime";
import { agentBrowserId } from "./browser/browser-id";
import {
  abortRunningSubagentBatches,
} from "./subagents/orchestrator";
import { abortRunningWorkflows } from "./workflows/server-store";
import {
  clearSessionRemember,
  listPendingApprovals,
} from "./collab/server-store";
import {
  clearAgentClarifications,
  listPendingClarifications,
} from "./clarification/server-store";
import {
  buildGoalRecap,
  clearGoal,
  finishGoalTurn,
  getGoal,
  noteGoalContinuation,
  patchGoal,
  setGoalStatus,
  startGoalTurn,
} from "./goal/server-store";
import { evaluateAndStoreGoalRunClosure } from "./goal/closure-store";
import { mirrorAgentEventToRuntimeLedger } from "./runtime/agent-event-mirror";
import {
  appendAgentEventBufferEntry,
  createAgentEventBuffer,
  getAgentEventsSince as readBufferedAgentEventsSince,
  getLatestAgentEventSeq,
  notifyAgentEventListeners,
  subscribeAgentEvent,
  type AgentEventBufferEntry,
} from "./agent-event-buffer";
import {
  createAssistantMessageTracker,
  trackAssistantMessageEvent,
  type AssistantMessageStreamEvent,
  type AssistantMessageTracker,
} from "./assistant-message-tracker";
import { auditAndStoreGoalFinalMessage } from "./goal/final-message-audit";
import {
  customToolsForSession,
  enableDefaultBrowserTools,
} from "./agent-tool-assembly";
import {
  buildAgentExtensionWiring,
  type AgentExtensionExternalEvent,
} from "./agent-extension-wiring";
import {
  LOCAL_CODING_ASSISTANT_CLI,
  LOCAL_CODING_ASSISTANT_MODEL_ID,
  LOCAL_CODING_ASSISTANT_PROVIDER_ID,
  LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE,
  SDK_AGENT_RUNTIME_PROFILE,
  buildLocalCodingAssistantCliArgs,
  createLocalCodingAssistantSession,
  extractLocalCodingAssistantText,
  isLocalCodingAssistantModelId,
  localCodingAssistantMessage,
} from "./local-coding-assistant/adapter";
import {
  buildAgentExtensionFactories,
  createAgentResourceLoader,
  createAgentSessionManager,
} from "./agent-session-construction";
import {
  clearFinishWatchdog,
  handleAgentSessionLifecycleEvent,
  type AgentLifecycleDeps,
} from "./agent-lifecycle";
import {
  DEFAULT_CLIENT_REQUEST_TTL_MS,
  claimRecentClientRequest,
} from "./client-request-dedupe";
import type { SubagentRole } from "./subagents/types";
import type { AgentGoal } from "./goal/types";
import type { AgentProgress } from "./progress/types";
import type {
  AgentRuntimeProfile,
  SessionRuntimePhase,
  SessionRuntimeState,
} from "./types";

export {
  LOCAL_CODING_ASSISTANT_MODELS,
  LOCAL_CODING_ASSISTANT_MODEL_ID,
  LOCAL_CODING_ASSISTANT_PROVIDER_ID,
} from "./local-coding-assistant/adapter";

/**
 * Ring buffer 里允许的事件类型。
 *
 * 除了 SDK 的 AgentSessionEvent，还包含 collab 自己的两个事件——它们走相同的 SSE 通道
 * 被推到前端，前端 useAgentEvents 按 type 字段分发。
 *
 * 注：把 union 包给 events 字段使用，对 SSE encode 路径透明（JSON.stringify 即可），
 * 对 SDK subscribe 路径也不影响（subscribe handler 仍然只塞 AgentSessionEvent）。
 */
export type RingBufferEvent =
  | AgentSessionEvent
  | AgentExtensionExternalEvent;

export interface AgentRecord {
  id: string;
  session: AgentSession;
  cwd: string;
  parentAgentId?: string;
  childRole?: SubagentRole;
  hidden?: boolean;
  /**
   * 事件 ring buffer:固定容量环形数组,避免每次满了 splice(O(n))。
   * - 写:events[head++ % MAX],覆盖最旧
   * - 读:遍历 [head - count, head),根据 seq 过滤
   * - count = min(nextSeq, MAX),buffer 满之前 count == nextSeq
   */
  events: Array<AgentEventBufferEntry<RingBufferEvent> | undefined>;
  nextSeq: number;
  /** notify all SSE listeners */
  listeners: Set<() => void>;
  /** 用来在 dispose 时取消订阅 */
  unsubscribe: () => void;
  /** 当前是否在跑(agent_start/end 之间为 true);给 sidebar 标"运行中"用 */
  isStreaming: boolean;
  /** Prompt 已提交但 provider 还没发 agent_start；用于避免后台启动竞态。 */
  isPromptStarting: boolean;
  /** 最近一次 runtime 相关更新，用于 PC/移动端 reconcile。 */
  updatedAt: number;
  /** 短时间内的客户端请求去重，避免弱网/双击重复 prompt。 */
  recentClientRequests: Map<string, number>;
  /** local shim 可能给完整 assistant 内容但漏掉 done/end，用 watchdog 兜底收尾 */
  finishWatchdog: ReturnType<typeof setTimeout> | null;
  pendingFinishMessage: unknown | null;
  /** 当前普通 run/goal 的用户可见执行契约。Goal 自身仍以 goal.contractId 为准。 */
  activeContractId?: string;
  /** Tracks the actual assistant final chat bubble for post-completion audit. */
  assistantMessageTracker?: AssistantMessageTracker;
  external?: {
    kind: "local-coding-assistant";
    child: ChildProcessWithoutNullStreams | null;
    emittedText: string;
  };
}

interface GlobalRegistry {
  agents: Map<string, AgentRecord>;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  /** SettingsManager 以 cwd 缓存，全局/项目 settings 不同 */
  settingsManagers?: Map<string, SettingsManager>;
  packageManagers?: Map<string, DefaultPackageManager>;
}

const g = globalThis as unknown as { __shaulaAgent?: GlobalRegistry };
if (!g.__shaulaAgent) {
  g.__shaulaAgent = { agents: new Map() };
}
const reg = g.__shaulaAgent!;

export function getAuth(): AuthStorage {
  if (!reg.authStorage) {
    reg.authStorage = AuthStorage.create();
  }
  return reg.authStorage;
}

export function getModelRegistry(): ModelRegistry {
  if (!reg.modelRegistry) {
    reg.modelRegistry = ModelRegistry.create(getAuth());
  }
  return reg.modelRegistry;
}

export function listAgentSummaries(): SessionRuntimeState[] {
  return Array.from(reg.agents.values()).map((rec) => {
    const waitingApprovalCount = listPendingApprovals(rec.id).length;
    const waitingClarificationCount = listPendingClarifications(rec.id).length;
    const runtimeState: SessionRuntimePhase =
      waitingApprovalCount + waitingClarificationCount > 0
        ? "waiting_user"
        : rec.isStreaming
          ? "streaming"
          : rec.nextSeq > 0
            ? "completed"
            : "idle";
    return {
      id: rec.id,
      agentId: rec.id,
      sessionId: rec.session.sessionId,
      sessionFile: rec.session.sessionFile ?? null,
      cwd: rec.cwd,
      isStreaming: rec.isStreaming,
      hidden: rec.hidden === true,
      waitingApprovalCount,
      waitingClarificationCount,
      lastEventSeq: rec.nextSeq - 1,
      updatedAt: rec.updatedAt ?? Date.now(),
      runtimeState,
    };
  });
}

export function claimClientRequest(
  agentId: string,
  clientRequestId: string | null | undefined
): boolean {
  const requestId = clientRequestId?.trim();
  if (!requestId) return true;
  const rec = getAgent(agentId);
  if (!rec) return true;
  if (!rec.recentClientRequests) {
    rec.recentClientRequests = new Map();
  }
  const now = Date.now();
  const claimed = claimRecentClientRequest(
    rec.recentClientRequests,
    requestId,
    now,
    DEFAULT_CLIENT_REQUEST_TTL_MS
  );
  if (!claimed) return false;
  rec.updatedAt = now;
  return true;
}

export function clearClientRequest(
  agentId: string,
  clientRequestId: string | null | undefined
): void {
  const requestId = clientRequestId?.trim();
  if (!requestId) return;
  getAgent(agentId)?.recentClientRequests?.delete(requestId);
}

/** 拿（或创建）对应 cwd 的 SettingsManager */
export function getSettingsManager(cwd?: string): SettingsManager {
  const useCwd = cwd && cwd.length > 0 ? cwd : os.homedir();
  if (!reg.settingsManagers) reg.settingsManagers = new Map();
  let sm = reg.settingsManagers.get(useCwd);
  if (!sm) {
    sm = SettingsManager.create(useCwd);
    reg.settingsManagers.set(useCwd, sm);
  }
  return sm;
}

/** 拿（或创建）对应 cwd 的 PackageManager */
export function getPackageManager(cwd?: string): DefaultPackageManager {
  const useCwd = cwd && cwd.length > 0 ? cwd : os.homedir();
  if (!reg.packageManagers) reg.packageManagers = new Map();
  let pm = reg.packageManagers.get(useCwd);
  if (!pm) {
    pm = new DefaultPackageManager({
      cwd: useCwd,
      agentDir: getAgentDir(),
      settingsManager: getSettingsManager(useCwd),
    });
    reg.packageManagers.set(useCwd, pm);
  }
  return pm;
}

/**
 * 把一条「非 SDK 来源」的事件塞进 ring buffer 并通知 SSE listeners。
 *
 * 用途：extension 自定义事件（approval / clarification / progress 等）走相同 SSE 通道
 * 推到前端，前端按 type 字段分发。
 *
 * 设计要点：
 *   - 与 session.subscribe 内的写入路径**完全对称**（同步 seq++、同 ring buffer 写法、
 *     同 listeners 通知）；这样 SSE 路由按 seq 顺序读出后 since 重连语义保持一致
 *   - 不更新 isStreaming flag（approval 事件不算 agent_start/end）
 */
export function pushExternalEvent(
  rec: AgentRecord,
  event: AgentExtensionExternalEvent
): void {
  pushAgentEvent(rec, event);
}

export function pushGoalEvent(rec: AgentRecord, goal: AgentGoal | null): void {
  pushExternalEvent(rec, { type: "goal_updated", goal });
}

export function pushProgressEvent(
  rec: AgentRecord,
  progress: AgentProgress
): void {
  pushExternalEvent(rec, { type: "progress_updated", progress });
}

function lifecycleDepsFor(rec: AgentRecord): AgentLifecycleDeps {
  return {
    getGoal,
    setGoalStatus,
    pushGoal: (goal) => pushGoalEvent(rec, goal),
    listPendingApprovals,
    listPendingClarifications,
    noteGoalContinuation,
    patchGoal,
    buildGoalRecap,
    startGoalTurn,
    finishGoalTurn,
    evaluateAndStoreGoalRunClosure,
  };
}

function pushAgentEvent(rec: AgentRecord, event: RingBufferEvent): void {
  rec.assistantMessageTracker ??= createAssistantMessageTracker();
  const actualFinalMessage = trackAssistantMessageEvent(
    rec.assistantMessageTracker,
    event as AssistantMessageStreamEvent
  );
  const seq = appendAgentEventBufferEntry(rec, event);
  rec.updatedAt = Date.now();
  mirrorAgentEventToRuntimeLedger(
    {
      agentId: rec.id,
      sessionId: rec.session.sessionId,
      sessionPath: rec.session.sessionFile ?? null,
      cwd: rec.cwd,
      seq,
    },
    event
  );
  notifyAgentEventListeners(rec);
  if (actualFinalMessage) auditFinalAssistantMessageIfNeeded(rec, actualFinalMessage);
}

function auditFinalAssistantMessageIfNeeded(
  rec: AgentRecord,
  actualFinalMessage: NonNullable<
    ReturnType<typeof trackAssistantMessageEvent>
  >
): void {
  const result = auditAndStoreGoalFinalMessage(rec.id, actualFinalMessage, {
    sessionId: rec.session.sessionId,
  });
  if (result?.goal) pushGoalEvent(rec, result.goal);
}

export interface CreateOptions {
  provider: string;
  modelId: string;
  cwd: string;
  /** 复用已有 session 文件（resume） */
  sessionPath?: string;
  /** thinking level，默认 medium */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Optional active tool allowlist. Used by read-only child subagents. */
  tools?: string[];
  /** Optional active tool denylist. */
  excludeTools?: string[];
  /** For hidden child subagents: file or directory paths this agent may write. */
  writePaths?: string[];
  /** Metadata for hidden child subagents. */
  parentAgentId?: string;
  parentSessionPath?: string;
  childRole?: SubagentRole;
  hidden?: boolean;
  /**
   * Multi-agent clarification attribution (cowork). When set on a child
   * subagent, the child's ask_user requests are surfaced on the parent's
   * channel tagged with this task id/title so the user sees who is asking.
   */
  taskId?: string;
  taskTitle?: string;
  /** Main agents enable delegate_subagents; child subagents disable it to avoid recursion. */
  enableSubagents?: boolean;
  /**
   * MCP server scope (Sprint 5). undefined = main agent (all enabled servers);
   * a list = specialist scope (only those servers); [] = no MCP tools.
   */
  mcpServers?: string[];
}

export function islocalCodingAssistantModelId(modelId: string): boolean {
  return isLocalCodingAssistantModelId(modelId);
}

function emitLocalCodingAssistantText(rec: AgentRecord, responseId: string, text: string) {
  if (!text) return;
  const modelId = rec.session.model?.id ?? LOCAL_CODING_ASSISTANT_MODEL_ID;
  pushAgentEvent(rec, {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: text,
      partial: {
        responseId,
      },
    },
    message: localCodingAssistantMessage("assistant", "", responseId, modelId),
  } as RingBufferEvent);
}

function emitLocalCodingAssistantJsonLine(
  rec: AgentRecord,
  responseId: string,
  line: string
) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const obj = JSON.parse(trimmed);
    const text = extractLocalCodingAssistantText(obj);
    if (!text) return;
    const emitted = rec.external?.emittedText ?? "";
    const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
    if (rec.external) rec.external.emittedText = emitted + delta;
    emitLocalCodingAssistantText(rec, responseId, delta);
  } catch {
    emitLocalCodingAssistantText(rec, responseId, line.endsWith("\n") ? line : `${line}\n`);
  }
}

export function isLocalCodingAssistantAgent(rec: AgentRecord): boolean {
  return rec.external?.kind === "local-coding-assistant";
}

export function describeAgentRuntime(rec: AgentRecord): AgentRuntimeProfile {
  if (isLocalCodingAssistantAgent(rec)) {
    return LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE;
  }
  return SDK_AGENT_RUNTIME_PROFILE;
}

export async function promptLocalCodingAssistantAgent(
  rec: AgentRecord,
  text: string
): Promise<void> {
  if (rec.external?.child) {
    throw new Error("自研 Coding 助手正在运行，请等待完成或先中止当前任务。");
  }
  const responseId = randomUUID();
  const modelId = rec.session.model?.id ?? LOCAL_CODING_ASSISTANT_MODEL_ID;
  rec.external = {
    kind: "local-coding-assistant",
    child: null,
    emittedText: "",
  };
  rec.isStreaming = true;
  rec.isPromptStarting = false;
  rec.updatedAt = Date.now();
  pushAgentEvent(rec, { type: "agent_start" } as RingBufferEvent);
  pushAgentEvent(rec, {
    type: "message_start",
    message: localCodingAssistantMessage("user", text, undefined, modelId),
  } as RingBufferEvent);
  pushAgentEvent(rec, {
    type: "message_start",
    message: localCodingAssistantMessage("assistant", "", responseId, modelId),
  } as RingBufferEvent);

  const args = buildLocalCodingAssistantCliArgs(text, modelId);
  const child = spawn(LOCAL_CODING_ASSISTANT_CLI, args, {
    cwd: rec.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
  rec.external.child = child;
  child.stdin.end();

  let stdoutBuffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let idx = stdoutBuffer.indexOf("\n");
    while (idx >= 0) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      emitLocalCodingAssistantJsonLine(rec, responseId, line);
      idx = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const textChunk = chunk.toString("utf8");
    if (textChunk.trim()) emitLocalCodingAssistantText(rec, responseId, textChunk);
  });

  child.on("close", (code, signal) => {
    if (stdoutBuffer.trim()) emitLocalCodingAssistantJsonLine(rec, responseId, stdoutBuffer);
    stdoutBuffer = "";
    if (code && code !== 0 && signal !== "SIGTERM") {
      emitLocalCodingAssistantText(
        rec,
        responseId,
        `\n\n[自研 Coding 助手退出，代码 ${code}]`
      );
    }
    pushAgentEvent(rec, {
      type: "message_end",
      message: {
        ...localCodingAssistantMessage("assistant", "", responseId, modelId),
        stopReason: code === 0 ? "stop" : "error",
      },
    } as RingBufferEvent);
    rec.isStreaming = false;
    rec.isPromptStarting = false;
    rec.updatedAt = Date.now();
    if (rec.external) rec.external.child = null;
    pushAgentEvent(rec, { type: "agent_end" } as RingBufferEvent);
  });
  child.on("error", (err) => {
    emitLocalCodingAssistantText(rec, responseId, `自研 Coding 助手启动失败：${err.message}`);
  });
}

export async function abortLocalCodingAssistantAgent(rec: AgentRecord): Promise<void> {
  if (rec.external?.child) {
    rec.external.child.kill("SIGTERM");
    rec.external.child = null;
  }
  if (rec.isStreaming) {
    rec.isStreaming = false;
    rec.isPromptStarting = false;
    rec.updatedAt = Date.now();
    pushAgentEvent(rec, { type: "agent_end" } as RingBufferEvent);
  } else if (rec.isPromptStarting) {
    rec.isPromptStarting = false;
    rec.updatedAt = Date.now();
  }
}

async function createLocalCodingAssistantAgent(opts: CreateOptions): Promise<{
  id: string;
  sessionId: string;
  sessionFile: string | undefined;
}> {
  const id = randomUUID();
  const sessionId = randomUUID();
  const session = createLocalCodingAssistantSession(sessionId, opts.modelId);
  const record: AgentRecord = {
    id,
    session,
    cwd: opts.cwd,
    parentAgentId: opts.parentAgentId,
    childRole: opts.childRole,
    hidden: opts.hidden,
    ...createAgentEventBuffer<RingBufferEvent>(),
    unsubscribe: () => {},
    isStreaming: false,
    isPromptStarting: false,
    updatedAt: Date.now(),
    recentClientRequests: new Map(),
    finishWatchdog: null,
    pendingFinishMessage: null,
    assistantMessageTracker: createAssistantMessageTracker(),
    external: {
      kind: "local-coding-assistant",
      child: null,
      emittedText: "",
    },
  };
  reg.agents.set(id, record);
  return { id, sessionId, sessionFile: undefined };
}

export async function createAgent(opts: CreateOptions): Promise<{
  id: string;
  sessionId: string;
  sessionFile: string | undefined;
}> {
  if (
    opts.provider === LOCAL_CODING_ASSISTANT_PROVIDER_ID &&
    islocalCodingAssistantModelId(opts.modelId)
  ) {
    return createLocalCodingAssistantAgent(opts);
  }

  const mr = getModelRegistry();
  const model = mr.find(opts.provider, opts.modelId);
  if (!model) {
    throw new Error(
      `model not found: ${opts.provider}/${opts.modelId}. Hint: 确认 provider 名 + env API key 已设置。`
    );
  }

  const sessionManager = createAgentSessionManager({
    cwd: opts.cwd,
    sessionPath: opts.sessionPath,
    parentSessionPath: opts.parentSessionPath,
  });

  // 提前生成 agentId —— B2 的 CollabExtension 需要 id 闭包来标记审批归属。
  // 这里提前到 createAgentSession 之前不影响 B1 行为（id 仍然唯一）。
  const id = randomUUID();

  const wiring = await buildAgentExtensionWiring({
    id,
    cwd: opts.cwd,
    parentAgentId: opts.parentAgentId,
    taskId: opts.taskId,
    taskTitle: opts.taskTitle,
    enableSubagents: opts.enableSubagents,
    mcpServers: opts.mcpServers,
    createAgent,
    getAgent: (agentId) => getAgent(agentId),
    disposeAgent,
    pushExternalEvent: (rec, event) =>
      pushExternalEvent(rec as AgentRecord, event),
    pushGoalEvent: (rec, goal) => pushGoalEvent(rec as AgentRecord, goal),
    pushProgressEvent: (rec, progress) =>
      pushProgressEvent(rec as AgentRecord, progress),
    lifecycleDepsFor: (rec) => lifecycleDepsFor(rec as AgentRecord),
  });

  const resourceLoader = createAgentResourceLoader({
    cwd: opts.cwd,
    agentDir: getAgentDir(),
    settingsManager: getSettingsManager(opts.cwd),
    extensionFactories: buildAgentExtensionFactories({
      cwd: opts.cwd,
      parentAgentId: opts.parentAgentId,
      writePaths: opts.writePaths,
      extensionFactories: wiring.extensionFactories,
    }),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: opts.cwd,
    model,
    thinkingLevel: opts.thinkingLevel ?? "medium",
    tools: opts.tools,
    excludeTools: opts.excludeTools,
    sessionManager,
    authStorage: getAuth(),
    modelRegistry: mr,
    resourceLoader,
    customTools: customToolsForSession(wiring.customTools),
  });

  if (!opts.tools) {
    enableDefaultBrowserTools(session);
  }

  const record: AgentRecord = {
    id,
    session,
    cwd: opts.cwd,
    parentAgentId: opts.parentAgentId,
    childRole: opts.childRole,
    hidden: opts.hidden,
    ...createAgentEventBuffer<RingBufferEvent>(),
    unsubscribe: () => {},
    isStreaming: false,
    isPromptStarting: false,
    updatedAt: Date.now(),
    recentClientRequests: new Map(),
    finishWatchdog: null,
    pendingFinishMessage: null,
    assistantMessageTracker: createAssistantMessageTracker(),
  };
  // 让 extension/tool 回调能 push 自定义事件（approval/clarification/progress 等）。
  wiring.recordHolder.current = record;

  // 把 AgentSession 的生命周期状态和事件流接到 ring buffer + 通知 listeners
  record.unsubscribe = session.subscribe((event) => {
    handleAgentSessionLifecycleEvent(record, event, lifecycleDepsFor(record));
    pushAgentEvent(record, event);
  });

  reg.agents.set(id, record);

  return {
    id,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
  };
}

export function getAgent(id: string): AgentRecord | undefined {
  return reg.agents.get(id);
}

/**
 * 返回当前所有 active AgentSession 的 sessionFile 路径集合。
 * 给前端 sidebar 标"运行中"用 —— sessionFile 与 SessionInfo.path 一致。
 */
export function getRunningSessionFiles(): Set<string> {
  const out = new Set<string>();
  for (const rec of reg.agents.values()) {
    if (rec.hidden) continue;
    if (!rec.isStreaming && !rec.isPromptStarting) continue;
    const f = rec.session.sessionFile;
    if (f) out.add(f);
  }
  return out;
}

export async function abortSubagentsForParent(parentAgentId: string): Promise<void> {
  await abortRunningSubagentBatches(parentAgentId, getAgent);
}

export async function abortWorkflowsForParent(parentAgentId: string): Promise<void> {
  await abortRunningWorkflows(parentAgentId);
}

export function disposeAgent(id: string) {
  const rec = reg.agents.get(id);
  if (!rec) return;
  if (!rec.hidden) {
    void abortSubagentsForParent(id).catch(() => undefined);
    void abortWorkflowsForParent(id).catch(() => undefined);
  }
  clearFinishWatchdog(rec);
  rec.unsubscribe();
  rec.session.dispose();
  reg.agents.delete(id);
  // B4：清理"本 session 不再问"记忆，避免悬挂（其他 agentId 复用同 globalThis store 不受影响）
  clearSessionRemember(id);
  clearAgentClarifications(id);
  clearGoal(id);
  void disposeBrowser(agentBrowserId(id));
}

/** 给 SSE 用：拿从某个 seq 之后的所有事件（按 seq 升序） */
export function getEventsSince(
  agentId: string,
  sinceSeq: number
): Array<{ seq: number; event: RingBufferEvent }> {
  const rec = reg.agents.get(agentId);
  if (!rec) return [];
  return readBufferedAgentEventsSince(rec, sinceSeq);
}

export function getLatestEventSeq(agentId: string): number {
  const rec = reg.agents.get(agentId);
  return rec ? getLatestAgentEventSeq(rec) : -1;
}

/** 注册一个事件监听器（用于 SSE 长连接），返回取消函数 */
export function onNewEvent(agentId: string, cb: () => void): () => void {
  const rec = reg.agents.get(agentId);
  if (!rec) return () => {};
  return subscribeAgentEvent(rec, cb);
}

export { getAgentDir };
