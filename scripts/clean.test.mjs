import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertInsideRoot,
  assertShaulaPackage,
  cleanProject,
  resolveCleanTargets,
} from "./clean.mjs";

describe("clean script guardrails", () => {
  it("refuses to clean a non-Shaula package root", () => {
    expect(() => assertShaulaPackage({ name: "other-project" }, "C:/repo")).toThrow(
      /unexpected project root/
    );
  });

  it("resolves only the fixed Shaula clean targets under the root", () => {
    const root = resolve("repo", "Shaula");

    expect(resolveCleanTargets(root)).toEqual([
      resolve(root, "dist"),
      resolve(root, ".next"),
    ]);
  });

  it("rejects clean targets outside the project root", () => {
    const root = resolve("repo", "Shaula");

    expect(() => assertInsideRoot(root, resolve(root, ".."))).toThrow(
      /outside workspace/
    );
  });

  it("checks package identity before deleting targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "shaula-clean-test-"));
    const deleted = [];

    await expect(
      cleanProject(root, {
        readFile: async () => JSON.stringify({ name: "wrong-project" }),
        rm: async (target) => {
          deleted.push(target);
        },
      })
    ).rejects.toThrow(/unexpected project root/);
    expect(deleted).toEqual([]);
  });
});
