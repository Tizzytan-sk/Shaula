import "server-only";
import { randomUUID } from "node:crypto";
import type {
  RunWorkflowScriptDeps,
  RunWorkflowScriptInput,
  WorkflowArtifact,
  WorkflowCheckpoint,
  WorkflowScriptLog,
  WorkflowScriptResult,
  WorkflowRun,
  WorkflowTraceEvent,
} from "./types";
import {
  appendWorkflowTraceEvent,
  finishWorkflowRun,
  getWorkflowRun,
  putWorkflowRun,
} from "./server-store";
import {
  approveManifestCapabilities,
  assertRuntimeSupportsCapabilities,
  normalizeManifest,
} from "./script-capabilities";
import { executeScriptInWorker } from "./script-worker-rpc";
import { createWorkflowSdk, type WorkflowResumeState } from "./script-sdk";
export { buildWorkflowWorkerSpawnConfig } from "./script-worker-spawn";

const MAX_SCRIPT_CHARS = 50000;

function now() {
  return Date.now();
}

function cleanText(raw: string | undefined, limit: number): string {
  return (raw?.trim() ?? "").slice(0, limit);
}

function serializeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeWorkflowId(raw: string | undefined): string | undefined {
  const id = cleanText(raw, 120);
  if (!id) return undefined;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`invalid resumeFromWorkflowId: ${id}`);
  }
  return id;
}

function sanitizeCheckpointName(raw: string | undefined): string | undefined {
  const name = cleanText(raw, 200);
  if (!name) return undefined;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`invalid resumeFromCheckpointName: ${name}`);
  }
  return name;
}

function makeTimeout(controller: AbortController, timeoutMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Workflow script timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Workflow script aborted"));
      },
      { once: true }
    );
  });
}

function loadResumeRun(
  input: RunWorkflowScriptInput,
  parentAgentId: string
): { run?: WorkflowRun; state?: WorkflowResumeState } {
  const resumeFromWorkflowId = input.resumeFromWorkflowId;
  if (!resumeFromWorkflowId) return {};
  const run = getWorkflowRun(resumeFromWorkflowId);
  if (!run) {
    throw new Error(`resume workflow not found: ${resumeFromWorkflowId}`);
  }
  if (run.parentAgentId !== parentAgentId) {
    throw new Error("resume workflow does not belong to this agent");
  }
  if (run.status === "running") {
    throw new Error("cannot resume from a running workflow");
  }
  if (run.checkpoints.length === 0) {
    throw new Error("cannot resume workflow without checkpoints");
  }
  const requestedCheckpointName = sanitizeCheckpointName(
    input.resumeFromCheckpointName
  );
  const selectedCheckpoint = requestedCheckpointName
    ? run.checkpoints.find((checkpoint) => checkpoint.name === requestedCheckpointName)
    : run.checkpoints[run.checkpoints.length - 1];
  if (!selectedCheckpoint) {
    throw new Error(
      `resume checkpoint not found in workflow ${resumeFromWorkflowId}: ${requestedCheckpointName}`
    );
  }
  const state: WorkflowResumeState = {
    fromWorkflowId: run.id,
    objective: run.objective,
    status: run.status,
    lastCheckpoint: selectedCheckpoint,
    checkpointNames: run.checkpoints.map((checkpoint) => checkpoint.name),
    artifactNames: run.artifacts.map((artifact) => artifact.name),
  };
  return { run, state };
}

