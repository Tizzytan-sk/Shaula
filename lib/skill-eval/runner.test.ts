import { describe, expect, it } from "vitest";
import {
  runShaulaSkillEvalSuiteV1,
  runSkillEvalSuite,
  shaulaSkillEvalSuiteV1Executors,
} from "./runner";
import { SHAULA_SKILL_EVAL_SUITE_V1 } from "./suite";

describe("skill eval suite runner", () => {
  it("executes the Shaula skill eval suite v1 through deterministic case runners", async () => {
    const run = await runShaulaSkillEvalSuiteV1({
      id: "shaula-suite-run-1",
      agentId: "agent-1",
      skillName: "shaula-runtime",
      skillPath: "C:/repo/Shaula",
      versionDiff: {
        summary: "Run executable suite v1 against local deterministic checks.",
      },
      createdAt: 100,
    });

    expect(run.results.map((item) => [item.caseId, item.status])).toEqual([
      ["preflight-evidence-ledger", "pass"],
      ["task-a-typecheck-fallback", "pass"],
      ["task-b-readonly-verifier-dirty-json", "pass"],
      ["task-c-route-decision-visibility", "pass"],
      ["p3-router-shadow-visibility", "pass"],
      ["p3-whiteboard-fake-evidence-rejected", "pass"],
      ["team-readonly-conflict-synthesis", "pass"],
      ["team-domain-aware-synthesis", "pass"],
      ["team-llm-assisted-synthesis-guardrail", "pass"],
      ["team-llm-assisted-synthesis-cache", "pass"],
      ["workflow-team-template-readonly", "pass"],
      ["workflow-team-worktree-implementation", "pass"],
      ["workflow-team-capability-deny", "pass"],
      ["provider-team-tool-isolation", "pass"],
      ["p2-coding-diff-success", "pass"],
      ["p2-premature-completion-rejection", "pass"],
      ["p2-failed-required-check", "pass"],
      ["p2-needs-user-pause", "pass"],
      ["p2-blocked-pause", "pass"],
      ["p2-browser-observation", "pass"],
      ["p2-subagent-write-boundary", "pass"],
      ["p2-workflow-worktree-merge-approval", "pass"],
      ["p2-local-cli-shim", "pass"],
    ]);
    expect(run.weightedScore).toBe(1);
    expect(run.evaluation.status).toBe("passed");
    expect(run.metrics).toMatchObject({
      verifierRejectionCount: 7,
      openActionCount: 7,
      browserEvidence: ["browser-evidence"],
    });
  });

  it("fails cases that do not have an executable runner", async () => {
    const run = await runSkillEvalSuite({
      id: "missing-runner",
      agentId: "agent-1",
      skillName: "shaula-runtime",
      skillPath: "C:/repo/Shaula",
      versionDiff: { summary: "Missing executor regression." },
      suite: SHAULA_SKILL_EVAL_SUITE_V1,
      executors: {
        "task-a-typecheck-fallback": shaulaSkillEvalSuiteV1Executors()[
          "task-a-typecheck-fallback"
        ],
      },
      createdAt: 100,
    });

    expect(run.failCount).toBe(22);
    expect(
      run.results.find((item) => item.caseId === "preflight-evidence-ledger")
        ?.reason
    ).toContain("No executable runner");
    expect(run.evaluation.status).toBe("failed");
  });
});
