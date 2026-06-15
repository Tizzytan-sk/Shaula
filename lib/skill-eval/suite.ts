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
  ],
};
