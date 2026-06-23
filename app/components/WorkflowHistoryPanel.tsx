"use client";

import { useState } from "react";
import { FileText, Loader2, RotateCcw, X } from "lucide-react";
import type {
  WorkflowDebugBundle,
  WorkflowResumeSnapshot,
  WorkflowTraceEvent,
} from "@/lib/workflows/types";

function formatWorkflowTime(ms: number | undefined): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function shortWorkflowJson(value: unknown, maxChars = 5000): string {
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (!text) return "(empty)";
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return String(value);
  }
}

function workflowTraceSummary(event: WorkflowTraceEvent): string {
  switch (event.type) {
    case "agent_start":
      return [
        event.title,
        event.agentType ? `type=${event.agentType}` : "",
        event.role ? `role=${event.role}` : "",
        event.isolation ? `isolation=${event.isolation}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "agent_end":
      return [
        event.title,
        `status=${event.status}`,
        event.schemaValid === undefined ? "" : `schema=${event.schemaValid}`,
        event.error ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "schema_validation":
      return event.valid ? "schema valid" : event.errors.join("; ");
    case "approval":
      return `${event.capability} · ${event.decision}`;
    default:
      return shortWorkflowJson(event, 800);
  }
}

export function formatWorkflowResumeSummaries(
  snapshot: WorkflowResumeSnapshot | undefined,
  checkpointName: string | undefined
): string[] {
  if (!snapshot) return [];
  const selectedCheckpoint = checkpointName
    ? snapshot.checkpointSummaries.find((item) => item.name === checkpointName)
    : snapshot.checkpointSummaries.at(-1);
  const checkpointSummaries = snapshot.checkpointSummaries.slice(-5);
  const artifactSummaries = snapshot.artifactSummaries.slice(-5);
  const lines: string[] = [];
  if (selectedCheckpoint) {
    lines.push(
      "Selected checkpoint preview:",
      `- ${selectedCheckpoint.name}: ${selectedCheckpoint.preview || "(empty)"}`
    );
  }
  if (checkpointSummaries.length > 0) {
    lines.push(
      "",
      "Recent checkpoints:",
      ...checkpointSummaries.map(
        (item) => `- ${item.name}: ${item.preview || "(empty)"}`
      )
    );
  }
  if (artifactSummaries.length > 0) {
    lines.push(
      "",
      "Recent artifacts:",
      ...artifactSummaries.map(
        (item) => `- ${item.name}: ${item.preview || "(empty)"}`
      )
    );
  }
  return lines;
}

function WorkflowDebugInspector({
  bundle,
  loading,
  error,
  onClose,
}: {
  bundle: WorkflowDebugBundle | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <aside
      className="min-h-0 overflow-auto border-t p-3 md:border-l md:border-t-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Workflow inspector</div>
          <div className="truncate text-token-xs text-[color:var(--text-muted)]">
            Trace, logs, artifacts, checkpoints, and script
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded border"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
          aria-label="Close workflow inspector"
          title="Close inspector"
        >
          <X size={14} />
        </button>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={15} className="animate-spin" />
          Loading debug bundle
        </div>
      ) : error ? (
        <div className="rounded-token border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-token-sm text-[color:var(--color-danger)]">
          {error}
        </div>
      ) : !bundle ? (
        <div className="flex h-32 items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
          Select a workflow to inspect
        </div>
      ) : (
        <div className="space-y-3 text-token-sm">
          <section className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-subtle)] px-3 py-2">
            <div className="truncate font-semibold">{bundle.workflow.objective}</div>
            <div className="mt-1 grid gap-1 text-token-xs text-[color:var(--text-muted)]">
              <span>{bundle.workflow.status} · {formatWorkflowTime(bundle.workflow.createdAt)}</span>
              <span>
                {bundle.counts.traceEvents} trace · {bundle.counts.logs} logs · {bundle.counts.artifacts} artifacts · {bundle.counts.checkpoints} checkpoints
              </span>
              <span>Capabilities: {bundle.workflow.manifest.capabilities.join(", ")}</span>
            </div>
          </section>

          <section className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-subtle)] px-3 py-2">
            <div className="mb-1 font-semibold">Trace</div>
            {bundle.traceEvents.length ? (
              <div className="space-y-1">
                {bundle.traceEvents.map((event, index) => (
                  <div key={`${event.type}-${index}`} className="rounded-token-sm border border-[color:var(--border-soft)] px-2 py-1">
                    <div className="flex gap-2">
                      <span className="shrink-0 font-medium">{event.type}</span>
                      <span className="min-w-0 truncate text-[color:var(--text-muted)]">
                        {workflowTraceSummary(event)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-token-xs text-[color:var(--text-muted)]">
                      {formatWorkflowTime(event.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[color:var(--text-muted)]">No trace events</div>
            )}
          </section>

          {bundle.logs.length > 0 && (
            <section className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-subtle)] px-3 py-2">
              <div className="mb-1 font-semibold">Logs</div>
              <div className="space-y-1">
                {bundle.logs.slice(-20).map((log, index) => (
                  <div key={index} className="text-[color:var(--text-muted)]">
                    [{log.level}] {log.message}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-subtle)] px-3 py-2">
            <div className="mb-1 font-semibold">Artifacts & checkpoints</div>
            {[...bundle.artifacts, ...bundle.checkpoints].length ? (
              <div className="space-y-1">
                {[...bundle.artifacts, ...bundle.checkpoints].slice(-12).map((item, index) => (
                  <details key={`${item.name}-${index}`}>
                    <summary className="cursor-pointer list-none truncate [&::-webkit-details-marker]:hidden">
                      {item.name}
                    </summary>
                    <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-token-xs text-[color:var(--text-muted)]">
                      {shortWorkflowJson(item.value)}
                    </pre>
                  </details>
                ))}
              </div>
            ) : (
              <div className="text-[color:var(--text-muted)]">No artifacts or checkpoints</div>
            )}
          </section>

          <details className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-subtle)] px-3 py-2">
            <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
              Script
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-token-xs text-[color:var(--text-muted)]">
              {bundle.script}
            </pre>
          </details>
        </div>
      )}
    </aside>
  );
}

export function WorkflowHistoryPanel({
  items,
  loading,
  debugBundle,
  debugLoading,
  debugError,
  onRefresh,
  onClose,
  onResume,
  onInspect,
  onCloseInspector,
}: {
  items: WorkflowResumeSnapshot[];
  loading: boolean;
  debugBundle: WorkflowDebugBundle | null;
  debugLoading: boolean;
  debugError: string | null;
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
  onResume: (snapshot: WorkflowResumeSnapshot, checkpointName?: string) => void;
  onInspect: (snapshot: WorkflowResumeSnapshot) => void | Promise<void>;
  onCloseInspector: () => void;
}) {
  const visible = items.slice(0, 50);
  const [selectedCheckpoints, setSelectedCheckpoints] = useState<
    Record<string, string>
  >({});
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-12"
      style={{ background: "var(--color-overlay)" }}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-panel)",
          color: "var(--text)",
        }}
      >
        <div
          className="flex h-11 items-center gap-2 border-b px-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Workflow history</div>
            <div className="truncate text-token-xs" style={{ color: "var(--text-muted)" }}>
              Resume from persisted checkpoints and artifacts
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onRefresh()}
            className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs disabled:opacity-50"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded border"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}
            aria-label="Close workflow history"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <div className="min-h-0 overflow-auto p-2">
            {loading && visible.length === 0 ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={15} className="animate-spin" />
                Loading workflows
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
                No resumable workflow history yet
              </div>
            ) : (
              <div className="space-y-1.5">
                {visible.map((item) => (
                  <div
                    key={item.workflowId}
                    className="rounded border px-3 py-2"
                    style={{
                      borderColor: "var(--border-soft)",
                      background: "color-mix(in srgb, var(--text) 2%, transparent)",
                    }}
                  >
                    <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {item.objective || item.workflowId}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-token-xs" style={{ color: "var(--text-muted)" }}>
                        <span>{item.status}</span>
                        <span>{item.checkpointNames.length} checkpoints</span>
                        <span>{item.artifactNames.length} artifacts</span>
                        {item.lastCheckpoint ? (
                          <span>Latest: {item.lastCheckpoint.name}</span>
                        ) : null}
                        <span>{formatWorkflowTime(item.lastCheckpoint?.createdAt)}</span>
                      </div>
                      {!item.canResume && item.reason ? (
                        <div className="mt-1 text-token-xs" style={{ color: "var(--text-muted)" }}>
                          {item.reason}
                        </div>
                      ) : null}
                      {item.canResume && item.checkpointNames.length > 1 ? (
                        <label className="mt-2 flex max-w-sm items-center gap-2 text-token-xs" style={{ color: "var(--text-muted)" }}>
                          <span className="shrink-0">Checkpoint</span>
                          <select
                            value={
                              selectedCheckpoints[item.workflowId] ??
                              item.lastCheckpoint?.name ??
                              item.checkpointNames[item.checkpointNames.length - 1] ??
                              ""
                            }
                            onChange={(event) =>
                              setSelectedCheckpoints((cur) => ({
                                ...cur,
                                [item.workflowId]: event.target.value,
                              }))
                            }
                            className="min-w-0 flex-1 rounded border bg-transparent px-2 py-1 text-token-xs outline-none"
                            style={{
                              borderColor: "var(--border-soft)",
                              color: "var(--text)",
                            }}
                          >
                            {item.checkpointNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {(item.checkpointSummaries.at(-1)?.preview ||
                        item.artifactSummaries.at(-1)?.preview) && (
                        <div
                          className="mt-2 line-clamp-2 text-token-xs"
                          style={{ color: "var(--text-muted)" }}
                          title={
                            item.checkpointSummaries.at(-1)?.preview ??
                            item.artifactSummaries.at(-1)?.preview
                          }
                        >
                          {item.checkpointSummaries.at(-1)?.preview ??
                            item.artifactSummaries.at(-1)?.preview}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => void onInspect(item)}
                        className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs"
                        style={{
                          borderColor: "var(--border-soft)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <FileText size={13} />
                        Inspect
                      </button>
                      <button
                        type="button"
                        disabled={!item.canResume}
                        onClick={() =>
                          onResume(
                            item,
                            selectedCheckpoints[item.workflowId] ??
                              item.lastCheckpoint?.name
                          )
                        }
                        className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                        style={{
                          borderColor: "var(--border-soft)",
                          color: item.canResume ? "var(--text)" : "var(--text-muted)",
                        }}
                      >
                        <RotateCcw size={13} />
                        Resume
                      </button>
                    </div>
                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <WorkflowDebugInspector
            bundle={debugBundle}
            loading={debugLoading}
            error={debugError}
            onClose={onCloseInspector}
          />
        </div>
      </div>
    </div>
  );
}
