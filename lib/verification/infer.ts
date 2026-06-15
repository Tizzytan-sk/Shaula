import { createHash } from "node:crypto";
import type {
  VerificationCheck,
  VerificationCommandCheck,
  VerificationPlan,
  VerificationPlanInferenceInput,
} from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 180_000;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function hasScript(
  scripts: Record<string, string> | undefined,
  name: string
): boolean {
  return Boolean(scripts && Object.prototype.hasOwnProperty.call(scripts, name));
}

function criterionText(
  criteria: VerificationPlanInferenceInput["acceptanceCriteria"] = []
): string {
  return criteria
    .flatMap((criterion) => [
      criterion.description,
      criterion.criterion,
      ...(criterion.evidenceRequired ?? []),
    ])
    .filter((item): item is string => typeof item === "string")
    .join(" ");
}

function hasChangedSource(files: string[] = []): boolean {
  return files.some((file) => /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json)$/i.test(file));
}

function stablePlanId(input: VerificationPlanInferenceInput, createdAt: number): string {
  const digest = createHash("sha1")
    .update(
      [
        input.agentId ?? "",
        input.contractId ?? "",
        input.objective,
        input.profileId ?? "",
        createdAt,
      ].join(":")
    )
    .digest("hex")
    .slice(0, 10);
  return `verification-${createdAt}-${digest}`;
}

function requiredEvidenceTokens(input: VerificationPlanInferenceInput): string[] {
  return [
    ...(input.requiredEvidence ?? []),
    ...(input.acceptanceCriteria ?? []).flatMap(
      (criterion) => criterion.evidenceRequired ?? []
    ),
  ].map(normalizeToken);
}

function requiredEvidenceForTypecheck(tokens: string[]): string[] {
  const explicit = tokens.filter(
    (token) => token.includes("typecheck") || token.includes("type_check")
  );
  return explicit.length > 0 ? [...new Set(explicit)] : ["typecheck"];
}

function needs(
  input: VerificationPlanInferenceInput,
  token: string,
  fallback = false
): boolean {
  const required = requiredEvidenceTokens(input);
  const text = normalizeToken(`${criterionText(input.acceptanceCriteria)} ${input.objective}`);
  return required.some((item) => item.includes(token)) || text.includes(token) || fallback;
}

function commandCheck(
  patch: Omit<VerificationCommandCheck, "type" | "cwd" | "timeoutMs"> & {
    cwd: string;
    timeoutMs?: number;
  }
): VerificationCommandCheck {
  return {
    type: "command",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...patch,
  };
}

export function inferVerificationPlan(
  input: VerificationPlanInferenceInput
): VerificationPlan {
  const createdAt = input.createdAt ?? Date.now();
  const profileId = input.profileId ?? "";
  const sourceChanged = hasChangedSource(input.changedFiles);
  const codingProfile = profileId.startsWith("coding.");
  const hasExplicitRequiredEvidence =
    (input.requiredEvidence?.length ?? 0) > 0 ||
    (input.acceptanceCriteria ?? []).some(
      (criterion) => (criterion.evidenceRequired?.length ?? 0) > 0
    );
  const requiredTokens = requiredEvidenceTokens(input);
  const requiredBy = (token: string) =>
    requiredTokens.some((item) => item.includes(token));
  const checks = new Map<string, VerificationCheck>();

  const add = (check: VerificationCheck) => {
    if (!checks.has(check.id)) checks.set(check.id, check);
  };

  if (needs(input, "test", codingProfile && !hasExplicitRequiredEvidence)) {
    const required = requiredBy("test") || codingProfile;
    if (hasScript(input.packageScripts, "test") || !input.packageScripts) {
      add(
        commandCheck({
          id: "npm-test",
          kind: "test",
          label: "Run tests",
          command: "npm",
          args: ["test"],
          cwd: input.cwd,
          required,
          evidenceRequired: ["test_result"],
          rationale: required
            ? "Contract or coding profile requires deterministic test evidence."
            : "Source changes suggest a test run.",
        })
      );
    }
  }

  if (needs(input, "lint", sourceChanged)) {
    if (hasScript(input.packageScripts, "lint") || !input.packageScripts) {
      add(
        commandCheck({
          id: "npm-lint",
          kind: "lint",
          label: "Run lint",
          command: "npm",
          args: ["run", "lint"],
          cwd: input.cwd,
          required: requiredBy("lint"),
          evidenceRequired: ["lint_result"],
          rationale: requiredBy("lint")
            ? "Contract requires lint evidence."
            : "Source changes should be checked for syntax/style regressions.",
        })
      );
    }
  }

  if (needs(input, "build", profileId === "coding.frontend-ui")) {
    if (hasScript(input.packageScripts, "build") || !input.packageScripts) {
      add(
        commandCheck({
          id: "npm-build",
          kind: "build",
          label: "Run build",
          command: "npm",
          args: ["run", "build"],
          cwd: input.cwd,
          timeoutMs: BUILD_TIMEOUT_MS,
          required: requiredBy("build") || profileId === "coding.frontend-ui",
          evidenceRequired: ["build_result"],
          rationale:
            profileId === "coding.frontend-ui"
              ? "Frontend UI changes should prove the app still builds."
              : "Contract requires build evidence.",
        })
      );
    }
  }

  if (needs(input, "typecheck", false) || needs(input, "type_check", false)) {
    const typecheckEvidence = requiredEvidenceForTypecheck(requiredTokens);
    if (hasScript(input.packageScripts, "typecheck")) {
      add(
        commandCheck({
          id: "npm-typecheck",
          kind: "typecheck",
          label: "Run typecheck",
          command: "npm",
          args: ["run", "typecheck"],
          cwd: input.cwd,
          required: requiredBy("typecheck") || requiredBy("type_check"),
          evidenceRequired: typecheckEvidence,
          rationale: "Contract or acceptance criteria mention type checking.",
        })
      );
    } else if (input.hasTypeScriptConfig) {
      add(
        commandCheck({
          id: "npx-tsc-no-emit",
          kind: "typecheck",
          label: "Run TypeScript typecheck",
          command: "npx",
          args: ["tsc", "--noEmit", "--pretty", "false"],
          cwd: input.cwd,
          required: requiredBy("typecheck") || requiredBy("type_check"),
          evidenceRequired: typecheckEvidence,
          rationale:
            "Contract or acceptance criteria mention type checking, and this TypeScript project has no package typecheck script.",
        })
      );
    }
  }

  if (needs(input, "browser", profileId === "coding.frontend-ui")) {
    add({
      id: "browser-observation",
      type: "browser_observation",
      kind: "browser_observation",
      label: "Browser observation",
      targetUrl: input.targetUrl,
      required: requiredBy("browser") || profileId === "coding.frontend-ui",
      evidenceRequired: ["browser_observation"],
      rationale:
        "Frontend completion needs host-observed UI evidence, not just textual reports.",
    });
  }

  return {
    id: input.id ?? stablePlanId(input, createdAt),
    agentId: input.agentId,
    contractId: input.contractId,
    objective: input.objective,
    profileId: input.profileId,
    checks: [...checks.values()],
    createdAt,
  };
}
