import { appendEvidence } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import { commandResultToEvidenceRef } from "./evidence";
import type { VerificationCommandResult } from "./types";

export function recordVerificationCommandResult(
  result: VerificationCommandResult,
  context: {
    id?: string;
    agentId?: string;
    sessionId?: string | null;
    createdAt?: number;
  } = {}
): EvidenceRef {
  return appendEvidence(commandResultToEvidenceRef(result, context));
}
