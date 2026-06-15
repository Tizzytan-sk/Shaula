import { createHash } from "node:crypto";
import { evaluateRubric } from "@/lib/evaluation/evaluator";
import { getEvaluatorWeightProfile, mergeProfileWithDynamicCriteria } from "@/lib/evaluation/profiles";
import type { CriterionScoreInput, RubricCriterion } from "@/lib/evaluation/types";
import { evidenceRefToEvaluationEvidence } from "@/lib/evidence/ledger";
import { buildExecutionContract } from "@/lib/execution-contract/build";
import type { ExecutionContract } from "@/lib/execution-contract/types";
import { skillEvalRunToEvidence } from "./evidence";
import type {
  SkillEvalCase,
  SkillEvalCaseStatus,
  SkillEvalRun,
  SkillEvalRunInput,
  SkillEvalVersionDiff,
} from "./types";

const PROFILE_ID = "skill.eval";

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableRunId(input: SkillEvalRunInput, createdAt: number): string {
  const digest = createHash("sha1")
    .update(
      [
        input.skillName,
        input.skillPath ?? input.skillPackage ?? "",
        input.baselineVersion ?? "",
        input.candidateVersion ?? "",
        createdAt,
      ].join(":")
    )
    .digest("hex")
    .slice(0, 10);
  return `skill-eval-${createdAt}-${digest}`;
}

function normalizeScore(status: SkillEvalCaseStatus, score?: number): number {
  if (typeof score === "number") return Math.max(0, Math.min(1, score));
  if (status === "pass") return 1;
  if (status === "partial") return 0.5;
  return 0;
}

function normalizeCases(cases: SkillEvalCase[]): SkillEvalCase[] {
  return cases
    .map((item, index) => ({
      id: cleanText(item.id, `case-${index + 1}`),
      title: cleanText(item.title, `Case ${index + 1}`),
      prompt: cleanText(item.prompt),
      expectedBehavior: cleanText(item.expectedBehavior),
      kind: item.kind ?? "positive",
      weight:
        typeof item.weight === "number" && item.weight > 0 ? item.weight : 1,
    }))
    .filter((item) => item.prompt);
}

function normalizeVersionDiff(input: SkillEvalRunInput): SkillEvalVersionDiff | undefined {
  if (input.versionDiff) return input.versionDiff;
  if (input.baselineVersion || input.candidateVersion) {
    return {
      baselineVersion: input.baselineVersion,
      candidateVersion: input.candidateVersion,
      summary:
        input.baselineVersion && input.candidateVersion
          ? `${input.baselineVersion} -> ${input.candidateVersion}`
          : undefined,
    };
  }
  return undefined;
}

function dynamicCriteria(): RubricCriterion[] {
  return [
    {
      id: "skill-source-present",
      dimensionId: "package_handoff",
      importance: "important",
      description: "The skill source, package, or directory is identified.",
      evidenceRequired: ["version_diff"],
      minEvidenceTrust: "artifact_reference",
    },
    {
      id: "skill-case-coverage",
      dimensionId: "case_coverage",
      importance: "essential",
      description: "The evaluation run covers the provided skill use cases.",
      evidenceRequired: ["eval_run"],
      minEvidenceTrust: "artifact_reference",
      hardFail: true,
    },
    {
      id: "skill-rubric-score",
      dimensionId: "rubric_quality",
      importance: "essential",
      description: "The skill version is scored against a reusable rubric.",
      evidenceRequired: ["rubric_score"],
      minEvidenceTrust: "artifact_reference",
      hardFail: true,
    },
    {
      id: "skill-version-diff",
      dimensionId: "package_handoff",
      importance: "essential",
      description: "The evaluated version is traceable to a baseline or version diff.",
      evidenceRequired: ["version_diff"],
      minEvidenceTrust: "artifact_reference",
      hardFail: true,
    },
  ];
}

export function buildSkillEvalContract(input: {
  agentId: string;
  skillName: string;
  objective?: string;
  createdAt?: number;
}): ExecutionContract {
  return buildExecutionContract({
    agentId: input.agentId,
    objective:
      input.objective ??
      `Evaluate skill ${input.skillName} with a reusable skill eval harness`,
    rubricProfile: PROFILE_ID,
    createdAt: input.createdAt,
  });
}

