import { spawn as spawnProcess } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type {
  RunWorkflowScriptInput,
  WorkflowAgentInput,
  WorkflowAskUserInput,
  WorkflowArtifact,
  WorkflowCallToolInput,
  WorkflowCreateWorktreeInput,
  WorkflowFetchUrlInput,
  WorkflowManifest,
  WorkflowSpawnAgentInput,
  WorkflowWorktree,
} from "./types";
import {
  WORKFLOW_WORKER_CPU_SECONDS,
  buildWorkflowWorkerSpawnConfig,
} from "./script-worker-spawn";

export interface WorkflowWorkerSdkBridge {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  checkpoint(name: string, value: unknown): unknown;
  artifact(name: string, value: unknown): unknown;
  listArtifacts(): WorkflowArtifact[];
  createWorktree(input?: WorkflowCreateWorktreeInput): Promise<unknown>;
  diffWorktree(worktree: WorkflowWorktree): Promise<unknown>;
  mergeWorktree(worktree: WorkflowWorktree): Promise<unknown>;
  removeWorktree(worktree: WorkflowWorktree): Promise<void>;
  askUser(input: WorkflowAskUserInput): Promise<unknown>;
  fetchUrl(input: WorkflowFetchUrlInput): Promise<unknown>;
  listTools(serverId?: string): Promise<unknown>;
  callTool(input: WorkflowCallToolInput): Promise<unknown>;
  agent(
    prompt: string,
    input?: Omit<WorkflowAgentInput, "prompt">
  ): Promise<unknown>;
  spawnAgent(input: WorkflowSpawnAgentInput): Promise<unknown>;
}

function serializeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sendWorkerMessage(
  child: ChildProcessWithoutNullStreams,
  message: unknown
): void {
  if (child.stdin.destroyed) return;
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

export async function executeScriptInWorker(args: {
  input: RunWorkflowScriptInput;
  manifest: WorkflowManifest;
  workflowId: string;
  sdk: WorkflowWorkerSdkBridge;
  signal: AbortSignal;
  resumeState?: unknown;
}): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const workerSpawn = buildWorkflowWorkerSpawnConfig({
      cpuSeconds: Math.max(
        1,
        Math.min(
          WORKFLOW_WORKER_CPU_SECONDS,
          Math.ceil(args.manifest.timeoutMs / 1000)
        )
      ),
    });
    const child: ChildProcessWithoutNullStreams = spawnProcess(
      workerSpawn.command,
      workerSpawn.args,
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      }
    );
    const stderr: string[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      args.signal.removeEventListener("abort", abortWorker);
      rl.close();
      child.kill("SIGKILL");
      fn();
    };

    const abortWorker = () => {
      settle(() => reject(new Error("Workflow script aborted")));
    };
    args.signal.addEventListener("abort", abortWorker, { once: true });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(String(chunk).slice(0, 4000));
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const handleRequest = async (message: Record<string, unknown>) => {
      const id = String(message.id ?? "");
      const method = String(message.method ?? "");
      const requestArgs = Array.isArray(message.args) ? message.args : [];
      try {
        let result: unknown;
        if (method === "log") {
          const level = String(requestArgs[0] ?? "info");
          const text = String(requestArgs[1] ?? "");
          if (level === "warn") args.sdk.warn(text);
          else if (level === "error") args.sdk.error(text);
          else args.sdk.log(text);
          result = null;
        } else if (method === "checkpoint") {
          result = args.sdk.checkpoint(
            String(requestArgs[0] ?? ""),
            requestArgs[1]
          );
        } else if (method === "artifact") {
          result = args.sdk.artifact(
            String(requestArgs[0] ?? ""),
            requestArgs[1]
          );
        } else if (method === "createWorktree") {
          result = await args.sdk.createWorktree(
            requestArgs[0] as WorkflowCreateWorktreeInput | undefined
          );
        } else if (method === "diffWorktree") {
          result = await args.sdk.diffWorktree(requestArgs[0] as WorkflowWorktree);
        } else if (method === "mergeWorktree") {
          result = await args.sdk.mergeWorktree(
            requestArgs[0] as WorkflowWorktree
          );
        } else if (method === "removeWorktree") {
          result = await args.sdk.removeWorktree(
            requestArgs[0] as WorkflowWorktree
          );
        } else if (method === "askUser") {
          result = await args.sdk.askUser(requestArgs[0] as WorkflowAskUserInput);
        } else if (method === "fetchUrl") {
          result = await args.sdk.fetchUrl(
            requestArgs[0] as WorkflowFetchUrlInput
          );
        } else if (method === "listTools") {
          result = await args.sdk.listTools(
            requestArgs[0] as string | undefined
          );
        } else if (method === "callTool") {
          result = await args.sdk.callTool(
            requestArgs[0] as WorkflowCallToolInput
          );
        } else if (method === "agent") {
          result = await args.sdk.agent(
            String(requestArgs[0] ?? ""),
            requestArgs[1] as Omit<WorkflowAgentInput, "prompt"> | undefined
          );
        } else if (method === "spawnAgent") {
          result = await args.sdk.spawnAgent(
            requestArgs[0] as WorkflowSpawnAgentInput
          );
        } else {
          throw new Error(`Unsupported workflow worker method: ${method}`);
        }
        sendWorkerMessage(child, { type: "response", id, result });
      } catch (err) {
        sendWorkerMessage(child, {
          type: "response",
          id,
          error: serializeError(err),
        });
      }
    };

    rl.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch (err) {
        settle(() =>
          reject(new Error(`Invalid workflow worker output: ${serializeError(err)}`))
        );
        return;
      }

      if (message.type === "request") {
        void handleRequest(message);
      } else if (message.type === "done") {
        settle(() => resolve(message.value));
      } else if (message.type === "error") {
        settle(() =>
          reject(new Error(String(message.error ?? "Workflow worker error")))
        );
      }
    });

    child.on("error", (err: Error) => {
      settle(() => reject(err));
    });

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      const detail = stderr.join("").trim();
      settle(() =>
        reject(
          new Error(
            `Workflow worker exited before completion (code=${code ?? "null"}, signal=${
              signal ?? "null"
            })${detail ? `: ${detail}` : ""}`
          )
        )
      );
    });

    sendWorkerMessage(child, {
      type: "init",
      workflowId: args.workflowId,
      objective: args.input.objective,
      script: args.input.script,
      manifest: args.manifest,
      resume: args.resumeState,
      artifacts: args.sdk.listArtifacts(),
      params: args.input.templateParams,
      template: args.input.templateRef,
    });
  });
}
