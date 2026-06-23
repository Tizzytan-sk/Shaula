import path from "node:path";
import { getShaulaEnv } from "@/lib/shaula-paths";

export const WORKFLOW_WORKER_MAX_OLD_SPACE_MB = 128;
export const WORKFLOW_WORKER_CPU_SECONDS = 60;

function workerScriptPath(): string {
  return path.join(process.cwd(), "lib/workflows/script-worker-child.cjs");
}

function parseWorkflowWorkerSandboxArgv(): string[] {
  const raw = getShaulaEnv("SHAULA_WORKFLOW_WORKER_SANDBOX_ARGV_JSON");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
      .slice(0, 100);
  } catch {
    return [];
  }
}

function wrapWorkerWithExternalSandbox(
  sandboxArgv: string[],
  worker: { command: string; args: string[] }
): { command: string; args: string[] } {
  const expanded: string[] = [];
  let sawCommand = false;
  let sawArgs = false;
  for (const arg of sandboxArgv) {
    if (arg === "{command}") {
      expanded.push(worker.command);
      sawCommand = true;
    } else if (arg === "{args}") {
      expanded.push(...worker.args);
      sawArgs = true;
    } else {
      expanded.push(arg);
    }
  }
  if (!sawCommand) expanded.push(worker.command);
  if (!sawArgs) expanded.push(...worker.args);
  const [command, ...args] = expanded;
  if (!command) {
    return { command: worker.command, args: worker.args };
  }
  return { command, args };
}

export function buildWorkflowWorkerSpawnConfig(options: {
  platform?: NodeJS.Platform;
  execPath?: string;
  workerPath?: string;
  memoryMb?: number;
  cpuSeconds?: number;
  sandboxArgv?: string[];
} = {}): {
  command: string;
  args: string[];
  usesPosixCpuLimit: boolean;
  usesExternalSandbox: boolean;
} {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const memoryMb = Math.max(
    16,
    Math.floor(options.memoryMb ?? WORKFLOW_WORKER_MAX_OLD_SPACE_MB)
  );
  const workerPath = options.workerPath ?? workerScriptPath();
  const nodeArgs = [`--max-old-space-size=${memoryMb}`, workerPath];
  const cpuSeconds = Math.floor(
    options.cpuSeconds ?? WORKFLOW_WORKER_CPU_SECONDS
  );
  let base: {
    command: string;
    args: string[];
    usesPosixCpuLimit: boolean;
  };
  if (platform !== "win32" && cpuSeconds > 0) {
    base = {
      command: "/bin/sh",
      args: [
        "-c",
        'ulimit -t "$1" 2>/dev/null || exit 126; shift; exec "$@"',
        "workflow-worker-launcher",
        String(cpuSeconds),
        execPath,
        ...nodeArgs,
      ],
      usesPosixCpuLimit: true,
    };
  } else {
    base = {
      command: execPath,
      args: nodeArgs,
      usesPosixCpuLimit: false,
    };
  }
  const sandboxArgv = options.sandboxArgv ?? parseWorkflowWorkerSandboxArgv();
  if (sandboxArgv.length === 0) {
    return {
      ...base,
      usesExternalSandbox: false,
    };
  }
  const wrapped = wrapWorkerWithExternalSandbox(sandboxArgv, base);
  return {
    ...wrapped,
    usesPosixCpuLimit: base.usesPosixCpuLimit,
    usesExternalSandbox: true,
  };
}