export function evaluateSkillEvalRun(input: SkillEvalRunInput): SkillEvalRun {
  const createdAt = input.createdAt ?? Date.now();
  const id = input.id ?? stableRunId(input, createdAt);
  const cases = normalizeCases(input.cases);
  const resultsByCase = new Map(input.results.map((item) => [item.caseId, item]));
  const normalizedResults = cases.map((testCase) => {
    const result = resultsByCase.get(testCase.id);
    const status = result?.status ?? "fail";
    const score = normalizeScore(status, result?.score);
    return {
      caseId: testCase.id,
      title: testCase.title,
      kind: testCase.kind ?? "positive",
      status,
      score,
      weight: testCase.weight ?? 1,
      reason: result?.reason ?? "No result recorded for this case.",
    };
  });
  const coveredCaseCount = cases.filter((testCase) =>
    resultsByCase.has(testCase.id)
  ).length;
  const totalWeight = normalizedResults.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? normalizedResults.reduce((sum, item) => sum + item.score * item.weight, 0) /
        totalWeight
      : 0;
  const passCount = normalizedResults.filter((item) => item.status === "pass").length;
  const partialCount = normalizedResults.filter((item) => item.status === "partial").length;
  const failCount = normalizedResults.filter((item) => item.status === "fail").length;
  const versionDiff = normalizeVersionDiff(input);
  const profile = getEvaluatorWeightProfile(PROFILE_ID);
  if (!profile) throw new Error("skill.eval profile missing");
  const rubric = mergeProfileWithDynamicCriteria(profile, {
    id: "skill-eval-harness",
    title: "Skill evaluation harness",
    criteria: dynamicCriteria(),
    createdAt,
  });

  const draftRun: Omit<SkillEvalRun, "evidence" | "evaluation"> & {
    evaluation?: SkillEvalRun["evaluation"];
    evidence: [];
  } = {
    id,
    agentId: input.agentId,
    sessionId: input.sessionId,
    skillName: cleanText(input.skillName, "unknown skill"),
    skillPath: cleanText(input.skillPath),
    skillPackage: cleanText(input.skillPackage),
    objective:
      input.objective ??
      `Evaluate skill ${cleanText(input.skillName, "unknown skill")}`,
    baselineVersion: input.baselineVersion ?? versionDiff?.baselineVersion,
    candidateVersion: input.candidateVersion ?? versionDiff?.candidateVersion,
    versionDiff,
    metrics: normalizeMetrics(input.metrics, input.results),
    cases,
    results: normalizedResults,
    weightedScore,
    passCount,
    partialCount,
    failCount,
    evidence: [],
    createdAt,
  };
  const evidence = skillEvalRunToEvidence(draftRun);
  const evaluationEvidence = evidence.map(evidenceRefToEvaluationEvidence);
  const scores: CriterionScoreInput[] = [
    {
      criterionId: "skill-source-present",
      status: input.skillPath || input.skillPackage ? "pass" : "fail",
      reason:
        input.skillPath || input.skillPackage
          ? "Skill source is identified."
          : "Skill source is missing.",
      evidenceIds: [`skill-eval-version-diff:${id}`],
    },
    {
      criterionId: "skill-case-coverage",
      status:
        cases.length > 0 && coveredCaseCount === cases.length
          ? "pass"
          : cases.length > 0 && coveredCaseCount > 0
            ? "partial"
            : "fail",
      reason: `${coveredCaseCount} of ${cases.length} case(s) have recorded results.`,
      evidenceIds: [`skill-eval-run:${id}`],
    },
    {
      criterionId: "skill-rubric-score",
      status:
        weightedScore >= 0.85
          ? "pass"
          : weightedScore >= 0.6
            ? "partial"
            : "fail",
      reason: `Weighted case score is ${weightedScore.toFixed(2)}.`,
      evidenceIds: [`skill-eval-score:${id}`],
    },
    {
      criterionId: "skill-version-diff",
      status: versionDiff?.summary || versionDiff?.filePath ? "pass" : "fail",
      reason:
        versionDiff?.summary || versionDiff?.filePath
          ? "Version diff is recorded."
          : "Version diff is missing.",
      evidenceIds: [`skill-eval-version-diff:${id}`],
    },
  ];
  const evaluation = evaluateRubric({
    rubric,
    subject: { agentId: input.agentId },
    criteria: scores,
    evidence: evaluationEvidence,
    createdAt,
    evaluationId: `skill-eval-rubric-${id}`,
  });

  return {
    ...draftRun,
    evaluation,
    evidence: skillEvalRunToEvidence({ ...draftRun, evaluation }),
  };
}

function normalizeMetrics(
  runMetrics: SkillEvalRunInput["metrics"],
  results: SkillEvalRunInput["results"]
): SkillEvalRunInput["metrics"] | undefined {
  const caseMetrics = results
    .map((item) => item.metadata)
    .filter(
      (item): item is NonNullable<SkillEvalRunInput["metrics"]> =>
        item !== undefined
    );
  const merged = {
    ...mergeCaseMetrics(caseMetrics),
    ...runMetrics,
  };
  return Object.values(merged).some((value) => value !== undefined)
    ? merged
    : undefined;
}

function mergeCaseMetrics(
  items: NonNullable<SkillEvalRunInput["metrics"]>[]
): SkillEvalRunInput["metrics"] {
  if (items.length === 0) return {};
  return {
    turnCount: sum(items.map((item) => item.turnCount)),
    verifierRejectionCount: sum(items.map((item) => item.verifierRejectionCount)),
    openActionCount: sum(items.map((item) => item.openActionCount)),
    changedFiles: unique(items.flatMap((item) => item.changedFiles ?? [])),
    testsRun: unique(items.flatMap((item) => item.testsRun ?? [])),
    browserEvidence: unique(items.flatMap((item) => item.browserEvidence ?? [])),
    manualIntervention: items.some((item) => item.manualIntervention === true),
  };
}

function sum(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : undefined;
}

function unique(values: string[]): string[] | undefined {
  const result = [...new Set(values.filter(Boolean))];
  return result.length > 0 ? result : undefined;
}
