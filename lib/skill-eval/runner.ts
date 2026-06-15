import { inferAdvisoryRouteDecision } from "@/lib/task-router/advisory";
import {
  __resetRouteDecisionsForTest,
  latestRouteDecision,
  recordRouteDecision,
} from "@/lib/task-router/server-store";
import { parseReadOnlyVerifierResult } from "@/lib/verifier/read-only";
import { inferVerificationPlan } from "@/lib/verification/infer";
import { isAllowedVerificationCommand } from "@/lib/verification/runner";
import { evaluateSkillEvalRun } from "./harness";
import { SHAULA_SKILL_EVAL_SUITE_V1, type SkillEvalSuite } from "./suite";
import type {
  SkillEvalCase,
  SkillEvalCaseResult,
  SkillEvalRun,
  SkillEvalRunInput,
} from "./types";

export interface SkillEvalRunnerContext {
  createdAt: number;
}

export type SkillEvalCaseExecutor = (
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
) => SkillEvalCaseResult | Promise<SkillEvalCaseResult>;

export interface RunSkillEvalSuiteInput
  extends Omit<SkillEvalRunInput, "cases" | "results"> {
  suite: SkillEvalSuite;
  executors: Record<string, SkillEvalCaseExecutor>;
  failMissingExecutors?: boolean;
}

export async function runSkillEvalSuite(
  input: RunSkillEvalSuiteInput
): Promise<SkillEvalRun> {
  const createdAt = input.createdAt ?? Date.now();
  const results: SkillEvalCaseResult[] = [];

  for (const testCase of input.suite.cases) {
    const executor = input.executors[testCase.id];
    if (!executor) {
      results.push({
        caseId: testCase.id,
        status: input.failMissingExecutors === false ? "partial" : "fail",
        reason: `No executable runner is registered for case ${testCase.id}.`,
      });
      continue;
    }
    results.push(await executor(testCase, { createdAt }));
  }

  return evaluateSkillEvalRun({
    ...input,
    cases: input.suite.cases,
    results,
    createdAt,
  });
}

export function shaulaSkillEvalSuiteV1Executors(): Record<
  string,
  SkillEvalCaseExecutor
> {
  return {
    "preflight-evidence-ledger": runPreflightEvidenceLedger,
    "task-a-typecheck-fallback": runTypecheckFallbackCase,
    "task-b-readonly-verifier-dirty-json": runReadOnlyVerifierJsonCase,
    "task-c-route-decision-visibility": runRouteDecisionVisibilityCase,
  };
}

export function runShaulaSkillEvalSuiteV1(
  input: Omit<RunSkillEvalSuiteInput, "suite" | "executors">
): Promise<SkillEvalRun> {
  return runSkillEvalSuite({
    ...input,
    suite: SHAULA_SKILL_EVAL_SUITE_V1,
    executors: shaulaSkillEvalSuiteV1Executors(),
  });
}

function passResult(
  testCase: SkillEvalCase,
  reason: string,
  metadata?: SkillEvalCaseResult["metadata"]
): SkillEvalCaseResult {
  return {
    caseId: testCase.id,
    status: "pass",
    score: 1,
    reason,
    metadata,
  };
}

function failResult(testCase: SkillEvalCase, reason: string): SkillEvalCaseResult {
  return {
    caseId: testCase.id,
    status: "fail",
    score: 0,
    reason,
  };
}

function runPreflightEvidenceLedger(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const innerRun = evaluateSkillEvalRun({
    id: "skill-eval-preflight-inner",
    agentId: "skill-eval-runner",
    skillName: "shaula-skill-eval-preflight",
    skillPath: "lib/skill-eval/harness.ts",
    versionDiff: { summary: "Preflight validates evidence and rubric wiring." },
    cases: [
      {
        id: "inner-evidence-case",
        title: "Inner evidence case",
        prompt: "Validate that a skill eval run emits required evidence.",
        kind: "positive",
      },
    ],
    results: [
      {
        caseId: "inner-evidence-case",
        status: "pass",
        reason: "Inner case passed.",
      },
    ],
    createdAt: context.createdAt,
  });
  const evidenceKinds = new Set(
    innerRun.evidence.flatMap((item) =>
      item.criteria?.map((criterion) => criterion.requiredEvidence) ?? []
    )
  );
  const hasRequiredEvidence =
    evidenceKinds.has("eval_run") &&
    evidenceKinds.has("rubric_score") &&
    evidenceKinds.has("version_diff");

  if (innerRun.evaluation.status === "passed" && hasRequiredEvidence) {
    return passResult(testCase, "Harness emits eval_run, rubric_score, and version_diff evidence.", {
      testsRun: ["skill-eval-preflight-inner"],
    });
  }
  return failResult(testCase, "Harness did not emit the required evidence set.");
}

