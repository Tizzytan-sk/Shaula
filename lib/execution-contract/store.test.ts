import { existsSync, mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExecutionContract } from "./build";
import {
  __resetExecutionContractStoreForTest,
  __setExecutionContractStoreRootForTest,
  getExecutionContract,
  listExecutionContracts,
  putExecutionContract,
} from "./store";

describe("execution contract store", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "shaula-contracts-"));
    __setExecutionContractStoreRootForTest(root);
  });

  afterEach(() => {
    __setExecutionContractStoreRootForTest(null);
    rmSync(root, { recursive: true, force: true });
  });

  it("persists and recovers contracts by id", () => {
    const contract = putExecutionContract(
      buildExecutionContract({
        agentId: "agent-1",
        objective: "Do the work",
        mainArtifact: "docs/plan.md",
        createdAt: 1,
      })
    );

    expect(
      existsSync(
        path.join(root, "execution-contracts", "agent-1", `${contract.id}.json`)
      )
    ).toBe(true);

    __resetExecutionContractStoreForTest();

    expect(getExecutionContract(contract.id)).toMatchObject({
      objective: "Do the work",
      mainArtifact: {
        kind: "file",
        label: "docs/plan.md",
        source: "explicit",
      },
    });
    expect(listExecutionContracts({ agentId: "agent-1" })).toHaveLength(1);
  });

  it("rejects unsafe ids", () => {
    const contract = buildExecutionContract({
      agentId: "agent-1",
      objective: "Do the work",
      createdAt: 1,
    });
    expect(() =>
      putExecutionContract({ ...contract, id: "../escape" })
    ).toThrow();
  });
});
