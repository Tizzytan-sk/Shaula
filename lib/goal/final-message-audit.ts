import "server-only";
import type { EvaluationEvidence } from "@/lib/evaluation/types";
import { collectGoalVerificationInput } from "./verification-input";
import { getGoal, patchGoal } from "./file-store";
import type {
  AgentGoal,
  GoalActualFinalMessage,
  GoalCompletionClaim,
  GoalFinalMessageAudit,
  GoalFinalMessageAuditFinding,
} from "./types";

interface AuditGoalFinalMessageInput {
  claim: GoalCompletionClaim;
  actualMessage: GoalActualFinalMessage;
  evidence: EvaluationEvidence[];
  createdAt?: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
  "work",
  "done",
  "complete",
  "completed",
  "已",
  "已完成",
  "完成",
  "验证",
  "通过",
]);

export function auditGoalFinalMessage({
  claim,
  actualMessage,
  evidence,
  createdAt = Date.now(),
}: AuditGoalFinalMessageInput): GoalFinalMessageAudit {
  const findings: GoalFinalMessageAuditFinding[] = [];
  const actualText = actualMessage.text.trim();
  const claimText = claim.finalSummary.trim();
  const evidenceIds = normalizedEvidenceIds(claim.evidenceIds);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  if (!actualText) {
    findings.push({
      severity: "failed",
      message: "Actual final assistant message is empty.",
    });
  }

  if (!claimText) {
    findings.push({
      severity: "failed",
      message: "Accepted completion claim did not include a final summary.",
    });
  } else if (actualText) {
    const overlap = tokenOverlapRatio(claimText, actualText);
    if (overlap === 0) {
      findings.push({
        severity: "failed",
        message:
          "Actual final assistant message does not overlap with the accepted completion summary.",
      });
    } else if (overlap < 0.18) {
      findings.push({
        severity: "warning",
        message:
          "Actual final assistant message only weakly matches the accepted completion summary.",
      });
    }
  }

  const missingEvidenceIds = evidenceIds.filter((id) => !evidenceById.has(id));
  if (missingEvidenceIds.length > 0) {
    findings.push({
      severity: "warning",
      message:
        "Accepted completion claim cites evidence ids that are no longer present in the verification input.",
      evidenceIds: missingEvidenceIds,
    });
  }

  const citedEvidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is EvaluationEvidence => Boolean(item));
  if (actualText && citedEvidence.length > 0) {
    const evidenceSignals = new Set(
      citedEvidence.flatMap((item) => evidenceSignalTokens(item))
    );
    const actualTokens = new Set(textTokens(actualText));
    const mentionsEvidence = [...evidenceSignals].some((token) =>
      actualTokens.has(token)
    );
    if (!mentionsEvidence) {
      findings.push({
        severity: "warning",
        message:
          "Actual final assistant message does not mention any recognizable cited-evidence signal.",
        evidenceIds: citedEvidence.map((item) => item.id),
      });
    }
  }

  return {
    status: findings.some((item) => item.severity === "failed")
      ? "failed"
      : findings.length > 0
        ? "warning"
        : "passed",
    actualMessage,
    claim,
    evidenceIds,
    findings,
    createdAt,
  };
}

export function auditAndStoreGoalFinalMessage(
  agentId: string,
  actualMessage: GoalActualFinalMessage,
  options: { sessionId?: string | null } = {}
): { goal: AgentGoal; audit: GoalFinalMessageAudit } | null {
  if (actualMessage.stopReason !== "stop") return null;
  const goal = getGoal(agentId);
  if (
    !goal ||
    goal.status !== "complete" ||
    !goal.lastCompletionClaim ||
    goal.lastFinalMessageAudit
  ) {
    return null;
  }
  const collected = collectGoalVerificationInput(agentId, goal, options);
  if (!collected) return null;
  const audit = auditGoalFinalMessage({
    claim: goal.lastCompletionClaim,
    actualMessage,
    evidence: collected.evaluationEvidence,
  });
  const updated = patchGoal(agentId, { lastFinalMessageAudit: audit });
  return updated ? { goal: updated, audit } : null;
}

function normalizedEvidenceIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean).slice(0, 50))];
}

function tokenOverlapRatio(left: string, right: string): number {
  const leftTokens = new Set(textTokens(left));
  if (leftTokens.size === 0) return right.trim() ? 1 : 0;
  const rightTokens = new Set(textTokens(right));
  let matched = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matched++;
  }
  return matched / leftTokens.size;
}

function evidenceSignalTokens(evidence: EvaluationEvidence): string[] {
  return textTokens(
    [
      evidence.id,
      evidence.title,
      evidence.href,
      evidence.summary,
      evidence.kind,
      evidence.outcome,
    ]
      .filter((item): item is string => Boolean(item))
      .join(" ")
  );
}

function textTokens(text: string): string[] {
  const normalized = text.toLowerCase();
  const ascii = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  const cjk = (normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []).flatMap(
    cjkTokens
  );
  return [...ascii, ...cjk]
    .map((token) => token.replace(/^_+|_+$/g, ""))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function cjkTokens(span: string): string[] {
  if (span.length <= 3) return [span];
  const tokens = [span];
  for (let i = 0; i < span.length - 1; i++) {
    tokens.push(span.slice(i, i + 2));
  }
  return tokens;
}
