"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  // P1-E：input 全局 store helpers。详见 lib/composer/input-store.ts。
  // ChatApp 只需 setter 与 LRU 淘汰清理；可视化读取走 useComposerInput hook。
  getInput as getStoreInput,
  setInput as storeSetInput,
  updateInput as storeUpdateInput,
  deleteInput as deleteStoreInput,
} from "@/lib/composer/input-store";
import type {
  SessionInfoLite,
  ChatMessage,
  ThinkingLevel,
  ImageContentLite,
  ForkableUserMessage,
} from "@/lib/types";
import type {
  WorkflowDebugBundle,
  WorkflowResumeSnapshot,
} from "@/lib/workflows/types";
import type { BrowserAnnotation } from "@/lib/browser/types";
import type { AgentProgress } from "@/lib/progress/types";
import { extractImagesFromClipboard } from "@/lib/image-utils";
import {
  getElectronApi,
  type AppInfo,
  type UpdateState,
} from "@/lib/electron-bridge";
import { useAudio } from "@/lib/use-audio";
import { useDragDrop } from "@/lib/use-drag-drop";
import { previewStore } from "@/lib/preview-store";
import {
  appendRestoredSubagentBatches,
  createInitialState,
  ctxToMessages,
  type ReducerState,
} from "@/lib/chat-reducer";
import { userFacingMessage } from "@/lib/user-facing-error";
import type { SubagentBatch } from "@/lib/subagents/types";
import {
  emptyRunner,
  DRAFT_KEY,
  type AgentPhase,
  type RunnerKey,
  type PendingAttachment,
} from "@/lib/session-runner";
import { useRunners } from "./hooks/useRunners";
import { useSseManager } from "./hooks/useSseManager";
import { useAgentEvents } from "./hooks/useAgentEvents";
import { useSessions } from "./hooks/useSessions";
import { useChatStream } from "./hooks/useChatStream";
import { useComposerAttachments } from "./hooks/useComposerAttachments";
import { usePetPusher } from "./hooks/usePetPusher";
import { useBudget } from "./hooks/useBudget";
import { useBudgetEnforcer, type BudgetTrigger } from "./hooks/useBudgetEnforcer";
import { useForkable } from "./hooks/useForkable";
import { useApprovals } from "./hooks/useApprovals";
import { useClarifications } from "./hooks/useClarifications";
import { useSessionMeta } from "./hooks/useSessionMeta";
import { useSearch } from "./hooks/useSearch";
import { useProviderModel } from "./hooks/useProviderModel";
import { useChatModalsState } from "./hooks/useChatModalsState";
import { useWorkbenchController } from "./hooks/useWorkbenchController";
import { useComposerHistoryController } from "./hooks/useComposerHistoryController";
import { useSessionSwitchingController } from "./hooks/useSessionSwitchingController";
import { loadCollabSettings } from "@/lib/collab/settings";
import { useAutocomplete } from "./hooks/useAutocomplete";
import { useMessageRefs } from "./ChatMinimap";
import { EmptyState } from "./components/EmptyState";
import { Composer } from "./components/Composer";
import { ChatAppShell } from "./components/ChatAppShell";
import { Sidebar } from "./components/Sidebar";
import { SidebarSearch } from "./components/SidebarSearch";
import { TopHeader } from "./components/TopHeader";
import { MessagesScrollArea } from "./components/MessagesScrollArea";
import type { WorkflowWorktreeAction } from "./components/MessageView";
import {
  WorkbenchSidebar,
} from "./components/WorkbenchSidebar";
import {
  formatWorkflowResumeSummaries,
  WorkflowHistoryPanel,
} from "./components/WorkflowHistoryPanel";
import {
  SessionLoadingState,
  UpdateLatestNotice,
  UpdateNotice,
} from "./components/ChatStatusOverlays";
import { ChatModals } from "./components/ChatModals";
import { BudgetExceededModal } from "./components/BudgetExceededModal";
import { resolveRuntimeIdentity } from "@/lib/runtime/identity";

interface Props {
  initialSessions: SessionInfoLite[];
  defaultCwd: string;
}

type Theme = "dark" | "light";

// SLASH_COMMANDS / SlashName / detectAutocompleteToken 已搬到 hooks/useAutocomplete.ts（RFC-1 阶段 C2）。

function extractSessionIdFromPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const base = p.split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.jsonl$/, "");
  const match = noExt.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  return match ? match[1] : null;
}

function runtimeProgressTitle(agentPhase: AgentPhase): string {
  if (agentPhase?.kind === "waiting_model") return "等待模型响应";
  if (agentPhase?.kind === "thinking") return "模型思考中";
  if (agentPhase?.kind === "running_tools") {
    const names = agentPhase.tools.map((tool) => tool.name).filter(Boolean);
    return names.length > 0 ? `执行工具：${names.slice(0, 2).join(", ")}` : "执行工具";
  }
  return "正在执行任务";
}

function progressWithRuntimeFallback(
  progress: AgentProgress | null,
  streaming: boolean,
  agentPhase: AgentPhase
): AgentProgress | null {
  const groups = progress?.groups ?? [];
  const steps = groups.at(-1)?.steps ?? progress?.steps ?? [];
  if (!streaming || steps.length > 0) return progress;
  const now = Date.now();
  const step = {
    id: "runtime-active",
    title: runtimeProgressTitle(agentPhase),
    status: "running" as const,
    summary: "agent 已开始执行，等待结构化进度更新。",
    startedAt: now,
  };
  return {
    steps: [step],
    groups: [
      {
        id: "runtime-active",
        index: 1,
        steps: [step],
        startedAt: now,
      },
    ],
    artifacts: progress?.artifacts ?? [],
    updatedAt: now,
  };
}

