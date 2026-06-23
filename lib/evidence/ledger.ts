import type {
  EvaluationEvidence,
  EvaluationEvidenceTrustLevel,
} from "@/lib/evaluation/types";
import { evidenceCanSatisfyRequirement } from "@/lib/verification/evidence";
import type { GoalEvidence } from "@/lib/goal/types";
import type {
  EvidenceRef,
  EvidenceSourceRef,
  EvidenceSourceType,
  EvidenceTrustLevel,
} from "./types";

const TRUST_RANK: Record<EvaluationEvidenceTrustLevel, number> = {
  agent_reported: 0,
  textual_log: 1,
  artifact_reference: 2,
  deterministic_check: 3,
  host_observed: 4,
  user_confirmed: 5,
};

function artifactReferenceValue(evidence: EvidenceRef): string | undefined {
  return (
    evidence.artifactUri ??
    evidence.url ??
    evidence.filePath ??
    (typeof evidence.metadata?.href === "string" ? evidence.metadata.href : undefined)
  );
}

function isWebOrDataReference(value: string): boolean {
  return /^(https?:|data:)/i.test(value.trim());
}

function normalizeLocalReference(value: string, cwd?: string): string | undefined {
  let ref = value.trim().replace(/\\/g, "/");
  if (!ref) return undefined;
  if (/^file:/i.test(ref)) {
    try {
      const url = new URL(ref);
      ref = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:\//.test(ref)) ref = ref.slice(1);
    } catch {
      return undefined;
    }
  }
  const root = cwd?.trim().replace(/\\/g, "/");
  const absolute = /^[a-zA-Z]:\//.test(ref) || ref.startsWith("/");
  if (!absolute) {
    if (!root) return undefined;
    ref = `${root.replace(/\/+$/, "")}/${ref}`;
  }
  const drive = /^[a-zA-Z]:\//.test(ref) ? ref.slice(0, 2).toLowerCase() : "";
  const rest = drive ? ref.slice(2) : ref;
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const prefix = drive || (ref.startsWith("/") ? "" : "");
  return `${prefix}/${parts.join("/")}`.replace(/\/+$/, "") || "/";
}

function localReferenceIsAllowed(evidence: EvidenceRef, value: string): boolean {
  if (isWebOrDataReference(value)) return true;
  const cwd = metadataString(evidence, "cwd");
  if (!cwd) return false;
  const normalizedRef = normalizeLocalReference(value, cwd);
  const normalizedCwd = normalizeLocalReference(cwd);
  if (!normalizedRef || !normalizedCwd) return false;
  const left = normalizedRef.toLowerCase();
  const root = normalizedCwd.toLowerCase().replace(/\/+$/, "");
  return left === root || left.startsWith(`${root}/`);
}

