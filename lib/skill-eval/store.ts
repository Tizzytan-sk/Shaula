import { appendEvidenceMany } from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { SkillEvalRun } from "./types";

export function recordSkillEvalRunEvidence(run: SkillEvalRun): EvidenceRef[] {
  return appendEvidenceMany(run.evidence);
}
