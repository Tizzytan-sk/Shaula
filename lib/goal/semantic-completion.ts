import type { EvaluationEvidence } from "@/lib/evaluation/types";
import type { EvaluatorContractSource } from "@/lib/evaluation/gate";
import { evaluationEvidenceMatchesRequirement } from "@/lib/evidence/ledger";
import { evidenceOutcome } from "@/lib/verification/evidence";

export type SemanticCompletionFindingSeverity = "blocking" | "review";

export interface SemanticCompletionFinding {
  id: string;
  severity: SemanticCompletionFindingSeverity;
  message: string;
  evidenceIds?: string[];
}

export function semanticCompletionFindings(input: {
  contract?: EvaluatorContractSource | null;
  evidence: EvaluationEvidence[];
}): SemanticCompletionFinding[] {
  return [
    ...staleVerificationFindings(input),
    ...outOfScopeDiffFindings(input),
  ];
}

function staleVerificationFindings(input: {
  contract?: EvaluatorContractSource | null;
  evidence: EvaluationEvidence[];
}): SemanticCompletionFinding[] {
  const latestDiff = latestEvidence(input.evidence.filter((item) => item.kind === "diff"));
  if (!latestDiff?.createdAt) return [];

  const deterministicRequirements = (input.contract?.requiredEvidence ?? []).filter(
    isDeterministicRequirement
  );
  const findings: SemanticCompletionFinding[] = [];
  for (const requirement of deterministicRequirements) {
    const matching = input.evidence
      .filter((item) => deterministicEvidenceSatisfies(item, requirement))
      .sort(compareEvidenceTime);
    if (matching.length === 0) continue;
    const latestMatching = matching.at(-1);
    if (!latestMatching?.createdAt) continue;
    if (latestMatching.createdAt >= latestDiff.createdAt) continue;
    findings.push({
      id: `stale-verification:${normalizeToken(requirement)}`,
      severity: "blocking",
      message: `Stale verification: ${requirement} was recorded before the latest diff evidence. Rerun the check after the change.`,
      evidenceIds: [latestDiff.id, latestMatching.id],
    });
  }
  return findings;
}

function outOfScopeDiffFindings(input: {
  contract?: EvaluatorContractSource | null;
  evidence: EvaluationEvidence[];
}): SemanticCompletionFinding[] {
  const scopePrefixes = scopePathPrefixes(input.contract?.scope ?? []);
  if (scopePrefixes.length === 0) return [];
  const findings: SemanticCompletionFinding[] = [];
  for (const diff of input.evidence.filter((item) => item.kind === "diff")) {
    const href = evidencePath(diff);
    if (!href) continue;
    const normalized = normalizePath(href);
    if (!normalized || scopePrefixes.some((prefix) => pathWithin(normalized, prefix))) {
      continue;
    }
    findings.push({
      id: `out-of-scope-diff:${diff.id}`,
      severity: "review",
      message: `Review out-of-scope diff evidence: ${href}`,
      evidenceIds: [diff.id],
    });
  }
  return findings;
}

function deterministicEvidenceSatisfies(
  evidence: EvaluationEvidence,
  requirement: string
): boolean {
  if (evidence.trustLevel !== "deterministic_check") return false;
  const outcome = evidenceOutcome(evidence);
  if (outcome !== undefined && outcome !== "passed") return false;
  return evaluationEvidenceMatchesRequirement(evidence, requirement);
}

function isDeterministicRequirement(requirement: string): boolean {
  const normalized = normalizeToken(requirement);
  return (
    normalized.includes("test") ||
    normalized.includes("type") ||
    normalized.includes("build") ||
    normalized.includes("lint")
  );
}

function latestEvidence(items: EvaluationEvidence[]): EvaluationEvidence | undefined {
  return items.slice().sort(compareEvidenceTime).at(-1);
}

function compareEvidenceTime(a: EvaluationEvidence, b: EvaluationEvidence): number {
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}

function evidencePath(evidence: EvaluationEvidence): string | undefined {
  if (evidence.href) return evidence.href;
  const path = evidence.metadata?.path ?? evidence.metadata?.filePath ?? evidence.metadata?.href;
  return typeof path === "string" ? path : undefined;
}

function scopePathPrefixes(scope: string[]): string[] {
  const prefixes = new Set<string>();
  for (const item of scope) {
    for (const match of item.matchAll(/`([^`]+)`/g)) {
      const normalized = normalizePath(match[1]);
      if (normalized) prefixes.add(normalized);
    }
    for (const match of item.matchAll(/(?:[A-Za-z]:[\\/])?[\w.-]+(?:[\\/][\w.@$() -]+)+/g)) {
      const normalized = normalizePath(match[0]);
      if (normalized) prefixes.add(normalized);
    }
  }
  return [...prefixes];
}

function pathWithin(path: string, prefix: string): boolean {
  const left = path.toLowerCase();
  const right = prefix.toLowerCase().replace(/\/+$/, "");
  return left === right || left.startsWith(`${right}/`);
}

function normalizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let ref = value.trim();
  if (!ref || /^(https?:|data:)/i.test(ref)) return undefined;
  if (/^file:/i.test(ref)) {
    try {
      const url = new URL(ref);
      ref = decodeURIComponent(url.pathname);
      if (/^\/[a-zA-Z]:\//.test(ref)) ref = ref.slice(1);
    } catch {
      return undefined;
    }
  }
  ref = ref.replace(/\\/g, "/");
  const parts: string[] = [];
  const drive = /^[a-zA-Z]:\//.test(ref) ? ref.slice(0, 2).toLowerCase() : "";
  const rest = drive ? ref.slice(2) : ref;
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `${drive}${drive ? "/" : ""}${parts.join("/")}`;
  return normalized.replace(/\/+$/, "") || undefined;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
