import {
  evidenceRefToEvaluationEvidence,
  requiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { TeamTask } from "./types";

export type TeamTaskVerificationStatus = "passed" | "warning" | "failed";

export interface TeamTaskVerificationCheck {
  id: string;
  status: TeamTaskVerificationStatus;
  message: string;
}

export interface TeamTaskVerificationSummary {
  status: TeamTaskVerificationStatus;
  verifiedAt: number;
  summary: string;
  passed: number;
  warnings: number;
  failed: number;
  missingEvidence: string[];
  matchedEvidenceIds: string[];
  checks: TeamTaskVerificationCheck[];
}

export interface VerifyTeamTasksInput {
  tasks: TeamTask[];
  evidence: EvidenceRef[];
  requiredEvidence?: string[];
  verifiedAt?: number;
}

function worstStatus(
  values: TeamTaskVerificationStatus[]
): TeamTaskVerificationStatus {
  if (values.includes("failed")) return "failed";
  if (values.includes("warning")) return "warning";
  return "passed";
}

function normalizeConflictScope(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(q|task|question)[-\s_]*\d+\b/g, "")
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, "")
    .trim();
}

function answerPolarity(value: string | undefined): "yes" | "no" | "unknown" {
  const text = (value ?? "").slice(0, 500).toLowerCase();
  if (/\b(no|not|cannot|can't|false|deny|denied)\b|否|不可以|不能|不允许|无需|不需要/i.test(text)) {
    return "no";
  }
  if (/\b(yes|true|can|allowed|allow|must|required)\b|可以|允许|需要|必须/i.test(text)) {
    return "yes";
  }
  return "unknown";
}

function evidenceText(evidence: EvidenceRef | undefined): string | undefined {
  if (!evidence) return undefined;
  return evidence.summary ?? evidence.textPreview ?? evidence.title;
}

function evidenceById(evidence: EvidenceRef[]): Map<string, EvidenceRef> {
  return new Map(evidence.map((item) => [item.id, item]));
}

function isTeamNativeRequirement(requirement: string): boolean {
  return requirement === "subagent_result" || requirement === "workflow_artifact";
}

function teamNativeRequirementMatches(
  requirement: string,
  evidence: EvidenceRef[]
): EvidenceRef[] {
  if (requirement === "subagent_result") {
    return evidence.filter((item) => item.kind === "subagent_result");
  }
  if (requirement === "workflow_artifact") {
    return evidence.filter((item) => item.kind === "workflow_artifact");
  }
  return [];
}

function detectCrossTaskConflicts(
  tasks: TeamTask[],
  evidence: EvidenceRef[]
): string[] {
  const byId = evidenceById(evidence);
  const byScope = new Map<
    string,
    Array<{ id: string; polarity: "yes" | "no"; source: string }>
  >();

  for (const task of tasks) {
    if (task.status !== "completed" && task.status !== "warning") continue;
    const scope = normalizeConflictScope(
      `${task.title} ${task.contextPacket?.taskTitle ?? ""}`
    );
    if (!scope || scope.length < 4) continue;
    const linkedEvidence = task.evidenceIds
      .map((id) => byId.get(id))
      .filter((item): item is EvidenceRef => Boolean(item));
    const text = linkedEvidence.map(evidenceText).filter(Boolean).join("\n");
    const polarity = answerPolarity(text);
    if (polarity === "unknown") continue;
    const current = byScope.get(scope) ?? [];
    current.push({
      id: task.id,
      polarity,
      source: linkedEvidence.map((item) => item.id).join(", ") || task.id,
    });
    byScope.set(scope, current);
  }

  const conflicts: string[] = [];
  for (const tasksInScope of byScope.values()) {
    const yes = tasksInScope.filter((task) => task.polarity === "yes");
    const no = tasksInScope.filter((task) => task.polarity === "no");
    if (yes.length > 0 && no.length > 0) {
      conflicts.push(
        `Conflicting yes/no results across ${[...yes, ...no]
          .map((task) => task.id)
          .join(", ")}.`
      );
    }
  }
  return conflicts;
}

export function verifyTeamTasks(input: VerifyTeamTasksInput): TeamTaskVerificationSummary {
  const verifiedAt = input.verifiedAt ?? Date.now();
  const tasks = input.tasks;
  const evidence = input.evidence;
  const checks: TeamTaskVerificationCheck[] = [];

  const failedTasks = tasks.filter((task) => task.status === "failed");
  checks.push({
    id: "failed-team-tasks",
    status: failedTasks.length === 0 ? "passed" : "failed",
    message:
      failedTasks.length === 0
        ? "No team tasks are failed."
        : `${failedTasks.length} team task(s) failed: ${failedTasks.map((task) => task.id).join(", ")}.`,
  });

  const warningTasks = tasks.filter((task) => task.status === "warning");
  checks.push({
    id: "warning-team-tasks",
    status: warningTasks.length === 0 ? "passed" : "warning",
    message:
      warningTasks.length === 0
        ? "No team tasks carry warnings."
        : `${warningTasks.length} team task(s) carry warnings: ${warningTasks.map((task) => task.id).join(", ")}.`,
  });

  const nonTerminal = tasks.filter(
    (task) => task.status === "pending" || task.status === "running" || task.status === "blocked"
  );
  checks.push({
    id: "terminal-team-tasks",
    status: nonTerminal.length === 0 ? "passed" : "failed",
    message:
      nonTerminal.length === 0
        ? "Every team task reached a terminal status."
        : `${nonTerminal.length} team task(s) are still pending, running, or blocked.`,
  });

  const missingRefs = tasks.filter(
    (task) =>
      task.requiredEvidence.length > 0 &&
      task.status !== "pending" &&
      task.status !== "running" &&
      task.evidenceIds.length === 0
  );
  checks.push({
    id: "team-task-evidence-refs",
    status: missingRefs.length === 0 ? "passed" : "failed",
    message:
      missingRefs.length === 0
        ? "Every evidence-requiring team task references evidence ids."
        : `${missingRefs.length} evidence-requiring task(s) have no evidence ids.`,
  });

  const requiredEvidence = [
    ...new Set([
      ...(input.requiredEvidence ?? []),
      ...tasks.flatMap((task) => task.requiredEvidence),
    ]),
  ];
  const linkedEvidenceIds = new Set(tasks.flatMap((task) => task.evidenceIds));
  const linkedEvidence = evidence.filter((item) => linkedEvidenceIds.has(item.id));
  const nativeRequirements = requiredEvidence.filter(isTeamNativeRequirement);
  const strongRequirements = requiredEvidence.filter(
    (requirement) => !isTeamNativeRequirement(requirement)
  );
  const nativeMatchedIds = new Set<string>();
  const nativeMissing: string[] = [];
  for (const requirement of nativeRequirements) {
    const matches = teamNativeRequirementMatches(requirement, linkedEvidence);
    if (matches.length === 0) nativeMissing.push(`${requirement} (requires linked team evidence)`);
    else matches.forEach((item) => nativeMatchedIds.add(item.id));
  }
  checks.push({
    id: "team-native-evidence",
    status: nativeMissing.length === 0 ? "passed" : "failed",
    message:
      nativeMissing.length === 0
        ? "Linked team-native evidence covers subagent/workflow result requirements."
        : `Missing team-native evidence: ${nativeMissing.join(", ")}.`,
  });
  const coverage = requiredEvidenceCoverage(
    strongRequirements,
    linkedEvidence.map(evidenceRefToEvaluationEvidence)
  );
  checks.push({
    id: "team-task-evidence-coverage",
    status: coverage.missing.length === 0 ? "passed" : "failed",
    message:
      coverage.missing.length === 0
        ? "Linked team task evidence covers declared requirements."
        : `Missing team task evidence: ${coverage.missing.join(", ")}.`,
  });

  const conflicts = detectCrossTaskConflicts(tasks, linkedEvidence);
  checks.push({
    id: "cross-task-conflicts",
    status: conflicts.length === 0 ? "passed" : "warning",
    message:
      conflicts.length === 0
        ? "No obvious cross-task result conflicts detected."
        : conflicts.join(" | "),
  });

  const status = worstStatus(checks.map((check) => check.status));
  const passed = checks.filter((check) => check.status === "passed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  return {
    status,
    verifiedAt,
    summary: `${passed} passed, ${warnings} warnings, ${failed} failed.`,
    passed,
    warnings,
    failed,
    missingEvidence: [...nativeMissing, ...coverage.missing],
    matchedEvidenceIds: [...new Set([...nativeMatchedIds, ...coverage.matchedEvidenceIds])],
    checks,
  };
}
