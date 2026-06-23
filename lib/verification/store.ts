import { appendEvidence } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import {
  commandResultToEvidenceRef,
  verificationResultToEvidenceRef,
} from "./evidence";
import type { VerificationCommandResult, VerificationResult } from "./types";

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

export function recordVerificationResult(
  result: VerificationResult,
  context: {
    id?: string;
    agentId?: string;
    sessionId?: string | null;
    createdAt?: number;
  } = {}
): EvidenceRef {
  return appendEvidence(verificationResultToEvidenceRef(result, context));
}
