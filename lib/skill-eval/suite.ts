import type { SkillEvalCase } from "./types";

export interface SkillEvalSuite {
  id: string;
  title: string;
  version: string;
  description: string;
  cases: SkillEvalCase[];
}

export const SHAULA_SKILL_EVAL_SUITE_V1: SkillEvalSuite = {
  id: "shaula-skill-eval-suite-v1",
  title: "Shaula Skill Eval Suite v1",
  version: "1",
  description:
    "Benchmark-derived cases for the contract/evidence/rubric/action loop. This suite records execution metadata; it is not a separate skill-eval platform.",
  cases: [
    {
      id: "preflight-evidence-ledger",
      title: "Preflight: evidence ledger survives evaluation",
      kind: "positive",
      prompt:
        "Run a small goal that records evidence, rejects unsupported completion, then accepts once concrete evidence exists.",
      expectedBehavior:
        "The run records Evidence Ledger entries, creates evaluator actions for gaps, and only completes after evidence is present.",
      weight: 1,
    },
    {
      id: "task-a-typecheck-fallback",
      title: "Task A: VerificationPlan typecheck fallback",
      kind: "edge",
      prompt:
        "In a TypeScript project without a package typecheck script, infer a required typecheck command.",
      expectedBehavior:
        "The inferred plan uses npx tsc --noEmit --pretty false, keeps it allowlisted, and records deterministic verification evidence.",
      weight: 1.2,
    },
    {
      id: "task-b-readonly-verifier-dirty-json",
      title: "Task B: read-only verifier dirty JSON",
      kind: "edge",
      prompt:
        "Parse verifier output from strict JSON, fenced JSON, and one wrapped JSON object; reject invalid or multi-object output.",
      expectedBehavior:
        "Only a single valid structured verifier result can produce accept/reject; ambiguous output becomes needs_review.",
      weight: 1.2,
    },
    {
      id: "task-c-route-decision-visibility",
      title: "Task C: route decision visibility",
      kind: "positive",
      prompt:
        "Start a goal and verify the advisory route decision is exposed through status and timeline surfaces.",
      expectedBehavior:
        "goal_status and goal_timeline expose the latest route decision without turning the advisory router into a hard gate.",
      weight: 1,
    },
    {
      id: "p3-router-shadow-visibility",
      title: "P3: router shadow visibility",
      kind: "positive",
      prompt:
        "Recommend subagent/workflow execution mode for a complex prompt without automatically executing that route.",
      expectedBehavior:
        "The route is visible as advisory-only with confidence, reasons, context boundary, and permission profile.",
      weight: 1.2,
    },
    {
      id: "p3-whiteboard-fake-evidence-rejected",
      title: "P3: whiteboard fake evidence rejected",
      kind: "negative",
      prompt:
        "Record a team whiteboard note claiming tests passed and browser is visible, then attempt to use it as required evidence.",
      expectedBehavior:
        "The verifier rejects whiteboard/progress self-reports for deterministic test and host-observed browser evidence.",
      weight: 1.3,
    },
    {
      id: "team-readonly-conflict-synthesis",
      title: "Team: readonly conflict synthesis",
      kind: "edge",
      prompt:
        "Run two read-only team tasks over the same question where one says yes and one says no.",
      expectedBehavior:
        "Team verification produces warning/partial convergence instead of silently treating conflicting child results as green.",
      weight: 1.2,
    },
    {
      id: "team-domain-aware-synthesis",
      title: "Team: domain-aware synthesis summary",
      kind: "positive",
      prompt:
        "Summarize Team task results with linked evidence, domain labels, warnings, conflicts, and next actions.",
      expectedBehavior:
        "Team synthesis exposes domain-aware conclusions and warning/conflict items without treating synthesis as trusted evidence.",
      weight: 1.2,
    },
    {
      id: "team-llm-assisted-synthesis-guardrail",
      title: "Team: LLM-assisted synthesis guardrail",
      kind: "negative",
      prompt:
        "Apply a candidate LLM synthesis over Team task results that tries to upgrade warning status and invent evidence.",
      expectedBehavior:
        "The LLM-assisted synthesis layer keeps deterministic status/evidence unchanged and rejects unsupported or incomplete candidate summaries.",
      weight: 1.2,
    },
    {
      id: "team-llm-assisted-synthesis-cache",
      title: "Team: provider-backed synthesis assist cache",
      kind: "positive",
      prompt:
        "Run explicit provider-backed Team synthesis assistance and read the cached result without triggering another model call.",
      expectedBehavior:
        "The explicit action calls the model once, sanitizes the candidate summary, caches it by deterministic synthesis fingerprint, and subsequent calls reuse the cache.",
      weight: 1.2,
    },
    {
      id: "workflow-team-template-readonly",
      title: "Workflow Team: built-in read-only review template",
      kind: "positive",
      prompt:
        "Run the built-in workflow-backed Team read-only review template with bounded reviewers and conflict synthesis.",
      expectedBehavior:
        "The template runs through the workflow runtime with spawn_agent/read_files only, emits a team-readonly-review artifact, and reports warning when child reviewers conflict.",
      weight: 1.2,
    },
    {
      id: "workflow-team-worktree-implementation",
      title: "Workflow Team: worktree-backed implementation template",
      kind: "positive",
      prompt:
        "Run the built-in implementation Team template in an isolated worktree and merge only after diff preview approval.",
      expectedBehavior:
        "The implementation worker runs with cwd set to the workflow worktree, diff evidence is recorded, and merge occurs only through workflow merge approval.",
      weight: 1.3,
    },
    {
      id: "workflow-team-capability-deny",
      title: "Workflow Team: denied capability creates no side effect",
      kind: "negative",
      prompt:
        "Declare a high-risk workflow capability, deny it at the approval gate, then ensure the workflow cannot continue or create artifacts.",
      expectedBehavior:
        "Denied write/shell/browser/network/worktree/MCP capability stops the workflow before side effects and cannot complete the goal.",
      weight: 1.2,
    },
    {
      id: "provider-team-tool-isolation",
      title: "Provider dogfood: Team orchestration tools stay disabled",
      kind: "negative",
      prompt:
        "Run provider dogfood policy with subagent and workflow orchestration tools exposed, including workflow templates.",
      expectedBehavior:
        "Provider dogfood disables subagent/workflow Team orchestration tools, including run_workflow_template, while preserving ordinary goal/progress tools.",
      weight: 1.2,
    },
    {
      id: "p2-coding-diff-success",
      title: "P2: coding diff success",
      kind: "positive",
      prompt:
        "Complete a scoped coding change only after diff and deterministic test evidence exist.",
      expectedBehavior:
        "The local dogfood closure reaches ready_to_finalize with diff and test_result evidence.",
      weight: 1.4,
    },
    {
      id: "p2-premature-completion-rejection",
      title: "P2: premature completion rejection",
      kind: "negative",
      prompt:
        "Attempt to complete before required deterministic evidence is present.",
      expectedBehavior:
        "The verifier rejects the attempt and emits an open action instead of accepting completion.",
      weight: 1.4,
    },
    {
      id: "p2-failed-required-check",
      title: "P2: failed required check",
      kind: "negative",
      prompt:
        "Present failed required test evidence and attempt to complete the goal.",
      expectedBehavior:
        "The failed deterministic check blocks completion until a newer passing check exists.",
      weight: 1.4,
    },
    {
      id: "p2-needs-user-pause",
      title: "P2: needs-user pause",
      kind: "edge",
      prompt:
        "Reach a point where a user decision is required and autonomous continuation should pause.",
      expectedBehavior:
        "The closure verdict is needs_user and auto-continuation does not proceed.",
      weight: 1.2,
    },
    {
      id: "p2-blocked-pause",
      title: "P2: blocked pause",
      kind: "edge",
      prompt:
        "Reach an external dependency blocker where repeated autonomous retries would waste turns.",
      expectedBehavior:
        "The closure verdict is blocked and the required unblock boundary is visible.",
      weight: 1.2,
    },
    {
      id: "p2-browser-observation",
      title: "P2: browser observation",
      kind: "positive",
      prompt:
        "Complete a UI-oriented goal only when host-observed browser evidence exists.",
      expectedBehavior:
        "Host-observed browser evidence satisfies browser_observation without accepting text-only claims.",
      weight: 1.3,
    },
    {
      id: "p2-subagent-write-boundary",
      title: "P2: subagent write boundary",
      kind: "negative",
      prompt:
        "Validate that subagent write-capable tools cannot edit outside declared writePaths.",
      expectedBehavior:
        "Writes inside the declared boundary are allowed and outside/no-boundary writes are rejected.",
      weight: 1.2,
    },
    {
      id: "p2-workflow-worktree-merge-approval",
      title: "P2: workflow worktree merge approval",
      kind: "negative",
      prompt:
        "Create a workflow worktree diff and deny merge approval.",
      expectedBehavior:
        "The merge is blocked after diff preview, no patch is applied, and a diff artifact is recorded.",
      weight: 1.2,
    },
    {
      id: "p2-local-cli-shim",
      title: "P2: local CLI shim behavior",
      kind: "edge",
      prompt:
        "Verify local-coding-assistant is exposed as an external text-only runner, not a full SDK runtime.",
      expectedBehavior:
        "The local CLI session has no structured tools/thinking support and preserves the Shaula prompt wrapper.",
      weight: 1.1,
    },
  ],
};
