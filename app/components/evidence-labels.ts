import type { EvidenceTrustLevel } from "@/lib/evidence/types";

export function evidenceTrustTone(trust?: EvidenceTrustLevel): string {
  if (trust === "user_confirmed" || trust === "host_observed") {
    return "var(--color-success)";
  }
  if (trust === "deterministic_check" || trust === "artifact_reference") {
    return "var(--accent)";
  }
  if (trust === "textual_log") return "var(--color-warning)";
  return "var(--text-muted)";
}

export function evidenceTrustLabel(trust?: EvidenceTrustLevel): string {
  switch (trust) {
    case "agent_reported":
      return "reported by agent";
    case "textual_log":
      return "text log";
    case "artifact_reference":
      return "file/reference";
    case "deterministic_check":
      return "verified check";
    case "host_observed":
      return "browser observed";
    case "user_confirmed":
      return "user confirmed";
    default:
      return "unknown";
  }
}
