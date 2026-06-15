import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetProgressStoreForTest,
  failOpenProgress,
  updateProgress,
} from "./server-store";

describe("progress server store", () => {
  beforeEach(() => {
    __resetProgressStoreForTest();
  });

  it("marks running and pending steps failed when aborted", () => {
    updateProgress("agent-1", {
      replaceSteps: true,
      steps: [
        { id: "done", title: "Done", status: "completed" },
        { id: "run", title: "Running", status: "running" },
        { id: "next", title: "Next", status: "pending" },
      ],
    });

    const progress = failOpenProgress("agent-1", "User stopped it.");

    expect(progress.steps.map((step) => [step.id, step.status])).toEqual([
      ["done", "completed"],
      ["run", "failed"],
      ["next", "failed"],
    ]);
    expect(progress.groups[0]?.endedAt).toEqual(expect.any(Number));
    expect(progress.steps[1]?.summary).toContain("User stopped it.");
    expect(progress.steps[2]?.completedAt).toEqual(expect.any(Number));
  });

  it("normalizes structured artifact evidence tags", () => {
    const progress = updateProgress("agent-1", {
      artifacts: [
        {
          id: "artifact-1",
          kind: "file",
          title: "Package metadata",
          href: "C:/repo/package.json",
          requiredEvidence: ["source_note", "", "analysis_artifact"],
          contractCriterionId: "contract-source",
          rubricCriterionId: "rubric-evidence",
        },
      ],
    });

    expect(progress.artifacts[0]).toMatchObject({
      id: "artifact-1",
      requiredEvidence: ["source_note", "analysis_artifact"],
      contractCriterionId: "contract-source",
      rubricCriterionId: "rubric-evidence",
    });
  });

  it("keeps only recent progress groups", () => {
    let progress = updateProgress("agent-1", {
      replaceSteps: true,
      steps: [{ id: "step-0", title: "Step 0", status: "running" }],
    });

    for (let i = 1; i < 55; i += 1) {
      progress = updateProgress("agent-1", {
        replaceSteps: true,
        steps: [{ id: `step-${i}`, title: `Step ${i}`, status: "running" }],
      });
    }

    expect(progress.groups).toHaveLength(50);
    expect(progress.groups[0]?.index).toBe(6);
    expect(progress.steps[0]?.id).toBe("step-54");
  });
});