function metadataString(
  evidence: EvidenceRef,
  key: string
): string | undefined {
  const value = evidence.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function progressArtifactKind(evidence: EvidenceRef): string | undefined {
  if (evidence.kind !== "progress_artifact") return undefined;
  return metadataString(evidence, "kind");
}

function metadataStringArray(
  evidence: EvidenceRef,
  key: string
): string[] {
  const value = evidence.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function criteriaRequiredEvidence(evidence: EvidenceRef): string[] {
  return (evidence.criteria ?? [])
    .map((criterion) => criterion.requiredEvidence)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function evaluationMetadata(evidence: EvidenceRef): Record<string, unknown> | undefined {
  const criteriaRequired = criteriaRequiredEvidence(evidence);
  const metadata = evidence.metadata ?? {};
  if (criteriaRequired.length === 0) return evidence.metadata;
  const existing = metadataStringArray(evidence, "evidenceRequired");
  return {
    ...metadata,
    evidenceRequired:
      existing.length > 0
        ? [...new Set([...existing, ...criteriaRequired])]
        : criteriaRequired,
  };
}

function metadataOutcome(
  evidence: EvidenceRef
): EvaluationEvidence["outcome"] | undefined {
  const outcome = evidence.metadata?.outcome;
  if (
    outcome === "passed" ||
    outcome === "failed" ||
    outcome === "timed_out" ||
    outcome === "skipped" ||
    outcome === "unknown"
  ) {
    return outcome;
  }
  const status = evidence.metadata?.status;
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "timed_out") return "timed_out";
  if (status === "skipped") return "skipped";
  const passed = evidence.metadata?.passed;
  if (typeof passed === "boolean") return passed ? "passed" : "failed";
  const exitCode = evidence.metadata?.exitCode;
  if (typeof exitCode === "number") return exitCode === 0 ? "passed" : "failed";
  return undefined;
}

function sourceString(source?: EvidenceSourceRef): string | undefined {
  if (!source) return undefined;
  return source.id ? `${source.type}:${source.id}` : source.type;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function inferEvidenceSource(evidence: EvidenceRef): EvidenceSourceRef {
  if (evidence.source) return evidence.source;
  if (evidence.kind.startsWith("browser_")) {
    return { type: "browser", id: evidence.browserId ?? evidence.agentId };
  }
  if (evidence.kind === "progress_artifact") {
    return { type: "progress", id: evidence.id, parentId: evidence.agentId };
  }
  if (evidence.kind === "workflow_artifact") {
    return { type: "workflow", id: evidence.workflowId ?? evidence.id };
  }
  if (evidence.kind === "subagent_result") {
    return { type: "subagent", id: evidence.taskId ?? evidence.id };
  }
  if (evidence.kind === "approval_decision") {
    return { type: "approval", id: evidence.id };
  }
  if (evidence.kind === "goal_turn") {
    return { type: "goal", id: evidence.agentId ?? evidence.id };
  }
  if (evidence.taskId) return { type: "task", id: evidence.taskId };
  if (evidence.agentId) return { type: "agent", id: evidence.agentId };
  return { type: "unknown", id: evidence.id };
}

export function inferEvidenceTrust(evidence: EvidenceRef): EvidenceTrustLevel {
  if (evidence.kind !== "progress_artifact" && evidence.trustLevel) {
    return evidence.trustLevel;
  }
  const progressKind = progressArtifactKind(evidence);
  const artifactRef = artifactReferenceValue(evidence);
  const hasArtifactReference = artifactRef
    ? localReferenceIsAllowed(evidence, artifactRef)
    : false;
  switch (evidence.kind) {
    case "browser_snapshot":
    case "browser_step":
    case "browser_annotation":
      return "host_observed";
    case "approval_decision":
      return "user_confirmed";
    case "workflow_artifact":
      return "artifact_reference";
    case "verification_result":
      return "deterministic_check";
    case "progress_artifact":
      if (
        hasArtifactReference &&
        (progressKind === "file" ||
          progressKind === "diff" ||
          progressKind === "url" ||
          progressKind === "screenshot" ||
          progressKind === "other")
      ) {
        return "artifact_reference";
      }
      return "agent_reported";
    case "subagent_result":
    case "goal_turn":
      return "agent_reported";
    case "log":
      return "textual_log";
    default:
      return "agent_reported";
  }
}

export function normalizeEvidenceRef(evidence: EvidenceRef): EvidenceRef {
  const source = inferEvidenceSource(evidence);
  const trustLevel = inferEvidenceTrust(evidence);
  const artifactUri = artifactReferenceValue(evidence);
  return {
    ...evidence,
    source,
    trustLevel,
    ...(artifactUri ? { artifactUri } : {}),
    summary:
      evidence.summary ??
      evidence.textPreview ??
      (typeof evidence.metadata?.summary === "string"
        ? evidence.metadata.summary
        : undefined),
  };
}

export function evidenceRefToEvaluationEvidence(
  input: EvidenceRef
): EvaluationEvidence {
  const evidence = normalizeEvidenceRef(input);
  const progressKind = progressArtifactKind(evidence);
  const verificationKind = metadataString(evidence, "verificationKind");
  const requiredEvidence = [
    ...new Set([
      ...metadataStringArray(evidence, "evidenceRequired"),
      ...criteriaRequiredEvidence(evidence),
    ]),
  ];
  const kind: EvaluationEvidence["kind"] =
    evidence.kind === "verification_result"
      ? verificationEvidenceKind(verificationKind, requiredEvidence)
      : progressKind === "test"
      ? "test_result"
      : progressKind === "diff"
        ? "diff"
        : progressKind === "screenshot" || evidence.screenshotDataUrl
          ? "screenshot"
          : evidence.url
            ? "url"
            : evidence.kind === "workflow_artifact"
              ? "workflow_artifact"
              : evidence.kind === "subagent_result"
                ? "subagent_session"
                : evidence.kind === "log"
                  ? "workflow_log"
                  : "other";
  return {
    id: evidence.id,
    kind,
    title: evidence.title,
    href: evidence.artifactUri ?? evidence.url ?? evidence.filePath,
    summary: evidence.summary ?? evidence.textPreview,
    trustLevel: evidence.trustLevel,
    source: sourceString(evidence.source),
    verifiable: (TRUST_RANK[evidence.trustLevel ?? "agent_reported"] ?? 0) >=
      TRUST_RANK.artifact_reference,
    outcome: metadataOutcome(evidence),
    metadata: evaluationMetadata(evidence),
    createdAt: evidence.createdAt,
  };
}

export function evidenceRefToGoalEvidence(input: EvidenceRef): GoalEvidence {
  const evidence = normalizeEvidenceRef(input);
  const progressKind = progressArtifactKind(evidence);
  const requiredEvidence = criteriaRequiredEvidence(evidence);
  const contractCriterionId = evidence.criteria?.find(
    (criterion) => criterion.contractCriterionId
  )?.contractCriterionId;
  const rubricCriterionId = evidence.criteria?.find(
    (criterion) => criterion.rubricCriterionId
  )?.rubricCriterionId;
  const kind: GoalEvidence["kind"] =
    progressKind === "file" ||
    progressKind === "url" ||
    progressKind === "screenshot" ||
    progressKind === "test" ||
    progressKind === "diff" ||
    progressKind === "log" ||
    progressKind === "browser"
      ? progressKind
      : evidence.kind.startsWith("browser_")
        ? "browser"
        : evidence.url
          ? "url"
          : evidence.filePath
            ? "file"
            : evidence.kind === "log"
              ? "log"
              : "other";
  return {
    id: evidence.id,
    kind,
    title: evidence.title,
    href: evidence.artifactUri ?? evidence.url ?? evidence.filePath,
    summary: evidence.summary ?? evidence.textPreview,
    ...(requiredEvidence.length > 0 ? { requiredEvidence } : {}),
    ...(contractCriterionId ? { contractCriterionId } : {}),
    ...(rubricCriterionId ? { rubricCriterionId } : {}),
    createdAt: evidence.createdAt,
  };
}

function verificationEvidenceKind(
  verificationKind: string | undefined,
  requiredEvidence: string[]
): EvaluationEvidence["kind"] {
  const required = requiredEvidence.map(normalizeToken);
  if (verificationKind === "lint" || required.some((item) => item.includes("lint"))) {
    return "lint_result";
  }
  if (verificationKind === "build" || required.some((item) => item.includes("build"))) {
    return "build_result";
  }
  if (
    verificationKind === "test" ||
    verificationKind === "typecheck" ||
    required.some((item) => item.includes("test") || item.includes("type"))
  ) {
    return "test_result";
  }
  return "workflow_artifact";
}

export function goalEvidenceToEvaluationEvidence(
  evidence: GoalEvidence
): EvaluationEvidence {
  const kind: EvaluationEvidence["kind"] =
    evidence.kind === "test"
      ? "test_result"
      : evidence.kind === "diff"
        ? "diff"
        : evidence.kind === "screenshot"
          ? "screenshot"
          : evidence.kind === "url"
            ? "url"
            : evidence.kind === "log"
              ? "workflow_log"
              : "goal_evidence";
  return {
    id: evidence.id,
    kind,
    title: evidence.title,
    href: evidence.href,
    summary: evidence.summary,
    trustLevel: "agent_reported",
    source: "goal",
    verifiable: false,
    metadata: {
      ...(evidence.requiredEvidence?.length
        ? { evidenceRequired: evidence.requiredEvidence }
        : {}),
      ...(evidence.contractCriterionId
        ? { contractCriterionId: evidence.contractCriterionId }
        : {}),
      ...(evidence.rubricCriterionId
        ? { rubricCriterionId: evidence.rubricCriterionId }
        : {}),
    },
    createdAt: evidence.createdAt,
  };
}

function minimumTrustForRequirement(
  requirement: string
): EvaluationEvidenceTrustLevel {
  const normalized = normalizeToken(requirement);
  if (
    normalized.includes("blocker") ||
    normalized.includes("blocked_state") ||
    normalized.includes("blocked_reason")
  ) {
    return "agent_reported";
  }
  if (
    normalized === "version_diff" ||
    normalized.includes("version_diff") ||
    normalized.includes("diff")
  ) {
    return "artifact_reference";
  }
  if (
    normalized.includes("test") ||
    normalized.includes("type") ||
    normalized.includes("build") ||
    normalized.includes("lint")
  ) {
    return "deterministic_check";
  }
  if (
    normalized.includes("browser") ||
    normalized.includes("url") ||
    normalized.includes("screenshot")
  ) {
    return "host_observed";
  }
  return "artifact_reference";
}

function trustMeets(
  actual: EvaluationEvidenceTrustLevel | undefined,
  minimum: EvaluationEvidenceTrustLevel
): boolean {
  return (TRUST_RANK[actual ?? "agent_reported"] ?? 0) >= TRUST_RANK[minimum];
}

export function evaluationEvidenceMatchesRequirement(
  evidence: EvaluationEvidence,
  requirement: string
): boolean {
  const required = normalizeToken(requirement);
  if (!required || required === "goal_evidence" || required === "evidence") {
    return true;
  }
  const source = normalizeToken(evidence.source ?? "");
  const title = normalizeToken(evidence.title);
  const kind = normalizeToken(evidence.kind);
  const href = normalizeToken(evidence.href ?? "");
  const metadataStatus =
    typeof evidence.metadata?.status === "string"
      ? normalizeToken(evidence.metadata.status)
      : "";
  const hasBlockedState =
    evidence.metadata?.blockedState != null &&
    typeof evidence.metadata.blockedState === "object";
  if (required.includes("blocker") || required.includes("blocked")) {
    return (
      title.includes("blocker") ||
      title.includes("blocked") ||
      kind.includes("log") ||
      metadataStatus === "blocked" ||
      hasBlockedState
    );
  }
  if (required.includes("browser")) {
    return source.includes("browser") || kind.includes("screenshot") || title.includes("browser");
  }
  const evidenceRequired = Array.isArray(evidence.metadata?.evidenceRequired)
    ? evidence.metadata.evidenceRequired
        .filter((item): item is string => typeof item === "string")
        .map(normalizeToken)
    : [];
  if (evidenceRequired.some((item) => item.includes(required))) return true;
  if (required.includes("test")) return kind === "test_result" || title.includes("test");
  if (required.includes("lint")) return kind === "lint_result" || title.includes("lint");
  if (required.includes("build")) return kind === "build_result" || title.includes("build");
  if (required.includes("diff")) return kind === "diff" || title.includes("diff");
  if (required.includes("screenshot")) return kind === "screenshot" || href.startsWith("data_image");
  if (required.includes("url")) return kind === "url" || href.startsWith("http");
  if (required.includes("file")) return Boolean(evidence.href);
  if (required.includes("log")) return kind.includes("log");
  return (
    kind.includes(required) ||
    title.includes(required) ||
    source.includes(required) ||
    href.includes(required)
  );
}

export interface RequiredEvidenceCoverage {
  missing: string[];
  matchedEvidenceIds: string[];
}

export function requiredEvidenceCoverage(
  requirements: string[],
  evidence: EvaluationEvidence[]
): RequiredEvidenceCoverage {
  const matched = new Set<string>();
  const missing: string[] = [];
  for (const requirement of requirements) {
    const minimumTrust = minimumTrustForRequirement(requirement);
    const found = evidence.find(
      (item) =>
        evidenceCanSatisfyRequirement(item) &&
        evaluationEvidenceMatchesRequirement(item, requirement) &&
        trustMeets(item.trustLevel, minimumTrust)
    );
    if (found) matched.add(found.id);
    else missing.push(`${requirement} (requires ${minimumTrust})`);
  }
  return { missing, matchedEvidenceIds: [...matched] };
}

export function evidenceSourceType(evidence: EvidenceRef): EvidenceSourceType {
  return normalizeEvidenceRef(evidence).source?.type ?? "unknown";
}
