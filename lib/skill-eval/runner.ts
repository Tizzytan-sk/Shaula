import { inferAdvisoryRouteDecision } from "@/lib/task-router/advisory";
import { summarizeExecutionMode } from "@/lib/agent-mode/execution-mode";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentRecord } from "@/lib/agent-registry";
import {
  __resetRouteDecisionsForTest,
  latestRouteDecision,
  recordRouteDecision,
} from "@/lib/task-router/server-store";
import {
  runLocalGoalDogfoodSet,
  type DogfoodGoalCaseId,
  type DogfoodGoalRunRecord,
} from "@/lib/dogfood/goal-run-set";
import {
  evidenceRefToEvaluationEvidence,
  requiredEvidenceCoverage,
} from "@/lib/evidence/ledger";
import {
  __resetEvidenceStoreForTest,
  appendEvidence,
} from "@/lib/evidence/server-store";
import type { EvidenceRef } from "@/lib/evidence/types";
import { verifyGoalCompletion } from "@/lib/goal/verifier";
import {
  LOCAL_CODING_ASSISTANT_MODEL_ID,
  LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE,
  buildLocalCodingAssistantCliArgs,
  createLocalCodingAssistantSession,
  extractLocalCodingAssistantText,
} from "@/lib/local-coding-assistant/adapter";
import { findWriteBoundaryViolation } from "@/lib/subagents/write-boundary";
import {
  applyTeamSynthesisAssistance,
  buildTeamSynthesisAssistancePrompt,
  synthesizeTeamTasks,
} from "@/lib/team-state/synthesis";
import {
  __resetTeamTaskStoreForTest,
  __setTeamTaskStoreRootForTest,
  upsertTeamTask,
} from "@/lib/team-state/server-store";
import {
  __resetTeamSynthesisAssistanceStoreForTest,
  __setTeamSynthesisAssistanceStoreRootForTest,
} from "@/lib/team-state/synthesis-assistance-store";
import type { TeamTask } from "@/lib/team-state/types";
import { verifyTeamTasks } from "@/lib/team-state/verifier";
import { handleTeamPostAction } from "@/lib/agent-actions/team-actions";
import { parseReadOnlyVerifierResult } from "@/lib/verifier/read-only";
import {
  TEAM_READONLY_REVIEW_TEMPLATE_ID,
  TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID,
} from "@/lib/workflows/builtin-templates";
import {
  browserResultToEvidenceRef,
  commandResultToEvidenceRef,
} from "@/lib/verification/evidence";
import { inferVerificationPlan } from "@/lib/verification/infer";
import { isAllowedVerificationCommand } from "@/lib/verification/runner";
import {
  __clearWorkflowMemoryForTest,
  __setWorkflowStoreRootForTest,
} from "@/lib/workflows/server-store";
import { __setRuntimeLedgerRootForTest } from "@/lib/runtime/file-ledger";
import { runWorkflowScript } from "@/lib/workflows/script-runtime";
import { getWorkflowTemplate } from "@/lib/workflows/template-store";
import { evaluateSkillEvalRun } from "./harness";
import { SHAULA_SKILL_EVAL_SUITE_V1, type SkillEvalSuite } from "./suite";
import type {
  SkillEvalCase,
  SkillEvalCaseResult,
  SkillEvalRun,
  SkillEvalRunInput,
} from "./types";
import type {
  VerificationBrowserResult,
  VerificationCommandResult,
} from "@/lib/verification/types";

export interface SkillEvalRunnerContext {
  createdAt: number;
}

export type SkillEvalCaseExecutor = (
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
) => SkillEvalCaseResult | Promise<SkillEvalCaseResult>;

export interface RunSkillEvalSuiteInput
  extends Omit<SkillEvalRunInput, "cases" | "results"> {
  suite: SkillEvalSuite;
  executors: Record<string, SkillEvalCaseExecutor>;
  failMissingExecutors?: boolean;
}

export async function runSkillEvalSuite(
  input: RunSkillEvalSuiteInput
): Promise<SkillEvalRun> {
  const createdAt = input.createdAt ?? Date.now();
  const results: SkillEvalCaseResult[] = [];

  for (const testCase of input.suite.cases) {
    const executor = input.executors[testCase.id];
    if (!executor) {
      results.push({
        caseId: testCase.id,
        status: input.failMissingExecutors === false ? "partial" : "fail",
        reason: `No executable runner is registered for case ${testCase.id}.`,
      });
      continue;
    }
    results.push(await executor(testCase, { createdAt }));
  }

  return evaluateSkillEvalRun({
    ...input,
    cases: input.suite.cases,
    results,
    createdAt,
  });
}

export function shaulaSkillEvalSuiteV1Executors(): Record<
  string,
  SkillEvalCaseExecutor
> {
  return {
    "preflight-evidence-ledger": runPreflightEvidenceLedger,
    "task-a-typecheck-fallback": runTypecheckFallbackCase,
    "task-b-readonly-verifier-dirty-json": runReadOnlyVerifierJsonCase,
    "task-c-route-decision-visibility": runRouteDecisionVisibilityCase,
    "p3-router-shadow-visibility": runRouterShadowVisibilityCase,
    "p3-whiteboard-fake-evidence-rejected": runWhiteboardFakeEvidenceRejectedCase,
    "team-readonly-conflict-synthesis": runTeamReadonlyConflictSynthesisCase,
    "team-domain-aware-synthesis": runTeamDomainAwareSynthesisCase,
    "team-llm-assisted-synthesis-guardrail":
      runTeamLlmAssistedSynthesisGuardrailCase,
    "team-llm-assisted-synthesis-cache":
      runTeamLlmAssistedSynthesisCacheCase,
    "workflow-team-template-readonly": runWorkflowTeamTemplateReadonlyCase,
    "workflow-team-worktree-implementation": runWorkflowTeamWorktreeImplementationCase,
    "workflow-team-capability-deny": runWorkflowTeamCapabilityDenyCase,
    "provider-team-tool-isolation": runProviderTeamToolIsolationCase,
    "p2-coding-diff-success": (testCase, context) =>
      runDogfoodCodingDiffCase(testCase, context),
    "p2-premature-completion-rejection": (testCase, context) =>
      runDogfoodPrematureCompletionCase(testCase, context),
    "p2-failed-required-check": (testCase, context) =>
      runDogfoodFailedRequiredCheckCase(testCase, context),
    "p2-needs-user-pause": (testCase, context) =>
      runDogfoodNeedsUserPauseCase(testCase, context),
    "p2-blocked-pause": (testCase, context) =>
      runDogfoodBlockedPauseCase(testCase, context),
    "p2-browser-observation": (testCase, context) =>
      runDogfoodBrowserObservationCase(testCase, context),
    "p2-subagent-write-boundary": runSubagentWriteBoundaryCase,
    "p2-workflow-worktree-merge-approval": runWorkflowWorktreeMergeApprovalCase,
    "p2-local-cli-shim": runLocalCliShimCase,
  };
}

