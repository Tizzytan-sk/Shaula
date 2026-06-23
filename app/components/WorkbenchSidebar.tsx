"use client";

import type {
  CSSProperties,
  Dispatch,
  MouseEventHandler,
  ReactNode,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Square,
  Target,
  Terminal,
  X,
} from "lucide-react";
import type { BrowserAnnotation, BrowserSnapshot } from "@/lib/browser/types";
import type { BudgetStatus } from "@/lib/budget/types";
import type { ExecutionContractSummary } from "@/lib/execution-contract/types";
import { summarizeExecutionMode } from "@/lib/agent-mode/execution-mode";
import type { RuntimeIdentity } from "@/lib/runtime/identity";
import type { StatsSnapshot } from "@/lib/session-runner";
import type { AgentRuntimeProfile } from "@/lib/types";
import type { AgentGoal, GoalRunClosure } from "@/lib/goal/types";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { AdvisoryRouteDecision } from "@/lib/task-router/types";
import type { ExecutionModeSummary } from "@/lib/agent-mode/types";
import type { TeamTask } from "@/lib/team-state/types";
import type {
  TeamTaskSynthesisAssistanceMeta,
  TeamTaskSynthesisItem,
  TeamTaskSynthesisSummary,
} from "@/lib/team-state/synthesis";
import type { TeamTaskVerificationSummary } from "@/lib/team-state/verifier";
import type { AgentProgress, ProgressArtifact, ProgressGroup } from "@/lib/progress/types";
import FileBrowser from "./FileBrowser";
import { BrowserPanel } from "./BrowserPanel";
import { ProgressPopover } from "./ProgressPopover";
import type { FilesLayout } from "./RightPanelContainer";

export type WorkbenchView =
  | { type: "overview" }
  | { type: "progress" }
  | { type: "outputs" }
  | { type: "files"; path?: string }
  | { type: "context" }
  | { type: "team" }
  | { type: "browser"; url?: string };

type WorkbenchTabKind =
  | "home"
  | "progress"
  | "outputs"
  | "files"
  | "context"
  | "team"
  | "browser"
  | "terminal"
  | "sidechat";

interface WorkbenchTab {
  id: string;
  kind: WorkbenchTabKind;
  title: string;
  subtitle?: string;
  closable: boolean;
  url?: string;
  path?: string;
}

interface TeamAssistUserError {
  title?: string;
  message?: string;
  actionLabel?: string;
  retryable?: boolean;
}

type WorkbenchRecommendationKind = "url" | "file" | "output";

interface WorkbenchRecommendation {
  id: string;
  kind: WorkbenchRecommendationKind;
  title: string;
  subtitle: string;
  href?: string;
}

interface WorkbenchGoalStatePayload {
  goal: AgentGoal | null;
  contract: ExecutionContractSummary | null;
  ledgerEvidence: EvidenceRef[];
  lastClosure: GoalRunClosure | null;
  routeDecision: AdvisoryRouteDecision | null;
  teamTasks: TeamTask[];
  teamTaskVerification: TeamTaskVerificationSummary | null;
  teamTaskSynthesis: TeamTaskSynthesisSummary | null;
}

export interface WorkbenchSidebarProps {
  open: boolean;
  view: WorkbenchView;
  width: number;
  isResizing?: boolean;
  cwd: string;
  agentId: string | null;
  runtimeIdentity: RuntimeIdentity;
  progress: AgentProgress | null;
  contract: ExecutionContractSummary | null;
  streaming: boolean;
  browserSnapshot: BrowserSnapshot;
  browserOpenRequest?: { id: number; url: string } | null;
  stats: StatsSnapshot | null;
  budgetStatus: BudgetStatus;
  providerLabel: string;
  modelLabel: string;
  thinkingLabel: string;
  runtimeProfile: AgentRuntimeProfile | null;
  toolsCount: number;
  pendingFileCount: number;
  pendingImageCount: number;
  filesLayout: FilesLayout;
  onSplitterMouseDown: MouseEventHandler<HTMLDivElement>;
  onOpenView: (view: WorkbenchView) => void;
  onAbort?: () => Promise<void> | void;
  onPickPath: (absPath: string) => void;
  onFilesLayoutChange: Dispatch<SetStateAction<FilesLayout>>;
  onOpenProgressUrl?: (url: string) => void;
  onAnnotate: (annotations: BrowserAnnotation[]) => void;
  onPrepareTeamWorkflow?: (prompt: string) => void;
}

export function WorkbenchSidebar({
  open,
  view,
  width,
  isResizing = false,
  cwd,
  agentId,
  runtimeIdentity,
  progress,
  contract,
  streaming,
  browserSnapshot,
  browserOpenRequest,
  stats,
  budgetStatus,
  providerLabel,
  modelLabel,
  thinkingLabel,
  runtimeProfile,
  toolsCount,
  pendingFileCount,
  pendingImageCount,
  filesLayout,
  onSplitterMouseDown,
  onOpenView,
  onAbort,
  onPickPath,
  onFilesLayoutChange,
  onOpenProgressUrl,
  onAnnotate,
  onPrepareTeamWorkflow,
}: WorkbenchSidebarProps) {
  const storageKey = useMemo(
    () =>
      `pi-workbench-tabs-v1:${
        runtimeIdentity.sessionId ?? agentId ?? cwd ?? "standalone"
      }`,
    [agentId, cwd, runtimeIdentity.sessionId]
  );
  const [tabs, setTabs] = useState<WorkbenchTab[]>(() => [homeTab()]);
  const [activeTabId, setActiveTabId] = useState("home");
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const viewRequestKey = `${view.type}:${"url" in view ? view.url ?? "" : ""}:${
    "path" in view ? view.path ?? "" : ""
  }`;
  const lastViewRequestRef = useRef(viewRequestKey);
  const recommendations = useMemo(
    () =>
      buildWorkbenchRecommendations({
        cwd,
        artifacts: progress?.artifacts ?? [],
        browserSnapshot,
      }),
    [browserSnapshot, cwd, progress?.artifacts]
  );

  useEffect(() => {
    const stored = loadStoredWorkbenchTabs(storageKey);
    queueMicrotask(() => {
      setTabs(stored.tabs);
      setActiveTabId(stored.activeTabId);
      setLoadedStorageKey(storageKey);
    });
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ tabs, activeTabId })
      );
    } catch {
      /* noop */
    }
  }, [activeTabId, loadedStorageKey, storageKey, tabs]);

  const openWorkbenchTab = useCallback(
    (nextView: WorkbenchView) => {
      const nextTab = tabFromView(nextView);
      setTabs((currentTabs) => upsertWorkbenchTab(currentTabs, nextTab));
      setActiveTabId(nextTab.id);
      setCreateMenuOpen(false);
      onOpenView(nextView);
    },
    [onOpenView]
  );

  const openLocalTab = useCallback((nextTab: WorkbenchTab) => {
    setTabs((currentTabs) => upsertWorkbenchTab(currentTabs, nextTab));
    setActiveTabId(nextTab.id);
    setCreateMenuOpen(false);
  }, []);

  useEffect(() => {
    if (lastViewRequestRef.current === viewRequestKey) return;
    lastViewRequestRef.current = viewRequestKey;
    const nextTab = tabFromView(view);
    queueMicrotask(() => {
      setTabs((currentTabs) => upsertWorkbenchTab(currentTabs, nextTab));
      setActiveTabId(nextTab.id);
    });
  }, [view, viewRequestKey]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((currentTabs) => {
        const targetIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        if (targetIndex < 0) return currentTabs;
        const target = currentTabs[targetIndex];
        if (!target.closable) return currentTabs;
        const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          const fallback =
            nextTabs[Math.max(0, targetIndex - 1)] ?? nextTabs[0] ?? homeTab();
          queueMicrotask(() => {
            setActiveTabId(fallback.id);
            if (fallback.kind !== "terminal" && fallback.kind !== "sidechat") {
              onOpenView(viewFromTab(fallback));
            }
          });
        }
        return nextTabs.length > 0 ? nextTabs : [homeTab()];
      });
    },
    [activeTabId, onOpenView]
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? homeTab();
  const minWidth =
    activeTab.kind === "files" && filesLayout.viewerHidden && filesLayout.treeCollapsed
      ? 56
      : 320;

  const panelWidth = open ? width : 0;
  const panelTransition =
    "width 240ms cubic-bezier(0.22, 1, 0.36, 1), flex-basis 240ms cubic-bezier(0.22, 1, 0.36, 1), min-width 240ms cubic-bezier(0.22, 1, 0.36, 1), max-width 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease, border-color 160ms ease";

  return (
    <>
      <div
        onMouseDown={open ? onSplitterMouseDown : undefined}
        title={open ? "拖动调整宽度" : undefined}
        style={{
          width: open ? 4 : 0,
          cursor: open ? "ew-resize" : "default",
          background: "var(--border-soft)",
          flexShrink: 0,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: isResizing
            ? "background 120ms ease"
            : "width 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease, background 120ms ease",
        }}
        onMouseEnter={(e) => {
          if (open) e.currentTarget.style.background = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--border-soft)";
        }}
      />
      <aside
        className="workbench-sidebar flex h-full min-h-0 flex-col border-l"
        style={{
          flex: `0 0 ${panelWidth}px`,
          width: panelWidth,
          minWidth: open ? minWidth : 0,
          maxWidth: panelWidth,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          overflow: "hidden",
          contain: "layout paint",
          willChange: "width, flex-basis, opacity",
          background: "var(--bg-panel)",
          borderColor: open ? "var(--border)" : "transparent",
          color: "var(--text)",
          transition: isResizing ? "none" : panelTransition,
        }}
        data-testid="workbench-sidebar"
      >
        <header
          className="relative flex h-10 shrink-0 items-center gap-1 border-b px-2"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <WorkbenchTabButton
                key={tab.id}
                tab={tab}
                active={tab.id === activeTab.id}
                onSelect={() => {
                  setActiveTabId(tab.id);
                  if (tab.kind !== "terminal" && tab.kind !== "sidechat") {
                    onOpenView(viewFromTab(tab));
                  }
                }}
                onClose={() => closeTab(tab.id)}
              />
            ))}
          </div>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[color:var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="新建 Workbench tab"
            title="新建 Workbench tab"
            data-testid="workbench-create-tab"
            onClick={() => setCreateMenuOpen((value) => !value)}
          >
            <Plus size={15} />
          </button>
          {createMenuOpen ? (
            <WorkbenchCreateMenu
              recommendations={recommendations}
              onOpenView={openWorkbenchTab}
              onOpenTerminal={() => openLocalTab(terminalTab())}
            />
          ) : null}
        </header>

        <div className="min-h-0 w-full max-w-full flex-1 overflow-auto">
          {activeTab.kind === "home" && (
            <OverviewPanel
              agentId={agentId}
              progress={progress}
              contract={contract}
              streaming={streaming}
              browserSnapshot={browserSnapshot}
              cwd={cwd}
              stats={stats}
              budgetStatus={budgetStatus}
              providerLabel={providerLabel}
              modelLabel={modelLabel}
              thinkingLabel={thinkingLabel}
              runtimeProfile={runtimeProfile}
              toolsCount={toolsCount}
              pendingFileCount={pendingFileCount}
              pendingImageCount={pendingImageCount}
              recommendations={recommendations}
              onOpenView={openWorkbenchTab}
              onAbort={onAbort}
              onOpenTerminal={() => openLocalTab(terminalTab())}
            />
          )}
          {activeTab.kind === "progress" && (
            <ProgressDetail
              progress={progress}
              streaming={streaming}
              onAbort={onAbort}
              onOpenUrl={onOpenProgressUrl}
            />
          )}
          {activeTab.kind === "outputs" && (
            <OutputsDetail
              artifacts={progress?.artifacts ?? []}
              onOpenView={openWorkbenchTab}
            />
          )}
          {activeTab.kind === "files" && (
            <div className="h-full min-h-0">
              <FileBrowser
                initialPath={cwd || "/"}
                initialFile={activeTab.path}
                onClose={() => closeTab(activeTab.id)}
                onPickPath={onPickPath}
                onLayoutChange={onFilesLayoutChange}
              />
            </div>
          )}
          {activeTab.kind === "context" && (
            <ContextDetail
              cwd={cwd}
              agentId={agentId}
              runtimeIdentity={runtimeIdentity}
              stats={stats}
              budgetStatus={budgetStatus}
              providerLabel={providerLabel}
              modelLabel={modelLabel}
              thinkingLabel={thinkingLabel}
              runtimeProfile={runtimeProfile}
              toolsCount={toolsCount}
              pendingFileCount={pendingFileCount}
              pendingImageCount={pendingImageCount}
            />
          )}
          {activeTab.kind === "team" && (
            <TeamPlanDetail
              agentId={agentId}
              contract={contract}
              onPrepareTeamWorkflow={onPrepareTeamWorkflow}
            />
          )}
          {activeTab.kind === "browser" && !activeTab.url && (
            <BrowserLauncherPanel
              recommendations={recommendations}
              browserSnapshot={browserSnapshot}
              onOpenView={openWorkbenchTab}
            />
          )}
          {activeTab.kind === "browser" && activeTab.url && (
            <BrowserPanel
              agentId={agentId}
              runtimeIdentity={runtimeIdentity}
              snapshot={browserSnapshot}
              width={width}
              openRequest={browserOpenRequest}
              onClose={() => closeTab(activeTab.id)}
              onAnnotate={onAnnotate}
            />
          )}
          {activeTab.kind === "terminal" && <TerminalLauncherPanel cwd={cwd} />}
          {activeTab.kind === "sidechat" && <SidechatPlaceholder />}
        </div>
      </aside>
    </>
  );
}

function WorkbenchTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: WorkbenchTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const Icon = tabIcon(tab.kind);
  return (
    <div
      className="group inline-flex h-7 max-w-[150px] shrink-0 items-center rounded border"
      style={{
        borderColor: active ? "var(--border)" : "transparent",
        background: active ? "var(--bg-selected)" : "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
      }}
      data-testid={`workbench-tab-${tab.kind}`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-token-xs"
        title={tab.subtitle ? `${tab.title}\n${tab.subtitle}` : tab.title}
      >
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{tab.title}</span>
      </button>
      {tab.closable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded opacity-0 hover:bg-[color:var(--bg-hover)] group-hover:opacity-100"
          aria-label={`关闭 ${tab.title}`}
          title={`关闭 ${tab.title}`}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

function WorkbenchCreateMenu({
  recommendations,
  onOpenView,
  onOpenTerminal,
}: {
  recommendations: WorkbenchRecommendation[];
  onOpenView: (view: WorkbenchView) => void;
  onOpenTerminal: () => void;
}) {
  return (
    <div
      className="absolute right-2 top-9 z-20 w-[280px] rounded border p-2 shadow-xl"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-panel)",
        color: "var(--text)",
      }}
      data-testid="workbench-create-menu"
    >
      <div className="space-y-1">
        <CreateMenuButton
          icon={<FolderOpen size={14} />}
          label="文件"
          shortcut="⌘P"
          onClick={() => onOpenView({ type: "files" })}
        />
        <CreateMenuButton
          icon={<Globe size={14} />}
          label="浏览器"
          shortcut="⌘T"
          onClick={() => onOpenView({ type: "browser" })}
        />
        <CreateMenuButton
          icon={<Terminal size={14} />}
          label="命令参考"
          shortcut="只读"
          onClick={onOpenTerminal}
        />
        <CreateMenuButton
          icon={<LayoutDashboard size={14} />}
          label="概览"
          onClick={() => onOpenView({ type: "overview" })}
        />
        <CreateMenuButton
          icon={<Boxes size={14} />}
          label="Team"
          onClick={() => onOpenView({ type: "team" })}
        />
        <CreateMenuButton
          icon={<MessageSquare size={14} />}
          label="侧边聊天"
          hint="即将支持"
          disabled
        />
      </div>
      <div className="my-2 h-px" style={{ background: "var(--border-soft)" }} />
      <div className="px-1 pb-1 text-token-xs font-medium" style={{ color: "var(--text-muted)" }}>
        推荐
      </div>
      <div className="max-h-56 space-y-1 overflow-auto">
        {recommendations.slice(0, 6).map((item) => (
          <RecommendationButton
            key={item.id}
            item={item}
            compact
            onOpenView={onOpenView}
          />
        ))}
      </div>
    </div>
  );
}

