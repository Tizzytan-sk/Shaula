import type { EvidenceRef } from "@/lib/evidence/types";
import type { TeamTask } from "./types";
import type { TeamTaskVerificationSummary } from "./verifier";

export type TeamTaskSynthesisStatus = "ready" | "warning" | "failed";

export type TeamTaskSynthesisItemKind =
  | "conclusion"
  | "risk"
  | "conflict"
  | "gap"
  | "next_action";

export type TeamTaskSynthesisSeverity = "info" | "warning" | "danger";

export interface TeamTaskSynthesisItem {
  id: string;
  kind: TeamTaskSynthesisItemKind;
  severity: TeamTaskSynthesisSeverity;
  title: string;
  detail?: string;
  domain?: string;
  taskIds: string[];
  evidenceIds: string[];
}

export type TeamTaskSynthesisAssistanceStatus = "accepted" | "rejected";

export interface TeamTaskSynthesisAssistanceDraft {
  headline?: string;
  summary?: string;
  status?: TeamTaskSynthesisStatus;
  itemIds?: string[];
  taskIds?: string[];
  evidenceIds?: string[];
}

export interface TeamTaskSynthesisAssistance {
  status: TeamTaskSynthesisAssistanceStatus;
  source: "llm_assisted";
  generatedAt: number;
  headline?: string;
  summary?: string;
  itemIds: string[];
  taskIds: string[];
  evidenceIds: string[];
  warnings: string[];
  meta?: TeamTaskSynthesisAssistanceMeta;
}

export interface TeamTaskSynthesisAssistanceMeta {
  fingerprint?: string;
  cached?: boolean;
  model?: {
    provider: string;
    id: string;
    name?: string;
  };
  latencyMs?: number;
  httpStatus?: number;
  tokenCount?: number;
  estimatedCost?: number;
  updatedAt?: number;
}

export interface TeamTaskSynthesisSummary {
  status: TeamTaskSynthesisStatus;
  generatedAt: number;
  headline: string;
  domains: string[];
  evidenceIds: string[];
  taskIds: string[];
  items: TeamTaskSynthesisItem[];
  assistance?: TeamTaskSynthesisAssistance;
}

export interface SynthesizeTeamTasksInput {
  tasks: TeamTask[];
  evidence: EvidenceRef[];
  verification: TeamTaskVerificationSummary | null;
  generatedAt?: number;
  assistanceDraft?: TeamTaskSynthesisAssistanceDraft;
}

export interface BuildTeamSynthesisAssistancePromptInput {
  synthesis: TeamTaskSynthesisSummary;
  tasks: TeamTask[];
  evidence: EvidenceRef[];
  verification: TeamTaskVerificationSummary | null;
}

