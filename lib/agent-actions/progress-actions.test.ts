import { describe, expect, it } from "vitest";
import {
  isProgressEvidencePostAction,
  parseProgressUpdate,
} from "./progress-actions";

describe("progress/evidence action helpers", () => {
  it("classifies progress and host evidence actions", () => {
    expect(isProgressEvidencePostAction("progress_update")).toBe(true);
    expect(
      isProgressEvidencePostAction("evidence_record_browser_observation")
    ).toBe(true);
    expect(isProgressEvidencePostAction("goal_update")).toBe(false);
    expect(isProgressEvidencePostAction("prompt")).toBe(false);
  });

  it("parses only structured progress arrays and boolean replace flags", () => {
    const parsed = parseProgressUpdate({
      steps: [{ title: "One", status: "running" }],
      artifacts: "not-array",
      replaceSteps: true,
      replaceArtifacts: "true",
    });

    expect(parsed.steps).toEqual([{ title: "One", status: "running" }]);
    expect(parsed.artifacts).toBeUndefined();
    expect(parsed.replaceSteps).toBe(true);
    expect(parsed.replaceArtifacts).toBe(false);
  });
});