export async function runWorkflowScript(
  deps: RunWorkflowScriptDeps,
  rawInput: RunWorkflowScriptInput,
  externalSignal?: AbortSignal
): Promise<WorkflowScriptResult> {
  const input: RunWorkflowScriptInput = {
    objective: cleanText(rawInput.objective, 2000),
    rationale: cleanText(rawInput.rationale, 2000),
    script: cleanText(rawInput.script, MAX_SCRIPT_CHARS),
    templateParams: rawInput.templateParams,
    templateRef: rawInput.templateRef,
    resumeFromWorkflowId: sanitizeWorkflowId(rawInput.resumeFromWorkflowId),
    resumeFromCheckpointName: sanitizeCheckpointName(
      rawInput.resumeFromCheckpointName
    ),
    capabilities: rawInput.capabilities,
    maxAgents: rawInput.maxAgents,
    maxConcurrency: rawInput.maxConcurrency,
    timeoutMs: rawInput.timeoutMs,
  };
  if (!input.objective) throw new Error("run_workflow_script requires an objective");
  if (!input.rationale) throw new Error("run_workflow_script requires a rationale");
  if (!input.script) throw new Error("run_workflow_script requires a script");
  const manifest = normalizeManifest(input);

  const parentAgentId = deps.parentAgentId ?? "unknown";
  const { run: resumeRun, state: resumeState } = loadResumeRun(input, parentAgentId);
  const workflowId = randomUUID();
  const startedAt = now();
  const artifacts = new Map<string, WorkflowArtifact>(
    (resumeRun?.artifacts ?? []).map((artifact) => [artifact.name, artifact])
  );
  const checkpoints: WorkflowCheckpoint[] = resumeRun?.checkpoints.slice() ?? [];
  const logs: WorkflowScriptLog[] = [];
  const traceEvents: WorkflowTraceEvent[] = [];
  const abortController = new AbortController();
  const abortFromExternal = () => abortController.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });

  putWorkflowRun(
    {
      id: workflowId,
      parentAgentId,
      objective: input.objective,
      rationale: input.rationale,
      status: "running",
      script: input.script,
      manifest,
      resumedFromWorkflowId: input.resumeFromWorkflowId,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs: [],
      traceEvents: [],
      createdAt: startedAt,
    },
    abortController
  );
  deps.onEvent?.({
    type: "workflow_start",
    run: {
      id: workflowId,
      parentAgentId,
      objective: input.objective,
      rationale: input.rationale,
      status: "running",
      script: input.script,
      manifest,
      resumedFromWorkflowId: input.resumeFromWorkflowId,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs: [],
      traceEvents: [],
      createdAt: startedAt,
    },
  });
  const pushRuntimeTrace = (trace: WorkflowTraceEvent) => {
    traceEvents.push(trace);
    appendWorkflowTraceEvent(workflowId, trace);
    deps.onEvent?.({ type: "workflow_trace", workflowId, trace });
  };

  try {
    await approveManifestCapabilities(
      deps,
      input,
      workflowId,
      manifest,
      pushRuntimeTrace
    );
    assertRuntimeSupportsCapabilities(manifest);
    const sdk = createWorkflowSdk({
      deps,
      input,
      manifest,
      workflowId,
      signal: abortController.signal,
      artifacts,
      checkpoints,
      logs,
      traceEvents,
      resumeState,
    });
    const value = await Promise.race([
      executeScriptInWorker({
        input,
        manifest,
        workflowId,
        sdk,
        signal: abortController.signal,
        resumeState,
      }),
      makeTimeout(abortController, manifest.timeoutMs),
    ]);
    const endedAt = now();
    const status = abortController.signal.aborted ? "aborted" : "completed";
    finishWorkflowRun(workflowId, {
      status,
      endedAt,
      returnValue: value,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      traceEvents,
    });
    deps.onEvent?.({
      type: "workflow_end",
      workflowId,
      status,
      endedAt,
      returnValue: value,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      traceEvents,
    });
    return {
      workflowId,
      objective: input.objective,
      status,
      manifest,
      resumedFromWorkflowId: input.resumeFromWorkflowId,
      returnValue: value,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      traceEvents,
      startedAt,
      endedAt,
    };
  } catch (err) {
    const endedAt = now();
    const status = abortController.signal.aborted ? "aborted" : "failed";
    const error = serializeError(err);
    finishWorkflowRun(workflowId, {
      status,
      endedAt,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      traceEvents,
      error,
    });
    deps.onEvent?.({
      type: "workflow_end",
      workflowId,
      status,
      endedAt,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      error,
    });
    return {
      workflowId,
      objective: input.objective,
      status,
      manifest,
      resumedFromWorkflowId: input.resumeFromWorkflowId,
      artifacts: Array.from(artifacts.values()),
      checkpoints,
      logs,
      traceEvents,
      startedAt,
      endedAt,
      error,
    };
  } finally {
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}