function CreateMenuButton({
  icon,
  label,
  shortcut,
  hint,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={hint}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
        disabled
          ? "cursor-not-allowed opacity-55"
          : "hover:bg-[color:var(--bg-hover)]"
      }`}
      data-testid={`workbench-create-${label}`}
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded" style={{ background: "var(--bg-selected)", color: "var(--accent)" }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? (
        <span className="text-token-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      ) : shortcut ? (
        <span className="text-token-xs" style={{ color: "var(--text-muted)" }}>
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

function WorkbenchHomeLauncher({
  recommendations,
  onOpenView,
  onOpenTerminal,
}: {
  recommendations: WorkbenchRecommendation[];
  onOpenView: (view: WorkbenchView) => void;
  onOpenTerminal: () => void;
}) {
  const gridStyle: CSSProperties = {
    display: "grid",
    gap: 6,
    gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
  };
  return (
    <section className="w-full min-w-0 max-w-full space-y-2" data-testid="workbench-home-launcher">
      <div className="w-full min-w-0 max-w-full" style={gridStyle}>
        <LauncherTile
          icon={<FolderOpen size={18} />}
          title="文件"
          body="浏览项目文件"
          onClick={() => onOpenView({ type: "files" })}
        />
        <LauncherTile
          icon={<Globe size={18} />}
          title="浏览器"
          body="打开本地项目"
          onClick={() => onOpenView({ type: "browser" })}
        />
        <LauncherTile
          icon={<Terminal size={18} />}
          title="命令参考"
          body="查看常用命令"
          onClick={onOpenTerminal}
        />
        <LauncherTile
          icon={<LayoutDashboard size={18} />}
          title="概览"
          body="查看 session 摘要"
          onClick={() => onOpenView({ type: "overview" })}
        />
        <LauncherTile
          icon={<Boxes size={18} />}
          title="Team"
          body="查看协作计划"
          onClick={() => onOpenView({ type: "team" })}
        />
      </div>
      <div className="space-y-1">
        <div className="px-1 text-token-xs font-medium" style={{ color: "var(--text-muted)" }}>
          推荐
        </div>
        {recommendations.length > 0 ? (
          recommendations.slice(0, 5).map((item) => (
            <RecommendationButton
              key={item.id}
              item={item}
              onOpenView={onOpenView}
            />
          ))
        ) : (
          <div
            className="rounded border px-2 py-2 text-xs"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
          >
            暂无可推荐的文件或本地网页
          </div>
        )}
      </div>
    </section>
  );
}

function LauncherTile({
  icon,
  title,
  body,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden rounded border px-2 py-2 text-left hover:bg-[color:var(--bg-hover)]"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-app)" }}
      data-testid={`workbench-launch-${title}`}
    >
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ background: "var(--bg-selected)", color: "var(--accent)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block w-full truncate text-token-xs font-medium">
          {title}
        </span>
        <span
          className="block w-full truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          title={body}
        >
          {body}
        </span>
      </span>
    </button>
  );
}

function RecommendationButton({
  item,
  compact,
  onOpenView,
}: {
  item: WorkbenchRecommendation;
  compact?: boolean;
  onOpenView: (view: WorkbenchView) => void;
}) {
  const Icon = item.kind === "url" ? Globe : item.kind === "file" ? FileText : Boxes;
  return (
    <button
      type="button"
      onClick={() => {
        if (item.kind === "url" && item.href) {
          onOpenView({ type: "browser", url: item.href });
        } else {
          onOpenView({ type: "files", path: item.href });
        }
      }}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[color:var(--bg-hover)]"
      title={item.href ?? item.subtitle}
      data-testid={`workbench-recommendation-${item.kind}`}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded" style={{ background: "var(--bg-selected)", color: "var(--text-muted)" }}>
        <Icon size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.title}</span>
        {!compact ? (
          <span className="block truncate text-token-xs" style={{ color: "var(--text-muted)" }}>
            {item.subtitle}
          </span>
        ) : null}
      </span>
      {item.kind === "url" ? (
        <ExternalLink size={12} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      ) : null}
    </button>
  );
}

function BrowserLauncherPanel({
  recommendations,
  browserSnapshot,
  onOpenView,
}: {
  recommendations: WorkbenchRecommendation[];
  browserSnapshot: BrowserSnapshot;
  onOpenView: (view: WorkbenchView) => void;
}) {
  const browserRecommendations = recommendations.filter((item) => item.kind === "url");
  return (
    <div className="space-y-3 p-2.5" data-testid="workbench-browser-launcher">
      <EmptyDetail
        title="选择要打开的浏览器目标"
        body="这里优先展示当前 session 已知的本地项目 URL，避免默认嵌套打开 Shaula 自身页面。"
      />
      <button
        type="button"
        onClick={() => onOpenView({ type: "browser", url: "about:blank" })}
        className="flex w-full items-center gap-2 rounded border px-2 py-2 text-left hover:bg-[color:var(--bg-hover)]"
        style={{ borderColor: "var(--border-soft)", background: "var(--bg-panel-2)" }}
        data-testid="workbench-open-blank-browser"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded" style={{ background: "var(--bg-selected)", color: "var(--accent)" }}>
          <Globe size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">打开空白页</span>
          <span className="block text-token-xs" style={{ color: "var(--text-muted)" }}>
            进入可接管的 in-app browser
          </span>
        </span>
      </button>
      {browserSnapshot.url && isCurrentAppRootUrl(browserSnapshot.url) ? (
        <div
          className="rounded border px-2 py-1.5 text-xs"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
        >
          当前浏览器 URL 是 Shaula 自身，已从默认推荐里过滤。
        </div>
      ) : null}
      {browserRecommendations.length > 0 ? (
        <div className="space-y-1">
          {browserRecommendations.map((item) => (
            <RecommendationButton key={item.id} item={item} onOpenView={onOpenView} />
          ))}
        </div>
      ) : (
        <div
          className="rounded border px-3 py-4 text-xs"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
        >
          暂无本地网页推荐。让 agent 打开一个页面，或从产物里生成 URL 后会出现在这里。
        </div>
      )}
    </div>
  );
}

function TerminalLauncherPanel({ cwd }: { cwd: string }) {
  const commands = ["npm run dev", "npm run test", "npx tsc --noEmit", "npx eslint ."];
  return (
    <div className="space-y-3 p-2.5" data-testid="workbench-terminal-detail">
      <EmptyDetail
        title="命令参考"
        body="这里不会直接启动终端，只展示常用命令。需要执行时，把命令发给 Shaula。"
      />
      <div className="space-y-1">
        <div className="px-1 text-token-xs" style={{ color: "var(--text-muted)" }}>
          cwd: {cwd || "n/a"}
        </div>
        {commands.map((command) => (
          <div
            key={command}
            className="rounded border px-2 py-1.5 font-mono text-xs"
            style={{ borderColor: "var(--border-soft)", background: "var(--bg-panel-2)" }}
          >
            {command}
          </div>
        ))}
      </div>
    </div>
  );
}

function SidechatPlaceholder() {
  return (
    <div className="p-2.5" data-testid="workbench-sidechat-detail">
      <EmptyDetail
        title="侧边聊天即将支持"
        body="后续会围绕当前文件或网页提供局部对话。v1 暂不做半成品输入流。"
      />
    </div>
  );
}

function OverviewPanel({
  agentId,
  progress,
  contract,
  streaming,
  browserSnapshot,
  cwd,
  stats,
  budgetStatus,
  providerLabel,
  modelLabel,
  thinkingLabel,
  runtimeProfile,
  toolsCount,
  pendingFileCount,
  pendingImageCount,
  recommendations,
  onOpenView,
  onAbort,
  onOpenTerminal,
}: {
  agentId: string | null;
  progress: AgentProgress | null;
  contract: ExecutionContractSummary | null;
  streaming: boolean;
  browserSnapshot: BrowserSnapshot;
  cwd: string;
  stats: StatsSnapshot | null;
  budgetStatus: BudgetStatus;
  providerLabel: string;
  modelLabel: string;
  thinkingLabel: string;
  runtimeProfile: AgentRuntimeProfile | null;
  toolsCount: number;
  pendingFileCount: number;
  pendingImageCount: number;
  recommendations: WorkbenchRecommendation[];
  onOpenView: (view: WorkbenchView) => void;
  onAbort?: () => Promise<void> | void;
  onOpenTerminal: () => void;
}) {
  const progressSummary = summarizeProgress(progress);
  const artifacts = progress?.artifacts ?? [];
  const artifactSummary = summarizeArtifacts(artifacts);
  const contextPct =
    stats?.ctxPct != null ? `${(stats.ctxPct * 100).toFixed(1)}%` : "n/a";
  const budgetTriggered = budgetStatus.triggered.length > 0;
  const browserAnnotations = browserSnapshot.annotations ?? [];
  const progressGroups = normalizedGroups(progress);
  const progressSteps = progressGroups.at(-1)?.steps ?? [];
  const progressCockpit = summarizeProgressCockpit(progress, contract, streaming);
  const browserStatus = describeBrowserStatus(browserSnapshot);
  const hasProgressContent = progressSteps.length > 0;
  const hasOutputContent = artifacts.length > 0;
  const hasFilesContent = pendingFileCount + pendingImageCount > 0;
  const hasContextContent =
    toolsCount > 0 || stats?.ctxPct != null || budgetTriggered;
  const hasBrowserContent =
    Boolean(browserSnapshot.url) ||
    browserAnnotations.length > 0 ||
    browserSnapshot.status === "ready" ||
    browserSnapshot.status === "busy" ||
    browserSnapshot.status === "error";
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    progress: hasProgressContent,
    outputs: hasOutputContent,
    files: hasFilesContent,
    context: hasContextContent,
    browser: hasBrowserContent,
  });
  const progressOpen = expanded.progress || hasProgressContent || streaming;
  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    // 概览面板根容器 —— 开启 CSS Container Queries，让里面的子组件能
    // 按 workbench 面板自身的宽度响应，而不是跟 viewport。
    // 这里用 inline-style 设 container-type/name，避免给 Tailwind 加插件。
    <div
      className="w-full min-w-0 max-w-full space-y-2 overflow-hidden px-2 py-2"
      style={{
        containerType: "inline-size",
        containerName: "workbench-overview",
      }}
      data-testid="workbench-overview"
    >
      <TaskCockpitCard
        summary={progressCockpit}
        browserStatus={browserStatus.short}
        streaming={streaming}
        onAbort={onAbort}
        onOpenProgress={() => onOpenView({ type: "progress" })}
      />

      <GoalStateStrip
        agentId={agentId}
        contract={contract}
        progress={progress}
        streaming={streaming}
      />

      <WorkbenchHomeLauncher
        recommendations={recommendations}
        onOpenView={onOpenView}
        onOpenTerminal={onOpenTerminal}
      />

      <OverviewSection
        id="progress"
        icon={<Clock size={13} />}
        title="进度"
        summary={progressSummary.badge ?? "idle"}
        open={progressOpen}
        onToggle={() => toggle("progress")}
        actionLabel="详情"
        onAction={() => onOpenView({ type: "progress" })}
      >
        <OverviewLine
          primary={progressSummary.primary}
          secondary={progressSummary.secondary}
          tone={progressSummary.tone}
        />
        {progressSteps.length > 0 ? (
          <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
            {progressSteps.slice(0, 4).map((step) => (
              <div
                key={step.id}
                className="py-1.5 first:pt-0 last:pb-0"
                style={{ borderColor: "var(--border-soft)" }}
              >
                <OverviewLine
                  primary={step.title}
                  checked={step.status === "completed"}
                  struck={step.status === "completed"}
                  tone={step.status === "running" ? "running" : step.status === "failed" || step.status === "blocked" ? "error" : undefined}
                />
              </div>
            ))}
          </div>
        ) : null}
      </OverviewSection>

      <OverviewSection
        id="outputs"
        icon={<Boxes size={13} />}
        title="输出"
        summary={artifacts.length > 0 ? String(artifacts.length) : "0"}
        open={expanded.outputs}
        onToggle={() => toggle("outputs")}
        actionLabel="详情"
        onAction={() => onOpenView({ type: "outputs" })}
      >
        <OverviewLine
          primary={`${artifacts.length} 个产物`}
          secondary={artifactSummary || "暂无产物"}
        />
        {artifacts.slice(0, 5).map((artifact) => (
          <OverviewArtifactButton
            key={artifact.id}
            artifact={artifact}
            onOpenView={onOpenView}
          />
        ))}
      </OverviewSection>

      <OverviewSection
        id="files"
        icon={<FolderOpen size={13} />}
        title="文件"
        summary={`${pendingFileCount + pendingImageCount}`}
        open={expanded.files}
        onToggle={() => toggle("files")}
        actionLabel="打开"
        onAction={() => onOpenView({ type: "files" })}
      >
        <OverviewLine
          primary={cwd.split("/").pop() || cwd || "Workspace"}
          secondary={`附件 ${pendingFileCount} · 图片 ${pendingImageCount}`}
        />
      </OverviewSection>

      <OverviewSection
        id="context"
        icon={<FileText size={13} />}
        title="上下文"
        summary={contextPct}
        open={expanded.context}
        onToggle={() => toggle("context")}
        actionLabel="详情"
        onAction={() => onOpenView({ type: "context" })}
      >
        <OverviewLine
          primary={`${modelLabel || providerLabel || "Model"} · ${thinkingLabel}`}
          secondary={`${runtimeProfile?.label ?? "SDK-backed agent"} · Context ${contextPct} · Tools ${toolsCount}${
            budgetTriggered ? " · Budget hit" : ""
          }`}
          tone={budgetTriggered ? "error" : undefined}
        />
      </OverviewSection>

      <OverviewSection
        id="browser"
        icon={<Globe size={13} />}
        title="浏览器"
        summary={browserStatus.short}
        open={expanded.browser}
        onToggle={() => toggle("browser")}
        actionLabel="打开"
        onAction={() => onOpenView({ type: "browser" })}
      >
        <OverviewLine
          primary={browserSnapshot.title ?? browserStatus.title}
          secondary={
            browserSnapshot.url ??
            `${browserStatus.detail} · ${browserAnnotations.length} annotations`
          }
          tone={browserSnapshot.status === "error" ? "error" : browserSnapshot.status === "busy" ? "running" : undefined}
        />
      </OverviewSection>
    </div>
  );
}

function TaskCockpitCard({
  summary,
  browserStatus,
  streaming,
  onAbort,
  onOpenProgress,
}: {
  summary: ProgressCockpitSummary;
  browserStatus: string;
  streaming: boolean;
  onAbort?: () => Promise<void> | void;
  onOpenProgress: () => void;
}) {
  const pctLabel = `${summary.percent}%`;
  return (
    <section
      className="overflow-hidden rounded border"
      style={{
        borderColor: "var(--border)",
        background: "linear-gradient(180deg, var(--bg-panel), var(--bg-app))",
      }}
      data-testid="workbench-task-cockpit"
    >
      <div className="space-y-3 p-3">
        <div className="flex items-start gap-2">
          <span
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded"
            style={{
              background: summary.tone === "error" ? "var(--color-danger-bg)" : "var(--bg-selected)",
              color: summary.tone === "error" ? "var(--color-danger)" : "var(--accent)",
            }}
          >
            <Clock size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="truncate text-token-xs font-medium uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                当前任务
              </div>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-token-xs"
                style={{
                  background:
                    summary.tone === "running"
                      ? "var(--color-warning-bg)"
                      : summary.tone === "error"
                        ? "var(--color-danger-bg)"
                        : "var(--bg-selected)",
                  color:
                    summary.tone === "running"
                      ? "var(--color-warning)"
                      : summary.tone === "error"
                        ? "var(--color-danger)"
                        : "var(--text-muted)",
                }}
              >
                {summary.statusLabel}
              </span>
              <span
                className="min-w-0 truncate rounded px-1.5 py-0.5 text-token-xs"
                style={{ background: "var(--bg-selected)", color: "var(--text-muted)" }}
                title={`任务契约：${summary.contractLabel}`}
              >
                {summary.contractLabel}
              </span>
            </div>
            <div
              className="mt-1 line-clamp-2 text-sm font-semibold leading-snug"
              style={{ color: "var(--text)" }}
              title={summary.title}
            >
              {summary.title}
            </div>
            <div
              className="mt-1 line-clamp-2 text-token-xs leading-relaxed"
              style={{ color: "var(--text-muted)" }}
              title={summary.detail}
            >
              {summary.detail}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-token-xs">
            <span style={{ color: "var(--text-muted)" }}>完成度</span>
            <span className="font-mono" style={{ color: "var(--text)" }}>
              {summary.completed}/{summary.total || 1} · {pctLabel}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: "var(--bg-selected)" }}
            aria-label={`任务完成度 ${pctLabel}`}
          >
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${summary.percent}%`,
                background:
                  summary.tone === "error"
                    ? "var(--color-danger)"
                    : summary.tone === "running"
                      ? "var(--color-warning)"
                      : "var(--accent)",
              }}
            />
          </div>
        </div>

        {summary.steps.length > 0 ? (
          <div className="space-y-1">
            {summary.steps.slice(0, 4).map((step) => {
              const stepTitle = shortDisplayText(step.title, 96);
              return (
                <div
                  key={step.id}
                  className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-token-xs"
                  style={{
                    background:
                      step.status === "running" ? "var(--color-warning-bg)" : "transparent",
                    color: "var(--text-muted)",
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background:
                        step.status === "completed"
                          ? "var(--accent)"
                          : step.status === "running"
                            ? "var(--color-warning)"
                            : step.status === "failed" || step.status === "blocked"
                              ? "var(--color-danger)"
                              : "var(--border)",
                    }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ color: step.status === "running" ? "var(--text)" : undefined }}
                    title={stepTitle}
                  >
                    {stepTitle}
                  </span>
                  <span className="shrink-0">{stepStatusLabel(step.status)}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-1.5">
          <CockpitMetric label="步骤" value={summary.total ? `${summary.completed}/${summary.total}` : "0/1"} />
          <CockpitMetric label="主产物" value={summary.artifactLabel} />
          <CockpitMetric label="证据" value={summary.evidenceLabel} />
          <CockpitMetric label="浏览器" value={browserStatus} />
        </div>
      </div>
      <div
        className="flex items-center justify-between gap-2 border-t px-3 py-2"
        style={{ borderColor: "var(--border-soft)" }}
      >
        <button
          type="button"
          onClick={onOpenProgress}
          className="rounded px-2 py-1 text-token-xs font-medium hover:bg-[color:var(--bg-hover)]"
          style={{ color: "var(--accent)" }}
        >
          查看详细进度
        </button>
        {streaming && onAbort ? (
          <AbortTaskButton testId="workbench-progress-stop" onAbort={onAbort} />
        ) : null}
      </div>
    </section>
  );
}

function GoalStateStrip({
  agentId,
  contract,
  progress,
  streaming,
}: {
  agentId: string | null;
  contract: ExecutionContractSummary | null;
  progress: AgentProgress | null;
  streaming: boolean;
}) {
  const [payload, setPayload] = useState<WorkbenchGoalStatePayload | null>(null);
  const progressUpdatedAt = progress?.updatedAt ?? 0;

  useEffect(() => {
    if (!agentId) {
      queueMicrotask(() => setPayload(null));
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/agent/${agentId}?action=goal_timeline`);
        if (!res.ok) return;
        const json = (await res.json()) as Partial<WorkbenchGoalStatePayload>;
        if (cancelled) return;
        setPayload({
          goal: json.goal ?? null,
          contract: json.contract ?? null,
          ledgerEvidence: Array.isArray(json.ledgerEvidence)
            ? json.ledgerEvidence
            : [],
          lastClosure: json.lastClosure ?? null,
          routeDecision: json.routeDecision ?? null,
          teamTasks: Array.isArray(json.teamTasks) ? json.teamTasks : [],
          teamTaskVerification: json.teamTaskVerification ?? null,
          teamTaskSynthesis: json.teamTaskSynthesis ?? null,
        });
      } catch {
        if (!cancelled) setPayload(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, contract?.id, progressUpdatedAt, streaming]);

  const summary = summarizeGoalState({
    payload,
    contract,
    progress,
    streaming,
  });
  const modeSummary = summarizeExecutionMode(payload?.routeDecision);
  const teamTaskSummary = summarizeTeamTasks(
    payload?.teamTasks ?? [],
    payload?.teamTaskVerification ?? null
  );
  if (!summary) return null;

  const StatusIcon =
    summary.tone === "done"
      ? CheckCircle2
      : summary.tone === "error" || summary.tone === "warning"
        ? AlertTriangle
        : Target;
  const color = goalStateToneColor(summary.tone);
  const objectiveLabel = shortDisplayText(summary.objective, 18);

  return (
    <section
      className="overflow-hidden rounded border p-2.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-panel)",
      }}
      data-testid="workbench-goal-state"
    >
      <div className="mb-2 flex min-w-0 items-start gap-2">
        <StatusIcon
          size={15}
          className="mt-0.5 shrink-0"
          style={{ color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-token-xs font-medium"
              style={{
                background: "var(--bg-selected)",
                color,
              }}
              data-testid="workbench-goal-state-status"
            >
              {summary.statusLabel}
            </span>
            <span
              className="min-w-0 truncate text-token-xs"
              style={{ color: "var(--text-muted)" }}
              title={summary.artifact}
              data-testid="workbench-goal-state-artifact"
            >
              {summary.artifact}
            </span>
          </div>
          <div
            className="mt-1 line-clamp-2 text-sm font-medium leading-snug"
            title={summary.objective}
            data-testid="workbench-goal-state-objective"
          >
            {objectiveLabel}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <GoalStateMetric
          label="Required"
          value={summary.requiredLabel}
          testId="workbench-goal-state-required"
        />
        <GoalStateMetric
          label="Verified"
          value={summary.verifiedLabel}
          testId="workbench-goal-state-verified"
        />
        <GoalStateMetric
          label="Missing"
          value={summary.missingLabel}
          tone={summary.missing.length > 0 ? "warning" : "done"}
          testId="workbench-goal-state-missing"
        />
      </div>

      {modeSummary ? <ExecutionModeMiniStrip summary={modeSummary} /> : null}
      {teamTaskSummary ? <TeamTaskMiniStrip summary={teamTaskSummary} /> : null}

      {summary.detail && (
        <div
          className="mt-2 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          title={summary.detail}
        >
          {summary.detail}
        </div>
      )}
    </section>
  );
}

interface TeamTaskSummary {
  total: number;
  running: number;
  warning: number;
  failed: number;
  completed: number;
  evidenceRefs: number;
  latestTitle: string;
  tone: "running" | "warning" | "done";
  verification?: TeamTaskVerificationSummary | null;
}

function summarizeTeamTasks(
  tasks: TeamTask[],
  verification: TeamTaskVerificationSummary | null
): TeamTaskSummary | null {
  if (tasks.length === 0) return null;
  const running = tasks.filter((task) => task.status === "running").length;
  const warning = tasks.filter((task) => task.status === "warning").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const evidenceRefs = new Set(tasks.flatMap((task) => task.evidenceIds)).size;
  const latest = tasks
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0];
  return {
    total: tasks.length,
    running,
    warning,
    failed,
    completed,
    evidenceRefs,
    latestTitle: latest?.title ?? "Team task",
    tone:
      verification?.status === "failed" ||
      verification?.status === "warning" ||
      failed ||
      warning
        ? "warning"
        : running
          ? "running"
          : "done",
    verification,
  };
}

function TeamTaskMiniStrip({ summary }: { summary: TeamTaskSummary }) {
  const color =
    summary.tone === "warning"
      ? "var(--color-warning)"
      : summary.tone === "running"
        ? "var(--accent)"
        : "var(--color-success)";
  const statusLabel =
    summary.verification?.status === "failed"
      ? "verification failed"
      : summary.verification?.status === "warning"
        ? "verification warning"
        : summary.failed > 0
      ? `${summary.failed} failed`
      : summary.warning > 0
        ? `${summary.warning} warning`
        : summary.running > 0
          ? `${summary.running} running`
          : `${summary.completed}/${summary.total} done`;
  return (
    <div
      className="mt-2 rounded border px-2 py-1.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-selected)",
      }}
      data-testid="workbench-team-tasks"
      title={summary.latestTitle}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-token-xs font-medium"
          style={{ background: "var(--bg-panel)", color }}
          data-testid="workbench-team-tasks-status"
        >
          Team tasks
        </span>
        <span
          className="min-w-0 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          data-testid="workbench-team-tasks-detail"
        >
          {statusLabel} · {summary.evidenceRefs} evidence refs
        </span>
      </div>
      <div
        className="mt-1 truncate text-token-xs"
        style={{ color: "var(--text-muted)" }}
        title={summary.verification?.summary ?? summary.latestTitle}
      >
        {summary.verification?.summary ?? summary.latestTitle}
      </div>
    </div>
  );
}

type TeamPlanTemplateMode = "readonly" | "worktree";
const DEFAULT_TEAM_PLAN_REVIEW_SUBJECT = "Review the current implementation";
const DEFAULT_TEAM_PLAN_IMPLEMENTATION_PROMPT =
  "Implement the requested change in an isolated worktree.";

function TeamPlanDetail({
  agentId,
  contract,
  onPrepareTeamWorkflow,
}: {
  agentId: string | null;
  contract: ExecutionContractSummary | null;
  onPrepareTeamWorkflow?: (prompt: string) => void;
}) {
  const [payload, setPayload] = useState<WorkbenchGoalStatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) {
      setPayload(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/${agentId}?action=goal_timeline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Partial<WorkbenchGoalStatePayload>;
      setPayload({
        goal: json.goal ?? null,
        contract: json.contract ?? null,
        ledgerEvidence: Array.isArray(json.ledgerEvidence)
          ? json.ledgerEvidence
          : [],
        lastClosure: json.lastClosure ?? null,
        routeDecision: json.routeDecision ?? null,
        teamTasks: Array.isArray(json.teamTasks) ? json.teamTasks : [],
        teamTaskVerification: json.teamTaskVerification ?? null,
        teamTaskSynthesis: json.teamTaskSynthesis ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = payload?.teamTasks ?? [];
  const verification = payload?.teamTaskVerification ?? null;
  const synthesis = payload?.teamTaskSynthesis ?? null;
  const evidenceById = useMemo(
    () => new Map((payload?.ledgerEvidence ?? []).map((item) => [item.id, item])),
    [payload?.ledgerEvidence]
  );
  const summary = summarizeTeamTasks(tasks, verification);

  return (
    <div
      className="h-full min-h-0 space-y-2 overflow-auto px-2 py-2"
      data-testid="workbench-team-plan"
    >
      <section
        className="rounded border p-3"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        <div className="flex min-w-0 items-start gap-2">
          <Boxes
            size={16}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--accent)" }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Team Plan</div>
            <div
              className="mt-0.5 truncate text-token-xs"
              style={{ color: "var(--text-muted)" }}
              title={payload?.contract?.objective ?? payload?.goal?.objective}
            >
              {payload?.contract?.objective ?? payload?.goal?.objective ?? "No active goal"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded px-2 py-1 text-token-xs hover:bg-[color:var(--bg-hover)]"
            style={{ color: "var(--accent)" }}
            disabled={loading}
          >
            {loading ? "刷新中" : "刷新"}
          </button>
        </div>

        {error ? (
          <div
            className="mt-2 rounded px-2 py-1.5 text-token-xs"
            style={{
              color: "var(--color-danger)",
              background: "var(--bg-selected)",
            }}
          >
            {error}
          </div>
        ) : null}

        {summary ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <GoalStateMetric
              label="Tasks"
              value={String(summary.total)}
              testId="workbench-team-plan-count"
            />
            <GoalStateMetric
              label="Status"
              value={verification?.status ?? summary.tone}
              tone={
                verification?.status === "passed" || summary.tone === "done"
                  ? "done"
                  : "warning"
              }
              testId="workbench-team-plan-status"
            />
            <GoalStateMetric
              label="Evidence"
              value={String(summary.evidenceRefs)}
              testId="workbench-team-plan-evidence"
            />
          </div>
        ) : (
          <div
            className="mt-3 rounded border px-2 py-2 text-token-xs"
            style={{
              borderColor: "var(--border-soft)",
              color: "var(--text-muted)",
            }}
          >
            暂无 Team task。普通 single-agent 任务不会强制创建 Team Plan。
          </div>
        )}
      </section>

      <TeamPlanTemplateEditor
        contract={payload?.contract ?? contract}
        onPrepareTeamWorkflow={onPrepareTeamWorkflow}
      />

      {verification ? (
        <section
          className="rounded border p-2.5"
          style={{
            borderColor: "var(--border-soft)",
            background: "var(--bg-panel)",
          }}
          data-testid="workbench-team-plan-verification"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <span
              className="rounded px-1.5 py-0.5 text-token-xs font-medium"
              style={{
                background: "var(--bg-selected)",
                color: teamPlanVerificationColor(verification.status),
              }}
            >
              {verification.status}
            </span>
            <span className="min-w-0 truncate text-token-xs" title={verification.summary}>
              {verification.summary}
            </span>
          </div>
          <div className="space-y-1">
            {verification.checks.slice(0, 8).map((check) => (
              <div
                key={check.id}
                className="rounded px-2 py-1.5"
                style={{ background: "var(--bg-selected)" }}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="shrink-0 rounded px-1 py-0.5 text-token-xs"
                    style={{
                      color: teamPlanVerificationColor(check.status),
                      background: "var(--bg-panel)",
                    }}
                  >
                    {check.status}
                  </span>
                  <span className="min-w-0 truncate text-token-xs font-medium">
                    {check.id}
                  </span>
                </div>
                <div
                  className="mt-0.5 line-clamp-2 text-token-xs"
                  style={{ color: "var(--text-muted)" }}
                  title={check.message}
                >
                  {check.message}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {synthesis ? (
        <TeamPlanSynthesis
          agentId={agentId}
          synthesis={synthesis}
          onRefresh={load}
        />
      ) : null}

      <section className="space-y-2">
        {tasks.map((task) => (
          <TeamPlanTaskCard
            key={task.id}
            task={task}
            evidenceById={evidenceById}
          />
        ))}
      </section>
    </div>
  );
}

function TeamPlanTemplateEditor({
  contract,
  onPrepareTeamWorkflow,
}: {
  contract: ExecutionContractSummary | null;
  onPrepareTeamWorkflow?: (prompt: string) => void;
}) {
  const contractObjective = contract?.objective?.trim();
  const [mode, setMode] = useState<TeamPlanTemplateMode>("readonly");
  const [subject, setSubject] = useState(
    contractObjective || DEFAULT_TEAM_PLAN_REVIEW_SUBJECT
  );
  const [questions, setQuestions] = useState(
    "What correctness risks remain?\nWhat evidence is missing?\nAre there conflicting conclusions?"
  );
  const [implementationPrompt, setImplementationPrompt] = useState(
    contractObjective || DEFAULT_TEAM_PLAN_IMPLEMENTATION_PROMPT
  );
  const [verificationPrompt, setVerificationPrompt] = useState(
    "Review the produced diff for correctness, missing tests, regressions, and unsupported claims."
  );
  const [requestMerge, setRequestMerge] = useState(false);

  useEffect(() => {
    if (!contractObjective) return;
    setSubject((current) =>
      current === DEFAULT_TEAM_PLAN_REVIEW_SUBJECT ? contractObjective : current
    );
    setImplementationPrompt((current) =>
      current === DEFAULT_TEAM_PLAN_IMPLEMENTATION_PROMPT
        ? contractObjective
        : current
    );
  }, [contractObjective]);

  const preparedPrompt = useMemo(
    () =>
      buildTeamWorkflowPrompt({
        mode,
        subject,
        questions,
        implementationPrompt,
        verificationPrompt,
        requestMerge,
      }),
    [implementationPrompt, mode, questions, requestMerge, subject, verificationPrompt]
  );
  const disabled = !onPrepareTeamWorkflow;

  return (
    <section
      className="rounded border p-2.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-panel)",
      }}
      data-testid="workbench-team-plan-editor"
    >
      <div className="mb-2 flex min-w-0 items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-token-xs font-medium"
          style={{
            background: "var(--bg-selected)",
            color: "var(--accent)",
          }}
        >
          Prepare
        </span>
        <span
          className="min-w-0 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Team workflow preview
        </span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => setMode("readonly")}
          className="rounded px-2 py-1.5 text-token-xs"
          style={{
            background:
              mode === "readonly" ? "var(--bg-selected)" : "transparent",
            color: mode === "readonly" ? "var(--accent)" : "var(--text-muted)",
            border: "1px solid var(--border-soft)",
          }}
          data-testid="workbench-team-plan-mode-readonly"
        >
          Read-only review
        </button>
        <button
          type="button"
          onClick={() => setMode("worktree")}
          className="rounded px-2 py-1.5 text-token-xs"
          style={{
            background:
              mode === "worktree" ? "var(--bg-selected)" : "transparent",
            color: mode === "worktree" ? "var(--accent)" : "var(--text-muted)",
            border: "1px solid var(--border-soft)",
          }}
          data-testid="workbench-team-plan-mode-worktree"
        >
          Worktree implementation
        </button>
      </div>

      {mode === "readonly" ? (
        <div className="space-y-2">
          <label className="block text-token-xs">
            <span style={{ color: "var(--text-muted)" }}>Subject</span>
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="mt-1 w-full rounded border bg-transparent px-2 py-1.5 text-token-xs outline-none"
              style={{
                borderColor: "var(--border-soft)",
                color: "var(--text)",
              }}
              data-testid="workbench-team-plan-subject"
            />
          </label>
          <label className="block text-token-xs">
            <span style={{ color: "var(--text-muted)" }}>Questions</span>
            <textarea
              value={questions}
              onChange={(event) => setQuestions(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-none rounded border bg-transparent px-2 py-1.5 text-token-xs outline-none"
              style={{
                borderColor: "var(--border-soft)",
                color: "var(--text)",
              }}
              data-testid="workbench-team-plan-questions"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-token-xs">
            <span style={{ color: "var(--text-muted)" }}>Implementation</span>
            <textarea
              value={implementationPrompt}
              onChange={(event) => setImplementationPrompt(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded border bg-transparent px-2 py-1.5 text-token-xs outline-none"
              style={{
                borderColor: "var(--border-soft)",
                color: "var(--text)",
              }}
              data-testid="workbench-team-plan-implementation"
            />
          </label>
          <label className="block text-token-xs">
            <span style={{ color: "var(--text-muted)" }}>Verification</span>
            <textarea
              value={verificationPrompt}
              onChange={(event) => setVerificationPrompt(event.target.value)}
              rows={3}
              className="mt-1 w-full resize-none rounded border bg-transparent px-2 py-1.5 text-token-xs outline-none"
              style={{
                borderColor: "var(--border-soft)",
                color: "var(--text)",
              }}
              data-testid="workbench-team-plan-verification-prompt"
            />
          </label>
          <label className="flex items-center gap-2 text-token-xs">
            <input
              type="checkbox"
              checked={requestMerge}
              onChange={(event) => setRequestMerge(event.target.checked)}
              data-testid="workbench-team-plan-request-merge"
            />
            <span style={{ color: "var(--text-muted)" }}>Request merge after approval</span>
          </label>
        </div>
      )}

      <details className="mt-2">
        <summary
          className="cursor-pointer text-token-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Prompt preview
        </summary>
        <pre
          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded px-2 py-1.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
          data-testid="workbench-team-plan-prompt-preview"
        >
          {preparedPrompt}
        </pre>
      </details>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onPrepareTeamWorkflow?.(preparedPrompt)}
        className="mt-2 w-full rounded px-2 py-1.5 text-token-xs font-medium disabled:opacity-50"
        style={{
          background: "var(--accent)",
          color: "var(--bg)",
        }}
        data-testid="workbench-team-plan-prepare"
      >
        Prepare in composer
      </button>
    </section>
  );
}

function buildTeamWorkflowPrompt({
  mode,
  subject,
  questions,
  implementationPrompt,
  verificationPrompt,
  requestMerge,
}: {
  mode: TeamPlanTemplateMode;
  subject: string;
  questions: string;
  implementationPrompt: string;
  verificationPrompt: string;
  requestMerge: boolean;
}): string {
  if (mode === "readonly") {
    const parsedQuestions = questions
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    return [
      "请使用 run_workflow_template 工具执行一个受控的只读 Team review。",
      "不要把它改写成普通对话，也不要启用写入、shell、browser、network 或 worktree 能力。",
      "",
      "templateId: team-readonly-review",
      "params:",
      JSON.stringify(
        {
          subject: subject.trim() || DEFAULT_TEAM_PLAN_REVIEW_SUBJECT,
          questions:
            parsedQuestions.length > 0
              ? parsedQuestions
              : ["What correctness risks remain?"],
          requirePass: false,
        },
        null,
        2
      ),
      "",
      "完成后请只基于 workflow artifact / teamTask evidence / verifier checks 做综合，不要把 Team note 当作 test_result 或 browser_observation。",
    ].join("\n");
  }
  return [
    "请使用 run_workflow_template 工具执行一个 worktree 隔离的 Team implementation。",
    "实现必须发生在 workflow-created worktree 内；合并回主工作区必须经过 workflow merge approval。",
    "",
    "templateId: team-worktree-implementation",
    "params:",
    JSON.stringify(
      {
        objective:
          implementationPrompt.trim() ||
          DEFAULT_TEAM_PLAN_IMPLEMENTATION_PROMPT,
        implementationPrompt:
          implementationPrompt.trim() ||
          DEFAULT_TEAM_PLAN_IMPLEMENTATION_PROMPT,
        verificationPrompt:
          verificationPrompt.trim() ||
          "Review the produced diff for correctness, missing tests, regressions, and unsupported claims.",
        requestMerge,
      },
      null,
      2
    ),
    "",
    "完成后请引用 diff artifact、verification result 和 Team synthesis；不要把 worker 自述当作 deterministic test evidence。",
  ].join("\n");
}

function TeamPlanSynthesis({
  agentId,
  synthesis,
  onRefresh,
}: {
  agentId: string | null;
  synthesis: TeamTaskSynthesisSummary;
  onRefresh: () => Promise<void> | void;
}) {
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<TeamAssistUserError | null>(null);
  const hasAssistance = Boolean(synthesis.assistance);
  const requestAssist = useCallback(async () => {
    if (!agentId || assistLoading) return;
    setAssistLoading(true);
    setAssistError(null);
    try {
      const res = await fetch(`/api/agent/${agentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "team_synthesis_assist",
          force: hasAssistance,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        userError?: TeamAssistUserError;
      };
      if (!res.ok) {
        setAssistError(
          json.userError ?? {
            title: "Team assist failed",
            message: json.error ?? `HTTP ${res.status}`,
            actionLabel: "Retry",
            retryable: true,
          }
        );
        return;
      }
      await onRefresh();
    } catch (error) {
      setAssistError({
        title: "Team assist failed",
        message: error instanceof Error ? error.message : String(error),
        actionLabel: "Retry",
        retryable: true,
      });
    } finally {
      setAssistLoading(false);
    }
  }, [agentId, assistLoading, hasAssistance, onRefresh]);
  const assistMeta = synthesis.assistance
    ? teamAssistMetaText(synthesis.assistance.meta)
    : "";

  return (
    <section
      className="rounded border p-2.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-panel)",
      }}
      data-testid="workbench-team-plan-synthesis"
    >
      <div className="mb-2 flex min-w-0 items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-token-xs font-medium"
          style={{
            background: "var(--bg-selected)",
            color: teamPlanSynthesisStatusColor(synthesis.status),
          }}
        >
          Synthesis
        </span>
        <span
          className="min-w-0 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          title={synthesis.headline}
        >
          {synthesis.headline}
        </span>
        <button
          type="button"
          disabled={!agentId || assistLoading}
          onClick={() => void requestAssist()}
          className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-token-xs disabled:opacity-50"
          style={{
            background: "var(--bg-selected)",
            color: "var(--accent)",
          }}
          data-testid="workbench-team-plan-synthesis-assist"
        >
          {assistLoading
            ? hasAssistance
              ? "Refreshing..."
              : "Assisting..."
            : hasAssistance
              ? "Refresh assist"
              : "LLM assist"}
        </button>
      </div>
      {assistError ? (
        <div
          className="mb-2 rounded px-2 py-1.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--color-danger)",
          }}
          data-testid="workbench-team-plan-synthesis-assist-error"
        >
          <div className="font-medium">
            {assistError.title ?? "Team assist failed"}
          </div>
          {assistError.message ? (
            <div className="mt-0.5">{assistError.message}</div>
          ) : null}
          {assistError.actionLabel ? (
            <div className="mt-0.5" style={{ color: "var(--text-muted)" }}>
              {assistError.actionLabel}
            </div>
          ) : null}
        </div>
      ) : null}
      {synthesis.assistance ? (
        <div
          className="mb-2 rounded px-2 py-1.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color:
              synthesis.assistance.status === "accepted"
                ? "var(--accent)"
                : "var(--color-warning)",
          }}
          data-testid="workbench-team-plan-synthesis-assistance"
        >
          LLM assist: {synthesis.assistance.status}
          {assistMeta ? ` · ${assistMeta}` : ""}
          {synthesis.assistance.warnings.length > 0
            ? ` · ${synthesis.assistance.warnings[0]}`
            : ""}
        </div>
      ) : null}
      {synthesis.domains.length > 0 ? (
        <div className="mb-2 flex min-w-0 flex-wrap gap-1">
          {synthesis.domains.slice(0, 5).map((domain) => (
            <span
              key={domain}
              className="rounded px-1.5 py-0.5 text-token-xs"
              style={{
                background: "var(--bg-selected)",
                color: "var(--text-muted)",
              }}
            >
              {domain}
            </span>
          ))}
        </div>
      ) : null}
      <div className="space-y-1">
        {synthesis.items.slice(0, 6).map((item) => (
          <TeamPlanSynthesisItem key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function teamAssistMetaText(
  meta: TeamTaskSynthesisAssistanceMeta | undefined
): string {
  if (!meta || typeof meta !== "object") return "";
  const typed = meta as {
    cached?: boolean;
    model?: { provider: string; id: string; name?: string };
    latencyMs?: number;
    httpStatus?: number;
    tokenCount?: number;
    estimatedCost?: number;
  };
  const parts: string[] = [typed.cached ? "cached" : "fresh"];
  if (typed.model) parts.push(`${typed.model.provider}/${typed.model.id}`);
  if (typeof typed.latencyMs === "number") parts.push(`${typed.latencyMs}ms`);
  if (typeof typed.httpStatus === "number") parts.push(`HTTP ${typed.httpStatus}`);
  if (typeof typed.tokenCount === "number") parts.push(`${typed.tokenCount} tok`);
  if (typeof typed.estimatedCost === "number") {
    parts.push(`$${typed.estimatedCost.toFixed(4)}`);
  }
  return parts.join(" · ");
}

function TeamPlanSynthesisItem({ item }: { item: TeamTaskSynthesisItem }) {
  return (
    <div
      className="rounded px-2 py-1.5"
      style={{ background: "var(--bg-selected)" }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1 py-0.5 text-token-xs"
          style={{
            color: teamPlanSynthesisSeverityColor(item.severity),
            background: "var(--bg-panel)",
          }}
        >
          {item.kind}
        </span>
        <span className="min-w-0 truncate text-token-xs font-medium" title={item.title}>
          {item.title}
        </span>
      </div>
      {item.detail ? (
        <div
          className="mt-0.5 line-clamp-2 text-token-xs"
          style={{ color: "var(--text-muted)" }}
          title={item.detail}
        >
          {item.detail}
        </div>
      ) : null}
    </div>
  );
}

function TeamPlanTaskCard({
  task,
  evidenceById,
}: {
  task: TeamTask;
  evidenceById: Map<string, EvidenceRef>;
}) {
  return (
    <article
      className="rounded border p-2.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-panel)",
      }}
      data-testid="workbench-team-plan-task"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-token-xs font-medium"
          style={{
            background: "var(--bg-selected)",
            color: teamPlanTaskColor(task.status),
          }}
        >
          {task.status}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={task.title}>
            {task.title}
          </div>
          <div
            className="mt-0.5 truncate text-token-xs"
            style={{ color: "var(--text-muted)" }}
            title={teamPlanTaskSource(task)}
          >
            {task.ownerType}
            {task.ownerId ? `:${task.ownerId}` : ""} · {teamPlanTaskSource(task)}
          </div>
        </div>
      </div>

      {task.contextPacket?.taskBoundary ? (
        <div
          className="mt-2 line-clamp-2 rounded px-2 py-1.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
          title={task.contextPacket.taskBoundary}
        >
          {task.contextPacket.taskBoundary}
        </div>
      ) : null}

      <TeamPlanChipRow
        label="Write"
        values={task.writePaths.length > 0 ? task.writePaths : ["read-only"]}
      />
      <TeamPlanChipRow
        label="Required"
        values={task.requiredEvidence.length > 0 ? task.requiredEvidence : ["not declared"]}
      />
      <TeamPlanChipRow
        label="Evidence"
        values={
          task.evidenceIds.length > 0
            ? task.evidenceIds.map((id) => evidenceById.get(id)?.title ?? id)
            : ["pending"]
        }
      />

      {task.blockedBy ? (
        <div
          className="mt-2 rounded px-2 py-1.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--color-warning)",
          }}
          title={task.blockedBy}
        >
          {task.blockedBy}
        </div>
      ) : null}
    </article>
  );
}

