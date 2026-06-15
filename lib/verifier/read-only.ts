import { createHash } from "node:crypto";
import type { SubagentTask } from "@/lib/subagents/types";
import type {
  BuildReadOnlyVerifierRequestInput,
  ReadOnlyVerifierRequest,
  ReadOnlyVerifierResult,
} from "./types";

export const READ_ONLY_VERIFIER_DEFAULT_TOOLS = [
  "read_files",
  "search",
  "browser_snapshot",
  "browser_extract",
  "list_evidence",
] as const;

const MAX_TEXT = 6000;
const MAX_EVIDENCE = 40;
const READ_ONLY_VERIFIER_ALLOWED_TOOLS = new Set<string>(
  READ_ONLY_VERIFIER_DEFAULT_TOOLS
);

function cleanText(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function stableRequestId(input: BuildReadOnlyVerifierRequestInput, createdAt: number): string {
  const digest = createHash("sha1")
    .update([input.objective, input.contract?.objective ?? "", createdAt].join(":"))
    .digest("hex")
    .slice(0, 10);
  return `readonly-verifier-${createdAt}-${digest}`;
}

export function isReadOnlyVerifierToolAllowed(tool: string): boolean {
  return READ_ONLY_VERIFIER_ALLOWED_TOOLS.has(tool);
}

export function sanitizeReadOnlyVerifierTools(tools?: string[]): string[] {
  const source = tools && tools.length > 0
    ? tools
    : [...READ_ONLY_VERIFIER_DEFAULT_TOOLS];
  return [...new Set(source.map((item) => item.trim()).filter(Boolean))]
    .filter(isReadOnlyVerifierToolAllowed);
}

export function buildReadOnlyVerifierRequest(
  input: BuildReadOnlyVerifierRequestInput
): ReadOnlyVerifierRequest {
  const objective = cleanText(input.objective);
  if (!objective) throw new Error("read-only verifier objective required");
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: input.id ?? stableRequestId(input, createdAt),
    objective,
    contract: input.contract ?? null,
    evidence: (input.evidence ?? []).slice(0, MAX_EVIDENCE).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: cleanText(item.title, 500) ?? item.id,
      href: cleanText(item.href, 1000),
      summary: cleanText(item.summary, 1000),
      trustLevel: item.trustLevel,
      source: cleanText(item.source, 500),
      verifiable: item.verifiable,
      outcome: item.outcome,
      createdAt: item.createdAt,
    })),
    rubricEvaluation: input.rubricEvaluation,
    diffSummary: cleanText(input.diffSummary),
    finalOutput: cleanText(input.finalOutput),
    allowedTools: sanitizeReadOnlyVerifierTools(input.allowedTools),
    createdAt,
  };
}

export function buildReadOnlyVerifierPrompt(
  request: ReadOnlyVerifierRequest
): string {
  return [
    "You are a read-only completion verifier.",
    "Do not modify files, run shell commands, publish, deploy, send messages, or change external state.",
    "Use only the allowed tools listed in the request. If evidence is insufficient, reject.",
    "Return only JSON matching this schema:",
    '{"decision":"accept|reject|needs_review","reason":"string","missingEvidence":["string"],"failedCriteria":["string"],"confidence":0}',
    "",
    "Verifier request:",
    JSON.stringify(request, null, 2),
  ].join("\n");
}

export function buildReadOnlyVerifierSubagentTask(
  request: ReadOnlyVerifierRequest
): SubagentTask {
  return {
    id: request.id,
    title: "Read-only completion verifier",
    role: "code-review",
    prompt: buildReadOnlyVerifierPrompt(request),
    allowedTools: sanitizeReadOnlyVerifierTools(request.allowedTools),
    maxTurns: 2,
    timeoutMs: 120_000,
  };
}

export function parseReadOnlyVerifierResult(value: unknown): ReadOnlyVerifierResult {
  const parsed = typeof value === "string"
    ? safeJson(value)
    : { value, mode: "object" as const };
  const source = parsed.value;
  const record = source && typeof source === "object"
    ? source as Record<string, unknown>
    : {};
  let decision: ReadOnlyVerifierResult["decision"] =
    record.decision === "accept" ||
    record.decision === "reject" ||
    record.decision === "needs_review"
      ? record.decision
      : "needs_review";
  if (parsed.mode === "wrapped" && decision === "accept") {
    decision = "needs_review";
  }
  return {
    decision,
    reason: cleanText(record.reason, 2000) ?? "Verifier result did not include a reason.",
    missingEvidence: cleanStringList(record.missingEvidence),
    failedCriteria: cleanStringList(record.failedCriteria),
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0,
  };
}

type ParsedVerifierJson =
  | { value: unknown; mode: "strict" | "fenced" | "wrapped" }
  | { value: null; mode: "invalid" };

function safeJson(value: string): ParsedVerifierJson {
  for (const candidate of verifierJsonCandidates(value)) {
    try {
      return {
        value: JSON.parse(candidate.value),
        mode: candidate.mode,
      };
    } catch {
      // Try the next conservative candidate.
    }
  }
  return { value: null, mode: "invalid" };
}

function verifierJsonCandidates(
  value: string
): Array<{ value: string; mode: "strict" | "fenced" | "wrapped" }> {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const candidates: Array<{ value: string; mode: "strict" | "fenced" | "wrapped" }> = [
    { value: trimmed, mode: "strict" },
  ];
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fenced.length === 1 && fenced[0]?.[1]) {
    candidates.push({ value: fenced[0][1].trim(), mode: "fenced" });
  } else if (fenced.length > 1) {
    return candidates;
  }
  const wrapped = extractSingleJsonObject(trimmed);
  if (wrapped) candidates.push({ value: wrapped, mode: "wrapped" });
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.mode}:${candidate.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSingleJsonObject(value: string): string | null {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth === 0) return null;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(value.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (depth !== 0 || objects.length !== 1) return null;
  return objects[0];
}

function cleanStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 1000))
        .filter(Boolean)
        .slice(0, 20)
    : [];
}