export default function ChatApp({ initialSessions, defaultCwd }: Props) {
  // setError 需要在 useSessions（B1）之前声明，作为 onError 回调注入。
  // 顶层 error 用于 UI banner 展示；useState setter 身份稳定，可安全提前。
  const [error, setError] = useState<string | null>(null);

  // ===== 多会话核心容器与 SSE 连接池（RFC-1 阶段 A1 + A2） =====
  // - runnersRef（useRunners）：所有会话工作面的"权威存储"
  // - esMapRef（useSseManager）：每个 runner 的 SSE 连接；切换会话时不关，后台流式继续
  // - LRU 淘汰 runner 时，useRunners 通过 onEvict 直接调到 useSseManager.closeSseFor
  //
  // hook 调用顺序：useSseManager 先 → useRunners 后（onEvict 直传 closeSseFor）
  // 但 useSseManager.onStatusChange 又需要 updateRunner（来自 useRunners）—— 循环依赖。
  // 解法：updateRunner 走 ref 转发；handleAgentEvent 是函数声明（hoisted）+ 也走 ref，
  //       让 useSseManager 内部回调闭包不直接依赖未定义的标识符。
  const updateRunnerRef = useRef<
    ((key: RunnerKey, patch: import("@/lib/session-runner").RunnerPatch) => void) | null
  >(null);
  const handleAgentEventRef = useRef<
    | ((
        event: { type: string; [k: string]: unknown },
        agentId: string,
        key: RunnerKey
      ) => void)
    | null
  >(null);
  // refreshForkList 来自 useForkable（声明在 useAgentEvents 之后）；
  // 同 handleAgentEvent / updateRunner，用 ref 转发避免时序倒置。
  const refreshForkListRef = useRef<
    ((agentId: string, ownerKey: RunnerKey) => void) | null
  >(null);

  const { esMapRef, attachSseFor, closeSseFor } = useSseManager({
    onEvent: (event, agentId, key) => {
      // useSseManager 的 onEvent event 类型是 unknown（hook 不知道业务结构）；
      // 这里 cast 到 handleAgentEvent 期望的形状。SSE envelope 一定有 type 字段。
      handleAgentEventRef.current?.(
        event as { type: string; [k: string]: unknown },
        agentId,
        key
      );
    },
    onStatusChange: (key, patch) => {
      updateRunnerRef.current?.(key, patch);
    },
  });

  const handleEvictRunner = useCallback(
    (key: RunnerKey) => {
      // LRU 淘汰 runner 时同步清理该 key 在 input store 里的草稿，
      // 避免留下“孤儿” input slot。
      deleteStoreInput(key);
      closeSseFor(key);
    },
    [closeSseFor]
  );

  const {
    runnersRef,
    activeKey,
    activeSnapshot,
    activeKeyRef,
    updateRunner,
    updateActive,
    switchTo,
    setRunner,
  } = useRunners({
    onEvict: handleEvictRunner,
  });

  // 把 updateRunner 绑到 ref，供 useSseManager 的 onStatusChange 回调使用
  useEffect(() => {
    updateRunnerRef.current = updateRunner;
    return () => {
      updateRunnerRef.current = null;
    };
  }, [updateRunner]);

  // E2E 诊断钩子:仅在 window.__E2E__=true 时挂载,把 runner 状态暴露给测试断言。
  // 不影响 prod 行为,默认 noop。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __E2E__?: boolean; __chatAppDiag?: unknown };
    if (!w.__E2E__) return;
    w.__chatAppDiag = {
      runners: runnersRef,
      esMap: esMapRef,
      activeKey: () => activeKeyRef.current,
      runnerCount: () => runnersRef.current.size,
      runnerKeys: () => [...runnersRef.current.keys()],
      sseKeys: () => [...esMapRef.current.keys()],
      inputFor: (key: RunnerKey) => getStoreInput(key),
    };
  }, [activeKeyRef, esMapRef, runnersRef]);

  // ===== Session 列表 + 已读追踪 + CRUD（RFC-1 阶段 B1） =====
  // 持有 sessions / selectedId / lastSeenMap（localStorage 持久化，lazy init 修复刷新已读丢失）；
  // 提供 groupedSessions / refreshSessions / submitRename / executeDeleteSession 等。
  const {
    sessions,
    setSessions,
    selectedId,
    setSelectedId,
    lastSeenMap,
    groupedSessions,
    refreshSessions,
    submitRename: submitRenameImpl,
    executeDeleteSession: executeDeleteSessionImpl,
    lastSeenMapRef,
  } = useSessions({
    initialSessions,
    closeSseFor,
    runnersRef,
    activeKeyRef,
    switchTo,
    onError: setError,
  });

  // chatState / forkable* 等 per-runner 字段已挪到 RunnerState。
  // messages / visibleMessageCount / messageRefs 依赖 chatState/forkableUserMessages,
  // 已下移到 activeSnapshot 解构之后(否则用前先声明会报错)。

  // agentId / agentSessionId / input / pending* / streaming / phase / compacting /
  // compactError / retryInfo / stats / toolsCount 已挪到 RunnerState(见下方解构区)。
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 输入框 @ / 自动补全已挪到 hooks/useAutocomplete.ts（RFC-1 阶段 C2）。
  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const [cwd, setCwd] = useState(defaultCwd);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addOptimisticSession = useCallback(
    ({
      sessionId,
      sessionFile,
      title,
      running = false,
    }: {
      sessionId?: string | null;
      sessionFile?: string | null;
      title?: string | null;
      running?: boolean;
    }) => {
      if (!sessionFile) return;
      const id = sessionId ?? extractSessionIdFromPath(sessionFile);
      if (!id) return;
      const now = new Date().toISOString();
      const label = title?.trim() || "新任务";
      setSessions((prev) => {
        const existing = prev.find((session) => session.id === id);
        const optimistic: SessionInfoLite = {
          id,
          path: sessionFile,
          cwd,
          name: existing?.name ?? label,
          firstMessage: existing?.firstMessage ?? label,
          created: existing?.created ?? now,
          modified: now,
          messageCount: existing?.messageCount ?? 0,
          isRunning: running || existing?.isRunning === true,
          runtimeState: running ? "streaming" : existing?.runtimeState ?? "loading",
          parentSessionPath: existing?.parentSessionPath,
          waitingApprovalCount: existing?.waitingApprovalCount,
          waitingClarificationCount: existing?.waitingClarificationCount,
          lastEventSeq: existing?.lastEventSeq,
          runtimeUpdatedAt: existing?.runtimeUpdatedAt,
          meta: existing?.meta,
        };
        const rest = prev.filter((session) => session.id !== id);
        return [optimistic, ...rest];
      });
    },
    [cwd, setSessions]
  );

  // 图片/文件附件相关 hook 调用挪到 setter wrappers 之后（依赖 setPendingImages/setPendingFiles）

  const {
    visibleProviders,
    currentProvider,
    providerId,
    setProviderId,
    modelId,
    setModelId,
    reloadProviders,
  } = useProviderModel();

  // thinking 字段(thinkingLevel / availableThinkingLevels / supportsThinking)
  // 已挪到 RunnerState。见下方 activeSnapshot 解构区。

  // theme: 首屏固定 light，避免服务端/客户端因 localStorage 差异导致 hydration mismatch。
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let next: Theme = "light";
      try {
        const stored = localStorage.getItem("pi-theme");
        if (stored === "light" || stored === "dark") next = stored;
      } catch {
        /* noop */
      }
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const apply = () => {
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("pi-theme", next);
      } catch {
        /* noop */
      }
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches;
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    if (!reduceMotion && typeof doc.startViewTransition === "function") {
      void doc.startViewTransition(apply).finished.catch(() => {});
      return;
    }
    apply();
  };

  const {
    workbenchOpen,
    workbenchView,
    browserOpenRequest,
    sidebarOpen,
    filesLayout,
    filesContainerWidth,
    rightPanelResizing,
    setFilesLayout,
    openWorkbench,
    closeWorkbench,
    toggleWorkbench,
    toggleSidebar,
    onSplitterMouseDown,
  } = useWorkbenchController();
  const [showSkills, setShowSkills] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const {
    showAuth,
    authInitialProvider,
    showModelsConfig,
    showProviderSetup,
    showSystemPrompt,
    systemPromptText,
    showCwdPicker,
    showFilePicker,
    showBranches,
    setShowAuth,
    openAuth,
    closeAuth,
    setShowModelsConfig,
    setShowProviderSetup,
    setShowSystemPrompt,
    setShowCwdPicker,
    setShowFilePicker,
    setShowBranches,
    setSystemPromptText,
    closeSystemPrompt,
  } = useChatModalsState();
  const [providerSetupChild, setProviderSetupChild] = useState<
    "auth" | "models" | null
  >(null);
  /** RFC-2 Phase A3：Budget 命中后由 useBudgetEnforcer 设置；非 null 时弹 BudgetExceededModal */
  const [budgetPausedTrigger, setBudgetPausedTrigger] =
    useState<BudgetTrigger | null>(null);
  // sseStatus 已挪到 RunnerState(每个会话独立的 SSE 状态)。
  // forksCollapsed / toggleForks 已挪到 useForkable hook（C1）
  /** 当前打开 ⋯ 菜单的 session id；renaming 时存 inline edit 状态 */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingFor, setRenamingFor] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showWorkflowHistory, setShowWorkflowHistory] = useState(false);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowResumeSnapshot[]>(
    []
  );
  const [workflowHistoryAgentId, setWorkflowHistoryAgentId] = useState<
    string | null
  >(null);
  const [workflowHistoryLoading, setWorkflowHistoryLoading] = useState(false);
  const [workflowDebugBundle, setWorkflowDebugBundle] =
    useState<WorkflowDebugBundle | null>(null);
  const [workflowDebugLoading, setWorkflowDebugLoading] = useState(false);
  const [workflowDebugError, setWorkflowDebugError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { selectSessionAndCloseWorkbench } = useSessionSwitchingController({
    sessions,
    selectedId,
    setSelectedId,
    closeWorkbench,
    runnersRef,
    setRunner,
    updateRunner,
    switchTo,
    attachSseFor,
    setError,
  });
  const toggleSkills = () => setShowSkills((prev) => !prev);
  const toggleTools = () => {
    setShowTools((prev) => {
      const next = !prev;
      if (prev && agentId) void refreshToolsCount(agentId);
      return next;
    });
  };

  // 任何 previewStore 触发(html/url/image)时,确保右侧 Workbench 进入 Files。
  useEffect(() => {
    return previewStore.onOpen(() => {
      openWorkbench({ type: "files" });
    });
  }, [openWorkbench]);

  // Electron 桥
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const electronApi = useMemo(
    () => (appInfo ? getElectronApi() : null),
    [appInfo]
  );
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateNoticeHidden, setUpdateNoticeHidden] = useState(false);
  const [latestNoticeHidden, setLatestNoticeHidden] = useState(true);
  const [openCommandMenuRequest, setOpenCommandMenuRequest] = useState(0);
  useEffect(() => {
    const api = getElectronApi();
    if (!api) return;
    void api
      .getAppInfo()
      .then(setAppInfo)
      .catch((e) => console.warn("getAppInfo failed", e));
  }, []);
  useEffect(() => {
    if (!electronApi?.updater) return;
    let cancelled = false;
    void electronApi.updater
      .getState()
      .then((state) => {
        if (!cancelled) setUpdateState(state);
      })
      .catch((e) => console.warn("updater:getState failed", e));
    const unsub = electronApi.updater.onState((state) => {
      setUpdateState(state);
      if (state.status === "available") setUpdateNoticeHidden(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [electronApi]);
  useEffect(() => {
    if (updateState?.status !== "available" || updateNoticeHidden) return;
    const id = window.setTimeout(() => setUpdateNoticeHidden(true), 8000);
    return () => window.clearTimeout(id);
  }, [updateNoticeHidden, updateState?.status, updateState?.latestVersion]);
  useEffect(() => {
    if (updateState?.status !== "not-available" || latestNoticeHidden) return;
    const id = window.setTimeout(() => setLatestNoticeHidden(true), 5000);
    return () => window.clearTimeout(id);
  }, [latestNoticeHidden, updateState?.status, updateState?.checkedAt]);
  const openCwdPicker = useCallback(() => {
    if (!electronApi?.selectDirectory) {
      setShowCwdPicker(true);
      return;
    }
    void electronApi
      .selectDirectory({
        title: "选择项目文件夹",
        defaultPath: cwd || undefined,
      })
      .then((picked) => {
        if (picked) setCwd(picked);
      })
      .catch((e) => {
        setError(userFacingMessage(e));
        setShowCwdPicker(true);
      });
  }, [cwd, electronApi, setShowCwdPicker]);
  const checkForUpdates = useCallback(() => {
    if (!electronApi?.updater) return;
    setUpdateNoticeHidden(false);
    setLatestNoticeHidden(true);
    void electronApi.updater
      .check({ manual: true })
      .then((state) => {
        setUpdateState(state);
        if (state.status === "not-available") {
          setLatestNoticeHidden(false);
        }
      })
      .catch((e) =>
        setUpdateState((prev) => ({
          ...(prev ?? {
            currentVersion: appInfo?.version ?? "0.0.0",
            autoCheckEnabled: true,
          }),
          status: "error",
          error: String(e),
        }))
      );
  }, [appInfo?.version, electronApi]);
  const openUpdateDownload = useCallback(() => {
    if (!electronApi?.updater) return;
    void electronApi.updater
      .openDownload()
      .catch((e) => setError(userFacingMessage(e, { context: "settings" })));
  }, [electronApi]);
  const viewUpdateDetails = useCallback(() => {
    setUpdateNoticeHidden(true);
    setOpenCommandMenuRequest((value) => value + 1);
  }, []);
  const skipUpdateVersion = useCallback(() => {
    setUpdateNoticeHidden(true);
    if (!electronApi?.updater) return;
    void electronApi.updater
      .skipVersion(updateState?.latestVersion ?? undefined)
      .then(setUpdateState)
      .catch(() => {});
  }, [electronApi, updateState?.latestVersion]);

  // currentSessionFile 已挪到 RunnerState.sessionFile(下方解构提供同名别名)。

  // 点外面关闭 session ⋯ 菜单
  useEffect(() => {
    if (!menuFor) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-session-menu]")) return;
      if (t && t.closest("[data-floating-layer]")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuFor]);

  // session 菜单操作：业务由 useSessions 承担，本层 wrapper 仅负责善后 UI 状态
  // （renamingFor / menuFor / pendingDeleteId 是 sidebar 交互的临时态，
  // 不属于 session 本身的生命周期，所以留在 ChatApp 内）。
  const submitRename = useCallback(
    async (id: string, name: string) => {
      try {
        await submitRenameImpl(id, name);
      } finally {
        setRenamingFor(null);
        setMenuFor(null);
      }
    },
    [submitRenameImpl]
  );

  const executeDeleteSession = useCallback(
    async (id: string) => {
      try {
        await executeDeleteSessionImpl(id);
      } finally {
        setMenuFor(null);
        setPendingDeleteId(null);
      }
    },
    [executeDeleteSessionImpl]
  );

  /** 触发 inline 删除确认（替代原生 confirm） */
  const requestDeleteSession = useCallback((id: string) => {
    setMenuFor(null);
    setPendingDeleteId(id);
  }, []);

  const handleExportSession = useCallback((id: string) => {
    // 直接走浏览器下载
    const a = document.createElement("a");
    a.href = `/api/sessions/${id}/export`;
    a.download = `pi-session-${id}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setMenuFor(null);
  }, []);

  // RFC-3 A4：session 置顶/取消置顶。
  // 实现：PATCH meta → refresh 列表（meta 在 A2 已聚合到列表 response）。
  const { patch: patchSessionMeta } = useSessionMeta({ onError: setError });
  const toggleSessionPin = useCallback(
    async (id: string, nextPinned: boolean) => {
      const res = await patchSessionMeta(id, { pinned: nextPinned });
      if (res) {
        await refreshSessions();
      }
    },
    [patchSessionMeta, refreshSessions]
  );

  // RFC-3 Phase B / F2：Sidebar 全文检索。
  // useSearch 自带 query / status / results state；isActive 决定 SidebarSearch 是否替换普通 sessions 列表。
  const searchHook = useSearch();
  const sessionLookup = useMemo(
    () =>
      new Map(
        sessions.map((s) => [
          s.id,
          { cwd: s.cwd, title: s.meta?.title ?? s.name ?? null },
        ])
      ),
    [sessions]
  );

  // ===== 当前活跃 runner 的解构(P1-4)=====
  // 所有下游 callbacks/render 通过这些同名变量读取,行为与原 useState 完全一致。
  const {
    chatState,
    forkableUserMessages,
    forkingIndex,
    forkText,
    forkBusy,
    agentId,
    agentSessionId,
    sessionFile: currentSessionFile,
    pendingImages,
    pendingFiles,
    sessionLoading,
    streaming,
    agentPhase,
    compacting,
    compactError,
    retryInfo,
    stats,
    toolsCount,
    goal,
    contract,
    progress,
    thinkingLevel,
    availableThinkingLevels,
    supportsThinking,
    sseStatus,
  } = activeSnapshot;
  const displayProgress = useMemo(
    () => progressWithRuntimeFallback(progress, streaming, agentPhase),
    [agentPhase, progress, streaming]
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions]
  );
  const runtimeIdentity = useMemo(
    () =>
      resolveRuntimeIdentity({
        selectedSessionId: selectedSession?.id ?? agentSessionId ?? null,
        selectedSessionPath:
          selectedSession?.path ?? currentSessionFile ?? activeKey,
        cwd,
        activeRunnerKey: activeKey,
        liveAgentId: agentId,
      }),
    [
      activeKey,
      agentId,
      agentSessionId,
      currentSessionFile,
      cwd,
      selectedSession?.id,
      selectedSession?.path,
    ]
  );

  // Stop should also be available when the run is paused on a user decision.
  // Steer / follow-up stay disabled unless streaming; abort remains useful for
  // "waiting_user" tasks that otherwise look stuck.
  const showAbort =
    streaming ||
    selectedSession?.isRunning === true ||
    selectedSession?.runtimeState === "waiting_user";
  const abortable = Boolean(agentId) && showAbort;

  const openUrlInBrowserPanel = useCallback(
    (url: string) => {
      openWorkbench({ type: "browser", url });
    },
    [openWorkbench]
  );

  // ===== Setter wrappers(同名,所有调用点不动)=====
  // 通用 helper:把 React 风格的 setter (value | (prev) => value) 路由到 updateActive。
  // 为每个字段写一个 useCallback,保持稳定的函数 identity,避免下游误触发。
  type Updater<T> = T | ((prev: T) => T);
  const resolve = useCallback(
    <T,>(prev: T, v: Updater<T>): T =>
      typeof v === "function" ? (v as (p: T) => T)(prev) : v,
    []
  );

  const setChatState = useCallback(
    (v: Updater<ReducerState>) =>
      updateActive((s) => ({ chatState: resolve(s.chatState, v) })),
    [resolve, updateActive]
  );
  const setForkableUserMessages = useCallback(
    (v: Updater<ForkableUserMessage[]>) =>
      updateActive((s) => ({
        forkableUserMessages: resolve(s.forkableUserMessages, v),
      })),
    [resolve, updateActive]
  );
  const setForkingIndex = useCallback(
    (v: Updater<number | null>) =>
      updateActive((s) => ({ forkingIndex: resolve(s.forkingIndex, v) })),
    [resolve, updateActive]
  );
  const setForkText = useCallback(
    (v: Updater<string>) =>
      updateActive((s) => ({ forkText: resolve(s.forkText, v) })),
    [resolve, updateActive]
  );
  // setForkBusy 已下沉到 useForkable hook（C1：fork 流程内 updateRunner 直接写）
  // P1-E: input 不再写入 RunnerState，而是走全局 store。
  //   - setInput：只动 store，不再 setActiveSnapshot 、不再重建 RunnerState。
  //   - getCurrentInput：交互时点快照读（send/steer/followUp 等）。
  //   - Composer 作为叶子组件订阅 activeKey 对应的 input slot。
  const setInput = useCallback(
    (v: Updater<string>) => {
      const key = activeKeyRef.current;
      if (typeof v === "function") {
        storeUpdateInput(key, (prev) => (v as (p: string) => string)(prev));
      } else {
        storeSetInput(key, v);
      }
    },
    [activeKeyRef]
  );
  const getCurrentInput = useCallback(
    () => getStoreInput(activeKeyRef.current),
    [activeKeyRef]
  );
  const setPendingImages = useCallback(
    (v: Updater<ImageContentLite[]>) =>
      updateActive((s) => ({ pendingImages: resolve(s.pendingImages, v) })),
    [resolve, updateActive]
  );
  const setPendingFiles = useCallback(
    (v: Updater<PendingAttachment[]>) =>
      updateActive((s) => ({ pendingFiles: resolve(s.pendingFiles, v) })),
    [resolve, updateActive]
  );
  const setCompactError = useCallback(
    (v: Updater<string | null>) =>
      updateActive((s) => ({ compactError: resolve(s.compactError, v) })),
    [resolve, updateActive]
  );

  // ===== Composer 附件子模块（RFC-1 阶段 B2-b，已抽到 useComposerAttachments） =====
  // 图片/文件拖入、粘贴、移除：依赖 setPendingImages/setPendingFiles，必须在 setter wrappers 之后
  const {
    addImageFiles,
    removePendingImage,
    onDropFiles,
    removePendingFile,
  } = useComposerAttachments({
    setPendingImages,
    setPendingFiles,
    setError,
  });

  const {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragDrop(onDropFiles);

  const onPasteTextarea = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imgs = extractImagesFromClipboard(e);
      if (imgs.length > 0) {
        e.preventDefault();
        void addImageFiles(imgs);
      }
    },
    [addImageFiles]
  );

  // compactError 3 秒自动消失（原本贴在 useState 旁,现在挪到 wrapper 之后）
  useEffect(() => {
    if (!compactError) return;
    const id = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(id);
  }, [compactError, setCompactError]);

  // RFC-2 Phase A：会话级 Budget MVP
  // 输入 activeSnapshot + agentId，输出当前预算/消耗/状态（duration 维度内部按 1s tick 刷新）
  const {
    budget,
    hasOverride: budgetHasOverride,
    status: budgetStatus,
    spent: budgetSpent,
    setSessionOverride,
  } = useBudget({ activeSnapshot, agentId });

  // RFC-2 Phase B3：工具审批 user actions（Allow / Deny POST）
  // approve/deny 直接走 fetch，server 端 resolve 后 SSE 推 approval_resolved 自然更新气泡。
  const {
    approve: approveCall,
    deny: denyCall,
    loadPending: loadPendingApprovals,
  } = useApprovals({
    agentId,
    onError: setError,
  });

  // RFC-5：主动追问 / 推荐下一步 user actions。
  const {
    choose: chooseClarification,
    respond: respondClarification,
    loadPending: loadPendingClarifications,
  } = useClarifications({
    agentId,
    onError: setError,
  });

  // ===== 宠物状态推送（hook 化，见 app/hooks/usePetPusher.ts）=====
  usePetPusher({
    runnersRef,
    sessions,
    selectedId,
    lastSeenMapRef,
    lastSeenMap,
    activeSnapshot,
    activeAgentId: agentId,
    budgetStatus,
    budgetPausedTrigger,
  });

  const messageRenderState = useMemo(() => {
    const shouldAttachForkIds = forkableUserMessages.length > 0;
    const renderedMessages: ChatMessage[] = shouldAttachForkIds ? [] : chatState.messages;
    let forkCursor = 0;
    let visibleMessageCount = 0;
    let userMessageCount = 0;
    let lastUserVisibleIndex = -1;

    for (const m of chatState.messages) {
      let next = m;
      if (shouldAttachForkIds && m.role === "user" && forkCursor < forkableUserMessages.length) {
        next = { ...m, entryId: forkableUserMessages[forkCursor].entryId };
        forkCursor++;
      }
      if (shouldAttachForkIds) renderedMessages.push(next);

      if (m.role === "user" || m.role === "assistant") {
        if (m.role === "user") {
          userMessageCount++;
          lastUserVisibleIndex = visibleMessageCount;
        }
        visibleMessageCount++;
      }
    }

    return {
      messages: renderedMessages,
      visibleMessageCount,
      userMessageCount,
      lastUserVisibleIndex,
    };
  }, [chatState.messages, forkableUserMessages]);

  const messages = messageRenderState.messages;
  const visibleMessageCount = messageRenderState.visibleMessageCount;
  const messageRefs = useMessageRefs(visibleMessageCount);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // 用户是否"贴底"：贴底时新内容自动跟随，往上滚一旦离开底部 64px 就停止跟随。
  const stickToBottomRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  // send 后锚定到刚发的 user 消息:记 send 时的 user 消息总数,
  // 等新 user 消息从 SSE 回来后扫到对应那条,把它滚到屏顶。
  // null = 不锚定(普通贴底跟随);number = 期望"这条 user 一出现就锚"
  const pendingPinUserCountRef = useRef<number | null>(null);
  // 锚定阶段:仅此期间渲染 60vh 底部占位,让最后一条 user 能被 scroll-to-top
  // 一旦锚定完成或被取消,移除占位,避免列表底部一大片空白可滚。
  const [pinSpacer, setPinSpacer] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = messagesScrollRef.current;
      if (!el) return;
      if (behavior === "smooth") {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        // Streaming token updates must be an immediate snap-to-bottom. Smooth
        // animations overlap with frequent content growth and make the scrollbar
        // visibly bounce.
        el.scrollTop = el.scrollHeight;
      }
      stickToBottomRef.current = true;
      setShowScrollToBottom(false);
    });
  }, []);

  function handleMessagesScroll() {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceToBottom < 64;
    stickToBottomRef.current = atBottom;
    setShowScrollToBottom((visible) => (visible === !atBottom ? visible : !atBottom));
    // 用户主动滚动 = 取消锚定意图(占位也跟着移除,见 effect)
    if (pendingPinUserCountRef.current !== null) {
      pendingPinUserCountRef.current = null;
      setPinSpacer(false);
    }
  }

  useEffect(() => {
    // 兜底:streaming 已结束还留着锚定/占位的话清掉,避免占位永久滞留
    if (!streaming && pendingPinUserCountRef.current !== null) {
      pendingPinUserCountRef.current = null;
      queueMicrotask(() => setPinSpacer(false));
    }
    // 优先级 1:有锚定目标 → 等那条 user 消息从 SSE 回来后锚到屏顶,只锚一次
    const targetCount = pendingPinUserCountRef.current;
    if (targetCount !== null) {
      if (
        messageRenderState.userMessageCount >= targetCount &&
        messageRenderState.lastUserVisibleIndex >= 0
      ) {
        const el = messageRefs.current?.[messageRenderState.lastUserVisibleIndex];
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          // 锚定完成 → 清意图 + 移除占位,列表底部回到"最后一条 + padding"
          pendingPinUserCountRef.current = null;
          queueMicrotask(() => setPinSpacer(false));
          return;
        }
      }
      // 目标消息还没到/ref 还没挂上,这一轮先不滚,等下一次 messages 更新再试
      return;
    }
    // 优先级 2:贴底时跟随新内容
    if (!stickToBottomRef.current) return;
    scrollMessagesToBottom();
  }, [messageRenderState, streaming, messageRefs, scrollMessagesToBottom]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollMessagesToBottom();
  }, [displayProgress?.updatedAt, scrollMessagesToBottom]);

  // refreshForkList 已挪到 useForkable hook（C1）
  // refreshStats / refreshToolsCount 写到指定 runner；ownerKey 缺省 = 当前活跃 runner。

  // 拉 token/cost/context window HUD
  const refreshStats = useCallback(
    async (aid: string, ownerKey?: RunnerKey) => {
      try {
        const r = await fetch(`/api/agent/${aid}?action=stats`);
        if (!r.ok) return;
        const d = (await r.json()) as {
          stats?: {
            tokens?: {
              input?: number;
              output?: number;
              cacheRead?: number;
              total?: number;
            };
            cost?: number;
          };
          contextUsage?: {
            tokens?: number | null;
            percentage?: number | null;
          } | null;
          contextWindow?: number | null;
        };
        const t = d.stats?.tokens ?? {};
        updateRunner(ownerKey ?? activeKeyRef.current, {
          stats: {
            input: t.input ?? 0,
            output: t.output ?? 0,
            cacheRead: t.cacheRead ?? 0,
            total: t.total ?? 0,
            cost: d.stats?.cost ?? 0,
            ctxTokens: d.contextUsage?.tokens ?? null,
            ctxPct: d.contextUsage?.percentage ?? null,
            ctxWindow: d.contextWindow ?? null,
          },
        });
      } catch (e) {
        console.warn("refreshStats failed", e);
      }
    },
    [activeKeyRef, updateRunner]
  );

  // 拉工具启用计数（Tools pill 用）
  const refreshToolsCount = useCallback(
    async (aid: string, ownerKey?: RunnerKey) => {
      try {
        const r = await fetch(`/api/agent/${aid}?action=get_tools`);
        if (!r.ok) return;
        const d = (await r.json()) as {
          tools?: Array<unknown>;
          active?: string[];
        };
        updateRunner(ownerKey ?? activeKeyRef.current, {
          toolsCount: {
            active: Array.isArray(d.active) ? d.active.length : 0,
            total: Array.isArray(d.tools) ? d.tools.length : 0,
          },
        });
      } catch (e) {
        console.warn("refreshToolsCount failed", e);
      }
    },
    [activeKeyRef, updateRunner]
  );

  // 切完分支后从 session context 重建 chat state
  const reloadFromCurrentSession = useCallback(async () => {
    const sid = agentSessionId ?? selectedId;
    if (!sid) return;
    try {
      const r = await fetch(`/api/sessions/${sid}/context`);
      const ctx = await r.json();
      if (ctx.error) {
        setError(ctx.error);
        return;
      }
      setChatState(
        createInitialState(
          appendRestoredSubagentBatches(
            ctxToMessages(ctx.messages ?? []),
            Array.isArray(ctx.subagentBatches)
              ? (ctx.subagentBatches as SubagentBatch[])
              : undefined
          )
        )
      );
      if (Array.isArray(ctx.forkableUserMessages)) {
        setForkableUserMessages(
          ctx.forkableUserMessages as ForkableUserMessage[]
        );
      }
      if (agentId) {
        void refreshStats(agentId);
        void refreshToolsCount(agentId);
      }
    } catch (e) {
      setError(userFacingMessage(e));
    }
  }, [
    agentId,
    agentSessionId,
    refreshStats,
    refreshToolsCount,
    selectedId,
    setChatState,
    setForkableUserMessages,
  ]);

  // 把 handleAgentEvent 绑到 ref，供 useSseManager 的 onEvent 回调使用。
  // handleAgentEvent 是函数声明（hoisted），每次 render 重建；通过 ref 转发避免
  // useSseManager 内部回调闭包捕获旧引用。
  useEffect(() => {
    handleAgentEventRef.current = handleAgentEvent;
    return () => {
      handleAgentEventRef.current = null;
    };
    // handleAgentEvent 是函数声明，每次 render 都是新引用，需每次同步到 ref
  });

  const reconnectActiveSession = useCallback(() => {
    if (!agentId) return;
    const key = activeKeyRef.current;
    updateRunner(key, { sseStatus: "idle" });
    attachSseFor(key, agentId);
  }, [agentId, activeKeyRef, updateRunner, attachSseFor]);

  /**
   * +New chat:
   * 1) 先确保 draft runner 存在(初始化已经建过,做兜底)
   * 2) 切到 draft —— 用户切走再切回时输入框/状态都还在
   * 3) 仍然 eager create 一个 agent 绑到 draft,这样 thinking pill / 模型能力
   *    立即就有数据(老 UX 保留)。首次发送时 send() 会把 draft 升级到 sessionFile key。
   */
  const startNewSession = useCallback(async () => {
    setError(null);
    if (!providerId || !modelId) {
      setError("请先选择 provider 和 model");
      return;
    }
    // 兜底:draft 槽如果被异常清掉了,重建一个
    if (!runnersRef.current.has(DRAFT_KEY)) {
      setRunner(DRAFT_KEY, emptyRunner());
    }
    closeWorkbench();
    setSelectedId(null);
    switchTo(DRAFT_KEY);
    // draft 已经有上一次留下的 agent? 关掉它再起新的 —— +New chat 语义就是"重置"
    closeSseFor(DRAFT_KEY);
    setRunner(DRAFT_KEY, emptyRunner());
    storeSetInput(DRAFT_KEY, "");
    // 重新 switchTo 让 useRunners 把新的 empty snapshot 同步给 React state
    switchTo(DRAFT_KEY);

    try {
      const r = await fetch("/api/agent/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          modelId,
          cwd,
          thinkingLevel,
        }),
      });
      const data = await r.json();
      if (data.error) {
        setError(userFacingMessage(data.error, { context: "settings" }));
        return;
      }
      const nextRunner = {
        ...emptyRunner(),
        agentId: data.id,
        agentSessionId: data.sessionId,
        sessionFile: data.sessionFile ?? null,
        ...(data.thinkingLevel
          ? { thinkingLevel: data.thinkingLevel as ThinkingLevel }
          : {}),
        ...(data.availableThinkingLevels
          ? {
              availableThinkingLevels:
                data.availableThinkingLevels as ThinkingLevel[],
            }
          : {}),
        ...(typeof data.supportsThinking === "boolean"
          ? { supportsThinking: data.supportsThinking }
          : {}),
        runtimeProfile: data.runtimeProfile ?? null,
      };
      const sessionFile =
        typeof data.sessionFile === "string" ? data.sessionFile : null;
      const ownerKey = sessionFile ?? DRAFT_KEY;
      if (sessionFile) {
        setRunner(sessionFile, nextRunner);
        addOptimisticSession({
          sessionId:
            typeof data.sessionId === "string" ? data.sessionId : null,
          sessionFile,
          title: "新任务",
        });
        setSelectedId(
          typeof data.sessionId === "string"
            ? data.sessionId
            : extractSessionIdFromPath(sessionFile)
        );
        storeSetInput(sessionFile, "");
        switchTo(sessionFile);
        setRunner(DRAFT_KEY, emptyRunner());
      } else {
        updateRunner(DRAFT_KEY, nextRunner);
      }
      attachSseFor(ownerKey, data.id);
      refreshSessions();
      void refreshStats(data.id, ownerKey);
      void refreshToolsCount(data.id, ownerKey);
    } catch (e) {
      setError(userFacingMessage(e, { context: "settings" }));
    }
  }, [
    cwd,
    providerId,
    modelId,
    thinkingLevel,
    refreshStats,
    refreshToolsCount,
    switchTo,
    setRunner,
    setSelectedId,
    refreshSessions,
    runnersRef,
    closeSseFor,
    attachSseFor,
    updateRunner,
    closeWorkbench,
    addOptimisticSession,
  ]);

  // ===== SSE agent 事件分发器（RFC-1 阶段 A3，已抽到 useAgentEvents） =====
  // 上游：useSseManager.onEvent → handleAgentEventRef.current（见 hook 区） → 本 handleAgentEvent
  // 下游：updateRunner（写 runner）+ 4 个全局副作用回调
  //
  // RFC-2 Phase B4：注入 isCollabEnabled + autoApprove —— 当用户关掉总开关时，
  // 前端绕过气泡 UI 自动 POST allow。loadCollabSettings 每次 approval_request
  // 都重读 localStorage，让用户改了 Settings 立即生效（不依赖 React state）。
  const {
    handleAgentEvent,
    restorePendingApprovals,
    restorePendingClarifications,
  } = useAgentEvents({
    updateRunner,
    playDoneSound,
    refreshSessions,
    refreshForkList: (aid, key) => refreshForkListRef.current?.(aid, key),
    refreshStats,
    isCollabEnabled: () => loadCollabSettings().enabled,
    onBrowserState: (_snapshot, _aid, ownerKey) => {
      if (ownerKey !== activeKey) return;
      // 右侧 Workbench 不因浏览器状态自动弹开；已打开时 Overview/Browser 摘要自然更新。
    },
    autoApprove: (aid, toolCallId) => {
      // 注意：autoApprove 用的是 SSE 携带的 aid（可能 ≠ activeKey），
      // 直接 fetch 而非用 approveCall（后者绑定 activeKey）。
      void fetch(`/api/agent/${aid}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, decision: "allow" }),
      }).catch((e) =>
        setError(userFacingMessage(e))
      );
    },
  });

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const ownerKey = activeKey;
    void loadPendingApprovals().then((requests) => {
      if (cancelled || requests.length === 0) return;
      restorePendingApprovals(requests, agentId, ownerKey);
    });
    void loadPendingClarifications().then((requests) => {
      if (cancelled || requests.length === 0) return;
      restorePendingClarifications(requests, agentId, ownerKey);
    });
    return () => {
      cancelled = true;
    };
  }, [
    agentId,
    activeKey,
    loadPendingApprovals,
    loadPendingClarifications,
    restorePendingApprovals,
    restorePendingClarifications,
  ]);

  // ===== Turn 控制中枢（RFC-1 阶段 B2-a，已抽到 useChatStream） =====
  // agentAction（通用 POST 通道）+ send / onAbort / onCompact / onAbortCompaction
  // / onSteer / onFollowUp / onChangeThinking
  // 留下：startNewSession / runSlashCommand / onChangeModel（仍在本文件，复用 agentAction）
  const {
    agentAction,
    ensureAgent,
    send,
    onAbort,
    onCompact,
    onAbortCompaction,
    onSteer,
    onFollowUp,
    onChangeThinking,
    startGoal,
    startWorkflow,
  } = useChatStream({
    agentId,
    getInput: getCurrentInput,
    pendingImages,
    pendingFiles,
    currentSessionFile,
    providerId,
    modelId,
    cwd,
    thinkingLevel,
    selectedId,
    sessions,
    messages,
    runnersRef,
    activeKeyRef,
    updateRunner,
    setRunner,
    switchTo,
    attachSseFor,
    closeSseFor,
    setInput,
    setPendingImages,
    setPendingFiles,
    setError,
    setSelectedId,
    refreshSessions,
    onSessionCreated: addOptimisticSession,
    refreshStats,
    refreshToolsCount,
    pendingPinUserCountRef,
    setPinSpacer,
  });

  const openBranches = useCallback(async () => {
    const ensured = await ensureAgent();
    if (!ensured) {
      setError("当前没有可用 session，先发送一条消息或选择已有任务后再查看分支。");
      return;
    }
    setError(null);
    setShowBranches(true);
  }, [ensureAgent, setShowBranches]);

  const openSystemPrompt = useCallback(async () => {
    const ensured = await ensureAgent();
    if (!ensured) {
      setError("当前没有可用 session，先发送一条消息或选择已有任务后再查看系统提示词。");
      return;
    }
    setError(null);
    setShowSystemPrompt(true);
    setSystemPromptText(null);
    try {
      const r = await fetch(`/api/agent/${ensured.aid}?action=system_prompt`);
      const d = (await r.json().catch(() => ({}))) as {
        systemPrompt?: string;
        error?: string;
      };
      if (!r.ok || d.error) {
        setSystemPromptText(d.error ?? `读取系统提示词失败：HTTP ${r.status}`);
        return;
      }
      setSystemPromptText(d.systemPrompt ?? "");
    } catch (e) {
      setSystemPromptText(userFacingMessage(e));
    }
  }, [ensureAgent, setShowSystemPrompt, setSystemPromptText]);

  // RFC-2 Phase A3：Budget 触发后执行 abort/pause
  useBudgetEnforcer({
    agentId,
    streaming,
    runStartedAt: activeSnapshot.runStartedAt,
    status: budgetStatus,
    budget,
    onAbort,
    onPause: (trigger) => {
      setBudgetPausedTrigger(trigger);
      if (trigger.agentId) {
        void agentAction(trigger.agentId, {
          type: "goal_pause",
          reason: "Budget limit reached.",
        }).catch(() => {});
      }
    },
  });

  // "提高上限并继续"：把当前 budget 各启用维度 × 2 写入 session override
  const handleRaiseAndContinue = useCallback(
    (trigger: BudgetTrigger) => {
      if (!agentId) {
        setBudgetPausedTrigger(null);
        return;
      }
      const b = trigger.budget;
      setSessionOverride({
        maxCostUsd: b.maxCostUsd && b.maxCostUsd > 0 ? b.maxCostUsd * 2 : b.maxCostUsd,
        maxTurns: b.maxTurns && b.maxTurns > 0 ? b.maxTurns * 2 : b.maxTurns,
        maxDurationSec:
          b.maxDurationSec && b.maxDurationSec > 0
            ? b.maxDurationSec * 2
            : b.maxDurationSec,
        action: b.action,
      });
      setBudgetPausedTrigger(null);
      // Phase A 暂不自动续发；用户需手动在 Composer 里继续追问
    },
    [agentId, setSessionOverride]
  );

  const {
    navigateInputHistory,
    sendWithHistory,
    steerWithHistory,
    followUpWithHistory,
    setComposerInput,
  } = useComposerHistoryController({
    inputRef,
    setInput,
    getCurrentInput,
    agentId,
    goal,
    setError,
    agentAction,
    startGoal,
    startWorkflow,
    send,
    onSteer,
    onFollowUp,
  });

  const handleGoalPause = useCallback(async () => {
    if (!agentId) return;
    await agentAction(agentId, { type: "goal_pause" }).catch(() => {});
  }, [agentId, agentAction]);

  const handleGoalResume = useCallback(async () => {
    if (!agentId) return;
    await agentAction(agentId, { type: "goal_resume" }).catch(() => {});
  }, [agentId, agentAction]);

  const handleGoalClear = useCallback(async () => {
    if (!agentId) return;
    const result = (await agentAction(agentId, { type: "goal_clear" }).catch(
      () => null
    )) as { goal?: null; progress?: AgentProgress | null } | null;
    if (result) {
      updateRunner(activeKeyRef.current, {
        goal: result.goal ?? null,
        contract: null,
        progress: result.progress ?? null,
      });
    }
  }, [activeKeyRef, agentId, agentAction, updateRunner]);

  const handleGoalRunVerification = useCallback(async () => {
    if (!agentId) return;
    const browserUrl = activeSnapshot.browser.url;
    const targetUrl =
      typeof browserUrl === "string" && /^(https?:\/\/|file:\/\/)/i.test(browserUrl)
        ? browserUrl
        : undefined;
    await agentAction(agentId, {
      type: "goal_run_verification",
      browserId: runtimeIdentity.browserId,
      ...(targetUrl ? { targetUrl } : {}),
    }).catch(() => {});
  }, [activeSnapshot.browser.url, agentId, agentAction, runtimeIdentity.browserId]);

  const resumeWorkflowFromCard = useCallback(
    (
      workflowId: string,
      objective: string,
      checkpointName?: string,
      snapshot?: WorkflowResumeSnapshot
    ) => {
      const summaryLines = formatWorkflowResumeSummaries(snapshot, checkpointName);
      const prompt = [
        "请从这个历史 workflow 的 checkpoint/artifact 继续执行，不要从头重跑全部工作。",
        "",
        `workflowId: ${workflowId}`,
        `previousObjective: ${objective}`,
        checkpointName ? `checkpointName: ${checkpointName}` : "",
        ...summaryLines,
        "",
        checkpointName
          ? "请使用 run_workflow_script，并设置 resumeFromWorkflowId 为上面的 workflowId，resumeFromCheckpointName 为上面的 checkpointName。"
          : "请使用 run_workflow_script，并设置 resumeFromWorkflowId 为上面的 workflowId。",
        "新的 workflow harness 应读取 workflow.resume.lastCheckpoint 和 workflow.readArtifact(name)，只规划并执行剩余步骤，最后综合给出结果。",
      ]
        .filter(Boolean)
        .join("\n");
      setComposerInput(prompt);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [inputRef, setComposerInput]
  );

  const loadWorkflowHistory = useCallback(async () => {
    if (!agentId) return;
    setWorkflowHistoryLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agent/${agentId}/workflows`);
      const d = (await r.json()) as {
        resumes?: WorkflowResumeSnapshot[];
        error?: string;
      };
      if (!r.ok) throw new Error(d.error ?? `workflow history HTTP ${r.status}`);
      setWorkflowHistory(Array.isArray(d.resumes) ? d.resumes : []);
      setWorkflowHistoryAgentId(agentId);
    } catch (e) {
      setError(userFacingMessage(e));
    } finally {
      setWorkflowHistoryLoading(false);
    }
  }, [agentId]);

  const loadWorkflowDebugBundle = useCallback(
    async (snapshot: WorkflowResumeSnapshot) => {
      if (!agentId) return;
      setWorkflowDebugLoading(true);
      setWorkflowDebugError(null);
      try {
        const r = await fetch(
          `/api/agent/${agentId}/workflows?id=${encodeURIComponent(
            snapshot.workflowId
          )}&debug=1`
        );
        const d = (await r.json()) as {
          debugBundle?: WorkflowDebugBundle;
          error?: string;
        };
        if (!r.ok || !d.debugBundle) {
          throw new Error(d.error ?? `workflow debug HTTP ${r.status}`);
        }
        setWorkflowDebugBundle(d.debugBundle);
      } catch (e) {
        setWorkflowDebugError(userFacingMessage(e));
      } finally {
        setWorkflowDebugLoading(false);
      }
    },
    [agentId]
  );

  const openWorkflowHistory = useCallback(() => {
    if (!agentId) return;
    if (workflowHistoryAgentId !== agentId) {
      setWorkflowDebugBundle(null);
      setWorkflowDebugError(null);
    }
    setShowWorkflowHistory(true);
    if (workflowHistoryAgentId !== agentId) {
      void loadWorkflowHistory();
    }
  }, [agentId, loadWorkflowHistory, workflowHistoryAgentId]);

  const resumeWorkflowFromHistory = useCallback(
    (snapshot: WorkflowResumeSnapshot, checkpointName?: string) => {
      resumeWorkflowFromCard(
        snapshot.workflowId,
        snapshot.objective,
        checkpointName,
        snapshot
      );
      setShowWorkflowHistory(false);
    },
    [resumeWorkflowFromCard]
  );

  const handleWorkflowWorktreeAction = useCallback(
    async (
      action: "retry_merge" | "cleanup",
      workflowId: string,
      worktree: WorkflowWorktreeAction
    ) => {
      if (!agentId) {
        const message = "当前没有可用的 agent，无法操作 workflow worktree";
        setError(message);
        throw new Error(message);
      }
      setError(null);
      const r = await fetch(`/api/agent/${agentId}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type:
            action === "retry_merge"
              ? "retry_merge_worktree"
              : "cleanup_worktree",
          workflowId,
          worktree,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        artifact?: { name: string; value: unknown; createdAt: number };
        error?: string;
      };
      if (!r.ok || d.error) {
        const message =
          d.error ?? `workflow worktree action failed: HTTP ${r.status}`;
        setError(message);
        throw new Error(message);
      }
      if (d.artifact) {
        handleAgentEvent(
          {
            type: "workflow_artifact",
            workflowId,
            artifact: d.artifact,
          },
          agentId,
          activeKeyRef.current
        );
      }
    },
    [activeKeyRef, agentId, handleAgentEvent]
  );

  const retrySubagentTaskFromCard = useCallback(
    async (batchId: string, taskId: string) => {
      const ensured = await ensureAgent();
      if (!ensured) {
        setError("当前没有可用的 parent agent，无法重试 subagent task");
        return;
      }
      setError(null);
      const r = await fetch(`/api/agent/${ensured.aid}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "retry", batchId, taskId }),
      });
      const data = (await r.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!r.ok || data?.error) {
        setError(data?.error ?? `重试 subagent task 失败: HTTP ${r.status}`);
      }
    },
    [ensureAgent]
  );

  const resumeSubagentBatchFromCard = useCallback(
    async (batchId: string) => {
      const ensured = await ensureAgent();
      if (!ensured) {
        setError("当前没有可用的 parent agent，无法继续 subagent batch");
        return;
      }
      setError(null);
      const r = await fetch(`/api/agent/${ensured.aid}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "resume", batchId }),
      });
      const data = (await r.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!r.ok || data?.error) {
        setError(data?.error ?? `继续 subagent batch 失败: HTTP ${r.status}`);
      }
    },
    [ensureAgent]
  );

  const openSubagentSessionFromCard = useCallback(
    (sessionFile: string) => {
      const target = sessions.find((session) => session.path === sessionFile);
      if (!target) {
        refreshSessions();
        setError("找不到这个 child subagent session；已刷新 session 列表");
        return;
      }
      setError(null);
      setSelectedId(target.id);
    },
    [refreshSessions, sessions, setSelectedId]
  );

  // ===== Autocomplete + Slash 命令（RFC-1 阶段 C2，已抽到 useAutocomplete） =====
  // 抽离内容：4 个 AC state + 3 个 handler + runSlashCommand(7 case) + onKeyDown 拦截块。
  // startNewSession / onCompact / 4 个 modal setter 通过参数注入；hook 对 UI state 零反向依赖。
  const {
    acMode,
    acItems,
    acIndex,
    setAcIndex,
    refreshAutocomplete,
    closeAutocomplete,
    applyAutocomplete,
    tryHandleAutocompleteKey,
  } = useAutocomplete({
    getInput: getCurrentInput,
    cwd,
    inputRef,
    setInput,
    agentId,
    startNewSession,
    onCompact,
    setShowBranches: (value) => {
      if (value) void openBranches();
      else setShowBranches(false);
    },
    setShowSystemPrompt: (value) => {
      if (value) void openSystemPrompt();
      else setShowSystemPrompt(false);
    },
    setShowModelsConfig,
    setShowAuth,
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 自动补全弹层打开时拦截上下/Enter/Tab/Esc（消费则直接 return）
    if (tryHandleAutocompleteKey(e)) return;
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.nativeEvent.isComposing
    ) {
      const handled = navigateInputHistory(
        e.key === "ArrowUp" ? "prev" : "next"
      );
      if (handled) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // streaming 时 Enter 默认走 follow_up（排队），shift+Enter 才换行
      if (streaming) void followUpWithHistory();
      else void sendWithHistory();
    }
  };

  const onChangeModel = useCallback(
    async (provider: string, mid: string) => {
      const ownerKey = activeKeyRef.current;
      const prevProviderId = providerId;
      const prevModelId = modelId;
      setProviderId(provider);
      setModelId(mid);
      if (agentId) {
        try {
          const data = (await agentAction(agentId, {
            type: "set_model",
            provider,
            modelId: mid,
          })) as {
            replacementAgent?: {
              id?: string;
              sessionId?: string;
              sessionFile?: string | null;
            };
          };
          const replacement = data?.replacementAgent as
            | {
                id?: string;
                sessionId?: string;
                sessionFile?: string | null;
              }
            | undefined;
          const nextAgentId = replacement?.id || agentId;
          if (replacement?.id) {
            closeSseFor(ownerKey);
            updateRunner(ownerKey, {
              agentId: replacement.id,
              agentSessionId: replacement.sessionId ?? null,
              sessionFile: replacement.sessionFile ?? null,
              sseStatus: "idle",
            });
            attachSseFor(ownerKey, replacement.id);
          }
          // 切完模型后,thinking 能力可能变了,重新拉一下(写回触发本次操作的 runner)
          const meta = await fetch(`/api/agent/${nextAgentId}`).then((r) =>
            r.json()
          );
          updateRunner(ownerKey, {
            ...(meta.thinkingLevel ? { thinkingLevel: meta.thinkingLevel } : {}),
            ...(meta.availableThinkingLevels
              ? { availableThinkingLevels: meta.availableThinkingLevels }
              : {}),
            ...(typeof meta.supportsThinking === "boolean"
              ? { supportsThinking: meta.supportsThinking }
              : {}),
            runtimeProfile: meta.runtimeProfile ?? null,
          });
          void data;
        } catch (e) {
          setProviderId(prevProviderId);
          setModelId(prevModelId);
          setError(userFacingMessage(e, { context: "settings" }));
        }
      }
    },
    [
      activeKeyRef,
      agentId,
      agentAction,
      attachSseFor,
      closeSseFor,
      modelId,
      providerId,
      setModelId,
      setProviderId,
      updateRunner,
    ]
  );

  // ===== Fork 模块（RFC-1 阶段 C1，已抽到 useForkable hook） =====
  const {
    forksCollapsed,
    refreshForkList,
    startFork,
    cancelFork,
    submitFork,
    forkToNewSession,
  } = useForkable({
    agentId,
    agentSessionId,
    selectedId,
    forkText,
    providerId,
    modelId,
    cwd,
    thinkingLevel,
    sessions,
    activeKeyRef,
    setRunner,
    updateRunner,
    setForkableUserMessages,
    setForkingIndex,
    setForkText,
    attachSseFor,
    switchTo,
    setSelectedId,
    refreshSessions,
    setError,
    refreshStats,
    refreshToolsCount,
    agentAction,
  });

  // refreshForkList ref 同步：useAgentEvents 通过 refreshForkListRef.current 调用本 hook 的方法。
  useEffect(() => {
    refreshForkListRef.current = refreshForkList;
    return () => {
      refreshForkListRef.current = null;
    };
  }, [refreshForkList]);

  const sidebarSlot = (
      <Sidebar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        cwd={cwd}
        onOpenCwdPicker={openCwdPicker}
        theme={theme}
        onToggleTheme={toggleTheme}
        updateAvailable={updateState?.status === "available"}
        updateLatestVersion={updateState?.latestVersion}
        onDownloadUpdate={openUpdateDownload}
        onOpenProviderSetup={() => {
          setProviderSetupChild(null);
          setShowProviderSetup(true);
        }}
        onOpenSettings={() => {
          window.location.assign("/settings");
        }}
        onSkipUpdateVersion={skipUpdateVersion}
        sessions={sessions}
        groupedSessions={groupedSessions}
        selectedId={selectedId}
        setSelectedId={selectSessionAndCloseWorkbench}
        lastSeenMap={lastSeenMap}
        renamingFor={renamingFor}
        setRenamingFor={setRenamingFor}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        menuFor={menuFor}
        setMenuFor={setMenuFor}
        pendingDeleteId={pendingDeleteId}
        setPendingDeleteId={setPendingDeleteId}
        startNewSession={startNewSession}
        submitRename={submitRename}
        executeDeleteSession={executeDeleteSession}
        requestDeleteSession={requestDeleteSession}
        handleExportSession={handleExportSession}
        toggleSessionPin={toggleSessionPin}
        setInput={setInput}
        setShowFilePicker={setShowFilePicker}
        searchQuery={searchHook.query}
        onSearchQueryChange={searchHook.setQuery}
        searchView={
          searchHook.isActive ? (
            <SidebarSearch
              query={searchHook.query}
              status={searchHook.status}
              results={searchHook.results}
              totalDocs={searchHook.totalDocs}
              durationMs={searchHook.durationMs}
              error={searchHook.error}
              onRetry={searchHook.retry}
              onSelect={(id) => {
                searchHook.clear();
                selectSessionAndCloseWorkbench(id);
              }}
              selectedId={selectedId}
              sessionLookup={sessionLookup}
            />
          ) : null
        }
      />
  );

  const headerSlot = (
    <TopHeader
      sidebarOpen={sidebarOpen}
      theme={theme}
      agentId={agentId}
      stats={stats}
      sseStatus={sseStatus}
      electronApi={electronApi}
      currentSessionFile={currentSessionFile}
      hasSessionContext={Boolean(agentId || selectedId || currentSessionFile)}
      showTools={showTools}
      showWorkbench={workbenchOpen}
      updateStatus={updateState?.status}
      updateLatestVersion={updateState?.latestVersion}
      openCommandMenuRequest={openCommandMenuRequest}
      budget={budget}
      budgetSpent={budgetSpent}
      budgetStatus={budgetStatus}
      budgetHasOverride={budgetHasOverride}
      onToggleSidebar={toggleSidebar}
      onToggleTheme={toggleTheme}
      onOpenBranches={openBranches}
      onOpenSystemPrompt={openSystemPrompt}
      onOpenWorkflows={openWorkflowHistory}
      onRevealInFinder={() => {
        if (electronApi && currentSessionFile) {
          void electronApi
            .revealInFinder(currentSessionFile)
            .catch((e) => setError(userFacingMessage(e)));
        }
      }}
      onOpenProviderSetup={() => {
        setProviderSetupChild(null);
        setShowProviderSetup(true);
      }}
      onOpenSettings={(section) => {
        window.location.assign(
          section === "mobile" ? "/settings?section=mobile" : "/settings"
        );
      }}
      onReconnectSession={reconnectActiveSession}
      onToggleTools={toggleTools}
      onToggleWorkbench={toggleWorkbench}
      onCheckForUpdates={checkForUpdates}
      onDownloadUpdate={openUpdateDownload}
      onSkipUpdateVersion={skipUpdateVersion}
    />
  );

  const noticesSlot = (
    <>
        {updateState?.status === "available" && !updateNoticeHidden ? (
          <UpdateNotice
            state={updateState}
            onView={viewUpdateDetails}
            onClose={() => setUpdateNoticeHidden(true)}
          />
        ) : null}
        {updateState?.status === "not-available" && !latestNoticeHidden ? (
          <UpdateLatestNotice
            state={updateState}
            onClose={() => setLatestNoticeHidden(true)}
          />
        ) : null}
    </>
  );

  const mainContentSlot =
    sessionLoading && messages.length === 0 ? (
      <SessionLoadingState session={selectedSession} />
    ) : messages.length === 0 && !error && !displayProgress ? (
      <EmptyState
        providerLabel={currentProvider?.provider ?? providerId}
        modelLabel={modelId}
        goal={goal}
        onOpenModelSetup={() => {
          setProviderSetupChild(null);
          setShowProviderSetup(true);
        }}
        onStartGoal={() => {
          setInput((cur) => (cur.trim() ? cur : "/goal "));
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onFocusComposer={() => inputRef.current?.focus()}
        onUseStarter={(prompt) => {
          setComposerInput((cur) =>
            cur.trim() ? `${cur.trim()}\n\n${prompt}` : prompt
          );
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />
    ) : (
      <MessagesScrollArea
        messages={messages}
        error={error}
        currentProvider={currentProvider}
        modelId={modelId}
        activeAssistantIndex={chatState.activeAssistantIndex}
        agentPhase={agentPhase}
        cwd={cwd}
        streaming={streaming}
        compacting={compacting}
        compactError={compactError}
        pinSpacer={pinSpacer}
        forksCollapsed={forksCollapsed}
        forkingIndex={forkingIndex}
        forkText={forkText}
        forkBusy={forkBusy}
        messagesScrollRef={messagesScrollRef}
        messagesEndRef={messagesEndRef}
        messageRefs={messageRefs}
        onScroll={handleMessagesScroll}
        onStartFork={startFork}
        onCancelFork={cancelFork}
        onChangeForkText={setForkText}
        onSubmitFork={submitFork}
        onForkToNewSession={forkToNewSession}
        onOpenUrl={openUrlInBrowserPanel}
        onApproveCall={approveCall}
        onDenyCall={denyCall}
        onChooseClarification={chooseClarification}
        onRespondClarification={respondClarification}
        onResumeWorkflow={resumeWorkflowFromCard}
        onWorkflowWorktreeAction={handleWorkflowWorktreeAction}
        onRetrySubagentTask={retrySubagentTaskFromCard}
        onResumeSubagentBatch={resumeSubagentBatchFromCard}
        onOpenSubagentSession={openSubagentSessionFromCard}
      />
    );

  const composerSlot = (
        <Composer
          inputKey={activeKey}
          setInput={setComposerInput}
          inputRef={inputRef}
          fileInputRef={fileInputRef}
          onKeyDown={onKeyDown}
          onPasteTextarea={onPasteTextarea}
          streaming={streaming}
          abortable={abortable}
          compacting={compacting}
          agentId={agentId}
          pendingMessages={activeSnapshot.pendingMessages}
          goal={goal}
          pendingImages={pendingImages}
          pendingFiles={pendingFiles}
          removePendingImage={removePendingImage}
          removePendingFile={removePendingFile}
          addImageFiles={addImageFiles}
          acMode={acMode}
          acItems={acItems}
          acIndex={acIndex}
          setAcIndex={setAcIndex}
          applyAutocomplete={applyAutocomplete}
          refreshAutocomplete={refreshAutocomplete}
          closeAutocomplete={closeAutocomplete}
          send={sendWithHistory}
          onSteer={steerWithHistory}
          onFollowUp={followUpWithHistory}
          onAbort={onAbort}
          onCompact={onCompact}
          onAbortCompaction={onAbortCompaction}
          onGoalPause={handleGoalPause}
          onGoalResume={handleGoalResume}
          onGoalClear={handleGoalClear}
          onGoalRunVerification={handleGoalRunVerification}
          retryInfo={retryInfo}
          compactError={compactError}
          visibleProviders={visibleProviders}
          providerId={providerId}
          modelId={modelId}
          currentProvider={currentProvider ?? null}
          onChangeModel={onChangeModel}
          onOpenAuth={(provider) => {
            setProviderSetupChild(null);
            openAuth(provider);
          }}
          onOpenModelsConfig={() => {
            setProviderSetupChild(null);
            setShowModelsConfig(true);
          }}
          onOpenProviderSetup={() => {
            setProviderSetupChild(null);
            setShowProviderSetup(true);
          }}
          supportsThinking={supportsThinking}
          thinkingLevel={thinkingLevel}
          availableThinkingLevels={availableThinkingLevels}
          onChangeThinking={onChangeThinking}
          toolsCount={toolsCount}
          toggleTools={toggleTools}
          soundEnabled={soundEnabled}
          onSoundToggle={onSoundToggle}
        />
  );

  const workbenchSlot = (
      <WorkbenchSidebar
        open={workbenchOpen}
        view={workbenchView}
        cwd={cwd}
        width={filesContainerWidth}
        isResizing={rightPanelResizing}
        agentId={agentId}
        runtimeIdentity={runtimeIdentity}
        progress={displayProgress}
        contract={contract}
        streaming={streaming}
        browserSnapshot={activeSnapshot.browser}
        browserOpenRequest={browserOpenRequest}
        stats={stats}
        budgetStatus={budgetStatus}
        providerLabel={currentProvider?.provider ?? providerId}
        modelLabel={modelId}
        thinkingLabel={thinkingLevel}
          runtimeProfile={activeSnapshot.runtimeProfile}
          toolsCount={toolsCount?.active ?? 0}
          pendingFileCount={pendingFiles.length}
          pendingImageCount={pendingImages.length}
          filesLayout={filesLayout}
        onSplitterMouseDown={onSplitterMouseDown}
        onOpenView={openWorkbench}
        onAbort={onAbort}
        onPickPath={(absPath) => {
          // 把路径加到输入框末尾（用 @ 前缀，pi-coding-agent 约定的引用语法）
          setInput((cur) => {
            const sep = cur.length === 0 || cur.endsWith(" ") ? "" : " ";
            return `${cur}${sep}@${absPath} `;
          });
        }}
        onFilesLayoutChange={setFilesLayout}
        onOpenProgressUrl={openUrlInBrowserPanel}
        onAnnotate={(annotations: BrowserAnnotation[]) => {
          if (annotations.length === 0) return;
          // 把结构化批注组装成给 agent 的视觉任务文本（含定位区域、URL、留言）。
          const text =
            annotations.length === 1
              ? formatBrowserAnnotation(annotations[0])
              : [
                  `请处理以下 ${annotations.length} 条页面批注：`,
                  ...annotations.map(
                    (a, i) => `\n${i + 1}. ${formatBrowserAnnotation(a)}`
                  ),
                ].join("\n");
          setComposerInput((cur) => {
            const sep = cur.trim() ? "\n\n" : "";
            return `${cur}${sep}${text}`;
          });
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onPrepareTeamWorkflow={(prompt) => {
          setComposerInput((cur) => {
            const sep = cur.trim() ? "\n\n" : "";
            return `${cur}${sep}${prompt}`;
          });
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />
  );

  const overlaysSlot = (
    <>
      {showWorkflowHistory && (
        <WorkflowHistoryPanel
          items={workflowHistory}
          loading={workflowHistoryLoading}
          debugBundle={workflowDebugBundle}
          debugLoading={workflowDebugLoading}
          debugError={workflowDebugError}
          onRefresh={loadWorkflowHistory}
          onClose={() => setShowWorkflowHistory(false)}
          onResume={resumeWorkflowFromHistory}
          onInspect={loadWorkflowDebugBundle}
          onCloseInspector={() => {
            setWorkflowDebugBundle(null);
            setWorkflowDebugError(null);
          }}
        />
      )}
      <ChatModals
        cwd={cwd}
        agentId={agentId}
        state={{
          showCwdPicker,
          showFilePicker,
          showSkills,
          showTools,
          showProviderSetup,
          showAuth,
          authInitialProvider,
          showModelsConfig,
          providerSetupChild,
          showSystemPrompt,
          systemPromptText,
          showBranches,
        }}
        onCloseCwdPicker={() => setShowCwdPicker(false)}
        onPickCwd={(picked) => {
          setCwd(picked);
          setShowCwdPicker(false);
        }}
        onCloseFilePicker={() => setShowFilePicker(false)}
        onPickFile={(absPath) => {
          setInput((cur) => {
            const sep =
              cur.length === 0 || cur.endsWith(" ") ? "" : " ";
            return `${cur}${sep}@${absPath} `;
          });
          setShowFilePicker(false);
        }}
        onCloseSkills={toggleSkills}
        onCloseTools={toggleTools}
        onCloseProviderSetup={() => {
          setProviderSetupChild(null);
          setShowProviderSetup(false);
        }}
        onProviderSetupOpenAuth={(provider) => {
          setProviderSetupChild("auth");
          setShowProviderSetup(false);
          openAuth(provider);
        }}
        onProviderSetupOpenModelsConfig={() => {
          setProviderSetupChild("models");
          setShowProviderSetup(false);
          setShowModelsConfig(true);
        }}
        onCloseAuth={() => {
          setProviderSetupChild(null);
          closeAuth();
        }}
        onBackFromAuth={() => {
          closeAuth();
          setProviderSetupChild(null);
          setShowProviderSetup(true);
        }}
        onAuthChanged={() => reloadProviders(true)}
        onCloseModelsConfig={() => {
          setProviderSetupChild(null);
          setShowModelsConfig(false);
        }}
        onBackFromModelsConfig={() => {
          setShowModelsConfig(false);
          setProviderSetupChild(null);
          setShowProviderSetup(true);
        }}
        onModelsConfigChanged={() => reloadProviders(true)}
        onCloseSystemPrompt={closeSystemPrompt}
        onCloseBranches={() => setShowBranches(false)}
        onBranchesNavigated={() => {
          void reloadFromCurrentSession();
        }}
      />
      <BudgetExceededModal
        trigger={budgetPausedTrigger}
        onClose={() => setBudgetPausedTrigger(null)}
        onRaiseAndContinue={handleRaiseAndContinue}
      />
    </>
  );

  return (
    <ChatAppShell
      sidebar={sidebarSlot}
      header={headerSlot}
      notices={noticesSlot}
      mainContent={mainContentSlot}
      composer={composerSlot}
      workbench={workbenchSlot}
      overlays={overlaysSlot}
      isDragOver={isDragOver}
      showScrollToBottom={showScrollToBottom}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onScrollToBottom={() => scrollMessagesToBottom("smooth")}
    />
  );
}

/**
 * 阶段 D：把一条结构化页面批注组装成给 agent 的视觉任务文本。
 * 包含定位区域（归一化百分比）、页面 URL/标题和用户留言，
 * 让 agent 能定位到“页面的哪个区域有什么问题”。
 */
function formatBrowserAnnotation(a: BrowserAnnotation): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const area = `区域 ${pct(a.rect.x)},${pct(a.rect.y)} 起，宽${pct(
    a.rect.w
  )} 高${pct(a.rect.h)}`;
  return [
    `页面批注${a.url ? ` @ ${a.url}` : ""}`,
    a.title ? `标题：${a.title}` : null,
    area,
    `留言：${a.comment}`,
  ]
    .filter(Boolean)
    .join("\n");
}
