import { createHash } from "node:crypto";
import { inferEvaluationProfileId } from "@/lib/evaluation/profile-selector";
import { getEvaluatorWeightProfile } from "@/lib/evaluation/profiles";
import {
  EXECUTION_CONTRACT_VERSION,
  type ExecutionAcceptanceCriterion,
  type ExecutionBudgetHints,
  type ExecutionContract,
  type ExecutionMainArtifact,
  type ExecutionMainArtifactKind,
  type ExecutionStopPolicy,
} from "./types";

export interface BuildExecutionContractInput {
  agentId: string;
  objective: string;
  tokenBudget?: number;
  id?: string;
  createdAt?: number;
  scope?: string[];
  nonGoals?: string[];
  acceptanceCriteria?: ExecutionAcceptanceCriterion[];
  requiredEvidence?: string[];
  mainArtifact?: string | Partial<ExecutionMainArtifact>;
  rubricProfile?: string;
  allowedCapabilities?: string[];
  budgetHints?: ExecutionBudgetHints;
  stopPolicy?: ExecutionStopPolicy;
}

const MAX_TEXT = 2000;
const MAX_LIST_ITEMS = 20;

function cleanText(value: unknown, maxLength = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, fallback: string[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function isMainArtifactKind(value: unknown): value is ExecutionMainArtifactKind {
  return (
    value === "file" ||
    value === "directory" ||
    value === "url" ||
    value === "route" ||
    value === "other"
  );
}

function inferArtifactKind(label: string, href?: string): ExecutionMainArtifactKind {
  const value = (href || label).trim();
  if (/^https?:\/\//i.test(value)) return "url";
  if (/^\/[A-Za-z0-9/_-]*$/.test(value)) return "route";
  if (/[\\/]$/.test(value)) return "directory";
  if (/[\\/]/.test(value) && !/\.[A-Za-z0-9]{1,12}$/.test(value)) {
    return "directory";
  }
  if (/\.[A-Za-z0-9]{1,12}$/.test(value)) return "file";
  return "other";
}

function normalizeMainArtifact(
  raw: string | Partial<ExecutionMainArtifact> | undefined,
  source: ExecutionMainArtifact["source"]
): ExecutionMainArtifact | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    const label = cleanText(raw, 500);
    if (!label) return undefined;
    const href = label;
    return {
      kind: inferArtifactKind(label, href),
      label,
      href,
      source,
    };
  }
  const label =
    cleanText(raw.label, 500) || cleanText(raw.href, 1000);
  if (!label) return undefined;
  const href = cleanText(raw.href, 1000) || undefined;
  return {
    kind: isMainArtifactKind(raw.kind)
      ? raw.kind
      : inferArtifactKind(label, href),
    label,
    ...(href ? { href } : {}),
    source: raw.source ?? source,
  };
}

function inferPathLikeArtifact(
  text: string,
  source: ExecutionMainArtifact["source"]
): ExecutionMainArtifact | undefined {
  const normalized = cleanText(text, 1000);
  if (!normalized) return undefined;
  const candidates = [
    ...normalized.matchAll(/`([^`]+)`/g),
  ].map((match) => match[1]);
  const url = normalized.match(/https?:\/\/[^\s),;]+/i)?.[0];
  if (url) candidates.unshift(url);
  const windowsPath = normalized.match(/[A-Za-z]:[\\/][^\s),;]+/)?.[0];
  if (windowsPath) candidates.push(windowsPath);
  const slashPath = normalized.match(
    /(?:\.{1,2}[\\/])?[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+[\\/]?/,
  )?.[0];
  if (slashPath) candidates.push(slashPath);
  const fileName = normalized.match(
    /[A-Za-z0-9_.-]+\.(?:tsx?|jsx?|md|html?|css|json|ya?ml|py|cs|go|rs|java|kt|swift|vue|svelte|mjs|cjs)\b/i,
  )?.[0];
  if (fileName) candidates.push(fileName);

  for (const candidate of candidates) {
    const value = cleanText(candidate, 500);
    if (!value) continue;
    if (
      /^https?:\/\//i.test(value) ||
      value.includes("/") ||
      value.includes("\\") ||
      /\.[A-Za-z0-9]{1,12}$/.test(value)
    ) {
      return normalizeMainArtifact(value, source);
    }
  }
  return undefined;
}

function inferMainArtifact(input: BuildExecutionContractInput): ExecutionMainArtifact | undefined {
  return (
    normalizeMainArtifact(input.mainArtifact, "explicit") ??
    cleanList(input.scope, [])
      .map((item) => inferPathLikeArtifact(item, "scope"))
      .find(Boolean) ??
    inferPathLikeArtifact(input.objective, "objective")
  );
}

function stableContractId(agentId: string, objective: string, createdAt: number): string {
  const digest = createHash("sha1")
    .update(`${agentId}:${createdAt}:${objective}`)
    .digest("hex")
    .slice(0, 10);
  return `contract-${createdAt}-${digest}`;
}

function defaultScope(): string[] {
  return [
    "Complete the stated objective in the current workspace and active session.",
    "Keep changes and actions within the user-approved scope.",
  ];
}

function defaultNonGoals(): string[] {
  return [
    "Do not perform public, external, destructive, or irreversible actions without explicit user confirmation.",
    "Do not migrate legacy app state paths until a migration plan is explicitly approved.",
    "Do not introduce unrelated refactors or parallel data models.",
  ];
}

function defaultAcceptanceCriteria(profileId: string): ExecutionAcceptanceCriterion[] {
  const base: ExecutionAcceptanceCriterion[] = [
    {
      id: "objective-met",
      description: "The stated objective is completed, not merely analyzed.",
      required: true,
      evidenceRequired: ["goal_evidence"],
    },
    {
      id: "evidence-recorded",
      description: "Concrete evidence is recorded for the completed work.",
      required: true,
      evidenceRequired: ["goal_evidence"],
    },
  ];
  if (profileId === "coding.default" || profileId === "coding.frontend-ui") {
    base.push({
      id: "local-verification-reviewed",
      description: "Relevant local verification such as tests, lint, build, or browser checks is run or explicitly explained.",
      required: true,
      evidenceRequired: ["test_result", "diff"],
    });
  }
  return base;
}

function defaultRequiredEvidence(profileId: string): string[] {
  if (profileId === "coding.frontend-ui") {
    return ["diff", "test_result", "browser_observation"];
  }
  if (profileId === "coding.default") {
    return ["diff", "test_result"];
  }
  if (profileId === "skill.eval") {
    return ["eval_run", "rubric_score", "version_diff"];
  }
  if (profileId.startsWith("analysis.") || profileId === "attribution.analysis") {
    return ["source_note", "analysis_artifact"];
  }
  return ["goal_evidence"];
}

function defaultAllowedCapabilities(profileId: string): string[] {
  if (profileId === "desktop.external-action") {
    return ["read_context", "ask_user", "local_observation"];
  }
  if (profileId === "coding.default" || profileId === "coding.frontend-ui") {
    return ["read_workspace", "edit_workspace", "run_local_checks", "browser_observation"];
  }
  if (profileId === "skill.eval") {
    return ["read_workspace", "edit_workspace", "run_eval_cases", "record_evidence"];
  }
  return ["read_context", "record_evidence", "use_workflows"];
}

function normalizeCriteria(
  criteria: ExecutionAcceptanceCriterion[] | undefined,
  fallback: ExecutionAcceptanceCriterion[]
): ExecutionAcceptanceCriterion[] {
  return (criteria && criteria.length > 0 ? criteria : fallback)
    .map((criterion, index) => ({
      id: cleanText(criterion.id, 120) || `criterion-${index + 1}`,
      description: cleanText(criterion.description, 600),
      required: criterion.required !== false,
      evidenceRequired: cleanList(criterion.evidenceRequired, []),
    }))
    .filter((criterion) => criterion.description)
    .slice(0, MAX_LIST_ITEMS);
}

export function buildExecutionContract(
  input: BuildExecutionContractInput
): ExecutionContract {
  const objective = cleanText(input.objective);
  if (!objective) throw new Error("execution contract objective required");
  const agentId = cleanText(input.agentId, 200);
  if (!agentId) throw new Error("execution contract agentId required");

  const createdAt = input.createdAt ?? Date.now();
  const inferredProfile = inferEvaluationProfileId({ objective });
  const overrideProfile = cleanText(input.rubricProfile, 160);
  const rubricProfile = overrideProfile || inferredProfile;
  const profile = getEvaluatorWeightProfile(rubricProfile);

  return {
    id: cleanText(input.id, 200) || stableContractId(agentId, objective, createdAt),
    version: EXECUTION_CONTRACT_VERSION,
    agentId,
    objective,
    scope: cleanList(input.scope, defaultScope()),
    nonGoals: cleanList(input.nonGoals, defaultNonGoals()),
    acceptanceCriteria: normalizeCriteria(
      input.acceptanceCriteria,
      defaultAcceptanceCriteria(rubricProfile)
    ),
    requiredEvidence: cleanList(
      input.requiredEvidence,
      defaultRequiredEvidence(rubricProfile)
    ),
    mainArtifact: inferMainArtifact(input),
    rubricProfile,
    profileSelection: {
      source: overrideProfile ? "override" : "inferred",
      selectedProfile: rubricProfile,
      inferredProfile,
      ...(overrideProfile ? { overrideProfile } : {}),
    },
    allowedCapabilities: cleanList(
      input.allowedCapabilities,
      defaultAllowedCapabilities(rubricProfile)
    ),
    budgetHints: {
      ...input.budgetHints,
      ...(typeof input.tokenBudget === "number" && input.tokenBudget > 0
        ? { tokenBudget: input.tokenBudget }
        : {}),
    },
    stopPolicy: {
      targetScore: profile?.targetScore,
      minDelta: profile?.exitPolicy.minDelta,
      maxIterations: profile?.exitPolicy.maxIterations,
      ...input.stopPolicy,
    },
    createdAt,
    updatedAt: createdAt,
  };
}
