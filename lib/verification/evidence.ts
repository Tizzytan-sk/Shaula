import type { EvaluationEvidence } from "@/lib/evaluation/types";
import type { EvidenceRef } from "@/lib/evidence/types";
import type {
  VerificationBrowserResult,
  VerificationCommandResult,
  VerificationResult,
} from "./types";

export type VerificationEvidenceOutcome =
  | "passed"
  | "failed"
  | "timed_out"
  | "skipped"
  | "unknown";

function commandLine(result: Pick<VerificationCommandResult, "command" | "args">): string {
  return [result.command, ...result.args].join(" ");
}

function trimPreview(value: string | undefined, maxLength = 1200): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function commandResultOutcome(
  result: Pick<VerificationCommandResult, "status">
): VerificationEvidenceOutcome {
  if (result.status === "passed") return "passed";
  if (result.status === "timed_out") return "timed_out";
  return "failed";
}

export function commandResultToEvidenceRef(
  result: VerificationCommandResult,
  context: {
    id?: string;
    agentId?: string;
    sessionId?: string | null;
    createdAt?: number;
  } = {}
): EvidenceRef {
  const outcome = commandResultOutcome(result);
  const createdAt = context.createdAt ?? result.completedAt;
  const preview =
    trimPreview(result.stderrPreview) ??
    trimPreview(result.stdoutPreview) ??
    undefined;
  const command = commandLine(result);
  return {
    id:
      context.id ??
      `verification-${result.planId ?? "plan"}-${result.commandId}-${createdAt}`,
    kind: "verification_result",
    title: `${outcome === "passed" ? "Verification passed" : "Verification failed"}: ${command}`,
    agentId: context.agentId,
    sessionId: context.sessionId,
    textPreview: preview,
    summary: `${result.label}: ${outcome}${
      typeof result.exitCode === "number" ? ` (exit ${result.exitCode})` : ""
    }`,
    trustLevel: "deterministic_check",
    source: {
      type: "system",
      id: "verification-plan",
      parentId: result.planId,
    },
    criteria: result.evidenceRequired.map((requiredEvidence) => ({
      requiredEvidence,
    })),
    metadata: {
      verificationPlanId: result.planId,
      verificationCommandId: result.commandId,
      verificationKind: result.kind,
      command,
      commandName: result.command,
      commandArgs: result.args,
      cwd: result.cwd,
      status: result.status,
      outcome,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      required: result.required,
      evidenceRequired: result.evidenceRequired,
      rationale: result.rationale,
      stdoutPreview: trimPreview(result.stdoutPreview),
      stderrPreview: trimPreview(result.stderrPreview),
      timedOut: result.timedOut === true,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function browserResultToEvidenceRef(
  result: VerificationBrowserResult,
  context: {
    id?: string;
    agentId?: string;
    sessionId?: string | null;
    createdAt?: number;
  } = {}
): EvidenceRef {
  const outcome = commandResultOutcome(result);
  const createdAt = context.createdAt ?? result.completedAt;
  const target =
    result.selector ??
    result.text ??
    result.targetUrl ??
    result.url ??
    result.expectation ??
    "browser state";
  return {
    id:
      context.id ??
      `verification-${result.planId ?? "plan"}-${result.checkId}-${createdAt}`,
    kind: "browser_snapshot",
    title: `${outcome === "passed" ? "Browser verification passed" : "Browser verification failed"}: ${result.label}`,
    agentId: context.agentId,
    sessionId: context.sessionId,
    browserId: result.browserId,
    url: result.url ?? result.targetUrl,
    screenshotDataUrl: result.screenshotDataUrl ?? undefined,
    textPreview: trimPreview(result.error) ?? trimPreview(result.textPreview),
    summary: `${result.label}: ${outcome} (${target})`,
    trustLevel: "host_observed",
    source: {
      type: "browser",
      id: result.browserId ?? "verification-plan",
      parentId: result.planId,
    },
    criteria: result.evidenceRequired.map((requiredEvidence) => ({
      requiredEvidence,
    })),
    metadata: {
      verificationPlanId: result.planId,
      verificationCheckId: result.checkId,
      verificationKind: result.kind,
      status: result.status,
      outcome,
      durationMs: result.durationMs,
      required: result.required,
      evidenceRequired: result.evidenceRequired,
      rationale: result.rationale,
      browserId: result.browserId,
      targetUrl: result.targetUrl,
      selector: result.selector,
      text: result.text,
      expectation: result.expectation,
      url: result.url,
      title: result.title,
      timedOut: result.timedOut === true,
      error: result.error,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function verificationResultToEvidenceRef(
  result: VerificationResult,
  context: {
    id?: string;
    agentId?: string;
    sessionId?: string | null;
    createdAt?: number;
  } = {}
): EvidenceRef {
  return result.kind === "browser_observation"
    ? browserResultToEvidenceRef(result, context)
    : commandResultToEvidenceRef(result, context);
}

export function evidenceOutcome(
  evidence: EvaluationEvidence
): VerificationEvidenceOutcome | undefined {
  if (evidence.outcome) return evidence.outcome;
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

export function evidenceCanSatisfyRequirement(
  evidence: EvaluationEvidence
): boolean {
  const outcome = evidenceOutcome(evidence);
  return outcome === undefined || outcome === "passed";
}

export function blockingRequiredVerificationFailures(
  evidence: EvaluationEvidence[]
): EvaluationEvidence[] {
  const latest = new Map<string, EvaluationEvidence>();
  for (const item of evidence) {
    if (item.metadata?.required !== true) continue;
    const commandId =
      typeof item.metadata.verificationCommandId === "string"
        ? item.metadata.verificationCommandId
        : typeof item.metadata.verificationCheckId === "string"
          ? item.metadata.verificationCheckId
        : undefined;
    const key = commandId ?? `${item.kind}:${item.title}`;
    const current = latest.get(key);
    if (!current || (item.createdAt ?? 0) >= (current.createdAt ?? 0)) {
      latest.set(key, item);
    }
  }
  return [...latest.values()].filter((item) => {
    const outcome = evidenceOutcome(item);
    return outcome === "failed" || outcome === "timed_out";
  });
}
