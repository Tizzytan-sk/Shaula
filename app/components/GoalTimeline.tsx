"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  FileText,
  Loader2,
  XCircle,
} from "lucide-react";
import type { AgentGoal, GoalEvidence, GoalTurn } from "@/lib/goal/types";
import type { GoalRunClosure } from "@/lib/goal/types";
import type { ExecutionContractSummary } from "@/lib/execution-contract/types";
import type {
  EvidenceRef,
  EvidenceSourceType,
} from "@/lib/evidence/types";
import type { EvaluationAction } from "@/lib/evaluation-actions/types";
import type { AdvisoryRouteDecision } from "@/lib/task-router/types";
import { userFacingMessage } from "@/lib/user-facing-error";
import {
  evidenceTrustLabel,
  evidenceTrustTone,
} from "./evidence-labels";

export interface GoalTimelineProps {
  agentId: string;
  /** When false the component renders nothing (collapsed). */
  open: boolean;
}

interface TimelinePayload {
  goal: AgentGoal | null;
  contract: ExecutionContractSummary | null;
  turns: GoalTurn[];
  evidence: GoalEvidence[];
  ledgerEvidence: EvidenceRef[];
  actions: EvaluationAction[];
  routeDecision: AdvisoryRouteDecision | null;
  lastClosure: GoalRunClosure | null;
}

function turnTone(status: GoalTurn["status"]) {
  switch (status) {
    case "completed":
      return { color: "var(--color-success)", Icon: CheckCircle2 };
    case "blocked":
      return { color: "var(--color-danger)", Icon: XCircle };
    case "failed":
      return { color: "var(--color-danger)", Icon: AlertTriangle };
    default:
      return { color: "var(--accent)", Icon: CircleDot };
  }
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "";
  }
}

function formatDuration(turn: GoalTurn): string {
  if (!turn.endedAt) return "";
  const sec = Math.max(0, Math.round((turn.endedAt - turn.startedAt) / 1000));
  return `${sec}s`;
}

function evaluationColor(
  status: NonNullable<AgentGoal["lastEvaluation"]>["status"]
): string {
  if (status === "passed") return "var(--color-success)";
  if (status === "warning") return "var(--color-warning)";
  return "var(--color-danger)";
}

function evaluationScore(
  evaluation: NonNullable<AgentGoal["lastEvaluation"]>
): string {
  return `${evaluation.totalScore.toFixed(2)} / ${evaluation.targetScore.toFixed(
    2
  )}`;
}

function sourceTypeLabel(source?: EvidenceSourceType): string {
  switch (source) {
    case "browser":
      return "browser";
    case "progress":
      return "progress";
    case "workflow":
      return "workflow";
    case "subagent":
      return "subagent";
    case "approval":
      return "approval";
    case "goal":
      return "goal";
    case "task":
      return "task";
    case "system":
      return "system";
    case "agent":
      return "agent";
    default:
      return "source";
  }
}

type AttentionTone = "warning" | "danger";

interface AttentionItem {
  key: string;
  label: string;
  title: string;
  detail?: string;
  tone: AttentionTone;
}

function attentionColor(tone: AttentionTone): string {
  return tone === "danger" ? "var(--color-danger)" : "var(--color-warning)";
}

function addAttentionItem(
  items: AttentionItem[],
  seen: Set<string>,
  item: AttentionItem
) {
  const dedupeKey = `${item.label}:${item.title}`.toLowerCase();
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  items.push(item);
}

