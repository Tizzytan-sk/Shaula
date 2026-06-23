import type {
  AgentGoal,
  GoalAcceptanceCriterion,
  GoalCompletionClaim,
  GoalEvidence,
  GoalTurn,
} from "./types";
import { evaluateRubric } from "@/lib/evaluation/evaluator";
import type {
  CriterionScoreInput,
  EvaluationEvidence,
  RubricCriterion,
  RubricEvaluation,
  RubricSpec,
} from "@/lib/evaluation/types";
import type { EvaluatorContractSource } from "@/lib/evaluation/gate";
import {
  goalEvidenceToEvaluationEvidence,
  requiredEvidenceCoverage,
  type RequiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import {
  blockingRequiredVerificationFailures,
  evidenceOutcome,
} from "@/lib/verification/evidence";
import {
  semanticCompletionFindings,
  type SemanticCompletionFinding,
} from "./semantic-completion";

export type GoalVerifyDecision = "accept" | "reject";

export interface GoalWorkflowStatus {
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  createdAt?: number;
  id?: string;
  objective?: string;
}

export interface GoalVerifyInput {
  goal: Pick<AgentGoal, "objective" | "acceptanceCriteria">;
  contract?: EvaluatorContractSource | null;
  evidence: GoalEvidence[];
  evaluationEvidence?: EvaluationEvidence[];
  turns: GoalTurn[];
  /**
   * Status of workflow runs launched under this goal's agent. The verifier only
   * cares whether any of them failed/aborted, so callers can pass a simple list.
   */
  workflowStatuses?: Array<"pending" | "running" | "completed" | "failed" | "aborted">;
  /**
   * Rich workflow status records, preferably scoped by the caller to the active
   * goal's lifecycle. When provided, failed/aborted runs are considered
   * unresolved only if no later completed workflow supersedes them.
   */
  workflowRuns?: GoalWorkflowStatus[];
  /**
   * Structured completion claim submitted with `goal_update complete`. When
   * present, the verifier checks that the proposed final handoff cites real
   * evidence and that cited evidence covers required contract evidence.
   */
  completionClaim?: GoalCompletionClaim;
  /**
   * Formal completion attempts require a structured claim for contracted or
   * acceptance-gated goals. Readiness checks leave this off so they can decide
   * whether the model should be prompted to produce that claim.
   */
  requireCompletionClaim?: boolean;
}

export interface GoalVerifyResult {
  decision: GoalVerifyDecision;
  /** Human-readable explanation, surfaced to the model when rejected. */
  reason: string;
  /** Descriptions of what is still missing, when rejected. */
  missingEvidence: string[];
  /**
   * Weighted rubric result for UI, persistence, and iteration decisions. This is
   * additive: it never overrides the accept/reject gate above, it only enriches
   * it with a score, recommendation, and per-criterion breakdown.
   */
  evaluation: RubricEvaluation;
}

interface CompletionClaimFinding {
  message: string;
  evidenceIds?: string[];
}

/**
 * Stop-time goal verifier (v1). Decides whether a model's `goal_update complete`
 * should be accepted based on collected evidence rather than the model's word.
 *
 * Rules (v1, intentionally conservative):
 *  1. No evidence at all -> reject (completion must be backed by something).
 *  2. Any related workflow is still running/pending -> reject.
 *  3. Any related workflow failed/aborted after the latest successful workflow
 *     -> reject (unresolved failure). Older failures can be superseded by a
 *     later successful validation workflow.
 *  4. Acceptance criteria exist and a required one is unmet -> reject.
 *
 * Otherwise accept. This is a pure function: callers gather the inputs (from the
 * goal store / workflow store) and pass them in, which keeps it fully testable.
 */
export function verifyGoalCompletion(
  input: GoalVerifyInput
): GoalVerifyResult {
  const missingEvidence: string[] = [];
  const workflowRuns = normalizeWorkflowRuns(input);
  const evaluationEvidence = evaluationEvidenceFor(input);
  const contractRequiredEvidence = input.contract?.requiredEvidence ?? [];
  const contractCoverage = requiredEvidenceCoverage(
    contractRequiredEvidence,
    evaluationEvidence
  );
  const semanticFindings = semanticCompletionFindings({
    contract: input.contract,
    evidence: evaluationEvidence,
  });
  const completionClaimRequired = isCompletionClaimRequired(input);
  const completionClaimFindings = findCompletionClaimFindings({
    claim: input.completionClaim,
    required: completionClaimRequired,
    evidence: evaluationEvidence,
    requiredEvidence: contractRequiredEvidence,
  });
  const evaluation = evaluateGoalCompletion(
    input,
    workflowRuns,
    evaluationEvidence,
    contractCoverage,
    semanticFindings,
    completionClaimFindings
  );

  // Rule 1: completion requires at least one piece of evidence.
  if (input.evidence.length === 0 && evaluationEvidence.length === 0) {
    const required = input.contract?.requiredEvidence?.length
      ? ` Required by contract: ${input.contract.requiredEvidence.join(", ")}.`
      : "";
    missingEvidence.push(
      `At least one evidence artifact (file, test, diff, url, screenshot, browser, or log).${required} Use update_progress to record concrete evidence.`
    );
  }
  for (const missing of contractCoverage.missing) {
    missingEvidence.push(`Missing contract evidence: ${missing}`);
  }
  for (const failure of blockingRequiredVerificationFailures(evaluationEvidence)) {
    const outcome = evidenceOutcome(failure);
    missingEvidence.push(
      `Required verification failed: ${failure.title}${
        outcome ? ` (${outcome})` : ""
      }`
    );
  }
  for (const finding of semanticFindings.filter(
    (item) => item.severity === "blocking"
  )) {
    missingEvidence.push(finding.message);
  }
  for (const finding of completionClaimFindings) {
    missingEvidence.push(finding.message);
  }

  // Rule 2: completion cannot be accepted while related workflows are active.
  const activeWorkflows = workflowRuns.filter(
    (run) => run.status === "pending" || run.status === "running"
  );
  if (activeWorkflows.length > 0) {
    missingEvidence.push(
      `Wait for ${activeWorkflows.length} pending/running workflow run(s) before completing.`
    );
  }

  // Rule 3: failed/aborted workflows block only until a later completed
  // workflow supersedes them. This avoids stale historical failures trapping a
  // goal after a successful rerun records fresh evidence.
  const latestCompletedIndex = workflowRuns
    .map((run, index) => ({ run, index }))
    .filter((item) => item.run.status === "completed")
    .map((item) => item.index)
    .at(-1) ?? -1;
  const failedWorkflows = workflowRuns.filter(
    (run, index) =>
      index > latestCompletedIndex &&
      (run.status === "failed" || run.status === "aborted")
  );
  if (failedWorkflows.length > 0) {
    missingEvidence.push(
      `Resolve ${failedWorkflows.length} failed/aborted workflow run(s) before completing.`
    );
  }

  // Rule 3: required acceptance criteria must be satisfied.
  const unmetCriteria = unmetRequiredCriteria(input.goal.acceptanceCriteria);
  for (const c of unmetCriteria) {
    missingEvidence.push(`Unsatisfied acceptance criterion: ${c.criterion}`);
  }

  if (missingEvidence.length > 0) {
    return {
      decision: "reject",
      reason:
        "Completion was not accepted because required evidence is missing. Keep working on the goal and record evidence, then mark complete again.",
      missingEvidence,
      evaluation,
    };
  }

  return {
    decision: "accept",
    reason: `Completion accepted: evidence present and no unresolved failures (score ${evaluation.totalScore.toFixed(
      2
    )} / ${evaluation.targetScore.toFixed(2)}).`,
    missingEvidence: [],
    evaluation,
  };
}

function normalizeWorkflowRuns(input: GoalVerifyInput): GoalWorkflowStatus[] {
  if (input.workflowRuns) {
    return input.workflowRuns
      .slice()
      .sort((a, b) =>
        typeof a.createdAt === "number" && typeof b.createdAt === "number"
          ? a.createdAt - b.createdAt
          : 0
      );
  }
  return (input.workflowStatuses ?? []).map((status) => ({ status }));
}

function evaluationEvidenceFor(input: GoalVerifyInput): EvaluationEvidence[] {
  if (input.evaluationEvidence) return input.evaluationEvidence;
  return input.evidence.map(goalEvidenceToEvaluationEvidence);
}

function findCompletionClaimFindings({
  claim,
  required,
  evidence,
  requiredEvidence,
}: {
  claim?: GoalCompletionClaim;
  required: boolean;
  evidence: EvaluationEvidence[];
  requiredEvidence: string[];
}): CompletionClaimFinding[] {
  const findings: CompletionClaimFinding[] = [];
  if (!claim) {
    if (required) {
      findings.push({
        message:
          "Structured final summary is required for contracted or acceptance-gated goals; include finalSummary and evidenceIds that cite recorded evidence.",
      });
    }
    return findings;
  }
  const finalSummary = claim.finalSummary.trim();
  const evidenceIds = normalizedClaimEvidenceIds(claim);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  if (!finalSummary) {
    findings.push({
      message:
        "Structured final summary is empty; include the actual handoff summary before completing.",
    });
  }
  if (evidenceIds.length === 0) {
    findings.push({
      message:
        "Structured final summary must cite at least one recorded evidence id.",
    });
    return findings;
  }

  const unknown = evidenceIds.filter((id) => !evidenceById.has(id));
  for (const id of unknown) {
    findings.push({
      message: `Structured final summary cites unknown evidence id: ${id}.`,
      evidenceIds: [id],
    });
  }

  const citedEvidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is EvaluationEvidence => Boolean(item));
  if (requiredEvidence.length > 0 && citedEvidence.length > 0) {
    const citedCoverage = requiredEvidenceCoverage(
      requiredEvidence,
      citedEvidence
    );
    if (citedCoverage.missing.length > 0) {
      findings.push({
        message: `Structured final summary does not cite evidence covering required evidence: ${citedCoverage.missing.join(", ")}.`,
        evidenceIds: citedEvidence.map((item) => item.id),
      });
    }
  }

  return findings;
}

