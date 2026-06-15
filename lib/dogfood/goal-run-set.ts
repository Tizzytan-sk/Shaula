import type { EvaluationAction } from "@/lib/evaluation-actions/types";
import type { EvaluationEvidence } from "@/lib/evaluation/types";
import { evaluateGoalRunClosure } from "@/lib/goal/closure";
import type {
  AgentGoal,
  GoalEvidence,
  GoalRunClosureVerdict,
} from "@/lib/goal/types";
import { verifyGoalCompletion } from "@/lib/goal/verifier";

export type DogfoodGoalCaseId =
  | "code-change-success"
  | "ui-check-success"
  | "verifier-rejection"
  | "needs-user-pause"
  | "blocked-pause";

export type DogfoodFinalOutcome =
  | "ready_to_finalize"
  | "continued_after_rejection"
  | "paused_for_user"
  | "paused_blocked";

export interface DogfoodGoalRunRecord {
  id: DogfoodGoalCaseId;
  title: string;
  objective: string;
  expectedVerdict: GoalRunClosureVerdict;
  closureVerdict: GoalRunClosureVerdict;
  verificationDecision: "accept" | "reject";
  evaluationStatus: string;
  evidence: Array<{
    id: string;
    kind: string;
    trustLevel?: string;
    outcome?: string;
  }>;
  missingEvidence: string[];
  openActionCount: number;
  autoContinueCount: number;
  verifierRejections: number;
  userIntervention: "none" | "decision" | "external_unblock";
  finalOutcome: DogfoodFinalOutcome;
  notes: string;
}

interface DogfoodCaseDefinition {
  id: DogfoodGoalCaseId;
  title: string;
  objective: string;
  expectedVerdict: GoalRunClosureVerdict;
  goal?: Partial<AgentGoal>;
  requiredEvidence?: string[];
  evidence?: GoalEvidence[];
  evaluationEvidence?: EvaluationEvidence[];
  openActions?: EvaluationAction[];
  notes: string;
}

export function runLocalGoalDogfoodSet(
  input: { createdAt?: number; agentId?: string } = {}
): DogfoodGoalRunRecord[] {
  const createdAt = input.createdAt ?? Date.now();
  const agentId = input.agentId ?? "dogfood-agent";
  return dogfoodCaseDefinitions(createdAt, agentId).map((definition) => {
    const goal = buildGoal(definition, createdAt);
    const verification = verifyGoalCompletion({
      goal: { objective: goal.objective, acceptanceCriteria: goal.acceptanceCriteria },
      contract: {
        objective: definition.objective,
        requiredEvidence: definition.requiredEvidence ?? [],
      },
      evidence: definition.evidence ?? [],
      evaluationEvidence: definition.evaluationEvidence ?? [],
      turns: [],
    });
    const closure = evaluateGoalRunClosure({
      agentId,
      goal,
      verification,
      openActions: definition.openActions ?? [],
      createdAt,
    });
    return {
      id: definition.id,
      title: definition.title,
      objective: definition.objective,
      expectedVerdict: definition.expectedVerdict,
      closureVerdict: closure.verdict,
      verificationDecision: verification.decision,
      evaluationStatus: verification.evaluation.status,
      evidence: (definition.evaluationEvidence ?? []).map((item) => ({
        id: item.id,
        kind: item.kind,
        trustLevel: item.trustLevel,
        outcome: item.outcome,
      })),
      missingEvidence: closure.missingEvidence,
      openActionCount: closure.openActions.length,
      autoContinueCount: predictedAutoContinueCount(closure.verdict),
      verifierRejections: verification.decision === "reject" ? 1 : 0,
      userIntervention: interventionFor(closure.verdict),
      finalOutcome: finalOutcomeFor(closure.verdict),
      notes: definition.notes,
    };
  });
}

