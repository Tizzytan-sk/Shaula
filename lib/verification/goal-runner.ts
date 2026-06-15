import "server-only";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { EvidenceRef } from "@/lib/evidence/types";
import { getExecutionContract } from "@/lib/execution-contract/store";
import type { AgentGoal, GoalRunClosure } from "@/lib/goal/types";
import { evaluateAndStoreGoalRunClosure } from "@/lib/goal/closure-store";
import { getGoal } from "@/lib/goal/file-store";
import { recordVerificationCommandResult } from "./store";
import { inferVerificationPlan } from "./infer";
import { runVerificationPlan } from "./runner";
import type {
  VerificationCommandCheck,
  VerificationCommandResult,
  VerificationPlan,
} from "./types";

export interface GoalVerificationRunResult {
  plan: VerificationPlan;
  results: VerificationCommandResult[];
  evidence: EvidenceRef[];
  goal: AgentGoal | null;
  closure: GoalRunClosure | null;
}

export async function runGoalVerificationPlanForAgent(input: {
  agentId: string;
  cwd: string;
  sessionId?: string | null;
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
  });
  const runnablePlan: VerificationPlan = {
    ...plan,
    checks:
      input.requiredOnly === false
        ? plan.checks
        : plan.checks.filter(isRequiredCommandCheck),
  };
  const results = await runVerificationPlan(runnablePlan);
  const evidence = results.map((result) =>
    recordVerificationCommandResult(result, {
      agentId: input.agentId,
      sessionId: input.sessionId,
    })
  );
  const storedClosure = evaluateAndStoreGoalRunClosure(input.agentId);
  return {
    plan: runnablePlan,
    results,
    evidence,
    goal: storedClosure?.goal ?? getGoal(input.agentId),
    closure: storedClosure?.closure ?? null,
  };
}

function isRequiredCommandCheck(
  check: VerificationPlan["checks"][number]
): check is VerificationCommandCheck {
  return check.type === "command" && check.required;
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