export function runShaulaSkillEvalSuiteV1(
  input: Omit<RunSkillEvalSuiteInput, "suite" | "executors">
): Promise<SkillEvalRun> {
  return runSkillEvalSuite({
    ...input,
    suite: SHAULA_SKILL_EVAL_SUITE_V1,
    executors: shaulaSkillEvalSuiteV1Executors(),
  });
}

function passResult(
  testCase: SkillEvalCase,
  reason: string,
  metadata?: SkillEvalCaseResult["metadata"]
): SkillEvalCaseResult {
  return {
    caseId: testCase.id,
    status: "pass",
    score: 1,
    reason,
    metadata,
  };
}

function failResult(testCase: SkillEvalCase, reason: string): SkillEvalCaseResult {
  return {
    caseId: testCase.id,
    status: "fail",
    score: 0,
    reason,
  };
}

function runPreflightEvidenceLedger(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const innerRun = evaluateSkillEvalRun({
    id: "skill-eval-preflight-inner",
    agentId: "skill-eval-runner",
    skillName: "shaula-skill-eval-preflight",
    skillPath: "lib/skill-eval/harness.ts",
    versionDiff: { summary: "Preflight validates evidence and rubric wiring." },
    cases: [
      {
        id: "inner-evidence-case",
        title: "Inner evidence case",
        prompt: "Validate that a skill eval run emits required evidence.",
        kind: "positive",
      },
    ],
    results: [
      {
        caseId: "inner-evidence-case",
        status: "pass",
        reason: "Inner case passed.",
      },
    ],
    createdAt: context.createdAt,
  });
  const evidenceKinds = new Set(
    innerRun.evidence.flatMap((item) =>
      item.criteria?.map((criterion) => criterion.requiredEvidence) ?? []
    )
  );
  const hasRequiredEvidence =
    evidenceKinds.has("eval_run") &&
    evidenceKinds.has("rubric_score") &&
    evidenceKinds.has("version_diff");

  if (innerRun.evaluation.status === "passed" && hasRequiredEvidence) {
    return passResult(testCase, "Harness emits eval_run, rubric_score, and version_diff evidence.", {
      testsRun: ["skill-eval-preflight-inner"],
    });
  }
  return failResult(testCase, "Harness did not emit the required evidence set.");
}

function runTypecheckFallbackCase(testCase: SkillEvalCase): SkillEvalCaseResult {
  const plan = inferVerificationPlan({
    objective: "Provide typecheck evidence for a TypeScript project.",
    profileId: "coding.default",
    requiredEvidence: ["typecheck"],
    packageScripts: { test: "vitest run" },
    hasTypeScriptConfig: true,
    cwd: "C:/repo",
    createdAt: 1,
  });
  const check = plan.checks.find((item) => item.id === "npx-tsc-no-emit");
  if (
    check?.type === "command" &&
    check.required &&
    check.command === "npx" &&
    check.args.join(" ") === "tsc --noEmit --pretty false" &&
    isAllowedVerificationCommand(check)
  ) {
    return passResult(testCase, "Typecheck fallback is inferred and allowlisted.", {
      testsRun: ["inferVerificationPlan", "isAllowedVerificationCommand"],
    });
  }
  return failResult(testCase, "Typecheck fallback was missing or not allowlisted.");
}

function runReadOnlyVerifierJsonCase(testCase: SkillEvalCase): SkillEvalCaseResult {
  const strict = parseReadOnlyVerifierResult(
    '{"decision":"accept","reason":"Enough evidence","missingEvidence":[],"failedCriteria":[],"confidence":0.9}'
  );
  const fenced = parseReadOnlyVerifierResult(
    '```json\n{"decision":"reject","reason":"Missing evidence","missingEvidence":["test_result"],"failedCriteria":["goal-evidence"],"confidence":0.7}\n```'
  );
  const wrappedAccept = parseReadOnlyVerifierResult(
    'Looks good: {"decision":"accept","reason":"Enough evidence","missingEvidence":[],"failedCriteria":[],"confidence":0.9}'
  );
  const invalid = parseReadOnlyVerifierResult("not json");
  const multi = parseReadOnlyVerifierResult(
    '{"decision":"accept","reason":"one","confidence":1} {"decision":"accept","reason":"two","confidence":1}'
  );

  if (
    strict.decision === "accept" &&
    fenced.decision === "reject" &&
    wrappedAccept.decision === "needs_review" &&
    invalid.decision === "needs_review" &&
    multi.decision === "needs_review"
  ) {
    return passResult(testCase, "Verifier parser accepts only unambiguous structured output.", {
      testsRun: ["parseReadOnlyVerifierResult"],
      verifierRejectionCount: 3,
    });
  }
  return failResult(testCase, "Verifier parser accepted ambiguous or invalid output.");
}

function runRouteDecisionVisibilityCase(
  testCase: SkillEvalCase
): SkillEvalCaseResult {
  __resetRouteDecisionsForTest();
  const decision = recordRouteDecision(
    inferAdvisoryRouteDecision({
      agentId: "agent-route-case",
      text: "继续按计划执行优化，并保留可验证证据",
      hasActiveGoal: true,
      createdAt: 1,
    })
  );
  const latest = latestRouteDecision("agent-route-case");
  if (
    latest?.id === decision.id &&
    latest.route === "goal" &&
    latest.confidence > 0 &&
    latest.reasons.length > 0 &&
    latest.inputPreview.length > 0
  ) {
    return passResult(testCase, "Route decision is stored with timeline/status display fields.", {
      testsRun: ["inferAdvisoryRouteDecision", "recordRouteDecision"],
    });
  }
  return failResult(testCase, "Route decision was not visible through the latest-decision store.");
}

function runRouterShadowVisibilityCase(
  testCase: SkillEvalCase
): SkillEvalCaseResult {
  __resetRouteDecisionsForTest();
  const decision = recordRouteDecision(
    inferAdvisoryRouteDecision({
      agentId: "agent-router-shadow",
      text: "让多个 subagent 并行审查 app、lib 和 workflow，再汇总结论",
      mentionedAgents: ["reviewer"],
      createdAt: 10,
    })
  );
  const summary = summarizeExecutionMode(decision);
  const latest = latestRouteDecision("agent-router-shadow");
  if (
    latest?.id === decision.id &&
    decision.route === "subagent_batch" &&
    summary?.mode === "subagent_coordinator" &&
    summary.advisoryOnly &&
    summary.canSwitch &&
    summary.contextBoundary.includes("子任务") &&
    summary.permissionProfile.includes("只读")
  ) {
    return passResult(testCase, "Router recommendation is visible as advisory-only execution mode metadata.", {
      testsRun: ["inferAdvisoryRouteDecision", "summarizeExecutionMode"],
      route: decision.route,
      executionSemantics: "advisory_only",
    });
  }
  return failResult(testCase, "Router recommendation was missing, hard-routed, or lacked context-boundary metadata.");
}

function runWhiteboardFakeEvidenceRejectedCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const fakeWhiteboard: EvidenceRef = {
    id: "team-whiteboard-note",
    kind: "progress_artifact",
    title: "Team whiteboard: tests passed and browser visible",
    agentId: "agent-whiteboard",
    metadata: {
      kind: "test",
      status: "passed",
      passed: true,
      evidenceRequired: ["test_result", "browser_observation"],
    },
    createdAt: context.createdAt,
  };
  const evaluationEvidence = evidenceRefToEvaluationEvidence(fakeWhiteboard);
  const coverage = requiredEvidenceCoverage(
    ["test_result", "browser_observation"],
    [evaluationEvidence]
  );
  if (
    evaluationEvidence.trustLevel === "agent_reported" &&
    coverage.matchedEvidenceIds.length === 0 &&
    coverage.missing.some((item) =>
      item.includes("test_result") && item.includes("deterministic_check")
    ) &&
    coverage.missing.some((item) =>
      item.includes("browser_observation") && item.includes("host_observed")
    )
  ) {
    return passResult(testCase, "Whiteboard self-reports cannot satisfy deterministic or host-observed evidence.", {
      testsRun: ["evidenceRefToEvaluationEvidence", "requiredEvidenceCoverage"],
      verifierRejectionCount: 1,
    });
  }
  return failResult(
    testCase,
    `Whiteboard evidence unexpectedly matched required evidence: missing=${coverage.missing.join(",") || "none"}`
  );
}

function teamTaskForEval(patch: Partial<TeamTask>): TeamTask {
  return {
    id: "team-task",
    agentId: "agent-team-eval",
    sessionId: "session-team-eval",
    title: "Should this policy be allowed?",
    status: "completed",
    ownerType: "subagent",
    dependsOn: [],
    writePaths: [],
    requiredEvidence: ["subagent_result"],
    evidenceIds: [],
    artifactRefs: [],
    source: { type: "subagent", id: "task", parentId: "batch-team-eval" },
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function runTeamReadonlyConflictSynthesisCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const tasks = [
    teamTaskForEval({
      id: "subagent:batch-team-eval:allow",
      evidenceIds: ["subagent-result:batch-team-eval:allow:child-yes"],
      source: { type: "subagent", id: "allow", parentId: "batch-team-eval" },
    }),
    teamTaskForEval({
      id: "subagent:batch-team-eval:deny",
      evidenceIds: ["subagent-result:batch-team-eval:deny:child-no"],
      source: { type: "subagent", id: "deny", parentId: "batch-team-eval" },
    }),
  ];
  const evidence: EvidenceRef[] = [
    {
      id: "subagent-result:batch-team-eval:allow:child-yes",
      kind: "subagent_result",
      title: "Subagent completed: allow",
      agentId: "agent-team-eval",
      taskId: "allow",
      textPreview: "Yes, this policy can be allowed.",
      metadata: { childAgentId: "child-yes" },
      createdAt: context.createdAt,
    },
    {
      id: "subagent-result:batch-team-eval:deny:child-no",
      kind: "subagent_result",
      title: "Subagent completed: deny",
      agentId: "agent-team-eval",
      taskId: "deny",
      textPreview: "No, this policy cannot be allowed.",
      metadata: { childAgentId: "child-no" },
      createdAt: context.createdAt + 1,
    },
  ];
  const verification = verifyTeamTasks({
    tasks,
    evidence,
    verifiedAt: context.createdAt + 2,
  });
  const conflictCheck = verification.checks.find(
    (check) => check.id === "cross-task-conflicts"
  );
  if (
    verification.status === "warning" &&
    conflictCheck?.status === "warning" &&
    verification.failed === 0
  ) {
    return passResult(testCase, "Conflicting read-only team results produce a warning convergence state, not silent green.", {
      testsRun: ["verifyTeamTasks"],
    });
  }
  return failResult(
    testCase,
    `Team conflict synthesis did not warn: status=${verification.status}; conflict=${conflictCheck?.status ?? "missing"}`
  );
}

function runTeamDomainAwareSynthesisCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const tasks = [
    teamTaskForEval({
      id: "team-auth-review",
      title: "Review auth boundary",
      status: "warning",
      evidenceIds: ["team-auth-evidence"],
      blockedBy: "Needs parent synthesis before completion.",
      contextPacket: {
        objective: "Review Team implementation",
        taskTitle: "Review auth boundary",
        taskBoundary: "Read-only review of auth route permissions.",
        includeContext: [],
        excludeContext: [],
        relevantPaths: ["app/api/auth/route.ts"],
        writePaths: [],
        requiredEvidence: ["subagent_result"],
        outputContract: {
          format: "review",
          mustInclude: ["findings", "evidence ids"],
          mustNotDo: ["edit files"],
        },
      },
    }),
    teamTaskForEval({
      id: "team-ui-verify",
      title: "Verify Workbench Team UI",
      status: "completed",
      evidenceIds: ["team-ui-evidence"],
      contextPacket: {
        objective: "Review Team implementation",
        taskTitle: "Verify Workbench Team UI",
        taskBoundary: "Run browser-level checks for the Team Plan panel.",
        includeContext: [],
        excludeContext: [],
        relevantPaths: ["app/components/WorkbenchSidebar.tsx"],
        writePaths: [],
        requiredEvidence: ["test_result"],
        outputContract: {
          format: "summary",
          mustInclude: ["test result"],
          mustNotDo: ["claim unobserved evidence"],
        },
      },
    }),
  ];
  const evidence: EvidenceRef[] = [
    {
      id: "team-auth-evidence",
      kind: "subagent_result",
      title: "Auth reviewer warning",
      agentId: "agent-team-eval",
      summary: "Auth permission boundary needs parent synthesis.",
      source: { type: "subagent", id: "child-auth" },
      createdAt: context.createdAt,
    },
    {
      id: "team-ui-evidence",
      kind: "verification_result",
      title: "Playwright Team UI check passed",
      agentId: "agent-team-eval",
      summary: "Workbench Team Plan panel renders task, evidence, and verifier details.",
      source: { type: "system", id: "playwright" },
      metadata: { evidenceRequired: ["test_result"], outcome: "passed" },
      createdAt: context.createdAt + 1,
    },
  ];
  const verification = verifyTeamTasks({
    tasks,
    evidence,
    verifiedAt: context.createdAt + 2,
  });
  const synthesis = synthesizeTeamTasks({
    tasks,
    evidence,
    verification,
    generatedAt: context.createdAt + 3,
  });
  const kinds = new Set(synthesis?.items.map((item) => item.kind));
  if (
    synthesis?.status === "warning" &&
    synthesis.domains.includes("security/auth") &&
    synthesis.domains.includes("frontend") &&
    synthesis.evidenceIds.includes("team-auth-evidence") &&
    synthesis.evidenceIds.includes("team-ui-evidence") &&
    kinds.has("risk") &&
    kinds.has("conclusion")
  ) {
    return passResult(testCase, "Team synthesis exposes domain-aware conclusions and warning items backed by evidence ids.", {
      testsRun: ["synthesizeTeamTasks", "verifyTeamTasks"],
      executionSemantics: "synthesis_not_trusted_evidence",
    });
  }
  return failResult(
    testCase,
    `Domain-aware Team synthesis failed: ${JSON.stringify(synthesis)}`
  );
}

