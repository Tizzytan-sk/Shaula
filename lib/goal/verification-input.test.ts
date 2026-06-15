import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetGoalStoreForTest,
  __setGoalStoreRootForTest,
  addGoalEvidence,
  setGoal,
} from "./file-store";
import { collectGoalVerificationInput } from "./verification-input";

describe("goal verification input collector", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "shaula-goal-verification-"));
    __setGoalStoreRootForTest(root);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetGoalStoreForTest();
    __setGoalStoreRootForTest(null);
    rmSync(root, { recursive: true, force: true });
  });

  it("filters stale stored goal evidence from before the active goal", () => {
    vi.setSystemTime(2_000);
    const currentGoal = setGoal("agent-1", "New goal");
    addGoalEvidence("agent-1", {
      id: "old-evidence",
      kind: "test",
      title: "Old test result",
      createdAt: 1_000,
    });
    addGoalEvidence("agent-1", {
      id: "fresh-evidence",
      kind: "test",
      title: "Fresh test result",
      createdAt: 2_001,
    });

    const collected = collectGoalVerificationInput("agent-1", currentGoal);

    expect(collected?.goalEvidence.map((item) => item.id)).toEqual([
      "fresh-evidence",
    ]);
    expect(collected?.evaluationEvidence.map((item) => item.id)).toEqual([
      "fresh-evidence",
    ]);
  });
});