function dogfoodCaseDefinitions(
  createdAt: number,
  agentId: string
): DogfoodCaseDefinition[] {
  return [
    {
      id: "code-change-success",
      title: "Code change accepted after deterministic evidence",
      objective: "Complete a scoped code change with diff and test evidence.",
      expectedVerdict: "ready_to_finalize",
      requiredEvidence: ["diff", "test_result"],
      evidence: [
        goalEvidence("diff-evidence", "diff", "Code diff recorded", createdAt),
        goalEvidence("test-evidence", "test", "Targeted tests passed", createdAt),
      ],
      evaluationEvidence: [
        evalEvidence("diff-evidence", "diff", "Code diff recorded", "deterministic_check", createdAt),
        evalEvidence(
          "test-evidence",
          "test_result",
          "Targeted tests passed",
          "deterministic_check",
          createdAt,
          "passed"
        ),
      ],
      notes: "Represents a normal scoped code task after evidence has been collected.",
    },
    {
      id: "ui-check-success",
      title: "UI check accepted after host-observed browser evidence",
      objective: "Complete a UI check with browser observation evidence.",
      expectedVerdict: "ready_to_finalize",
      requiredEvidence: ["browser_observation"],
      evidence: [
        goalEvidence("browser-evidence", "browser", "Browser observed UI", createdAt),
      ],
      evaluationEvidence: [
        evalEvidence(
          "browser-evidence",
          "screenshot",
          "Browser observed UI",
          "host_observed",
          createdAt,
          "passed",
          "browser:dogfood"
        ),
      ],
      notes: "Represents a frontend/UI task that should not complete from text-only evidence.",
    },
    {
      id: "verifier-rejection",
      title: "Premature completion rejected for missing deterministic evidence",
      objective: "Reject completion when required test evidence is missing.",
      expectedVerdict: "continue",
      requiredEvidence: ["test_result"],
      evidence: [],
      evaluationEvidence: [],
      openActions: [
        action(agentId, "missing_evidence", "Collect test_result evidence", "Run the required verification check.", createdAt),
      ],
      notes: "Captures fake completion resistance and conversion into a next action.",
    },
    {
      id: "needs-user-pause",
      title: "User decision pauses auto-continuation",
      objective: "Pause when the evaluator requires a user decision.",
      expectedVerdict: "needs_user",
      requiredEvidence: ["user_confirmed_direction"],
      evidence: [],
      evaluationEvidence: [],
      openActions: [
        action(agentId, "ask_user", "Choose the product direction", "Ask the user which path to take.", createdAt),
      ],
      notes: "Captures the pause boundary when Shaula should not guess for the user.",
    },
    {
      id: "blocked-pause",
      title: "External blocker pauses auto-continuation",
      objective: "Pause when an external unblock is required.",
      expectedVerdict: "blocked",
      goal: {
        status: "blocked",
        blockedReason: "Waiting for unavailable credentials.",
        blockedState: {
          reason: "Waiting for unavailable credentials.",
          category: "external_dependency",
          unblockAction: "Provide credentials or choose a no-auth path.",
          repeatedCount: 1,
          firstBlockedAt: createdAt,
          lastBlockedAt: createdAt,
        },
      },
      requiredEvidence: [],
      evidence: [
        goalEvidence("blocker-log", "log", "Credential check failed", createdAt),
      ],
      evaluationEvidence: [
        evalEvidence("blocker-log", "workflow_log", "Credential check failed", "textual_log", createdAt),
      ],
      notes: "Captures the boundary where further autonomous retries would waste turns.",
    },
  ];
}

function buildGoal(
  definition: DogfoodCaseDefinition,
  createdAt: number
): AgentGoal {
  return {
    objective: definition.objective,
    status: "active",
    turns: 1,
    blockedStreak: 0,
    createdAt,
    updatedAt: createdAt,
    ...definition.goal,
  };
}

function goalEvidence(
  id: string,
  kind: GoalEvidence["kind"],
  title: string,
  createdAt: number
): GoalEvidence {
  return {
    id,
    kind,
    title,
    createdAt,
  };
}

function evalEvidence(
  id: string,
  kind: EvaluationEvidence["kind"],
  title: string,
  trustLevel: NonNullable<EvaluationEvidence["trustLevel"]>,
  createdAt: number,
  outcome?: EvaluationEvidence["outcome"],
  source = "system:dogfood"
): EvaluationEvidence {
  return {
    id,
    kind,
    title,
    trustLevel,
    source,
    verifiable: true,
    outcome,
    createdAt,
  };
}

function action(
  agentId: string,
  kind: EvaluationAction["kind"],
  title: string,
  nextAction: string,
  createdAt: number
): EvaluationAction {
  return {
    id: `dogfood-action:${kind}:${createdAt}`,
    agentId,
    key: `dogfood:${kind}`,
    kind,
    status: "open",
    title,
    detail: title,
    target: title,
    latestEvaluationId: "dogfood-evaluation",
    recommendation: kind === "ask_user" ? "ask_user" : "iterate",
    nextAction,
    createdAt,
    updatedAt: createdAt,
  };
}

function predictedAutoContinueCount(verdict: GoalRunClosureVerdict): number {
  if (verdict === "needs_user" || verdict === "blocked") return 0;
  return 1;
}

function interventionFor(
  verdict: GoalRunClosureVerdict
): DogfoodGoalRunRecord["userIntervention"] {
  if (verdict === "needs_user") return "decision";
  if (verdict === "blocked") return "external_unblock";
  return "none";
}

function finalOutcomeFor(verdict: GoalRunClosureVerdict): DogfoodFinalOutcome {
  if (verdict === "ready_to_finalize") return "ready_to_finalize";
  if (verdict === "needs_user") return "paused_for_user";
  if (verdict === "blocked") return "paused_blocked";
  return "continued_after_rejection";
}