function TeamPlanChipRow({
  label,
  values,
}: {
  label: string;
  values: string[];
}) {
  return (
    <div className="mt-2 min-w-0">
      <div
        className="mb-1 text-token-xs uppercase"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div className="flex min-w-0 flex-wrap gap-1">
        {values.slice(0, 8).map((value) => (
          <span
            key={`${label}:${value}`}
            className="max-w-full truncate rounded px-1.5 py-0.5 text-token-xs"
            style={{
              background: "var(--bg-selected)",
              color: "var(--text-muted)",
            }}
            title={value}
          >
            {value}
          </span>
        ))}
        {values.length > 8 ? (
          <span
            className="rounded px-1.5 py-0.5 text-token-xs"
            style={{
              background: "var(--bg-selected)",
              color: "var(--text-muted)",
            }}
          >
            +{values.length - 8}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function teamPlanTaskColor(status: TeamTask["status"]): string {
  if (status === "completed") return "var(--color-success)";
  if (status === "failed") return "var(--color-danger)";
  if (status === "warning" || status === "blocked") return "var(--color-warning)";
  return "var(--accent)";
}

function teamPlanVerificationColor(
  status: TeamTaskVerificationSummary["status"]
): string {
  if (status === "passed") return "var(--color-success)";
  if (status === "warning") return "var(--color-warning)";
  return "var(--color-danger)";
}

function teamPlanSynthesisStatusColor(status: TeamTaskSynthesisSummary["status"]): string {
  if (status === "ready") return "var(--color-success)";
  if (status === "warning") return "var(--color-warning)";
  return "var(--color-danger)";
}

function teamPlanSynthesisSeverityColor(
  severity: TeamTaskSynthesisItem["severity"]
): string {
  if (severity === "danger") return "var(--color-danger)";
  if (severity === "warning") return "var(--color-warning)";
  return "var(--accent)";
}

function teamPlanTaskSource(task: TeamTask): string {
  if (task.batchId) return `batch ${task.batchId}`;
  if (task.workflowId) return `workflow ${task.workflowId}`;
  return task.source.parentId
    ? `${task.source.type} ${task.source.parentId}/${task.source.id}`
    : `${task.source.type} ${task.source.id}`;
}

function ExecutionModeMiniStrip({ summary }: { summary: ExecutionModeSummary }) {
  const color =
    summary.tone === "warning"
      ? "var(--color-warning)"
      : summary.tone === "running"
        ? "var(--accent)"
        : "var(--text-muted)";
  const confidence = `${Math.round(summary.confidence * 100)}%`;
  return (
    <div
      className="mt-2 rounded border px-2 py-1.5"
      style={{
        borderColor: "var(--border-soft)",
        background: "var(--bg-selected)",
      }}
      data-testid="workbench-execution-mode"
      title={`${summary.detail} ${summary.contextBoundary}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-token-xs font-medium"
          style={{ background: "var(--bg-panel)", color }}
          data-testid="workbench-execution-mode-label"
        >
          {summary.label}
        </span>
        <span
          className="min-w-0 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          data-testid="workbench-execution-mode-detail"
        >
          {summary.advisoryOnly ? "建议" : "执行中"} · {confidence} · {summary.permissionProfile}
        </span>
      </div>
      <div
        className="mt-1 truncate text-token-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {summary.contextBoundary}
      </div>
    </div>
  );
}

function GoalStateMetric({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string;
  tone?: "done" | "warning";
  testId: string;
}) {
  return (
    <div
      className="min-w-0 rounded px-2 py-1.5"
      style={{ background: "var(--bg-selected)" }}
      data-testid={testId}
    >
      <div
        className="truncate text-token-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-mono text-token-xs font-semibold"
        style={{
          color:
            tone === "warning"
              ? "var(--color-warning)"
              : tone === "done"
                ? "var(--color-success)"
                : "var(--text)",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function CockpitMetric({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="min-w-0 rounded px-2 py-1.5"
      style={{ background: "var(--bg-selected)" }}
    >
      <div
        className="truncate text-token-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 truncate font-mono text-token-xs font-semibold"
        style={{ color: "var(--text)" }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function OverviewSection({
  icon,
  title,
  id,
  summary,
  open,
  actionLabel,
  children,
  onToggle,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  id: string;
  summary?: string;
  open: boolean;
  actionLabel?: string;
  children: ReactNode;
  onToggle: () => void;
  onAction?: () => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section
      className="border-b pb-1.5 last:border-b-0"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid={`workbench-section-${id}`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-token-xs font-medium hover:bg-[color:var(--bg-hover)]"
          style={{ color: "var(--text-muted)" }}
          aria-expanded={open}
          data-testid={`workbench-section-${id}-toggle`}
        >
          <Chevron size={12} className="shrink-0" />
          <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center"
            style={{ color: "var(--accent)" }}
          >
            {icon}
          </span>
          {/* 标题必须能被压缩，flex-1 使它占位，min-w-0 才能生效 truncate */}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {summary ? (
            // 讯讷：徽章有最大宽限制，极窄时自身也 truncate，不再跳出表格。
            <span
              className="max-w-[40%] shrink truncate rounded px-1.5 py-0.5 text-token-xs"
              style={{ background: "var(--bg-selected)", color: "var(--text-muted)" }}
              title={summary}
            >
              {summary}
            </span>
          ) : null}
        </button>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="shrink-0 rounded px-1.5 py-0.5 text-token-xs hover:bg-[color:var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
            data-testid={`workbench-section-${id}-action`}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {/* 窄态下取消 pl-7 缩进，避免内容区被压到 < 200px。
          宽态（workbench 面板 ≥ 380px）保留缩进以对齐标题。 */}
      {open ? (
        <div
          className="mt-1 space-y-1 pl-1 [@container_workbench-overview_(min-width:380px)]:pl-7"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function OverviewLine({
  primary,
  secondary,
  checked,
  struck,
  tone,
}: {
  primary: string;
  secondary?: string;
  checked?: boolean;
  struck?: boolean;
  tone?: "running" | "done" | "error";
}) {
  const visiblePrimary = shortDisplayText(primary, 96);
  const visibleSecondary = secondary ? shortDisplayText(secondary, 120) : undefined;
  const color =
    tone === "error" ? "var(--color-danger)" : tone === "running" ? "var(--color-warning)" : "var(--text-muted)";
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-xs">
      {checked != null ? (
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: checked ? "var(--text-muted)" : color }} />
      ) : null}
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          title={visiblePrimary}
          style={{
            color: struck ? "var(--text-muted)" : "var(--text)",
            textDecorationLine: struck ? "line-through" : undefined,
            textDecorationColor: "var(--text-muted)",
          }}
        >
          {visiblePrimary}
        </span>
        {visibleSecondary ? (
          <span className="block truncate text-token-xs" title={visibleSecondary} style={{ color }}>
            {visibleSecondary}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function OverviewArtifactButton({
  artifact,
  onOpenView,
}: {
  artifact: ProgressArtifact;
  onOpenView: (view: WorkbenchView) => void;
}) {
  const target = artifactTarget(artifact);
  const label = artifact.title || artifact.href || artifact.summary || "未命名产物";
  if (!target) {
    return (
      <span
        className="block w-full truncate rounded px-1 py-0.5 text-left text-xs"
        style={{ color: "var(--text-muted)" }}
        title={artifact.summary ?? "这个产物没有可打开的 URL 或文件路径"}
      >
        ▣ {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (target.type === "browser") onOpenView({ type: "browser", url: target.url });
        else onOpenView({ type: "files", path: target.path });
      }}
      className="block w-full truncate rounded px-1 py-0.5 text-left text-xs hover:bg-[color:var(--bg-hover)]"
      style={{ color: "var(--text)" }}
      title={target.type === "browser" ? target.url : target.path}
    >
      {target.type === "browser" ? "◎" : "▣"} {label}
    </button>
  );
}

function ProgressDetail({
  progress,
  streaming,
  onAbort,
  onOpenUrl,
}: {
  progress: AgentProgress | null;
  streaming: boolean;
  onAbort?: () => Promise<void> | void;
  onOpenUrl?: (url: string) => void;
}) {
  const groups = progress?.groups ?? [];
  const steps = progress?.steps ?? [];
  const artifacts = progress?.artifacts ?? [];
  return (
    <div className="p-2.5" data-testid="workbench-progress-detail">
      {streaming && onAbort ? (
        <div className="mb-2 flex justify-end">
          <AbortTaskButton
            testId="workbench-progress-stop-detail"
            onAbort={onAbort}
          />
        </div>
      ) : null}
      <ProgressPopover progress={progress} onOpenUrl={onOpenUrl} />
      {!progress || (groups.length === 0 && steps.length === 0 && artifacts.length === 0) ? (
        <EmptyDetail title="暂无进度" body="agent 调用 update_progress 后，当前任务进度会显示在这里。" />
      ) : null}
    </div>
  );
}

function AbortTaskButton({
  testId,
  onAbort,
}: {
  testId: string;
  onAbort: () => Promise<void> | void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        void onAbort();
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded border px-2 text-token-xs font-medium transition-colors hover:bg-[color:var(--bg-hover)]"
      style={{
        borderColor: "var(--color-danger)",
        color: "var(--color-danger)",
      }}
      title="终止当前任务"
    >
      <Square size={12} />
      <span>终止任务</span>
    </button>
  );
}

function OutputsDetail({
  artifacts,
  onOpenView,
}: {
  artifacts: ProgressArtifact[];
  onOpenView: (view: WorkbenchView) => void;
}) {
  if (artifacts.length === 0) {
    return (
      <div className="p-2.5" data-testid="workbench-outputs-detail">
        <EmptyDetail title="暂无产物" body="文件、URL、截图、测试和日志产物会汇总到这里。" />
      </div>
    );
  }
  const grouped = artifacts.reduce<Record<string, ProgressArtifact[]>>(
    (acc, artifact) => {
      acc[artifact.kind] = acc[artifact.kind] ?? [];
      acc[artifact.kind].push(artifact);
      return acc;
    },
    {}
  );
  return (
    <div className="space-y-3 p-2.5" data-testid="workbench-outputs-detail">
      {Object.entries(grouped).map(([kind, items]) => (
        <section key={kind} className="space-y-1.5">
          <div
            className="flex items-center gap-2 text-token-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            <span>{artifactKindLabel(kind)}</span>
            <span className="h-px flex-1" style={{ background: "var(--border-soft)" }} />
            <span>{items.length}</span>
          </div>
          {items.map((artifact) => {
            const target = artifactTarget(artifact);
            const canOpen = Boolean(target);
            return (
              <button
                key={artifact.id}
                type="button"
                disabled={!canOpen}
                onClick={() => {
                  if (!target) return;
                  if (target.type === "browser")
                    onOpenView({ type: "browser", url: target.url });
                  else onOpenView({ type: "files", path: target.path });
                }}
                className="block w-full rounded border px-2 py-1.5 text-left hover:bg-[color:var(--bg-hover)] disabled:cursor-default disabled:opacity-65 disabled:hover:bg-transparent"
                style={{ borderColor: "var(--border-soft)", background: "var(--bg-panel-2)" }}
                title={artifact.href ?? artifact.summary ?? "这个产物没有可打开的 URL 或文件路径"}
              >
                <span className="flex items-center gap-2">
                  <FileText size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {artifact.title}
                  </span>
                  <span className="shrink-0 text-token-xs" style={{ color: "var(--text-muted)" }}>
                    {target?.type === "browser"
                      ? "打开 Browser"
                      : target?.type === "files"
                        ? "打开 Files"
                        : "无可预览路径"}
                  </span>
                </span>
                {(artifact.href || artifact.summary) && (
                  <span className="mt-0.5 block truncate pl-5 text-token-xs" style={{ color: "var(--text-muted)" }}>
                    {artifact.href ?? artifact.summary}
                  </span>
                )}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ContextDetail({
  cwd,
  agentId,
  runtimeIdentity,
  stats,
  budgetStatus,
  providerLabel,
  modelLabel,
  thinkingLabel,
  runtimeProfile,
  toolsCount,
  pendingFileCount,
  pendingImageCount,
}: {
  cwd: string;
  agentId: string | null;
  runtimeIdentity: RuntimeIdentity;
  stats: StatsSnapshot | null;
  budgetStatus: BudgetStatus;
  providerLabel: string;
  modelLabel: string;
  thinkingLabel: string;
  runtimeProfile: AgentRuntimeProfile | null;
  toolsCount: number;
  pendingFileCount: number;
  pendingImageCount: number;
}) {
  const rows = [
    ["cwd", cwd || "n/a"],
    ["mode", runtimeIdentity.mode],
    ["sessionId", runtimeIdentity.sessionId ?? "n/a"],
    ["agentId", agentId ?? "n/a"],
    ["browserId", runtimeIdentity.browserId],
    ["provider", providerLabel || "n/a"],
    ["model", modelLabel || "n/a"],
    ["runtime", runtimeProfile?.label ?? "SDK-backed agent"],
    ["runtime detail", runtimeProfile?.details ?? "Full structured runtime"],
    ["thinking", thinkingLabel],
    ["context", stats?.ctxPct != null ? `${(stats.ctxPct * 100).toFixed(1)}%` : "n/a"],
    ["budget", budgetStatus.triggered.length > 0 ? budgetStatus.triggered.join(", ") : "ok"],
    ["tools", String(toolsCount)],
    ["attachments", `${pendingFileCount} files · ${pendingImageCount} images`],
  ];
  return (
    <div className="space-y-1 p-2.5" data-testid="workbench-context-detail">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[88px_1fr] gap-2 rounded border px-2 py-1.5 text-xs"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-panel-2)" }}
        >
          <span style={{ color: "var(--text-muted)" }}>{label}</span>
          <span className="min-w-0 truncate" title={value}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyDetail({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded border px-3 py-4 text-xs"
      style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
    >
      <div className="font-medium" style={{ color: "var(--text)" }}>{title}</div>
      <div className="mt-1">{body}</div>
    </div>
  );
}

function shortDisplayText(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(0, max - 1))}...`;
}

type GoalStateTone = "idle" | "running" | "done" | "warning" | "error";

interface GoalStateSummary {
  objective: string;
  artifact: string;
  statusLabel: string;
  tone: GoalStateTone;
  requiredLabel: string;
  verifiedLabel: string;
  missingLabel: string;
  missing: string[];
  detail?: string;
}

function summarizeGoalState({
  payload,
  contract,
  progress,
  streaming,
}: {
  payload: WorkbenchGoalStatePayload | null;
  contract: ExecutionContractSummary | null;
  progress: AgentProgress | null;
  streaming: boolean;
}): GoalStateSummary | null {
  const goal = payload?.goal ?? null;
  const effectiveContract = payload?.contract ?? contract;
  const artifacts = progress?.artifacts ?? [];
  if (!goal && !effectiveContract && artifacts.length === 0) return null;

  const required = [
    ...new Set([
      ...(effectiveContract?.requiredEvidence ?? []),
      ...artifacts.flatMap((artifact) => artifact.requiredEvidence ?? []),
    ]),
  ];
  const ledgerEvidence = payload?.ledgerEvidence ?? [];
  const evaluation = goal?.lastEvaluation;
  const closure = payload?.lastClosure ?? goal?.lastClosure ?? null;
  const passedEvidenceIds = new Set(
    evaluation?.criteria
      .filter((criterion) => criterion.status === "pass")
      .flatMap((criterion) => criterion.evidenceIds ?? []) ?? []
  );
  const verifiedRequired = required.filter((requirement) =>
    ledgerEvidence.some((evidence) =>
      evidenceMatchesRequiredEvidence(evidence, requirement, passedEvidenceIds)
    )
  );
  const allRequiredVerified =
    required.length > 0 &&
    (verifiedRequired.length === required.length ||
      (evaluation?.status === "passed" &&
        (evaluation.missingEvidence?.length ?? 0) === 0));
  const missingFromEvaluation = [
    ...(closure?.missingEvidence ?? []),
    ...(evaluation?.missingEvidence ?? []),
  ];
  const inferredMissing = allRequiredVerified
    ? []
    : required.filter((item) => !verifiedRequired.includes(item));
  const missing = [
    ...new Set(
      (missingFromEvaluation.length > 0
        ? missingFromEvaluation
        : inferredMissing
      ).filter(Boolean)
    ),
  ];
  const status = summarizeGoalRuntimeStatus({
    goal,
    closure,
    streaming,
    missingCount: missing.length,
  });
  const requiredLabel =
    required.length > 0
      ? shortDisplayText(required.slice(0, 2).join(", "), 36) +
        (required.length > 2 ? ` +${required.length - 2}` : "")
      : "未声明";
  const verifiedCount = allRequiredVerified
    ? required.length
    : verifiedRequired.length;
  return {
    objective:
      effectiveContract?.objective ?? goal?.objective ?? "当前任务未声明目标",
    artifact: summarizePrimaryArtifact(effectiveContract, artifacts),
    statusLabel: status.label,
    tone: status.tone,
    requiredLabel,
    verifiedLabel:
      required.length > 0 ? `${verifiedCount}/${required.length}` : "n/a",
    missingLabel: missing.length > 0 ? String(missing.length) : "0",
    missing,
    detail:
      closure?.nextAction ??
      evaluation?.nextAction ??
      (streaming ? "Agent 正在执行，等待新的验证证据。" : undefined),
  };
}

function summarizeGoalRuntimeStatus({
  goal,
  closure,
  streaming,
  missingCount,
}: {
  goal: AgentGoal | null;
  closure: GoalRunClosure | null;
  streaming: boolean;
  missingCount: number;
}): { label: string; tone: GoalStateTone } {
  if (goal?.status === "complete") return { label: "已完成", tone: "done" };
  if (goal?.status === "blocked") return { label: "已阻塞", tone: "error" };
  if (closure?.verdict === "blocked") return { label: "已阻塞", tone: "error" };
  if (closure?.verdict === "needs_user") {
    return { label: "等待用户", tone: "warning" };
  }
  if (closure?.verdict === "ready_to_finalize") {
    return { label: "可收尾", tone: "done" };
  }
  if (goal?.status === "paused") return { label: "已暂停", tone: "warning" };
  if (streaming) return { label: "运行中", tone: "running" };
  if (missingCount > 0) return { label: "缺证据", tone: "warning" };
  if (goal?.status === "active") return { label: "待验证", tone: "running" };
  return { label: "空闲", tone: "idle" };
}

function goalStateToneColor(tone: GoalStateTone): string {
  if (tone === "done") return "var(--color-success)";
  if (tone === "warning") return "var(--color-warning)";
  if (tone === "error") return "var(--color-danger)";
  if (tone === "running") return "var(--accent)";
  return "var(--text-muted)";
}

function evidenceMatchesRequiredEvidence(
  evidence: EvidenceRef,
  requirement: string,
  passedEvidenceIds: Set<string>
): boolean {
  const required = normalizeEvidenceToken(requirement);
  if (!required || required === "goal_evidence" || required === "evidence") {
    return true;
  }
  if (!evidenceCanCountAsVerified(evidence, passedEvidenceIds)) return false;
  const metadataKind =
    typeof evidence.metadata?.kind === "string" ? evidence.metadata.kind : "";
  const metadataRequirements = Array.isArray(evidence.metadata?.evidenceRequired)
    ? evidence.metadata.evidenceRequired.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  const haystack = [
    evidence.id,
    evidence.kind,
    evidence.title,
    evidence.summary,
    evidence.textPreview,
    evidence.url,
    evidence.filePath,
    evidence.artifactUri,
    evidence.source?.type,
    evidence.source?.id ?? undefined,
    metadataKind,
    ...metadataRequirements,
  ]
    .filter((item): item is string => Boolean(item))
    .map(normalizeEvidenceToken);
  if (metadataRequirements.some((item) => normalizeEvidenceToken(item).includes(required))) {
    return true;
  }
  if (required.includes("browser")) {
    return (
      evidence.kind.startsWith("browser_") ||
      evidence.source?.type === "browser" ||
      haystack.some((item) => item.includes("browser"))
    );
  }
  if (required.includes("test") || required.includes("type")) {
    return haystack.some(
      (item) =>
        item.includes("test") ||
        item.includes("typecheck") ||
        item.includes("verification_result")
    );
  }
  if (required.includes("lint")) {
    return haystack.some((item) => item.includes("lint"));
  }
  if (required.includes("build")) {
    return haystack.some((item) => item.includes("build"));
  }
  if (required.includes("diff")) {
    return haystack.some((item) => item.includes("diff"));
  }
  if (required.includes("screenshot")) {
    return haystack.some(
      (item) => item.includes("screenshot") || item.includes("browser_snapshot")
    );
  }
  return haystack.some((item) => item.includes(required));
}

function evidenceCanCountAsVerified(
  evidence: EvidenceRef,
  passedEvidenceIds: Set<string>
): boolean {
  if (passedEvidenceIds.size > 0 && passedEvidenceIds.has(evidence.id)) {
    return true;
  }
  const outcome =
    typeof evidence.metadata?.outcome === "string"
      ? evidence.metadata.outcome
      : typeof evidence.metadata?.status === "string"
        ? evidence.metadata.status
        : undefined;
  if (outcome === "failed" || outcome === "timed_out") return false;
  if (typeof evidence.metadata?.passed === "boolean") {
    return evidence.metadata.passed;
  }
  return true;
}

function normalizeEvidenceToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function summarizePrimaryArtifact(
  contract: ExecutionContractSummary | null,
  artifacts: ProgressArtifact[]
): string {
  if (contract?.mainArtifact) {
    return shortDisplayText(contract.mainArtifact.label, 48);
  }
  const candidate = artifacts.find(
    (artifact) =>
      artifact.title !== "任务契约" &&
      ["url", "browser", "screenshot", "file", "diff", "test"].includes(
        artifact.kind
      )
  );
  if (!candidate) return "待锁定";
  return shortDisplayText(
    candidate.title ||
      candidate.href?.split(/[\\/]/).pop() ||
      artifactKindLabel(candidate.kind),
    48
  );
}

function summarizeRequiredEvidence(
  contract: ExecutionContractSummary | null,
  artifacts: ProgressArtifact[]
): string {
  const fromContract = contract?.requiredEvidence ?? [];
  const fromArtifacts = artifacts.flatMap(
    (artifact) => artifact.requiredEvidence ?? []
  );
  const required = [...new Set([...fromContract, ...fromArtifacts])];
  if (required.length === 0) return "待记录";
  const label = required.slice(0, 2).join(", ");
  return required.length > 2 ? `${label} +${required.length - 2}` : label;
}

type ProgressCockpitSummary = {
  title: string;
  detail: string;
  statusLabel: string;
  tone?: "running" | "done" | "error";
  percent: number;
  completed: number;
  total: number;
  steps: ProgressGroup["steps"];
  artifactLabel: string;
  evidenceLabel: string;
  contractLabel: string;
};

function summarizeProgressCockpit(
  progress: AgentProgress | null,
  contract: ExecutionContractSummary | null,
  streaming: boolean
): ProgressCockpitSummary {
  const groups = normalizedGroups(progress);
  const currentGroup = groups.at(-1);
  const steps = currentGroup?.steps ?? [];
  const artifacts = progress?.artifacts ?? [];
  const artifactLabel = summarizePrimaryArtifact(contract, artifacts);
  const evidenceLabel = summarizeRequiredEvidence(contract, artifacts);
  const contractLabel = contract?.rubricProfile ?? "未生成";
  const total = steps.length;
  const completed = steps.filter((step) => step.status === "completed").length;
  const running = steps.find((step) => step.status === "running");
  const failedOrBlocked = steps.find(
    (step) => step.status === "failed" || step.status === "blocked"
  );
  const percent =
    total > 0
      ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
      : streaming
        ? 8
        : 0;

  if (failedOrBlocked) {
    return {
      title: contract ? shortDisplayText(contract.objective, 90) : failedOrBlocked.title,
      detail: failedOrBlocked.summary ?? "需要处理后才能继续。",
      statusLabel: failedOrBlocked.status === "blocked" ? "blocked" : "failed",
      tone: "error",
      percent,
      completed,
      total,
      steps,
      artifactLabel,
      evidenceLabel,
      contractLabel,
    };
  }

  if (running) {
    return {
      title: contract ? shortDisplayText(contract.objective, 90) : running.title,
      detail:
        running.summary ??
        `第 ${currentGroup?.index ?? 1} 组任务 · ${completed}/${total} 已完成`,
      statusLabel: "running",
      tone: "running",
      percent: Math.max(percent, 8),
      completed,
      total,
      steps,
      artifactLabel,
      evidenceLabel,
      contractLabel,
    };
  }

  if (total > 0) {
    return {
      title: contract
        ? shortDisplayText(contract.objective, 90)
        : completed >= total
          ? "当前任务步骤已完成"
          : "等待下一步执行",
      detail: `第 ${currentGroup?.index ?? 1} 组任务 · ${completed}/${total} 已完成`,
      statusLabel: completed >= total ? "done" : "pending",
      tone: completed >= total ? "done" : undefined,
      percent,
      completed,
      total,
      steps,
      artifactLabel,
      evidenceLabel,
      contractLabel,
    };
  }

  return {
    title: contract
      ? shortDisplayText(contract.objective, 90)
      : streaming
        ? "任务已开始，等待模型响应"
        : "暂无进行中的任务",
    detail: streaming
      ? "agent 正在启动或准备第一步，收到进度事件后会显示具体动作。"
      : "发起任务后，这里会显示当前目标、执行阶段和产物。",
    statusLabel: streaming ? "starting" : "idle",
    tone: streaming ? "running" : undefined,
    percent,
    completed,
    total: 1,
    steps,
    artifactLabel,
    evidenceLabel,
    contractLabel,
  };
}

function summarizeProgress(progress: AgentProgress | null) {
  const groups = normalizedGroups(progress);
  const steps = groups.at(-1)?.steps ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const running = steps.find((step) => step.status === "running");
  const failed = steps.filter((step) => step.status === "failed").length;
  const blocked = steps.filter((step) => step.status === "blocked").length;
  if (steps.length === 0) {
    return {
      primary: "暂无进行中的任务",
      secondary: "等待 agent 更新进度",
      badge: undefined,
      tone: undefined,
    };
  }
  return {
    primary: running?.title ?? `${completed}/${steps.length} completed`,
    secondary: `任务组 ${groups.at(-1)?.index ?? 1} · ${completed}/${steps.length}${
      failed || blocked ? ` · ${failed + blocked} needs attention` : ""
    }`,
    badge: `${completed}/${steps.length}`,
    tone: failed || blocked ? "error" : running ? "running" : "done",
  } as const;
}

function stepStatusLabel(status: ProgressGroup["steps"][number]["status"]) {
  if (status === "completed") return "done";
  if (status === "running") return "now";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  return "next";
}

function normalizedGroups(progress: AgentProgress | null): ProgressGroup[] {
  if (!progress) return [];
  const groups = progress.groups ?? [];
  const steps = progress.steps ?? [];
  if (groups.length > 0) return groups;
  if (steps.length === 0) return [];
  return [
    {
      id: "legacy",
      index: 1,
      steps,
      startedAt: progress.updatedAt,
    },
  ];
}

function summarizeArtifacts(artifacts: ProgressArtifact[]): string {
  if (artifacts.length === 0) return "";
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => `${kind} ${count}`)
    .join(" · ");
}

function artifactKindLabel(kind: string): string {
  if (kind === "url") return "URLs";
  if (kind === "file") return "Files";
  if (kind === "screenshot") return "Screenshots";
  if (kind === "test") return "Tests";
  if (kind === "diff") return "Diffs";
  if (kind === "log") return "Logs";
  if (kind === "browser") return "Browser";
  return "Other";
}

function describeBrowserStatus(snapshot: BrowserSnapshot): {
  short: string;
  title: string;
  detail: string;
} {
  if (snapshot.error || snapshot.status === "error") {
    return {
      short: "error",
      title: "浏览器出错",
      detail: snapshot.error ?? "最近一次浏览器操作失败",
    };
  }
  if (snapshot.task?.status === "running" || snapshot.status === "busy") {
    return {
      short: "busy",
      title: "agent 操作中",
      detail: snapshot.task?.intent ?? "agent 正在使用浏览器",
    };
  }
  if (snapshot.status === "ready") {
    return {
      short: "ready",
      title: "浏览器已就绪",
      detail: "可查看页面、验收证据或接管操作",
    };
  }
  if (snapshot.status === "launching") {
    return {
      short: "starting",
      title: "浏览器启动中",
      detail: "正在连接浏览器 workspace",
    };
  }
  if (snapshot.status === "closed") {
    return {
      short: "closed",
      title: "浏览器已关闭",
      detail: "打开 Browser 后可重新连接",
    };
  }
  return {
    short: "idle",
    title: "浏览器空闲",
    detail: "等待 agent 或用户打开页面",
  };
}

function viewTitle(type: WorkbenchView["type"]) {
  if (type === "overview") return "Overview";
  if (type === "progress") return "Progress";
  if (type === "outputs") return "Outputs";
  if (type === "files") return "Files";
  if (type === "context") return "Context";
  if (type === "team") return "Team";
  return "Browser";
}

function homeTab(): WorkbenchTab {
  return {
    id: "home",
    kind: "home",
    title: "概览",
    subtitle: "Overview",
    closable: false,
  };
}

function terminalTab(): WorkbenchTab {
  return {
    id: "terminal",
    kind: "terminal",
    title: "命令参考",
    subtitle: "只读",
    closable: true,
  };
}

function tabFromView(view: WorkbenchView): WorkbenchTab {
  if (view.type === "overview") return homeTab();
  if (view.type === "progress") {
    return {
      id: "progress",
      kind: "progress",
      title: "进度",
      subtitle: "Progress",
      closable: true,
    };
  }
  if (view.type === "outputs") {
    return {
      id: "outputs",
      kind: "outputs",
      title: "输出",
      subtitle: "Outputs",
      closable: true,
    };
  }
  if (view.type === "files") {
    const title = view.path ? basename(view.path) : "打开文件";
    return {
      id: view.path ? `files:${view.path}` : "files",
      kind: "files",
      title,
      subtitle: view.path ?? "Files",
      path: view.path,
      closable: true,
    };
  }
  if (view.type === "context") {
    return {
      id: "context",
      kind: "context",
      title: "上下文",
      subtitle: "Context",
      closable: true,
    };
  }
  if (view.type === "team") {
    return {
      id: "team",
      kind: "team",
      title: "Team",
      subtitle: "Team Plan",
      closable: true,
    };
  }
  const url = view.url?.trim();
  return {
    id: url ? `browser:${url}` : "browser:launcher",
    kind: "browser",
    title: url ? browserTabTitle(url) : "浏览器",
    subtitle: url ?? "选择本地项目",
    url,
    closable: true,
  };
}

function viewFromTab(tab: WorkbenchTab): WorkbenchView {
  if (tab.kind === "home") return { type: "overview" };
  if (tab.kind === "progress") return { type: "progress" };
  if (tab.kind === "outputs") return { type: "outputs" };
  if (tab.kind === "files") return { type: "files", path: tab.path };
  if (tab.kind === "context") return { type: "context" };
  if (tab.kind === "team") return { type: "team" };
  if (tab.kind === "browser") return { type: "browser", url: tab.url };
  return { type: "overview" };
}

function upsertWorkbenchTab(tabs: WorkbenchTab[], tab: WorkbenchTab): WorkbenchTab[] {
  if (tab.id === "home") {
    return tabs.some((item) => item.id === "home") ? tabs : [homeTab(), ...tabs];
  }
  const withHome = tabs.some((item) => item.id === "home") ? tabs : [homeTab(), ...tabs];
  const index = withHome.findIndex((item) => item.id === tab.id);
  if (index >= 0) {
    return withHome.map((item, itemIndex) => (itemIndex === index ? { ...item, ...tab } : item));
  }
  return [...withHome, tab];
}

function loadStoredWorkbenchTabs(storageKey: string): {
  tabs: WorkbenchTab[];
  activeTabId: string;
} {
  const fallbackTabs = [homeTab()];
  if (typeof window === "undefined") {
    return { tabs: fallbackTabs, activeTabId: "home" };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { tabs: fallbackTabs, activeTabId: "home" };
    const parsed = JSON.parse(raw) as {
      tabs?: Partial<WorkbenchTab>[];
      activeTabId?: string;
    };
    const validTabs =
      parsed.tabs
        ?.map(normalizeStoredTab)
        .filter((tab): tab is WorkbenchTab => Boolean(tab)) ?? [];
    const tabs = validTabs.some((tab) => tab.id === "home")
      ? validTabs
      : [homeTab(), ...validTabs];
    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId ?? "home"
      : "home";
    return { tabs, activeTabId };
  } catch {
    return { tabs: fallbackTabs, activeTabId: "home" };
  }
}

function normalizeStoredTab(tab: Partial<WorkbenchTab> | null | undefined): WorkbenchTab | null {
  if (!tab?.id || !tab.kind) return null;
  if (!isWorkbenchTabKind(tab.kind)) return null;
  return {
    id: tab.id,
    kind: tab.kind,
    title: tab.kind === "home" ? "概览" : tab.title || viewTitleFromTabKind(tab.kind),
    subtitle: tab.subtitle,
    closable: tab.kind === "home" ? false : tab.closable !== false,
    url: tab.url,
    path: tab.path,
  };
}

function isWorkbenchTabKind(kind: string): kind is WorkbenchTabKind {
  return [
    "home",
    "progress",
    "outputs",
    "files",
    "context",
    "team",
    "browser",
    "terminal",
    "sidechat",
  ].includes(kind);
}

function viewTitleFromTabKind(kind: WorkbenchTabKind): string {
  if (kind === "home") return "概览";
  if (kind === "terminal") return "终端";
  if (kind === "sidechat") return "侧边聊天";
  if (kind === "team") return "Team";
  return viewTitle(kind);
}

function tabIcon(kind: WorkbenchTabKind) {
  if (kind === "home") return HomeTabIcon;
  if (kind === "progress") return Clock;
  if (kind === "outputs") return Boxes;
  if (kind === "files") return FolderOpen;
  if (kind === "context") return FileText;
  if (kind === "team") return Boxes;
  if (kind === "browser") return Globe;
  if (kind === "terminal") return Terminal;
  return MessageSquare;
}

function HomeTabIcon({
  size = 13,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 7.1 8 2.6l5.5 4.5v5.4a1 1 0 0 1-1 1h-2.7V9.1H6.2v4.4H3.5a1 1 0 0 1-1-1V7.1Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M5.4 4.7V3.2h1.7"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function buildWorkbenchRecommendations({
  cwd,
  artifacts,
  browserSnapshot,
}: {
  cwd: string;
  artifacts: ProgressArtifact[];
  browserSnapshot: BrowserSnapshot;
}): WorkbenchRecommendation[] {
  const recommendations: WorkbenchRecommendation[] = [];
  const seen = new Set<string>();
  const add = (item: WorkbenchRecommendation) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    recommendations.push(item);
  };

  if (browserSnapshot.url && !isCurrentAppRootUrl(browserSnapshot.url)) {
    add({
      id: `url:${browserSnapshot.url}`,
      kind: "url",
      title: browserSnapshot.title || browserTabTitle(browserSnapshot.url),
      subtitle: browserSnapshot.url,
      href: browserSnapshot.url,
    });
  }

  for (const artifact of artifacts) {
    const target = artifactTarget(artifact);
    if (target?.type === "browser" && !isCurrentAppRootUrl(target.url)) {
      add({
        id: `url:${target.url}`,
        kind: "url",
        title: artifact.title || browserTabTitle(target.url),
        subtitle: target.url,
        href: target.url,
      });
    } else if (target?.type === "files") {
      add({
        id: `file:${target.path}`,
        kind: artifact.kind === "file" ? "file" : "output",
        title: artifact.title || basename(target.path),
        subtitle: target.path,
        href: target.path,
      });
    }
  }

  if (cwd) {
    add({
      id: `file:${cwd}/README.md`,
      kind: "file",
      title: "README.md",
      subtitle: `${cwd}/README.md`,
      href: `${cwd}/README.md`,
    });
  }

  return recommendations;
}

function isFileLikeArtifact(kind: ProgressArtifact["kind"]): boolean {
  return ["file", "screenshot", "test", "diff", "log", "browser", "other"].includes(kind);
}

function artifactTarget(
  artifact: ProgressArtifact
):
  | { type: "browser"; url: string }
  | { type: "files"; path: string }
  | null {
  const href = artifact.href?.trim();
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return { type: "browser", url: href };
  if (isFileLikeArtifact(artifact.kind)) {
    const path = filePathFromHref(href);
    if (path) return { type: "files", path };
  }
  return null;
}

function filePathFromHref(href: string): string | null {
  if (href.startsWith("/")) return href;
  if (!href.startsWith("file://")) return null;
  try {
    return decodeURIComponent(new URL(href).pathname);
  } catch {
    return null;
  }
}

function isCurrentAppRootUrl(url: string | null | undefined): boolean {
  if (!url || typeof window === "undefined") return false;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname === "/";
  } catch {
    return false;
  }
}

function browserTabTitle(url: string): string {
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.href);
    return parsed.host || url;
  } catch {
    return url;
  }
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index >= 0 ? trimmed.slice(index + 1) || trimmed : trimmed;
}
