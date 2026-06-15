import type { RubricEvaluation } from "@/lib/evaluation/types";
import type { EvaluationAction, EvaluationActionKind } from "./types";

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function titleFor(kind: EvaluationActionKind, target: string): string {
  switch (kind) {
    case "missing_evidence":
      return `Collect evidence: ${target}`;
    case "hard_fail":
      return `Fix hard fail: ${target}`;
    case "failed_criterion":
      return `Address criterion: ${target}`;
    case "min_score_failure":
      return `Improve dimension: ${target}`;
    case "triggered_pitfall":
      return `Remove pitfall: ${target}`;
    case "ask_user":
      return "Ask user for required input";
    case "blocked":
      return "Surface blocker";
  }
}

function action(
  input: {
    agentId: string;
    evaluation: RubricEvaluation;
    kind: EvaluationActionKind;
    target: string;
    detail?: string;
    createdAt: number;
  }
): EvaluationAction {
  const key = `${input.kind}:${normalizeKey(input.target)}`;
  return {
    id: `eval-action:${input.agentId}:${key}`,
    agentId: input.agentId,
    key,
    kind: input.kind,
    status: "open",
    title: titleFor(input.kind, input.target),
    detail: input.detail ?? input.target,
    target: input.target,
    latestEvaluationId: input.evaluation.id,
    recommendation: input.evaluation.recommendation,
    nextAction: input.evaluation.nextAction,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function actionsFromEvaluation(input: {
  agentId: string;
  evaluation: RubricEvaluation;
  createdAt?: number;
}): EvaluationAction[] {
  const createdAt = input.createdAt ?? Date.now();
  const actions: EvaluationAction[] = [];
  for (const target of input.evaluation.missingEvidence) {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "missing_evidence",
      target,
      createdAt,
    }));
  }
  for (const target of input.evaluation.hardFails) {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "hard_fail",
      target,
      createdAt,
    }));
  }
  for (const target of input.evaluation.failedCriteria) {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "failed_criterion",
      target,
      createdAt,
    }));
  }
  for (const target of input.evaluation.minScoreFailures) {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "min_score_failure",
      target,
      createdAt,
    }));
  }
  for (const target of input.evaluation.triggeredPitfalls) {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "triggered_pitfall",
      target,
      createdAt,
    }));
  }
  if (input.evaluation.recommendation === "ask_user") {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "ask_user",
      target: input.evaluation.nextAction,
      createdAt,
    }));
  }
  if (input.evaluation.recommendation === "blocked") {
    actions.push(action({
      agentId: input.agentId,
      evaluation: input.evaluation,
      kind: "blocked",
      target: input.evaluation.nextAction,
      createdAt,
    }));
  }
  return dedupeActions(actions);
}

function dedupeActions(actions: EvaluationAction[]): EvaluationAction[] {
  return [...new Map(actions.map((item) => [item.key, item])).values()];
}
