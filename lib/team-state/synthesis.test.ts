import { describe, expect, it } from "vitest";
import type { EvidenceRef } from "@/lib/evidence/types";
import type { TeamTask } from "./types";
import {
  applyTeamSynthesisAssistance,
  buildTeamSynthesisAssistancePrompt,
  synthesizeTeamTasks,
} from "./synthesis";
import type { TeamTaskVerificationSummary } from "./verifier";

function task(patch: Partial<TeamTask>): TeamTask {
  return {
    id: "task-1",
    agentId: "agent-1",
    sessionId: "session-1",
    title: "Review auth boundary",
    status: "completed",
    ownerType: "subagent",
    ownerId: "child-1",
    dependsOn: [],
    contextPacket: {
      objective: "Review auth changes",
      taskTitle: "Review auth boundary",
      taskBoundary: "Read-only auth route review.",
      includeContext: [],
      excludeContext: [],
      relevantPaths: ["app/api/auth/route.ts"],
      writePaths: [],
      requiredEvidence: ["subagent_result"],
      outputContract: {
        format: "review",
        mustInclude: ["findings"],
        mustNotDo: ["edit files"],
      },
    },
    writePaths: [],
    requiredEvidence: ["subagent_result"],
    evidenceIds: ["evidence-1"],
    artifactRefs: [],
    source: { type: "subagent", id: "task-1", parentId: "batch-1" },
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function evidence(patch: Partial<EvidenceRef>): EvidenceRef {
  return {
    id: "evidence-1",
    kind: "subagent_result",
    title: "Auth reviewer result",
    agentId: "agent-1",
    summary: "Auth route boundary is mostly safe.",
    source: { type: "subagent", id: "child-1" },
    createdAt: 2,
    ...patch,
  };
}

function verification(
  patch: Partial<TeamTaskVerificationSummary>
): TeamTaskVerificationSummary {
  return {
    status: "passed",
    verifiedAt: 3,
    summary: "6 passed, 0 warnings, 0 failed.",
    passed: 6,
    warnings: 0,
    failed: 0,
    missingEvidence: [],
    matchedEvidenceIds: ["evidence-1"],
    checks: [],
    ...patch,
  };
}

describe("synthesizeTeamTasks", () => {
  it("extracts domain-aware conclusions from linked task evidence", () => {
    const result = synthesizeTeamTasks({
      tasks: [task({})],
      evidence: [evidence({})],
      verification: verification({}),
      generatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "ready",
      generatedAt: 10,
      domains: ["security/auth"],
      evidenceIds: ["evidence-1"],
      taskIds: ["task-1"],
    });
    expect(result?.items).toEqual([
      expect.objectContaining({
        kind: "conclusion",
        severity: "info",
        title: "Review auth boundary",
        domain: "security/auth",
        evidenceIds: ["evidence-1"],
        detail: "Auth route boundary is mostly safe.",
      }),
    ]);
  });

  it("keeps warning tasks and verifier conflicts visible in synthesis", () => {
    const result = synthesizeTeamTasks({
      tasks: [
        task({
          id: "task-warning",
          status: "warning",
          blockedBy: "Needs parent synthesis before completion.",
          evidenceIds: ["evidence-warning"],
        }),
      ],
      evidence: [
        evidence({
          id: "evidence-warning",
          summary: "No, the policy cannot be allowed yet.",
        }),
      ],
      verification: verification({
        status: "warning",
        summary: "5 passed, 1 warning, 0 failed.",
        warnings: 1,
        checks: [
          {
            id: "cross-task-conflicts",
            status: "warning",
            message: "Conflicting yes/no results across task-a, task-b.",
          },
        ],
      }),
      generatedAt: 11,
    });

    expect(result?.status).toBe("warning");
    expect(result?.headline).toContain("warning");
    expect(result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task:task-warning",
          kind: "risk",
          severity: "warning",
          detail: "Needs parent synthesis before completion.",
        }),
        expect.objectContaining({
          id: "check:cross-task-conflicts",
          kind: "conflict",
          severity: "warning",
        }),
      ])
    );
  });

  it("accepts bounded LLM assistance without changing synthesis status or evidence", () => {
    const base = synthesizeTeamTasks({
      tasks: [
        task({
          id: "task-warning",
          status: "warning",
          blockedBy: "Needs parent synthesis before completion.",
          evidenceIds: ["evidence-warning"],
        }),
      ],
      evidence: [
        evidence({
          id: "evidence-warning",
          summary: "Auth policy remains risky until the parent resolves it.",
        }),
      ],
      verification: verification({
        status: "warning",
        warnings: 1,
        checks: [
          {
            id: "cross-task-conflicts",
            status: "warning",
            message: "Conflicting yes/no results across task-a, task-b.",
          },
        ],
      }),
      generatedAt: 12,
    });

    expect(base).not.toBeNull();
    const assisted = applyTeamSynthesisAssistance(
      base!,
      {
        status: "warning",
        headline: "Auth review still needs parent resolution.",
        summary:
          "The Team result is useful but still warning-level because the auth risk and conflict item remain open.",
        itemIds: ["task:task-warning", "check:cross-task-conflicts"],
        taskIds: ["task-warning"],
        evidenceIds: ["evidence-warning"],
      },
      13
    );

    expect(assisted.status).toBe("warning");
    expect(assisted.evidenceIds).toEqual(["evidence-warning"]);
    expect(assisted.assistance).toMatchObject({
      status: "accepted",
      source: "llm_assisted",
      generatedAt: 13,
      itemIds: ["task:task-warning", "check:cross-task-conflicts"],
      taskIds: ["task-warning"],
      evidenceIds: ["evidence-warning"],
      warnings: [],
    });
  });

  it("rejects LLM assistance that upgrades status, invents evidence, or omits risk items", () => {
    const base = synthesizeTeamTasks({
      tasks: [
        task({
          id: "task-warning",
          status: "warning",
          evidenceIds: ["evidence-warning"],
        }),
      ],
      evidence: [evidence({ id: "evidence-warning" })],
      verification: verification({
        status: "warning",
        warnings: 1,
        checks: [
          {
            id: "unsupported-evidence",
            status: "warning",
            message: "Missing deterministic evidence.",
          },
        ],
      }),
      generatedAt: 14,
    });

    const assisted = applyTeamSynthesisAssistance(base!, {
      status: "ready",
      headline: "Everything is done.",
      summary: "All evidence passed.",
      itemIds: ["task:task-warning"],
      taskIds: ["task-warning", "unknown-task"],
      evidenceIds: ["evidence-warning", "invented-test-evidence"],
    });

    expect(assisted.status).toBe("warning");
    expect(assisted.assistance?.status).toBe("rejected");
    expect(assisted.assistance?.evidenceIds).toEqual(["evidence-warning"]);
    expect(assisted.assistance?.taskIds).toEqual(["task-warning"]);
    expect(assisted.assistance?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Ignored draft status"),
        expect.stringContaining("Rejected unknown task ids"),
        expect.stringContaining("Rejected unknown evidence ids"),
        expect.stringContaining("omitted required risk/conflict/gap item ids"),
      ])
    );
  });

  it("builds a bounded prompt for LLM-assisted synthesis", () => {
    const base = synthesizeTeamTasks({
      tasks: [task({})],
      evidence: [evidence({})],
      verification: verification({}),
      generatedAt: 15,
    });

    const prompt = buildTeamSynthesisAssistancePrompt({
      synthesis: base!,
      tasks: [task({})],
      evidence: [evidence({})],
      verification: verification({}),
    });

    expect(prompt).toContain("must not change verifier status");
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("allowedEvidenceIds");
    expect(prompt).toContain("evidence-1");
    expect(prompt).toContain("Do not treat synthesis text as test_result");
  });
});