function isCompletionClaimRequired(input: GoalVerifyInput): boolean {
  return (
    input.requireCompletionClaim === true &&
    (Boolean(input.contract) || Boolean(input.goal.acceptanceCriteria?.length))
  );
}

function normalizedClaimEvidenceIds(claim: GoalCompletionClaim): string[] {
  return [
    ...new Set(
      claim.evidenceIds
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50)
    ),
  ];
}

function unmetRequiredCriteria(
  criteria?: GoalAcceptanceCriterion[]
): GoalAcceptanceCriterion[] {
  if (!criteria || criteria.length === 0) return [];
  return criteria.filter((c) => c.status !== "met");
}

/**
 * Build and run an additive rubric evaluation for the goal. Uses only fields the
 * verifier already has, so it stays a pure function and requires no extra inputs.
 * The rubric mirrors the hard gate (evidence + workflow health + acceptance
 * criteria) but expresses it as a weighted score for UI and iteration decisions.
 */
function evaluateGoalCompletion(
  input: GoalVerifyInput,
  workflowRuns: GoalWorkflowStatus[],
  evaluationEvidence: EvaluationEvidence[],
  contractCoverage: RequiredEvidenceCoverage,
  semanticFindings: SemanticCompletionFinding[],
  completionClaimFindings: CompletionClaimFinding[]
): RubricEvaluation {
  const { rubric, scores } = goalRubricInput(
    input,
    workflowRuns,
    evaluationEvidence,
    contractCoverage,
    completionClaimFindings
  );
  const evaluation = evaluateRubric({
    rubric,
    subject: {},
    criteria: scores,
    evidence: evaluationEvidence,
    repeatedBlockerCount: repeatedBlockedTurns(input.turns),
    createdAt: Date.now(),
  });
  const reviewFindings = semanticFindings.filter((item) => item.severity === "review");
  if (reviewFindings.length === 0) return evaluation;
  return {
    ...evaluation,
    status: evaluation.status === "passed" ? "warning" : evaluation.status,
    recommendation:
      evaluation.recommendation === "pass" ? "iterate" : evaluation.recommendation,
    nextAction:
      evaluation.recommendation === "pass"
        ? "Review flagged semantic completion issues."
        : evaluation.nextAction,
    triggeredPitfalls: [
      ...evaluation.triggeredPitfalls,
      ...reviewFindings.map((item) => item.message),
    ],
  };
}