function runTypecheckFallbackCase(testCase: SkillEvalCase): SkillEvalCaseResult {
  const plan = inferVerificationPlan({
    objective: "Provide typecheck evidence for a TypeScript project.",
    profileId: "coding.default",
    requiredEvidence: ["typecheck"],
    packageScripts: { test: "vitest run" },
    hasTypeScriptConfig: true,
    cwd: "C:/repo",
    createdAt: 1,
  });
  const check = plan.checks.find((item) => item.id === "npx-tsc-no-emit");
  if (
    check?.type === "command" &&
    check.required &&
    check.command === "npx" &&
    check.args.join(" ") === "tsc --noEmit --pretty false" &&
    isAllowedVerificationCommand(check)
  ) {
    return passResult(testCase, "Typecheck fallback is inferred and allowlisted.", {
      testsRun: ["inferVerificationPlan", "isAllowedVerificationCommand"],
    });
  }
  return failResult(testCase, "Typecheck fallback was missing or not allowlisted.");
}

function runReadOnlyVerifierJsonCase(testCase: SkillEvalCase): SkillEvalCaseResult {
  const strict = parseReadOnlyVerifierResult(
    '{"decision":"accept","reason":"Enough evidence","missingEvidence":[],"failedCriteria":[],"confidence":0.9}'
  );
  const fenced = parseReadOnlyVerifierResult(
    '```json\n{"decision":"reject","reason":"Missing evidence","missingEvidence":["test_result"],"failedCriteria":["goal-evidence"],"confidence":0.7}\n```'
  );
  const wrappedAccept = parseReadOnlyVerifierResult(
    'Looks good: {"decision":"accept","reason":"Enough evidence","missingEvidence":[],"failedCriteria":[],"confidence":0.9}'
  );
  const invalid = parseReadOnlyVerifierResult("not json");
  const multi = parseReadOnlyVerifierResult(
    '{"decision":"accept","reason":"one","confidence":1} {"decision":"accept","reason":"two","confidence":1}'
  );

  if (
    strict.decision === "accept" &&
    fenced.decision === "reject" &&
    wrappedAccept.decision === "needs_review" &&
    invalid.decision === "needs_review" &&
    multi.decision === "needs_review"
  ) {
    return passResult(testCase, "Verifier parser accepts only unambiguous structured output.", {
      testsRun: ["parseReadOnlyVerifierResult"],
      verifierRejectionCount: 3,
    });
  }
  return failResult(testCase, "Verifier parser accepted ambiguous or invalid output.");
}

function runRouteDecisionVisibilityCase(
  testCase: SkillEvalCase
): SkillEvalCaseResult {
  __resetRouteDecisionsForTest();
  const decision = recordRouteDecision(
    inferAdvisoryRouteDecision({
      agentId: "agent-route-case",
      text: "继续按计划执行优化，并保留可验证证据",
      hasActiveGoal: true,
      createdAt: 1,
    })
  );
  const latest = latestRouteDecision("agent-route-case");
  if (
    latest?.id === decision.id &&
    latest.route === "goal" &&
    latest.confidence > 0 &&
    latest.reasons.length > 0 &&
    latest.inputPreview.length > 0
  ) {
    return passResult(testCase, "Route decision is stored with timeline/status display fields.", {
      testsRun: ["inferAdvisoryRouteDecision", "recordRouteDecision"],
    });
  }
  return failResult(testCase, "Route decision was not visible through the latest-decision store.");
}
