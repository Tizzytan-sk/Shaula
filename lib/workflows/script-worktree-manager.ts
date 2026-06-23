import "server-only";
import type {
  RunWorkflowScriptDeps,
  WorkflowArtifact,
  WorkflowCreateWorktreeInput,
  WorkflowManifest,
  WorkflowWorktree,
  WorkflowWorktreeDiff,
  WorkflowWorktreeMergeResult,
} from "./types";
import { putWorkflowArtifact } from "./server-store";
import { requireCapability } from "./script-capabilities";

export interface WorkflowScriptWorktreeRuntime {
  createWorktree(input?: WorkflowCreateWorktreeInput): Promise<WorkflowWorktree>;
  diffWorktree(worktree: WorkflowWorktree): Promise<WorkflowWorktreeDiff>;
  mergeWorktree(worktree: WorkflowWorktree): Promise<WorkflowWorktreeMergeResult>;
  removeWorktree(worktree: WorkflowWorktree): Promise<void>;
}

interface CreateWorkflowScriptWorktreeRuntimeArgs {
  deps: Pick<RunWorkflowScriptDeps, "worktrees" | "approveWorktreeMerge" | "onEvent">;
  manifest: WorkflowManifest;
  workflowId: string;
  objective: string;
  rationale: string;
  signal: AbortSignal;
  artifacts: Map<string, WorkflowArtifact>;
}

function now() {
  return Date.now();
}

function cleanText(raw: string | undefined, limit: number): string {
  return (raw?.trim() ?? "").slice(0, limit);
}

function serializeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createWorkflowScriptWorktreeRuntime({
  deps,
  manifest,
  workflowId,
  objective,
  rationale,
  signal,
  artifacts,
}: CreateWorkflowScriptWorktreeRuntimeArgs): WorkflowScriptWorktreeRuntime {
  const createdWorktrees = new Map<string, WorkflowWorktree>();

  function putArtifact(artifact: WorkflowArtifact) {
    artifacts.set(artifact.name, artifact);
    putWorkflowArtifact(workflowId, artifact);
    deps.onEvent?.({ type: "workflow_artifact", workflowId, artifact });
  }

  function ensureKnownWorktree(worktree: WorkflowWorktree, errorMessage: string) {
    const known = createdWorktrees.get(worktree.id);
    if (!known || known.path !== worktree.path) {
      throw new Error(errorMessage);
    }
    return known;
  }

  function putDiffArtifact(diff: WorkflowWorktreeDiff) {
    putArtifact({
      name: `worktree-diff:${diff.worktreeId}`,
      value: {
        worktreeId: diff.worktreeId,
        path: diff.path,
        branchName: diff.branchName,
        baseRef: diff.baseRef,
        stat: diff.stat,
        diff: diff.diff,
      },
      createdAt: diff.createdAt,
    });
  }

  return {
    async createWorktree(worktreeInput?: WorkflowCreateWorktreeInput) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "worktree");
      if (!deps.worktrees) {
        throw new Error("workflow.createWorktree requires a worktree runtime");
      }
      const worktree = await deps.worktrees.create({
        workflowId,
        name: cleanText(worktreeInput?.name, 80) || undefined,
        baseRef: cleanText(worktreeInput?.baseRef, 160) || undefined,
      });
      createdWorktrees.set(worktree.id, worktree);
      putArtifact({
        name: `worktree:${worktree.id}`,
        value: {
          id: worktree.id,
          path: worktree.path,
          branchName: worktree.branchName,
          baseRef: worktree.baseRef,
        },
        createdAt: worktree.createdAt,
      });
      return worktree;
    },

    async diffWorktree(worktree: WorkflowWorktree) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "worktree");
      if (!deps.worktrees?.diff) {
        throw new Error("workflow.diffWorktree requires a diff-capable worktree runtime");
      }
      const known = ensureKnownWorktree(
        worktree,
        "workflow.diffWorktree can only diff worktrees created by this workflow"
      );
      const diff = await deps.worktrees.diff(known);
      putDiffArtifact(diff);
      return diff;
    },

    async mergeWorktree(worktree: WorkflowWorktree) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "worktree");
      requireCapability(manifest, "write_files");
      if (!deps.worktrees?.merge) {
        throw new Error("workflow.mergeWorktree requires a merge-capable worktree runtime");
      }
      if (!deps.worktrees.diff) {
        throw new Error("workflow.mergeWorktree requires a diff-capable worktree runtime for merge approval");
      }
      const known = ensureKnownWorktree(
        worktree,
        "workflow.mergeWorktree can only merge worktrees created by this workflow"
      );
      const diff = await deps.worktrees.diff(known);
      putDiffArtifact(diff);
      if (diff.diff.trim()) {
        if (!deps.approveWorktreeMerge) {
          throw new Error("workflow.mergeWorktree requires merge approval before applying a diff");
        }
        const resp = await deps.approveWorktreeMerge({
          workflowId,
          manifest,
          objective,
          rationale,
          worktree: known,
          diff,
        });
        if (resp.decision !== "allow") {
          throw new Error(resp.denyReason ?? "Workflow worktree merge denied");
        }
      }
      try {
        const merge = await deps.worktrees.merge(known);
        putArtifact({
          name: `worktree-merge:${known.id}`,
          value: merge,
          createdAt: merge.mergedAt,
        });
        return merge;
      } catch (error) {
        const failedAt = now();
        putArtifact({
          name: `worktree-merge-failed:${known.id}`,
          value: {
            worktreeId: known.id,
            path: known.path,
            branchName: known.branchName,
            baseRef: known.baseRef,
            failedAt,
            error: serializeError(error),
            stat: diff.stat,
            diffPreview: diff.diff.slice(0, 12000),
            truncated: diff.diff.length > 12000,
          },
          createdAt: failedAt,
        });
        throw error;
      }
    },

    async removeWorktree(worktree: WorkflowWorktree) {
      if (signal.aborted) throw new Error("Workflow script aborted");
      requireCapability(manifest, "worktree");
      if (!deps.worktrees?.remove) {
        throw new Error("workflow.removeWorktree requires a removable worktree runtime");
      }
      const known = ensureKnownWorktree(
        worktree,
        "workflow.removeWorktree can only remove worktrees created by this workflow"
      );
      await deps.worktrees.remove(known);
      createdWorktrees.delete(known.id);
    },
  };
}