function goalRubricInput(
  input: GoalVerifyInput,
  workflowRuns: GoalWorkflowStatus[],
  evaluationEvidence: EvaluationEvidence[],
  contractCoverage: RequiredEvidenceCoverage,
  completionClaimFindings: CompletionClaimFinding[]
): { rubric: RubricSpec; scores: CriterionScoreInput[] } {
  const contractRequiredEvidence = input.contract?.requiredEvidence ?? [];
  const evidenceIds = evaluationEvidence.map((item) => item.id);
  const completionClaimRequired = isCompletionClaimRequired(input);
  const matchedEvidenceIds =
    contractCoverage.matchedEvidenceIds.length > 0
      ? contractCoverage.matchedEvidenceIds
      : evidenceIds;
  const hasEvidence = input.evidence.length > 0 || evaluationEvidence.length > 0;
  const hasRequiredEvidence = contractCoverage.missing.length === 0;
  const completionClaimEvidenceIds = input.completionClaim
    ? normalizedClaimEvidenceIds(input.completionClaim)
    : [];
  const criteria: RubricCriterion[] = [
    {
      id: "goal-evidence",
      dimensionId: "evidence_traceability",
      importance: "essential",
      description:
        input.contract?.objective
          ? `Completion of the contract objective must be backed by concrete evidence: ${input.contract.objective}`
          : "Completion must be backed by at least one concrete evidence artifact.",
      evidenceRequired:
        contractRequiredEvidence.length > 0
          ? contractRequiredEvidence
          : ["goal_evidence"],
      minEvidenceTrust: "agent_reported",
      hardFail: true,
    },
    {
      id: "workflow-health",
      dimensionId: "runtime_health",
      importance: "essential",
      description: "Related workflows must not be left failed or aborted.",
      hardFail: true,
    },
  ];
  if (completionClaimRequired || input.completionClaim) {
    criteria.push({
      id: "final-summary-evidence",
      dimensionId: "evidence_traceability",
      importance: "essential",
      description:
        "The structured final summary must cite recorded evidence that supports the completion claim.",
      evidenceRequired:
        contractRequiredEvidence.length > 0
          ? contractRequiredEvidence
          : ["goal_evidence"],
      minEvidenceTrust: "agent_reported",
      hardFail: true,
    });
  }
  for (const criterion of input.goal.acceptanceCriteria ?? []) {
    criteria.push({
      id: `acceptance:${criterion.id}`,
      dimensionId: "completion_gate",
      importance: "essential",
      description: criterion.criterion,
      hardFail: true,
    });
  }

  // Mirror the hard-gate logic so the score never disagrees with the decision:
  // active OR unsuperseded failed/aborted runs count as unhealthy.
  const latestCompletedIndex =
    workflowRuns
      .map((run, index) => ({ run, index }))
      .filter((item) => item.run.status === "completed")
      .map((item) => item.index)
      .at(-1) ?? -1;
  const unhealthyWorkflows = workflowRuns.filter(
    (run, index) =>
      run.status === "pending" ||
      run.status === "running" ||
      (index > latestCompletedIndex &&
        (run.status === "failed" || run.status === "aborted"))
  );

  const scores: CriterionScoreInput[] = [
    {
      criterionId: "goal-evidence",
      status: hasEvidence && hasRequiredEvidence ? "pass" : "fail",
      reason:
        hasEvidence && hasRequiredEvidence
          ? "Goal has concrete evidence that covers the required contract evidence."
          : hasEvidence
            ? `Goal evidence does not cover required contract evidence: ${contractCoverage.missing.join(", ")}.`
            : "Goal has no concrete evidence.",
      evidenceIds: hasEvidence ? matchedEvidenceIds : undefined,
    },
    {
      criterionId: "workflow-health",
      status: unhealthyWorkflows.length > 0 ? "fail" : "pass",
      reason:
        unhealthyWorkflows.length > 0
          ? `${unhealthyWorkflows.length} workflow run(s) are active or unresolved.`
          : "No active or unresolved workflow runs.",
    },
  ];
  if (completionClaimRequired || input.completionClaim) {
    scores.push({
      criterionId: "final-summary-evidence",
      status: completionClaimFindings.length === 0 ? "pass" : "fail",
      reason:
        completionClaimFindings.length === 0
          ? "Structured final summary cites recorded evidence that supports the completion claim."
          : completionClaimFindings.map((item) => item.message).join(" "),
      evidenceIds:
        completionClaimEvidenceIds.length > 0
          ? completionClaimEvidenceIds
          : undefined,
    });
  }
  for (const criterion of input.goal.acceptanceCriteria ?? []) {
    scores.push({
      criterionId: `acceptance:${criterion.id}`,
      status: criterion.status === "met" ? "pass" : "fail",
      reason:
        criterion.status === "met"
          ? `Acceptance criterion met: ${criterion.criterion}`
          : `Acceptance criterion not met: ${criterion.criterion}`,
      evidenceIds: criterion.evidence ? [criterion.evidence] : undefined,
    });
  }

  const rubric: RubricSpec = {
    id: "goal-completion",
    version: "1",
    title: "Goal completion rubric",
    profileId: "goal.completion",
    taskClass: "workflow",
    targetScore: 0.9,
    dimensions: [
      { id: "completion_gate", name: "验收完成度", weight: 0.45, minScore: 1 },
      { id: "evidence_traceability", name: "证据可追溯性", weight: 0.35, minScore: 1 },
      { id: "runtime_health", name: "运行健康度", weight: 0.2, minScore: 1 },
    ],
    criteria,
    importanceWeights: {
      essential: 1,
      important: 0.7,
      optional: 0.3,
      pitfall: 0.9,
    },
    exitPolicy: {
      maxIterations: 4,
      minDelta: 0.02,
      blockedRepeatLimit: 3,
      scoreCapWithoutEvidence: 0.65,
    },
    createdAt: Date.now(),
  };
  return { rubric, scores };
}

function repeatedBlockedTurns(turns: GoalTurn[]): number {
  let count = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].status !== "blocked") break;
    count += 1;
  }
  return count;
}

/**
 * Build a continuation prompt fragment from a rejected verification, telling the
 * model exactly what is still missing.
 */
export function buildVerifierRejectionNote(result: GoalVerifyResult): string {
  if (result.decision !== "reject") return "";
  const lines = [
    "The goal was NOT accepted as complete yet.",
    result.reason,
  ];
  if (result.missingEvidence.length > 0) {
    lines.push("Still missing:");
    for (const item of result.missingEvidence) {
      lines.push(`- ${item}`);
    }
  }
  lines.push(
    `Evaluation: ${result.evaluation.status}, score ${result.evaluation.totalScore.toFixed(
      2
    )} / ${result.evaluation.targetScore.toFixed(2)}, recommendation ${
      result.evaluation.recommendation
    }.`
  );
  return lines.join("\n");
}