const DOMAIN_PATTERNS: Array<{ domain: string; patterns: RegExp[] }> = [
  {
    domain: "security/auth",
    patterns: [/auth/i, /login/i, /oauth/i, /permission/i, /rbac/i, /安全/, /权限/],
  },
  {
    domain: "frontend",
    patterns: [/ui/i, /ux/i, /browser/i, /workbench/i, /component/i, /tsx?/i, /前端/, /界面/],
  },
  {
    domain: "workflow",
    patterns: [/workflow/i, /worktree/i, /template/i, /orchestration/i, /流程/],
  },
  {
    domain: "verification",
    patterns: [/test/i, /vitest/i, /playwright/i, /typecheck/i, /verifier/i, /验证/, /测试/],
  },
  {
    domain: "data",
    patterns: [/data/i, /schema/i, /store/i, /json/i, /state/i, /数据/],
  },
  {
    domain: "docs",
    patterns: [/docs?\//i, /\.md\b/i, /document/i, /文档/],
  },
];

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((item): item is string => Boolean(item)))];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compactText(value: string | undefined, max = 180): string | undefined {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function compactList(values: string[] | undefined, maxItems = 24): string[] {
  return unique((values ?? []).map((item) => compactText(item, 160))).slice(
    0,
    maxItems
  );
}

function evidenceText(evidence: EvidenceRef | undefined): string | undefined {
  if (!evidence) return undefined;
  return compactText(evidence.summary ?? evidence.textPreview ?? evidence.title);
}

function taskText(task: TeamTask, evidence: EvidenceRef[]): string {
  return [
    task.title,
    task.ownerType,
    task.source.type,
    task.blockedBy,
    task.contextPacket?.objective,
    task.contextPacket?.taskTitle,
    task.contextPacket?.taskBoundary,
    ...(task.contextPacket?.relevantPaths ?? []),
    ...(task.contextPacket?.writePaths ?? []),
    ...task.writePaths,
    ...task.requiredEvidence,
    ...evidence.flatMap((item) => [
      item.title,
      item.summary,
      item.textPreview,
      item.filePath,
      item.artifactUri,
      item.source?.type,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function inferDomain(task: TeamTask, evidence: EvidenceRef[]): string {
  const text = taskText(task, evidence);
  for (const entry of DOMAIN_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.domain;
    }
  }
  return "general";
}

function itemSeverityFromTask(task: TeamTask): TeamTaskSynthesisSeverity {
  if (task.status === "failed" || task.status === "blocked") return "danger";
  if (task.status === "warning") return "warning";
  return "info";
}

function statusFromVerification(
  verification: TeamTaskVerificationSummary | null,
  items: TeamTaskSynthesisItem[]
): TeamTaskSynthesisStatus {
  if (verification?.status === "failed") return "failed";
  if (items.some((item) => item.severity === "danger")) return "failed";
  if (verification?.status === "warning") return "warning";
  if (items.some((item) => item.severity === "warning")) return "warning";
  return "ready";
}

function headlineFor(status: TeamTaskSynthesisStatus, items: TeamTaskSynthesisItem[]): string {
  const conclusions = items.filter((item) => item.kind === "conclusion").length;
  const risks = items.filter((item) => item.kind === "risk").length;
  const conflicts = items.filter((item) => item.kind === "conflict").length;
  const gaps = items.filter((item) => item.kind === "gap").length;
  if (status === "failed") {
    return `${conclusions} conclusions; blocked by ${gaps + conflicts + risks} issue(s).`;
  }
  if (status === "warning") {
    return `${conclusions} conclusions; ${risks + conflicts + gaps} warning(s) need synthesis.`;
  }
  return `${conclusions} conclusions with linked team evidence.`;
}

function riskItemIds(synthesis: TeamTaskSynthesisSummary): string[] {
  return synthesis.items
    .filter(
      (item) =>
        item.severity !== "info" ||
        item.kind === "risk" ||
        item.kind === "conflict" ||
        item.kind === "gap"
    )
    .map((item) => item.id);
}

function unknownIds(ids: string[], allowed: Set<string>): string[] {
  return ids.filter((id) => !allowed.has(id));
}

function allIncluded(required: string[], actual: Set<string>): boolean {
  return required.every((id) => actual.has(id));
}

export function applyTeamSynthesisAssistance(
  synthesis: TeamTaskSynthesisSummary,
  draft: TeamTaskSynthesisAssistanceDraft,
  generatedAt = Date.now()
): TeamTaskSynthesisSummary {
  const allowedItemIds = new Set(synthesis.items.map((item) => item.id));
  const allowedTaskIds = new Set(synthesis.taskIds);
  const allowedEvidenceIds = new Set(synthesis.evidenceIds);
  const draftItemIds = compactList(draft.itemIds);
  const draftTaskIds = compactList(draft.taskIds);
  const draftEvidenceIds = compactList(draft.evidenceIds);
  const unknownItemIds = unknownIds(draftItemIds, allowedItemIds);
  const unknownTaskIds = unknownIds(draftTaskIds, allowedTaskIds);
  const unknownEvidenceIds = unknownIds(draftEvidenceIds, allowedEvidenceIds);
  const warnings: string[] = [];

  if (draft.status && draft.status !== synthesis.status) {
    warnings.push(
      `Ignored draft status "${draft.status}"; Team synthesis status remains "${synthesis.status}".`
    );
  }
  if (unknownItemIds.length > 0) {
    warnings.push(`Rejected unknown item ids: ${unknownItemIds.join(", ")}.`);
  }
  if (unknownTaskIds.length > 0) {
    warnings.push(`Rejected unknown task ids: ${unknownTaskIds.join(", ")}.`);
  }
  if (unknownEvidenceIds.length > 0) {
    warnings.push(`Rejected unknown evidence ids: ${unknownEvidenceIds.join(", ")}.`);
  }

  const itemIds = draftItemIds.filter((id) => allowedItemIds.has(id));
  const taskIds = draftTaskIds.filter((id) => allowedTaskIds.has(id));
  const evidenceIds = draftEvidenceIds.filter((id) => allowedEvidenceIds.has(id));
  const requiredRiskItemIds = riskItemIds(synthesis);
  if (!allIncluded(requiredRiskItemIds, new Set(itemIds))) {
    warnings.push(
      `Rejected draft because it omitted required risk/conflict/gap item ids: ${requiredRiskItemIds.join(", ") || "(none)"}.`
    );
  }

  const headline = compactText(draft.headline, 180);
  const summary = compactText(draft.summary, 900);
  if (!headline && !summary) {
    warnings.push("Rejected draft because it did not provide a headline or summary.");
  }

  const accepted =
    warnings.length === 0 &&
    (Boolean(headline) || Boolean(summary)) &&
    allIncluded(requiredRiskItemIds, new Set(itemIds));

  return {
    ...synthesis,
    assistance: {
      status: accepted ? "accepted" : "rejected",
      source: "llm_assisted",
      generatedAt,
      headline,
      summary,
      itemIds,
      taskIds,
      evidenceIds,
      warnings,
    },
  };
}

export function buildTeamSynthesisAssistancePrompt(
  input: BuildTeamSynthesisAssistancePromptInput
): string {
  const requiredRiskItemIds = riskItemIds(input.synthesis);
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const taskById = new Map(input.tasks.map((item) => [item.id, item]));
  const payload = {
    synthesis: {
      status: input.synthesis.status,
      headline: input.synthesis.headline,
      domains: input.synthesis.domains,
      requiredRiskItemIds,
      allowedItemIds: input.synthesis.items.map((item) => item.id),
      allowedTaskIds: input.synthesis.taskIds,
      allowedEvidenceIds: input.synthesis.evidenceIds,
      items: input.synthesis.items.slice(0, 12).map((item) => ({
        id: item.id,
        kind: item.kind,
        severity: item.severity,
        title: compactText(item.title, 120),
        detail: compactText(item.detail, 240),
        domain: item.domain,
        taskIds: item.taskIds,
        evidenceIds: item.evidenceIds,
      })),
    },
    verification: input.verification
      ? {
          status: input.verification.status,
          summary: compactText(input.verification.summary, 240),
          checks: input.verification.checks.slice(0, 12).map((check) => ({
            id: check.id,
            status: check.status,
            message: compactText(check.message, 240),
          })),
        }
      : null,
    tasks: input.synthesis.taskIds.slice(0, 12).map((id) => {
      const task = taskById.get(id);
      return {
        id,
        title: compactText(task?.title, 120),
        status: task?.status,
        ownerType: task?.ownerType,
        requiredEvidence: task?.requiredEvidence ?? [],
        evidenceIds: task?.evidenceIds ?? [],
      };
    }),
    evidence: input.synthesis.evidenceIds.slice(0, 12).map((id) => {
      const item = evidenceById.get(id);
      return {
        id,
        kind: item?.kind,
        title: compactText(item?.title, 120),
        summary: evidenceText(item),
        trustLevel: item?.trustLevel,
        sourceType: item?.source?.type,
      };
    }),
  };

  return [
    "You are producing an LLM-assisted Team synthesis note for Shaula.",
    "You may improve wording and connect existing Team conclusions, but you must not change verifier status or invent evidence.",
    "",
    "Hard rules:",
    `- Top-level status is fixed: ${input.synthesis.status}. Do not claim it is stronger.`,
    "- Use only allowed itemIds, taskIds, and evidenceIds from the payload.",
    "- Include every requiredRiskItemId in itemIds, even if your summary is short.",
    "- Do not treat synthesis text as test_result, browser_observation, diff, or workflow_artifact evidence.",
    "- Return JSON only with: headline, summary, itemIds, taskIds, evidenceIds.",
    "",
    "Bounded payload:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export function fingerprintTeamSynthesis(
  synthesis: TeamTaskSynthesisSummary
): string {
  return hashString(
    stableStringify({
      status: synthesis.status,
      headline: synthesis.headline,
      domains: synthesis.domains,
      evidenceIds: synthesis.evidenceIds,
      taskIds: synthesis.taskIds,
      items: synthesis.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        severity: item.severity,
        title: item.title,
        detail: item.detail,
        domain: item.domain,
        taskIds: item.taskIds,
        evidenceIds: item.evidenceIds,
      })),
    })
  );
}

export function synthesizeTeamTasks(
  input: SynthesizeTeamTasksInput
): TeamTaskSynthesisSummary | null {
  if (input.tasks.length === 0) return null;
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const items: TeamTaskSynthesisItem[] = [];

  for (const task of input.tasks) {
    const linkedEvidence = task.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item): item is EvidenceRef => Boolean(item));
    const domain = inferDomain(task, linkedEvidence);
    const primaryEvidence = linkedEvidence[0];
    const severity = itemSeverityFromTask(task);
    const kind: TeamTaskSynthesisItemKind =
      task.status === "failed" || task.status === "blocked" || task.status === "warning"
        ? "risk"
        : "conclusion";
    items.push({
      id: `task:${task.id}`,
      kind,
      severity,
      title: task.title,
      detail:
        task.blockedBy ??
        evidenceText(primaryEvidence) ??
        compactText(task.contextPacket?.taskBoundary),
      domain,
      taskIds: [task.id],
      evidenceIds: task.evidenceIds,
    });
  }

  for (const check of input.verification?.checks ?? []) {
    if (check.status === "passed") continue;
    const isConflict = check.id.includes("conflict");
    const isGap =
      check.id.includes("evidence") ||
      check.message.toLowerCase().includes("missing");
    items.push({
      id: `check:${check.id}`,
      kind: isConflict ? "conflict" : isGap ? "gap" : "next_action",
      severity: check.status === "failed" ? "danger" : "warning",
      title: check.id,
      detail: compactText(check.message, 220),
      taskIds: [],
      evidenceIds: [],
    });
  }

  const status = statusFromVerification(input.verification, items);
  const base: TeamTaskSynthesisSummary = {
    status,
    generatedAt: input.generatedAt ?? Date.now(),
    headline: headlineFor(status, items),
    domains: unique(items.map((item) => item.domain)),
    evidenceIds: unique(input.tasks.flatMap((task) => task.evidenceIds)),
    taskIds: input.tasks.map((task) => task.id),
    items,
  };
  return input.assistanceDraft
    ? applyTeamSynthesisAssistance(base, input.assistanceDraft, base.generatedAt)
    : base;
}