function runTeamLlmAssistedSynthesisGuardrailCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const tasks = [
    teamTaskForEval({
      id: "team-auth-review",
      title: "Review auth boundary",
      status: "warning",
      evidenceIds: ["team-auth-evidence"],
      blockedBy: "Needs parent synthesis before completion.",
      contextPacket: {
        objective: "Review Team implementation",
        taskTitle: "Review auth boundary",
        taskBoundary: "Read-only review of auth route permissions.",
        includeContext: [],
        excludeContext: [],
        relevantPaths: ["app/api/auth/route.ts"],
        writePaths: [],
        requiredEvidence: ["subagent_result"],
        outputContract: {
          format: "review",
          mustInclude: ["findings", "evidence ids"],
          mustNotDo: ["edit files"],
        },
      },
    }),
  ];
  const evidence: EvidenceRef[] = [
    {
      id: "team-auth-evidence",
      kind: "subagent_result",
      title: "Auth reviewer warning",
      agentId: "agent-team-eval",
      summary: "Auth permission boundary needs parent synthesis.",
      source: { type: "subagent", id: "child-auth" },
      createdAt: context.createdAt,
    },
  ];
  const verification = verifyTeamTasks({
    tasks,
    evidence,
    verifiedAt: context.createdAt + 1,
  });
  const synthesis = synthesizeTeamTasks({
    tasks,
    evidence,
    verification,
    generatedAt: context.createdAt + 2,
  });
  if (!synthesis) {
    return failResult(testCase, "Base Team synthesis was not produced.");
  }
  const prompt = buildTeamSynthesisAssistancePrompt({
    synthesis,
    tasks,
    evidence,
    verification,
  });
  const assisted = applyTeamSynthesisAssistance(
    synthesis,
    {
      status: "ready",
      headline: "All clear.",
      summary: "The Team warning can be treated as complete.",
      itemIds: [],
      taskIds: ["team-auth-review", "invented-task"],
      evidenceIds: ["team-auth-evidence", "invented-test-evidence"],
    },
    context.createdAt + 3
  );
  if (
    prompt.includes("Do not treat synthesis text as test_result") &&
    assisted.status === "warning" &&
    assisted.evidenceIds.length === 1 &&
    assisted.evidenceIds[0] === "team-auth-evidence" &&
    assisted.assistance?.status === "rejected" &&
    assisted.assistance.warnings.some((item) => item.includes("Ignored draft status")) &&
    assisted.assistance.warnings.some((item) => item.includes("unknown evidence ids")) &&
    assisted.assistance.warnings.some((item) => item.includes("required risk"))
  ) {
    return passResult(
      testCase,
      "LLM-assisted Team synthesis guardrail rejected status upgrades, invented evidence, and omitted risk items.",
      {
        testsRun: [
          "buildTeamSynthesisAssistancePrompt",
          "applyTeamSynthesisAssistance",
        ],
        executionSemantics: "llm_assistance_cannot_override_evidence",
      }
    );
  }
  return failResult(
    testCase,
    `LLM-assisted Team synthesis guardrail failed: ${JSON.stringify(assisted)}`
  );
}

