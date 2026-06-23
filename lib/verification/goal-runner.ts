import "server-only";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { agentBrowserId } from "@/lib/browser/browser-id";
import {
  browserOpen,
  browserScreenshot,
  browserVerify,
} from "@/lib/browser/runtime";
import type { EvidenceRef } from "@/lib/evidence/types";
import { requiredEvidenceCoverage } from "@/lib/evidence/ledger";
import { getExecutionContract } from "@/lib/execution-contract/store";
import type { AgentGoal, GoalRunClosure } from "@/lib/goal/types";
import { evaluateAndStoreGoalRunClosure } from "@/lib/goal/closure-store";
import { getGoal } from "@/lib/goal/file-store";
import { collectGoalVerificationInput } from "@/lib/goal/verification-input";
import { recordVerificationResult } from "./store";
import { inferVerificationPlan } from "./infer";
import {
  runVerificationPlan,
  type VerificationBrowserObserver,
} from "./runner";
import type {
  VerificationPlan,
  VerificationResult,
} from "./types";

export interface GoalVerificationRunResult {
  plan: VerificationPlan;
  results: VerificationResult[];
  evidence: EvidenceRef[];
  goal: AgentGoal | null;
  closure: GoalRunClosure | null;
}

export async function runGoalVerificationPlanForAgent(input: {
  agentId: string;
  cwd: string;
  sessionId?: string | null;
  browserId?: string | null;
  targetUrl?: string | null;
  targetSelector?: string | null;
  targetText?: string | null;
  browserOnly?: boolean;
  requiredOnly?: boolean;
}): Promise<GoalVerificationRunResult> {
  const goal = getGoal(input.agentId);
  if (!goal) throw new Error("active goal required");
  const contract = goal.contractId
    ? getExecutionContract(goal.contractId)
    : null;
  const plan = inferVerificationPlan({
    agentId: input.agentId,
    contractId: contract?.id ?? goal.contractId,
    objective: contract?.objective ?? goal.objective,
    profileId: contract?.rubricProfile,
    requiredEvidence: contract?.requiredEvidence,
    acceptanceCriteria: contract?.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      evidenceRequired: criterion.evidenceRequired,
    })),
    packageScripts: readPackageScripts(input.cwd),
    hasTypeScriptConfig: hasTypeScriptConfig(input.cwd),
    cwd: input.cwd,
    targetUrl: input.targetUrl ?? undefined,
    targetSelector: input.targetSelector ?? undefined,
    targetText: input.targetText ?? undefined,
  });
  const runnablePlan: VerificationPlan = {
    ...plan,
    checks:
      input.requiredOnly === false
        ? plan.checks
        : plan.checks.filter((check) => check.required),
  };
  if (input.browserOnly) {
    runnablePlan.checks = runnablePlan.checks.filter(
      (check) => check.type === "browser_observation"
    );
  }
  const results = await runVerificationPlan(runnablePlan, {
    browserObserver: createAgentBrowserObserver({
      agentId: input.agentId,
      browserId: input.browserId ?? undefined,
    }),
  });
  const evidence = results.map((result) =>
    recordVerificationResult(result, {
      agentId: input.agentId,
      sessionId: input.sessionId,
    })
  );
  const storedClosure = evaluateAndStoreGoalRunClosure(input.agentId, {
    sessionId: input.sessionId,
  });
  return {
    plan: runnablePlan,
    results,
    evidence,
    goal: storedClosure?.goal ?? getGoal(input.agentId),
    closure: storedClosure?.closure ?? null,
  };
}

export async function ensureBrowserVerificationForGoal(input: {
  agentId: string;
  cwd: string;
  sessionId?: string | null;
  browserId?: string | null;
  targetUrl?: string | null;
  targetSelector?: string | null;
  targetText?: string | null;
}): Promise<GoalVerificationRunResult | null> {
  const goal = getGoal(input.agentId);
  if (!goal) return null;
  const contract = goal.contractId ? getExecutionContract(goal.contractId) : null;
  if (!contractRequiresBrowserEvidence(contract)) return null;

  const collected = collectGoalVerificationInput(input.agentId, goal, {
    sessionId: input.sessionId,
  });
  const coverage = requiredEvidenceCoverage(
    ["browser_observation"],
    collected?.evaluationEvidence ?? []
  );
  if (coverage.missing.length === 0) return null;

  return runGoalVerificationPlanForAgent({
    ...input,
    browserOnly: true,
    requiredOnly: true,
  });
}

function contractRequiresBrowserEvidence(
  contract: ReturnType<typeof getExecutionContract>
): boolean {
  const tokens = [
    ...(contract?.requiredEvidence ?? []),
    ...(contract?.acceptanceCriteria ?? []).flatMap(
      (criterion) => criterion.evidenceRequired ?? []
    ),
  ];
  return tokens.some((item) => item.toLowerCase().includes("browser"));
}

function createAgentBrowserObserver(input: {
  agentId: string;
  browserId?: string | null;
}): VerificationBrowserObserver {
  const browserId = input.browserId || agentBrowserId(input.agentId);
  return async (check) => {
    let snapshot:
      | Awaited<ReturnType<typeof browserScreenshot>>["snapshot"]
      | undefined;
    let passed = false;
    let textPreview: string | undefined;

    if (check.targetUrl) {
      const opened = await browserOpen(browserId, check.targetUrl, {
        taskId: check.id,
      });
      snapshot = opened.snapshot;
    }

    if (check.selector || check.text || check.expectation || check.targetUrl) {
      const expectation =
        check.expectation ??
        (check.targetUrl
          ? `page opened at ${check.targetUrl}`
          : check.text
            ? `visible text: ${check.text}`
            : `visible selector: ${check.selector}`);
      const verified = await browserVerify(
        browserId,
        {
          expectation,
          selector: check.selector,
          text: check.text,
        },
        { taskId: check.id }
      );
      snapshot = verified.snapshot;
      passed = verified.result.passed;
      textPreview = verified.result.evidence;
    } else {
      const captured = await browserScreenshot(browserId);
      snapshot = captured.snapshot;
      passed = Boolean(snapshot.screenshotDataUrl || snapshot.url);
      textPreview = snapshot.title ?? snapshot.url ?? undefined;
    }

    return {
      browserId,
      passed,
      url: snapshot?.url,
      title: snapshot?.title,
      screenshotDataUrl: snapshot?.screenshotDataUrl,
      textPreview,
    };
  };
}

function readPackageScripts(cwd: string): Record<string, string> | undefined {
  try {
    const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object") return undefined;
    const scripts: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.scripts)) {
      if (typeof value === "string") scripts[key] = value;
    }
    return scripts;
  } catch {
    return undefined;
  }
}

function hasTypeScriptConfig(cwd: string): boolean {
  return existsSync(path.join(cwd, "tsconfig.json"));
}
