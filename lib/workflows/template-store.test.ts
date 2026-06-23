import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetWorkflowTemplateStoreForTest,
  __setWorkflowTemplateStoreRootForTest,
  deleteWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplates,
  putWorkflowTemplate,
} from "./template-store";
import {
  TEAM_READONLY_REVIEW_TEMPLATE_ID,
  TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID,
} from "./builtin-templates";

describe("workflow template store", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "workflow-template-test-"));
    __setWorkflowTemplateStoreRootForTest(root);
  });

  afterEach(async () => {
    __resetWorkflowTemplateStoreForTest();
    __setWorkflowTemplateStoreRootForTest(null);
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("stores, lists, updates, and deletes workflow templates", () => {
    const first = putWorkflowTemplate({
      id: "triage",
      name: "Bug triage",
      description: "Classify and route bugs.",
      version: "1.0.0",
      script: "return workflow.params;",
      paramsSchema: {
        type: "object",
        properties: { queue: { type: "string" } },
      },
      defaultParams: { queue: "support" },
      capabilities: ["spawn_agent", "read_files"],
      tags: ["triage"],
    });

    expect(first.id).toBe("triage");
    expect(getWorkflowTemplate("triage")).toMatchObject({
      name: "Bug triage",
      defaultParams: { queue: "support" },
    });
    expect(listWorkflowTemplates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "triage", tags: ["triage"] }),
      ])
    );

    const updated = putWorkflowTemplate({
      id: "triage",
      name: "Bug triage v2",
      version: "1.1.0",
      script: "return workflow.template;",
    });

    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(getWorkflowTemplate("triage")).toMatchObject({
      name: "Bug triage v2",
      version: "1.1.0",
    });
    expect(deleteWorkflowTemplate("triage")).toBe(true);
    expect(getWorkflowTemplate("triage")).toBeUndefined();
  });

  it("exposes built-in workflow templates and lets user templates override them", () => {
    expect(getWorkflowTemplate(TEAM_READONLY_REVIEW_TEMPLATE_ID)).toMatchObject({
      id: TEAM_READONLY_REVIEW_TEMPLATE_ID,
      capabilities: ["spawn_agent", "read_files"],
      tags: expect.arrayContaining(["team", "readonly"]),
    });
    expect(getWorkflowTemplate(TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID)).toMatchObject({
      id: TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID,
      capabilities: ["spawn_agent", "read_files", "write_files", "worktree"],
      tags: expect.arrayContaining(["team", "worktree"]),
    });
    expect(listWorkflowTemplates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: TEAM_READONLY_REVIEW_TEMPLATE_ID }),
      ])
    );

    putWorkflowTemplate({
      id: TEAM_READONLY_REVIEW_TEMPLATE_ID,
      name: "Custom read-only team review",
      version: "9.9.9",
      script: "return workflow.params;",
    });

    expect(getWorkflowTemplate(TEAM_READONLY_REVIEW_TEMPLATE_ID)).toMatchObject({
      name: "Custom read-only team review",
      version: "9.9.9",
    });
    expect(
      listWorkflowTemplates().filter(
        (template) => template.id === TEAM_READONLY_REVIEW_TEMPLATE_ID
      )
    ).toHaveLength(1);
  });

  it("rejects unsafe template ids", () => {
    expect(() =>
      putWorkflowTemplate({
        id: "../bad",
        script: "return null;",
      })
    ).toThrow("invalid workflow template id");
  });

  it("loads documented example templates", async () => {
    const examplesDir = path.join(
      process.cwd(),
      "docs",
      "examples",
      "workflow-templates"
    );
    const files = (await readdir(examplesDir)).filter((file) =>
      file.endsWith(".json")
    );

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(
        await readFile(path.join(examplesDir, file), "utf8")
      ) as {
        id: string;
        script: string;
      };
      const template = putWorkflowTemplate(raw);
      expect(template.id).toBeTruthy();
      expect(template.script).toContain("workflow.");
    }
    expect(listWorkflowTemplates().length).toBeGreaterThanOrEqual(files.length);
  });
});