function collectAttentionItems(data: TimelinePayload): AttentionItem[] {
  const items: AttentionItem[] = [];
  const seen = new Set<string>();
  const evaluation = data.goal?.lastEvaluation;

  for (const item of data.lastClosure?.missingEvidence ?? []) {
    addAttentionItem(items, seen, {
      key: `closure-missing:${item}`,
      label: "Missing evidence",
      title: item,
      detail: data.lastClosure?.nextAction,
      tone: "warning",
    });
  }

  for (const item of evaluation?.missingEvidence ?? []) {
    addAttentionItem(items, seen, {
      key: `evaluation-missing:${item}`,
      label: "Missing evidence",
      title: item,
      detail: evaluation?.nextAction,
      tone: "warning",
    });
  }

  for (const item of evaluation?.hardFails ?? []) {
    addAttentionItem(items, seen, {
      key: `evaluation-hard-fail:${item}`,
      label: "Completion check blocked",
      title: item,
      detail: evaluation?.nextAction,
      tone: "danger",
    });
  }

  for (const item of evaluation?.failedCriteria ?? []) {
    addAttentionItem(items, seen, {
      key: `evaluation-failed:${item}`,
      label: "Failed requirement",
      title: item,
      detail: evaluation?.nextAction,
      tone: "danger",
    });
  }

  for (const action of data.actions) {
    if (action.status !== "open") continue;
    if (
      action.kind !== "missing_evidence" &&
      action.kind !== "hard_fail" &&
      action.kind !== "failed_criterion" &&
      action.kind !== "blocked"
    ) {
      continue;
    }
    addAttentionItem(items, seen, {
      key: `action:${action.key}`,
      label:
        action.kind === "missing_evidence"
          ? "Missing evidence"
          : action.kind === "blocked"
            ? "Blocked"
            : "Completion check blocked",
      title: action.title,
      detail: action.nextAction || action.detail,
      tone: action.kind === "missing_evidence" ? "warning" : "danger",
    });
  }

  return items.slice(0, 8);
}

