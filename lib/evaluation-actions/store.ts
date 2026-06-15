import type { RubricEvaluation } from "@/lib/evaluation/types";
import { actionsFromEvaluation } from "./mapper";
import type { EvaluationAction, EvaluationActionFilter } from "./types";

interface EvaluationActionStore {
  byId: Map<string, EvaluationAction>;
}

const g = globalThis as unknown as {
  __shaulaEvaluationActions?: EvaluationActionStore;
};
if (!g.__shaulaEvaluationActions) {
  g.__shaulaEvaluationActions = { byId: new Map() };
}
const store = g.__shaulaEvaluationActions;

function matches<T>(actual: T | undefined, expected?: T): boolean {
  return expected === undefined || actual === expected;
}

function compareAction(a: EvaluationAction, b: EvaluationAction): number {
  if (a.status !== b.status) return a.status === "open" ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id.localeCompare(b.id);
}

export function listEvaluationActions(
  filter: EvaluationActionFilter = {}
): EvaluationAction[] {
  return [...store.byId.values()]
    .filter(
      (item) =>
        matches(item.agentId, filter.agentId) &&
        matches(item.status, filter.status) &&
        matches(item.kind, filter.kind)
    )
    .sort(compareAction);
}

export function reconcileEvaluationActions(input: {
  agentId: string;
  evaluation: RubricEvaluation;
  createdAt?: number;
}): EvaluationAction[] {
  const createdAt = input.createdAt ?? Date.now();
  const nextActions = actionsFromEvaluation({
    agentId: input.agentId,
    evaluation: input.evaluation,
    createdAt,
  });
  const nextKeys = new Set(nextActions.map((item) => item.key));
  const currentOpen = listEvaluationActions({
    agentId: input.agentId,
    status: "open",
  });

  for (const current of currentOpen) {
    if (nextKeys.has(current.key)) continue;
    store.byId.set(current.id, {
      ...current,
      status: "resolved",
      resolvedAt: createdAt,
      updatedAt: createdAt,
      latestEvaluationId: input.evaluation.id,
      resolutionReason: "No longer present in the latest evaluation.",
    });
  }

  for (const next of nextActions) {
    const current = store.byId.get(next.id);
    store.byId.set(next.id, {
      ...next,
      createdAt: current?.createdAt ?? next.createdAt,
      updatedAt: createdAt,
      status: "open",
      resolvedAt: undefined,
      resolutionReason: undefined,
    });
  }

  return listEvaluationActions({ agentId: input.agentId, status: "open" });
}

export function resolveEvaluationAction(
  id: string,
  reason = "Resolved."
): EvaluationAction | null {
  const current = store.byId.get(id);
  if (!current) return null;
  const now = Date.now();
  const next: EvaluationAction = {
    ...current,
    status: "resolved",
    resolvedAt: now,
    updatedAt: now,
    resolutionReason: reason,
  };
  store.byId.set(id, next);
  return next;
}

export function waiveEvaluationAction(
  id: string,
  reason = "Waived."
): EvaluationAction | null {
  const current = store.byId.get(id);
  if (!current) return null;
  const now = Date.now();
  const next: EvaluationAction = {
    ...current,
    status: "waived",
    resolvedAt: now,
    updatedAt: now,
    resolutionReason: reason,
  };
  store.byId.set(id, next);
  return next;
}

export function __resetEvaluationActionsForTest(): void {
  store.byId.clear();
}
