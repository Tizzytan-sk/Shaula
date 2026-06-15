import type { EvidenceRef } from "@/lib/evidence/types";
import type { SkillEvalRun } from "./types";

type SkillEvalEvidenceInput = Omit<SkillEvalRun, "evidence" | "evaluation"> & {
  evaluation?: SkillEvalRun["evaluation"];
};

function briefJson(value: unknown, max = 1200): string {
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return String(value).slice(0, max);
  }
}

function baseEvidence(run: SkillEvalEvidenceInput, suffix: string): Pick<
  EvidenceRef,
  "agentId" | "sessionId" | "source" | "createdAt" | "updatedAt"
> & { id: string } {
  return {
    id: `skill-eval-${suffix}:${run.id}`,
    agentId: run.agentId,
    sessionId: run.sessionId,
    source: { type: "workflow", id: "skill-eval", parentId: run.id },
    createdAt: run.createdAt,
    updatedAt: run.createdAt,
  };
}

export function skillEvalRunToEvidence(run: SkillEvalEvidenceInput): EvidenceRef[] {
  const caseSummary = `${run.passCount} passed, ${run.partialCount} partial, ${run.failCount} failed`;
  const evidence: EvidenceRef[] = [
    {
      ...baseEvidence(run, "run"),
      kind: "workflow_artifact",
      title: `Skill eval run: ${run.skillName}`,
      summary: `${run.results.length} case(s): ${caseSummary}`,
      textPreview: briefJson({
        skillName: run.skillName,
        metrics: run.metrics,
        cases: run.results.map((item) => ({
          caseId: item.caseId,
          status: item.status,
          score: item.score,
        })),
      }),
      trustLevel: "artifact_reference",
      criteria: [{ requiredEvidence: "eval_run" }],
      metadata: {
        kind: "skill_eval_run",
        evidenceRequired: ["eval_run"],
        weightedScore: run.weightedScore,
        passCount: run.passCount,
        partialCount: run.partialCount,
        failCount: run.failCount,
        metrics: run.metrics,
      },
    },
    {
      ...baseEvidence(run, "score"),
      kind: "workflow_artifact",
      title: `Skill eval score: ${run.skillName}`,
      summary: run.evaluation
        ? `${run.evaluation.status}, score ${run.evaluation.totalScore.toFixed(2)} / ${run.evaluation.targetScore.toFixed(2)}`
        : `Weighted case score ${run.weightedScore.toFixed(2)}`,
      textPreview: briefJson({
        evaluationId: run.evaluation?.id,
        status: run.evaluation?.status,
        weightedScore: run.weightedScore,
        failedCriteria: run.evaluation?.failedCriteria,
        missingEvidence: run.evaluation?.missingEvidence,
      }),
      trustLevel: "artifact_reference",
      criteria: [{ requiredEvidence: "rubric_score" }],
      metadata: {
        kind: "skill_eval_score",
        evidenceRequired: ["rubric_score"],
        evaluationId: run.evaluation?.id,
        evaluationStatus: run.evaluation?.status,
        totalScore: run.evaluation?.totalScore,
        targetScore: run.evaluation?.targetScore,
      },
    },
  ];
  const hasVersionDiff = Boolean(
    run.versionDiff?.summary ||
      run.versionDiff?.filePath ||
      run.baselineVersion ||
      run.candidateVersion
  );
  if (hasVersionDiff) {
    evidence.push({
      ...baseEvidence(run, "version-diff"),
      kind: "workflow_artifact",
      title: `Skill eval version diff: ${run.skillName}`,
      summary:
        run.versionDiff?.summary ??
        `${run.baselineVersion ?? "baseline"} -> ${run.candidateVersion ?? "candidate"}`,
      filePath: run.versionDiff?.filePath,
      textPreview: briefJson(run.versionDiff ?? {}),
      trustLevel: "artifact_reference",
      criteria: [{ requiredEvidence: "version_diff" }],
      metadata: {
        kind: "skill_eval_version_diff",
        evidenceRequired: ["version_diff"],
        baselineVersion: run.baselineVersion,
        candidateVersion: run.candidateVersion,
        summary: run.versionDiff?.summary,
      },
    });
  }
  return evidence;
}