async function runTeamLlmAssistedSynthesisCacheCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): Promise<SkillEvalCaseResult> {
  const storeRoot = mkdtempSync(
    path.join(os.tmpdir(), "shaula-skill-eval-team-assist-")
  );
  __setRuntimeLedgerRootForTest(storeRoot);
  __setTeamTaskStoreRootForTest(storeRoot);
  __setTeamSynthesisAssistanceStoreRootForTest(storeRoot);
  __resetEvidenceStoreForTest();
  __resetTeamTaskStoreForTest();
  __resetTeamSynthesisAssistanceStoreForTest();
  try {
    const rec = {
      id: "agent-team-eval",
      session: {
        sessionId: "session-team-eval",
        model: {
          provider: "openai",
          id: "gpt-test",
          name: "GPT Test",
          baseUrl: "https://example.test/v1",
        },
      },
    } as unknown as AgentRecord;
    upsertTeamTask({
      task: teamTaskForEval({
        id: "team-assist-review",
        status: "warning",
        title: "Review auth boundary",
        blockedBy: "Needs parent synthesis before completion.",
        evidenceIds: ["team-assist-evidence"],
        source: { type: "subagent", id: "team-assist-review", parentId: "batch-team-eval" },
      }),
      event: {
        id: "team-assist-event",
        taskId: "team-assist-review",
        agentId: "agent-team-eval",
        sessionId: "session-team-eval",
        type: "evidence_linked",
        status: "warning",
        evidenceIds: ["team-assist-evidence"],
        createdAt: context.createdAt,
      },
    });
    appendEvidence({
      id: "team-assist-evidence",
      kind: "subagent_result",
      title: "Auth reviewer warning",
      agentId: "agent-team-eval",
      sessionId: "session-team-eval",
      summary: "Auth boundary still needs parent synthesis.",
      source: { type: "subagent", id: "child-auth" },
      createdAt: context.createdAt,
    });

    let calls = 0;
    const first = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async ({ prompt }) => {
        calls += 1;
        if (!prompt.includes("allowedEvidenceIds")) {
          throw new Error("assistance prompt omitted allowlist");
        }
        return {
          role: "assistant",
          provider: "openai",
          api: "openai-responses",
          model: "gpt-test",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                headline: "Auth warning remains open.",
                summary:
                  "The provider-backed assist cites only the existing warning task and evidence.",
                itemIds: ["task:team-assist-review", "check:warning-team-tasks"],
                taskIds: ["team-assist-review"],
                evidenceIds: ["team-assist-evidence"],
              }),
            },
          ],
          stopReason: "stop",
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          timestamp: context.createdAt + 1,
        };
      },
    });
    const second = await handleTeamPostAction({
      type: "team_synthesis_assist",
      agentId: rec.id,
      rec,
      body: {},
      callModel: async () => {
        throw new Error("cache miss");
      },
    });
    if (
      calls === 1 &&
      first.body.cached === false &&
      second.body.cached === true &&
      (second.body.assistance as { status?: string } | undefined)?.status ===
        "accepted"
    ) {
      return passResult(
        testCase,
        "Provider-backed Team synthesis assistance runs explicitly once and reuses the fingerprint cache.",
        {
          testsRun: ["handleTeamPostAction", "teamSynthesisAssistanceStore"],
          executionSemantics: "explicit_provider_call_cached_by_fingerprint",
        }
      );
    }
    return failResult(
      testCase,
      `Team synthesis assistance cache failed: ${JSON.stringify({
        calls,
        first: first.body,
        second: second.body,
      })}`
    );
  } finally {
    __resetEvidenceStoreForTest();
    __resetTeamTaskStoreForTest();
    __resetTeamSynthesisAssistanceStoreForTest();
    __setTeamTaskStoreRootForTest(null);
    __setTeamSynthesisAssistanceStoreRootForTest(null);
    __setRuntimeLedgerRootForTest(null);
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

async function runWorkflowTeamTemplateReadonlyCase(
  testCase: SkillEvalCase
): Promise<SkillEvalCaseResult> {
  const template = getWorkflowTemplate(TEAM_READONLY_REVIEW_TEMPLATE_ID);
  if (!template) {
    return failResult(testCase, "Built-in read-only Team workflow template was not registered.");
  }
  const storeRoot = mkdtempSync(
    path.join(os.tmpdir(), "shaula-skill-eval-team-template-")
  );
  __setWorkflowStoreRootForTest(storeRoot);
  __clearWorkflowMemoryForTest();
  try {
    const result = await runWorkflowScript(
      {
        parentAgentId: "skill-eval-team-template",
        runSubagents: async (input) => {
          const taskId = input.tasks[0]?.id ?? "missing";
          const answer = taskId.endsWith("1")
            ? {
                question: "Should this policy be allowed?",
                verdict: "yes",
                summary: "Yes, it can be allowed.",
                evidenceNotes: ["Read-only reviewer result."],
                risks: [],
              }
            : {
                question: "Should this policy be allowed?",
                verdict: "no",
                summary: "No, it cannot be allowed.",
                evidenceNotes: ["Read-only reviewer result."],
                risks: ["Conflicting interpretation."],
              };
          return {
            batchId: `batch-${taskId}`,
            results: [
              {
                taskId,
                agentId: `agent-${taskId}`,
                status: "completed",
                answer: JSON.stringify(answer),
                startedAt: Date.now(),
                endedAt: Date.now(),
              },
            ],
          };
        },
      },
      {
        objective: "Evaluate built-in read-only Team template.",
        rationale: "Verify workflow-backed Team template remains read-only and warns on conflicts.",
        script: template.script,
        templateParams: {
          subject: "Policy review",
          questions: [
            "Should this policy be allowed?",
            "Should this policy be allowed?",
          ],
        },
        templateRef: {
          id: template.id,
          name: template.name,
          version: template.version,
        },
        capabilities: template.capabilities,
        maxAgents: template.maxAgents,
        maxConcurrency: template.maxConcurrency,
        timeoutMs: 10_000,
      }
    );
    const returnValue = result.returnValue as
      | { status?: string; conflicts?: unknown[] }
      | undefined;
    const hasArtifact = result.artifacts.some(
      (artifact) => artifact.name === "team-readonly-review"
    );
    const unsafeCapability = result.manifest.capabilities.find((capability) =>
      ["write_files", "shell", "browser", "network", "worktree", "mcp"].includes(
        capability
      )
    );
    if (
      result.status === "completed" &&
      returnValue?.status === "warning" &&
      Array.isArray(returnValue.conflicts) &&
      returnValue.conflicts.length === 1 &&
      hasArtifact &&
      !unsafeCapability &&
      result.manifest.capabilities.join(",") === "spawn_agent,read_files"
    ) {
      return passResult(testCase, "Built-in workflow-backed read-only Team template warns on conflict without unsafe capabilities.", {
        testsRun: ["runWorkflowScript", "getWorkflowTemplate"],
        route: "workflow_template",
        executionSemantics: "advisory_only",
      });
    }
    return failResult(
      testCase,
      `Unexpected Team template behavior: status=${result.status}; return=${JSON.stringify(result.returnValue)}; capabilities=${result.manifest.capabilities.join(",")}`
    );
  } finally {
    __setWorkflowStoreRootForTest(null);
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

async function runWorkflowTeamWorktreeImplementationCase(
  testCase: SkillEvalCase
): Promise<SkillEvalCaseResult> {
  const template = getWorkflowTemplate(TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID);
  if (!template) {
    return failResult(testCase, "Built-in worktree implementation Team workflow template was not registered.");
  }
  const storeRoot = mkdtempSync(
    path.join(os.tmpdir(), "shaula-skill-eval-worktree-template-")
  );
  __setWorkflowStoreRootForTest(storeRoot);
  __clearWorkflowMemoryForTest();
  const approvals: string[] = [];
  const mergeApprovals: string[] = [];
  const cwdSeen: Array<string | undefined> = [];
  const toolsSeen: Array<string[] | undefined> = [];
  const calls: string[] = [];
  try {
    const result = await runWorkflowScript(
      {
        parentAgentId: "skill-eval-worktree-template",
        approveCapability: async (request) => {
          approvals.push(request.capability);
          return { decision: "allow" };
        },
        approveWorktreeMerge: async (request) => {
          mergeApprovals.push(request.diff.stat);
          return { decision: "allow" };
        },
        worktrees: {
          async create(input) {
            calls.push("create");
            return {
              id: `${input.workflowId.slice(0, 4)}-impl`,
              path: "/tmp/skill-eval-worktree",
              branchName: "shaula-agent-workflow/test/impl",
              baseRef: input.baseRef ?? "HEAD",
              createdAt: Date.now(),
            };
          },
          async diff(worktree) {
            calls.push(`diff:${worktree.id}`);
            return {
              worktreeId: worktree.id,
              path: worktree.path,
              branchName: worktree.branchName,
              baseRef: worktree.baseRef,
              diff: "diff --git a/app.ts b/app.ts\n+export const ok = true;\n",
              stat: " app.ts | 1 +",
              createdAt: Date.now(),
            };
          },
          async merge(worktree) {
            calls.push(`merge:${worktree.id}`);
            return {
              worktreeId: worktree.id,
              path: worktree.path,
              branchName: worktree.branchName,
              mergedAt: Date.now(),
              applied: true,
            };
          },
        },
        runSubagents: async (input) => {
          const task = input.tasks[0];
          cwdSeen.push(task?.cwd);
          toolsSeen.push(task?.allowedTools);
          const isVerifier = task?.id === "worktree-verifier";
          return {
            batchId: `batch-${task?.id ?? "missing"}`,
            results: [
              {
                taskId: task?.id ?? "missing",
                agentId: `agent-${task?.id ?? "missing"}`,
                status: "completed",
                answer: isVerifier
                  ? JSON.stringify({
                      verdict: "pass",
                      summary: "Diff is ready to merge.",
                      risks: [],
                      requiredEvidence: ["diff"],
                    })
                  : "Implemented inside the worktree.",
                startedAt: Date.now(),
                endedAt: Date.now(),
              },
            ],
          };
        },
      },
      {
        objective: "Evaluate worktree-backed Team implementation template.",
        rationale: "Verify implementation Team writes through worktree and merge approval.",
        script: template.script,
        templateParams: {
          objective: "Add ok export.",
          implementationPrompt: "Add ok export.",
          requestMerge: true,
          worktreeName: "impl",
        },
        templateRef: {
          id: template.id,
          name: template.name,
          version: template.version,
        },
        capabilities: template.capabilities,
        maxAgents: template.maxAgents,
        maxConcurrency: template.maxConcurrency,
        timeoutMs: 10_000,
      }
    );
    const returnValue = result.returnValue as
      | { status?: string; merge?: { applied?: boolean }; mergeRequested?: boolean }
      | undefined;
    const hasDiffArtifact = result.artifacts.some((artifact) =>
      artifact.name.startsWith("worktree-diff:")
    );
    const hasMergeArtifact = result.artifacts.some((artifact) =>
      artifact.name.startsWith("worktree-merge:")
    );
    if (
      result.status === "completed" &&
      returnValue?.status === "merged" &&
      returnValue.mergeRequested === true &&
      returnValue.merge?.applied === true &&
      approvals.join(",") === "write_files,worktree" &&
      cwdSeen[0] === "/tmp/skill-eval-worktree" &&
      toolsSeen[0]?.includes("apply_patch") &&
      mergeApprovals[0] === " app.ts | 1 +" &&
      calls.some((item) => item.startsWith("merge:")) &&
      hasDiffArtifact &&
      hasMergeArtifact
    ) {
      return passResult(testCase, "Built-in worktree implementation Team template writes only in worktree and merges through approval.", {
        testsRun: ["runWorkflowScript", "getWorkflowTemplate"],
        route: "workflow_template",
      });
    }
    return failResult(
      testCase,
      `Unexpected worktree Team template behavior: status=${result.status}; return=${JSON.stringify(result.returnValue)}; approvals=${approvals.join(",")}; mergeApprovals=${mergeApprovals.join(",")}; cwd=${cwdSeen.join(",")}`
    );
  } finally {
    __setWorkflowStoreRootForTest(null);
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

async function runWorkflowTeamCapabilityDenyCase(
  testCase: SkillEvalCase
): Promise<SkillEvalCaseResult> {
  const storeRoot = mkdtempSync(
    path.join(os.tmpdir(), "shaula-skill-eval-capability-deny-")
  );
  __setWorkflowStoreRootForTest(storeRoot);
  __clearWorkflowMemoryForTest();
  let subagentCalls = 0;
  try {
    const result = await runWorkflowScript(
      {
        parentAgentId: "skill-eval-capability-deny",
        approveCapability: async (request) => ({
          decision: "deny",
          denyReason: `Denied ${request.capability} for test.`,
        }),
        runSubagents: async () => {
          subagentCalls += 1;
          return { batchId: "unexpected", results: [] };
        },
      },
      {
        objective: "Attempt denied workflow capability.",
        rationale: "Verify denied high-risk capability stops workflow before side effects.",
        capabilities: ["spawn_agent", "read_files", "network"],
        script: `
          workflow.artifact("should-not-exist", true);
          await workflow.fetchUrl({ url: "https://example.com" });
          return "unreachable";
        `,
        timeoutMs: 10_000,
      }
    );
    const deniedTrace = result.traceEvents.find(
      (event) =>
        event.type === "approval" &&
        event.capability === "network" &&
        event.decision === "deny"
    );
    if (
      result.status === "failed" &&
      result.error === "Denied network for test." &&
      deniedTrace &&
      subagentCalls === 0 &&
      result.artifacts.length === 0 &&
      result.returnValue === undefined
    ) {
      return passResult(testCase, "Denied workflow capability stops before script side effects.", {
        testsRun: ["runWorkflowScript"],
        openActionCount: 1,
      });
    }
    return failResult(
      testCase,
      `Denied capability produced unexpected result: status=${result.status}; error=${result.error ?? "none"}; artifacts=${result.artifacts.length}; subagents=${subagentCalls}`
    );
  } finally {
    __setWorkflowStoreRootForTest(null);
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

function providerDogfoodDisabledToolRules(input: {
  expectedEvidence: string[];
  caseId?: string;
}): string[] {
  const disabled = [
    "delegate_subagents",
    "plan_subagents",
    "run_dynamic_workflow",
    "run_workflow_script",
    "run_workflow_template",
  ];
  if (!input.expectedEvidence.includes("browser_observation")) {
    disabled.push("browser_");
  }
  if (input.caseId === "blocked-pause") {
    disabled.push(
      "apply_patch",
      "bash",
      "edit",
      "list_files",
      "powershell",
      "read_file",
      "run_command",
      "search_files",
      "shell",
      "write_file"
    );
  }
  return disabled;
}

function applyProviderDogfoodToolRules(input: {
  activeTools: string[];
  expectedEvidence: string[];
  caseId?: string;
}): { nextTools: string[]; disabledTools: string[]; rules: string[] } {
  const rules = providerDogfoodDisabledToolRules(input);
  const disabledTools = input.activeTools.filter((name) =>
    rules.some((rule) => name === rule || name.startsWith(rule))
  );
  return {
    nextTools: input.activeTools.filter((name) => !disabledTools.includes(name)),
    disabledTools,
    rules,
  };
}

function runProviderTeamToolIsolationCase(
  testCase: SkillEvalCase
): SkillEvalCaseResult {
  const activeTools = [
    "delegate_subagents",
    "plan_subagents",
    "run_dynamic_workflow",
    "run_workflow_script",
    "run_workflow_template",
    "browser_open",
    "browser_verify",
    "read_file",
    "goal_update",
    "progress_update",
  ];
  const ordinaryCase = applyProviderDogfoodToolRules({
    activeTools,
    expectedEvidence: ["diff", "test_result"],
    caseId: "coding-diff-success",
  });
  const browserCase = applyProviderDogfoodToolRules({
    activeTools,
    expectedEvidence: ["browser_observation"],
    caseId: "browser-observation",
  });
  const orchestrationTools = [
    "delegate_subagents",
    "plan_subagents",
    "run_dynamic_workflow",
    "run_workflow_script",
    "run_workflow_template",
  ];
  const ordinaryDisabled = new Set(ordinaryCase.disabledTools);
  const browserDisabled = new Set(browserCase.disabledTools);
  const ordinaryNext = new Set(ordinaryCase.nextTools);
  const browserNext = new Set(browserCase.nextTools);
  const disablesAllTeamTools = orchestrationTools.every(
    (tool) => ordinaryDisabled.has(tool) && browserDisabled.has(tool)
  );
  const preservesGoalTools =
    ordinaryNext.has("goal_update") &&
    ordinaryNext.has("progress_update") &&
    browserNext.has("goal_update") &&
    browserNext.has("progress_update");
  const preservesBrowserOnlyWhenRequired =
    !ordinaryNext.has("browser_open") &&
    !ordinaryNext.has("browser_verify") &&
    browserNext.has("browser_open") &&
    browserNext.has("browser_verify");

  if (
    disablesAllTeamTools &&
    preservesGoalTools &&
    preservesBrowserOnlyWhenRequired
  ) {
    return passResult(testCase, "Provider dogfood policy disables Team orchestration tools, including workflow templates, without stripping ordinary goal/progress tools.", {
      testsRun: ["providerDogfoodDisabledToolRules"],
      route: "provider_dogfood",
      executionSemantics: "orchestration_tools_disabled",
    });
  }
  return failResult(
    testCase,
    `Provider tool isolation failed: ordinaryNext=${ordinaryCase.nextTools.join(",")}; browserNext=${browserCase.nextTools.join(",")}; ordinaryDisabled=${ordinaryCase.disabledTools.join(",")}`
  );
}

function localDogfoodRecord(
  id: DogfoodGoalCaseId,
  context: SkillEvalRunnerContext
): DogfoodGoalRunRecord {
  const record = runLocalGoalDogfoodSet({
    agentId: "skill-eval-dogfood",
    createdAt: context.createdAt,
  }).find((item) => item.id === id);
  if (!record) throw new Error(`local dogfood case missing: ${id}`);
  return record;
}

function summarizeDogfoodFailure(record: DogfoodGoalRunRecord): string {
  return [
    `case=${record.id}`,
    `verdict=${record.closureVerdict}`,
    `verification=${record.verificationDecision}`,
    `missing=${record.missingEvidence.join(",") || "none"}`,
    `actions=${record.openActionCount}`,
  ].join("; ");
}

function dogfoodMetadata(
  record: DogfoodGoalRunRecord,
  extra: SkillEvalCaseResult["metadata"] = {}
): SkillEvalCaseResult["metadata"] {
  return {
    testsRun: ["runLocalGoalDogfoodSet"],
    verifierRejectionCount: record.verifierRejections,
    openActionCount: record.openActionCount,
    manualIntervention: record.userIntervention !== "none",
    ...extra,
  };
}

function skillEvalCommandResult(
  override: Partial<VerificationCommandResult>
): VerificationCommandResult {
  const completedAt = override.completedAt ?? Date.now();
  return {
    planId: "skill-eval-plan",
    commandId: "npm-test",
    kind: "test",
    label: "Targeted tests",
    command: "npm",
    args: ["test", "--", "fixture"],
    cwd: "/tmp/shaula-skill-eval",
    required: true,
    evidenceRequired: ["test_result"],
    status: "passed",
    exitCode: 0,
    durationMs: 42,
    startedAt: completedAt - 42,
    completedAt,
    ...override,
  };
}

function skillEvalBrowserResult(
  override: Partial<VerificationBrowserResult>
): VerificationBrowserResult {
  const completedAt = override.completedAt ?? Date.now();
  return {
    planId: "skill-eval-browser-plan",
    checkId: "browser-ready",
    kind: "browser_observation",
    label: "Browser ready",
    browserId: "skill-eval-browser",
    targetUrl: "http://127.0.0.1:3000",
    selector: "[data-testid='ready']",
    expectation: "ready element is visible",
    required: true,
    evidenceRequired: ["browser_observation"],
    status: "passed",
    passed: true,
    url: "http://127.0.0.1:3000",
    title: "Shaula",
    screenshotDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    textPreview: "Ready",
    durationMs: 42,
    startedAt: completedAt - 42,
    completedAt,
    ...override,
  };
}

function runDogfoodCodingDiffCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("code-change-success", context);
  const evidenceKinds = record.evidence.map((item) => item.kind);
  if (
    record.closureVerdict === "ready_to_finalize" &&
    record.verificationDecision === "accept" &&
    evidenceKinds.includes("diff") &&
    evidenceKinds.includes("test_result")
  ) {
    return passResult(testCase, "Coding dogfood closes only after diff and test evidence.", dogfoodMetadata(record, {
      changedFiles: ["fixture/src/value.json"],
      testsRun: ["runLocalGoalDogfoodSet", "fixture npm test"],
    }));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runDogfoodPrematureCompletionCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("verifier-rejection", context);
  if (
    record.closureVerdict === "continue" &&
    record.verificationDecision === "reject" &&
    record.openActionCount > 0 &&
    record.verifierRejections > 0
  ) {
    return passResult(testCase, "Premature completion is rejected and converted into a next action.", dogfoodMetadata(record));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runDogfoodFailedRequiredCheckCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("failed-required-check", context);
  const failedRequired = record.evidence.some(
    (item) => item.kind === "test_result" && item.outcome === "failed"
  );
  const failedCheck = evidenceRefToEvaluationEvidence(
    commandResultToEvidenceRef(
      skillEvalCommandResult({
        status: "failed",
        exitCode: 1,
        stdoutPreview: "1 failing test",
        completedAt: context.createdAt,
      }),
      { id: "failed-test-evidence", createdAt: context.createdAt }
    )
  );
  const recoveredCheck = evidenceRefToEvaluationEvidence(
    commandResultToEvidenceRef(
      skillEvalCommandResult({
        status: "passed",
        exitCode: 0,
        stdoutPreview: "tests passed",
        completedAt: context.createdAt + 1,
      }),
      { id: "recovered-test-evidence", createdAt: context.createdAt + 1 }
    )
  );
  const failedOnly = verifyGoalCompletion({
    goal: { objective: testCase.prompt },
    contract: {
      objective: testCase.prompt,
      requiredEvidence: ["test_result"],
    },
    evidence: [],
    evaluationEvidence: [failedCheck],
    turns: [],
  });
  const recovered = verifyGoalCompletion({
    goal: { objective: testCase.prompt },
    contract: {
      objective: testCase.prompt,
      requiredEvidence: ["test_result"],
    },
    evidence: [],
    evaluationEvidence: [failedCheck, recoveredCheck],
    turns: [],
  });
  if (
    record.closureVerdict === "continue" &&
    record.verificationDecision === "reject" &&
    failedRequired &&
    record.openActionCount > 0 &&
    failedOnly.decision === "reject" &&
    recovered.decision === "accept"
  ) {
    return passResult(testCase, "Failed required check blocks completion and keeps repair action open.", dogfoodMetadata(record, {
      testsRun: ["runLocalGoalDogfoodSet", "commandResultToEvidenceRef", "newer passed required test recovery"],
    }));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runDogfoodNeedsUserPauseCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("needs-user-pause", context);
  if (
    record.closureVerdict === "needs_user" &&
    record.autoContinueCount === 0 &&
    record.userIntervention === "decision"
  ) {
    return passResult(testCase, "User-decision boundary pauses autonomous continuation.", dogfoodMetadata(record));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runDogfoodBlockedPauseCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("blocked-pause", context);
  if (
    record.closureVerdict === "blocked" &&
    record.autoContinueCount === 0 &&
    record.userIntervention === "external_unblock"
  ) {
    return passResult(testCase, "External blocker pauses autonomous continuation.", dogfoodMetadata(record));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runDogfoodBrowserObservationCase(
  testCase: SkillEvalCase,
  context: SkillEvalRunnerContext
): SkillEvalCaseResult {
  const record = localDogfoodRecord("ui-check-success", context);
  const browserEvidence = record.evidence.find(
    (item) => item.kind === "screenshot" && item.trustLevel === "host_observed"
  );
  const textOnly = verifyGoalCompletion({
    goal: { objective: testCase.prompt },
    contract: {
      objective: testCase.prompt,
      requiredEvidence: ["browser_observation"],
    },
    evidence: [],
    evaluationEvidence: [
      {
        id: "text-only-browser-claim",
        kind: "screenshot",
        title: "Browser observation reported by agent text",
        trustLevel: "agent_reported",
        source: "browser:agent-reported-text",
        verifiable: false,
        outcome: "passed",
        metadata: { evidenceRequired: ["browser_observation"] },
        createdAt: context.createdAt,
      },
    ],
    turns: [],
  });
  const failedBrowser = verifyGoalCompletion({
    goal: { objective: testCase.prompt },
    contract: {
      objective: testCase.prompt,
      requiredEvidence: ["browser_observation"],
    },
    evidence: [],
    evaluationEvidence: [
      evidenceRefToEvaluationEvidence(
        browserResultToEvidenceRef(
          skillEvalBrowserResult({
            status: "failed",
            passed: false,
            error: "selector not found",
            completedAt: context.createdAt + 1,
          }),
          { id: "failed-browser-evidence", createdAt: context.createdAt + 1 }
        )
      ),
    ],
    turns: [],
  });
  const passedBrowser = verifyGoalCompletion({
    goal: { objective: testCase.prompt },
    contract: {
      objective: testCase.prompt,
      requiredEvidence: ["browser_observation"],
    },
    evidence: [],
    evaluationEvidence: [
      evidenceRefToEvaluationEvidence(
        browserResultToEvidenceRef(
          skillEvalBrowserResult({
            status: "passed",
            passed: true,
            completedAt: context.createdAt + 2,
          }),
          { id: "passed-browser-evidence", createdAt: context.createdAt + 2 }
        )
      ),
    ],
    turns: [],
  });
  if (
    record.closureVerdict === "ready_to_finalize" &&
    record.verificationDecision === "accept" &&
    browserEvidence &&
    textOnly.decision === "reject" &&
    textOnly.missingEvidence.some((item) =>
      item.includes("browser_observation") && item.includes("host_observed")
    ) &&
    failedBrowser.decision === "reject" &&
    passedBrowser.decision === "accept"
  ) {
    return passResult(testCase, "Browser observation is satisfied by host-observed evidence.", dogfoodMetadata(record, {
      browserEvidence: [browserEvidence.id],
    }));
  }
  return failResult(testCase, summarizeDogfoodFailure(record));
}

function runSubagentWriteBoundaryCase(
  testCase: SkillEvalCase
): SkillEvalCaseResult {
  const allowed = findWriteBoundaryViolation({
    toolName: "apply_patch",
    input: {
      patch: [
        "*** Begin Patch",
        "*** Update File: app/components/Safe.tsx",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    },
    cwd: "/repo",
    writePaths: ["app/components"],
  });
  const outside = findWriteBoundaryViolation({
    toolName: "edit",
    input: { path: "app/api/route.ts" },
    cwd: "/repo",
    writePaths: ["app/components"],
  });
  const noBoundary = findWriteBoundaryViolation({
    toolName: "edit",
    input: { path: "app/components/Safe.tsx" },
    cwd: "/repo",
  });

  if (
    allowed === null &&
    outside?.reason === "write target is outside declared writePaths" &&
    noBoundary?.reason.includes("no writePaths boundary")
  ) {
    return passResult(testCase, "Subagent write tools are constrained by declared writePaths.", {
      testsRun: ["findWriteBoundaryViolation"],
      openActionCount: 2,
    });
  }
  return failResult(testCase, "Subagent write boundary did not block outside or undeclared writes.");
}

async function runWorkflowWorktreeMergeApprovalCase(
  testCase: SkillEvalCase
): Promise<SkillEvalCaseResult> {
  const storeRoot = mkdtempSync(
    path.join(os.tmpdir(), "shaula-skill-eval-workflow-")
  );
  __setWorkflowStoreRootForTest(storeRoot);
  __clearWorkflowMemoryForTest();
  const calls: string[] = [];
  try {
    const result = await runWorkflowScript(
      {
        parentAgentId: "skill-eval-workflow",
        approveCapability: async () => ({ decision: "allow" }),
        approveWorktreeMerge: async (request) => {
          calls.push(`approval:${request.diff.stat}`);
          return {
            decision: "deny",
            denyReason: "Review the diff manually first.",
          };
        },
        worktrees: {
          async create(input) {
            calls.push("create");
            return {
              id: `${input.workflowId.slice(0, 4)}-feature`,
              path: "/tmp/workflow-feature",
              branchName: "shaula-agent-workflow/test/feature",
              baseRef: "HEAD",
              createdAt: Date.now(),
            };
          },
          async diff(worktree) {
            calls.push(`diff:${worktree.id}`);
            return {
              worktreeId: worktree.id,
              path: worktree.path,
              branchName: worktree.branchName,
              baseRef: worktree.baseRef,
              diff: "diff --git a/a.txt b/a.txt\n",
              stat: " a.txt | 1 +",
              createdAt: Date.now(),
            };
          },
          async merge(worktree) {
            calls.push(`merge:${worktree.id}`);
            return {
              worktreeId: worktree.id,
              path: worktree.path,
              branchName: worktree.branchName,
              mergedAt: Date.now(),
              applied: true,
            };
          },
        },
        runSubagents: async () => ({ batchId: "unused", results: [] }),
      },
      {
        objective: "Reject isolated workflow worktree changes.",
        rationale: "Verify merge-specific approval blocks applying a denied diff.",
        capabilities: ["spawn_agent", "read_files", "write_files", "worktree"],
        script: `
          const wt = await workflow.createWorktree({ name: "feature" });
          await workflow.mergeWorktree(wt);
        `,
        timeoutMs: 10_000,
      }
    );
    const hasDiffArtifact = result.artifacts.some((artifact) =>
      artifact.name.startsWith("worktree-diff:")
    );
    if (
      result.status === "failed" &&
      result.error === "Review the diff manually first." &&
      calls.some((item) => item === "approval: a.txt | 1 +") &&
      !calls.some((item) => item.startsWith("merge:")) &&
      hasDiffArtifact
    ) {
      return passResult(testCase, "Workflow worktree merge is denied after diff preview without applying the patch.", {
        testsRun: ["runWorkflowScript"],
        openActionCount: 1,
      });
    }
    return failResult(
      testCase,
      `Unexpected worktree merge behavior: status=${result.status}; error=${result.error ?? "none"}; calls=${calls.join(",")}`
    );
  } finally {
    __setWorkflowStoreRootForTest(null);
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

async function runLocalCliShimCase(
  testCase: SkillEvalCase
): Promise<SkillEvalCaseResult> {
  const session = createLocalCodingAssistantSession(
    "skill-eval-local-cli",
    LOCAL_CODING_ASSISTANT_MODEL_ID
  );
  const args = buildLocalCodingAssistantCliArgs(
    "修复测试",
    LOCAL_CODING_ASSISTANT_MODEL_ID
  );
  const extracted = extractLocalCodingAssistantText({
    message: { content: [{ type: "text", text: "ok" }] },
  });
  const prompted = await session.prompt("ignored");

  if (
    session.supportsThinking() === false &&
    session.getAllTools().length === 0 &&
    prompted === undefined &&
    args.includes("--output-format") &&
    args.at(-1)?.includes("Shaula operating rules:") &&
    extracted === "ok" &&
    LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE.kind === "external_text_runner" &&
    LOCAL_CODING_ASSISTANT_RUNTIME_PROFILE.structuredTools === false
  ) {
    return passResult(testCase, "Local coding assistant stays labeled as an external text-only runner.", {
      testsRun: ["createLocalCodingAssistantSession", "buildLocalCodingAssistantCliArgs"],
    });
  }
  return failResult(testCase, "Local CLI shim exposed SDK-like behavior or lost its prompt wrapper.");
}