export function GoalTimeline({ agentId, open }: GoalTimelineProps) {
  const [data, setData] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/${agentId}?action=goal_timeline`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Partial<TimelinePayload>;
      setData({
        goal: json.goal ?? null,
        contract: json.contract ?? null,
        turns: Array.isArray(json.turns) ? json.turns : [],
        evidence: Array.isArray(json.evidence) ? json.evidence : [],
        ledgerEvidence: Array.isArray(json.ledgerEvidence)
          ? json.ledgerEvidence
          : [],
        actions: Array.isArray(json.actions) ? json.actions : [],
        routeDecision: json.routeDecision ?? null,
        lastClosure: json.lastClosure ?? null,
      });
    } catch (e) {
      setError(userFacingMessage(e));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!open) return;
    // Defer to a microtask so the load (which sets state) does not run
    // synchronously inside the effect body.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [open, load]);

  if (!open) return null;

  return (
    <div
      className="mt-1 mb-2 rounded-md border px-3 py-2 text-xs"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border)",
        color: "var(--text)",
      }}
      data-testid="goal-timeline"
    >
      {loading && (
        <div
          className="flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={12} className="animate-spin" />
          Loading timeline…
        </div>
      )}

      {error && (
        <div
          className="flex items-center gap-1.5"
          style={{ color: "var(--color-danger)" }}
        >
          <AlertTriangle size={12} />
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="underline hover:opacity-80"
          >
            retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.lastClosure && (
            <ClosureSummary closure={data.lastClosure} />
          )}

          {data.goal?.lastEvaluation && (
            <EvaluationSummary evaluation={data.goal.lastEvaluation} />
          )}

          {collectAttentionItems(data).length > 0 && (
            <AttentionSummary items={collectAttentionItems(data)} />
          )}

          {data.actions.length > 0 && (
            <ActionQueueSummary actions={data.actions} />
          )}

          {data.routeDecision && (
            <RouteDecisionSummary decision={data.routeDecision} />
          )}

          {data.contract && <ContractSummary contract={data.contract} />}

          {data.turns.length === 0 &&
            data.evidence.length === 0 &&
            !data.contract &&
            data.ledgerEvidence.length === 0 &&
            data.actions.length === 0 &&
            !data.routeDecision &&
            !data.lastClosure &&
            !data.goal?.lastEvaluation && (
            <div style={{ color: "var(--text-muted)" }}>
              No turns or evidence recorded yet.
            </div>
          )}

          {data.turns.length > 0 && (
            <div className="mb-2">
              <div
                className="mb-1 font-medium uppercase tracking-wide text-token-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Turns ({data.turns.length})
              </div>
              <ol className="space-y-1">
                {data.turns.map((turn) => {
                  const { color, Icon } = turnTone(turn.status);
                  return (
                    <li
                      key={turn.turnNumber}
                      className="flex items-start gap-1.5"
                    >
                      <Icon
                        size={12}
                        style={{ color }}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">#{turn.turnNumber}</span>
                          <span style={{ color }}>{turn.status}</span>
                          <span
                            className="text-token-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {formatTime(turn.startedAt)}
                            {formatDuration(turn)
                              ? ` · ${formatDuration(turn)}`
                              : ""}
                          </span>
                        </div>
                        {turn.summary && (
                          <div
                            className="truncate"
                            title={turn.summary}
                            style={{ color: "var(--text-muted)" }}
                          >
                            {turn.summary}
                          </div>
                        )}
                        {turn.blockedReason && (
                          <div
                            className="truncate"
                            title={turn.blockedReason}
                            style={{ color: "var(--color-danger)" }}
                          >
                            blocked: {turn.blockedReason}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {data.evidence.length > 0 && (
            <div>
              <div
                className="mb-1 font-medium uppercase tracking-wide text-token-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Evidence ({data.evidence.length})
              </div>
              <ul className="space-y-1">
                {data.evidence.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-1.5">
                    <FileText
                      size={12}
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--text-muted)" }}
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className="mr-1 rounded-token-sm px-1 py-0.5 text-token-xs uppercase"
                        style={{
                          background: "var(--bg-selected)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {ev.kind}
                      </span>
                      {ev.href ? (
                        <a
                          href={ev.href}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:opacity-80"
                          title={ev.href}
                        >
                          {ev.title}
                        </a>
                      ) : (
                        <span title={ev.summary ?? ev.title}>{ev.title}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.ledgerEvidence.length > 0 && (
            <LedgerEvidenceSummary evidence={data.ledgerEvidence} />
          )}
        </>
      )}
    </div>
  );
}

function closureTone(verdict: GoalRunClosure["verdict"]): string {
  if (verdict === "ready_to_finalize") return "var(--color-success)";
  if (verdict === "needs_user" || verdict === "blocked") {
    return "var(--color-warning)";
  }
  return "var(--accent)";
}

function ClosureSummary({ closure }: { closure: GoalRunClosure }) {
  const color = closureTone(closure.verdict);
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-run-closure"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <ClipboardCheck
          size={13}
          className="shrink-0"
          style={{ color }}
        />
        <span className="font-medium">Run closure</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color,
          }}
        >
          {closure.verdict}
        </span>
        {typeof closure.evaluationScore === "number" &&
          typeof closure.evaluationTargetScore === "number" && (
            <span
              className="rounded-token-sm px-1 py-0.5 text-token-xs"
              style={{
                background: "var(--bg-selected)",
                color: "var(--text-muted)",
              }}
            >
              {closure.evaluationScore.toFixed(2)} /{" "}
              {closure.evaluationTargetScore.toFixed(2)}
            </span>
          )}
      </div>
      <div className="break-words leading-5">
        {closure.reason}
      </div>
      <div
        className="mt-0.5 break-words leading-5"
        style={{ color: "var(--text-muted)" }}
      >
        Next: {closure.nextAction}
      </div>
      {closure.missingEvidence.length > 0 && (
        <ul className="mt-1 space-y-0.5" style={{ color: "var(--color-warning)" }}>
          {closure.missingEvidence.slice(0, 4).map((item) => (
            <li key={item} className="break-words">
              Missing: {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RouteDecisionSummary({
  decision,
}: {
  decision: AdvisoryRouteDecision;
}) {
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-route-decision"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <CircleDot
          size={13}
          className="shrink-0"
          style={{ color: "var(--accent)" }}
        />
        <span className="font-medium">Route decision</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {decision.route}
        </span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {decision.confidence.toFixed(2)}
        </span>
      </div>
      <div className="truncate" title={decision.reasons.join("; ")}>
        {decision.reasons.slice(0, 2).join("; ")}
      </div>
      {decision.overriddenFrom && (
        <div
          className="mt-0.5 truncate"
          style={{ color: "var(--text-muted)" }}
          title={decision.overrideReason}
        >
          Override: {decision.overriddenFrom} {" -> "} {decision.route}
        </div>
      )}
    </div>
  );
}

function actionColor(kind: EvaluationAction["kind"]): string {
  if (kind === "missing_evidence") return "var(--color-warning)";
  if (kind === "ask_user" || kind === "blocked") return "var(--color-danger)";
  return "var(--accent)";
}

function actionKindLabel(kind: EvaluationAction["kind"]): string {
  switch (kind) {
    case "missing_evidence":
      return "Missing evidence";
    case "hard_fail":
      return "Hard fail";
    case "failed_criterion":
      return "Failed requirement";
    case "min_score_failure":
      return "Score below target";
    case "triggered_pitfall":
      return "Triggered pitfall";
    case "ask_user":
      return "Ask user";
    case "blocked":
      return "Blocked";
  }
}

function AttentionSummary({ items }: { items: AttentionItem[] }) {
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-attention-summary"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <AlertTriangle
          size={13}
          className="shrink-0"
          style={{ color: "var(--color-warning)" }}
        />
        <span className="font-medium">Needs attention</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="shrink-0 rounded-token-sm px-1 py-0.5 text-token-xs"
                style={{
                  background: "var(--bg-selected)",
                  color: attentionColor(item.tone),
                }}
              >
                {item.label}
              </span>
              <span className="min-w-0 truncate" title={item.title}>
                {item.title}
              </span>
            </div>
            {item.detail && (
              <div
                className="truncate pl-1"
                style={{ color: "var(--text-muted)" }}
                title={item.detail}
              >
                {item.detail}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionQueueSummary({ actions }: { actions: EvaluationAction[] }) {
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-action-queue"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <AlertTriangle
          size={13}
          className="shrink-0"
          style={{ color: "var(--color-warning)" }}
        />
        <span className="font-medium">Action queue</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {actions.length}
        </span>
      </div>
      <ul className="space-y-1">
        {actions.slice(0, 6).map((action) => (
          <li key={action.id} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="shrink-0 rounded-token-sm px-1 py-0.5 text-token-xs"
                style={{
                  background: "var(--bg-selected)",
                  color: actionColor(action.kind),
                }}
              >
                {actionKindLabel(action.kind)}
              </span>
              <span className="min-w-0 truncate" title={action.title}>
                {action.title}
              </span>
            </div>
            <div
              className="truncate pl-1"
              style={{ color: "var(--text-muted)" }}
              title={action.nextAction}
            >
              {action.nextAction}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function criterionKey(evidence: EvidenceRef): string {
  const mapped = evidence.criteria?.[0];
  return (
    mapped?.contractCriterionId ??
    mapped?.rubricCriterionId ??
    mapped?.requiredEvidence ??
    "unmapped"
  );
}

function sourceLabel(evidence: EvidenceRef): string {
  if (!evidence.source) return "unknown";
  return evidence.source.id
    ? `${evidence.source.type}:${evidence.source.id}`
    : evidence.source.type;
}

function LedgerEvidenceSummary({ evidence }: { evidence: EvidenceRef[] }) {
  const groups = new Map<string, EvidenceRef[]>();
  for (const item of evidence) {
    const key = criterionKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-ledger-evidence"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <FileText
          size={13}
          className="shrink-0"
          style={{ color: "var(--accent)" }}
        />
        <span className="font-medium">Evidence ledger</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {evidence.length}
        </span>
      </div>
      <div className="space-y-1">
        {[...groups.entries()].slice(0, 6).map(([key, items]) => (
          <div key={key}>
            <div
              className="mb-0.5 text-token-xs uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              {key} ({items.length})
            </div>
            <ul className="space-y-0.5">
              {items.slice(-4).map((item) => (
                <li key={item.id} className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className="shrink-0 rounded-token-sm px-1 py-0.5 text-token-xs"
                      style={{
                        background: "var(--bg-selected)",
                        color: evidenceTrustTone(item.trustLevel),
                      }}
                      title={item.trustLevel ?? "unknown trust"}
                    >
                      {evidenceTrustLabel(item.trustLevel)}
                    </span>
                    <span
                      className="shrink-0 rounded-token-sm px-1 py-0.5 text-token-xs"
                      style={{
                        background: "var(--bg-selected)",
                        color: "var(--text-muted)",
                      }}
                      title={sourceLabel(item)}
                    >
                      {sourceTypeLabel(item.source?.type)}
                    </span>
                    <span
                      className="min-w-0 truncate"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                  </div>
                  {(item.summary ?? item.textPreview) && (
                    <div
                      className="truncate pl-1"
                      style={{ color: "var(--text-muted)" }}
                      title={item.summary ?? item.textPreview}
                    >
                      {item.summary ?? item.textPreview}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvaluationSummary({
  evaluation,
}: {
  evaluation: NonNullable<AgentGoal["lastEvaluation"]>;
}) {
  const Icon = evaluation.status === "passed" ? CheckCircle2 : AlertTriangle;
  const color = evaluationColor(evaluation.status);
  const gaps = [
    ...evaluation.missingEvidence.map((item) => `Missing: ${item}`),
    ...evaluation.hardFails.map((item) => `Hard fail: ${item}`),
    ...evaluation.failedCriteria.map((item) => `Failed: ${item}`),
  ].slice(0, 6);

  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-evaluation-summary"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Icon size={13} className="shrink-0" style={{ color }} />
        <span className="font-medium">Completion evaluation</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{ background: "var(--bg-selected)", color }}
        >
          {evaluation.status}
        </span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {evaluationScore(evaluation)}
        </span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {evaluation.recommendation}
        </span>
      </div>
      <div style={{ color: "var(--text-muted)" }}>{evaluation.nextAction}</div>
      {gaps.length > 0 && (
        <ul className="mt-1 space-y-0.5" style={{ color: "var(--text-muted)" }}>
          {gaps.map((item) => (
            <li key={item} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContractSummary({ contract }: { contract: ExecutionContractSummary }) {
  const selection = contract.profileSelection;
  return (
    <div
      className="mb-2 border-b pb-2"
      style={{ borderColor: "var(--border-soft)" }}
      data-testid="goal-contract-summary"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <ClipboardCheck
          size={13}
          className="shrink-0"
          style={{ color: "var(--accent)" }}
        />
        <span className="font-medium">Execution contract</span>
        <span
          className="rounded-token-sm px-1 py-0.5 text-token-xs"
          style={{
            background: "var(--bg-selected)",
            color: "var(--text-muted)",
          }}
        >
          {contract.rubricProfile}
        </span>
        {selection && (
          <span
            className="rounded-token-sm px-1 py-0.5 text-token-xs"
            style={{
              background: "var(--bg-selected)",
              color:
                selection.source === "override"
                  ? "var(--color-warning)"
                  : "var(--text-muted)",
            }}
            title={
              selection.source === "override"
                ? `route override: ${selection.inferredProfile} -> ${selection.selectedProfile}`
                : `route inferred: ${selection.selectedProfile}`
            }
          >
            route: {selection.source}
          </span>
        )}
      </div>
      <div className="truncate" title={contract.objective}>
        {contract.objective}
      </div>
      {selection && (
        <div
          className="mt-0.5 truncate text-token-xs"
          style={{ color: "var(--text-muted)" }}
          title={
            selection.source === "override"
              ? `${selection.inferredProfile} -> ${selection.selectedProfile}`
              : selection.selectedProfile
          }
        >
          Profile route:{" "}
          {selection.source === "override"
            ? `${selection.inferredProfile} -> ${selection.selectedProfile}`
            : `inferred ${selection.selectedProfile}`}
        </div>
      )}
      {contract.requiredEvidence.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {contract.requiredEvidence.slice(0, 8).map((item) => (
            <span
              key={item}
              className="rounded-token-sm px-1.5 py-0.5 text-token-xs uppercase"
              style={{
                background: "var(--bg-selected)",
                color: "var(--text-muted)",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}
      {contract.acceptanceCriteria.length > 0 && (
        <ul className="mt-1 space-y-0.5" style={{ color: "var(--text-muted)" }}>
          {contract.acceptanceCriteria.slice(0, 3).map((item) => (
            <li key={item.id} className="truncate" title={item.description}>
              {item.required ? "Required" : "Optional"}: {item.description}
            </li>
          ))}
        </ul>
      )}
      {contract.nonGoals.length > 0 && (
        <div
          className="mt-1 truncate"
          style={{ color: "var(--text-muted)" }}
          title={contract.nonGoals.join("\n")}
        >
          Non-goals: {contract.nonGoals.slice(0, 2).join("; ")}
        </div>
      )}
    </div>
  );
}
