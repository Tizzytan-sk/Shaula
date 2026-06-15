import { spawn } from "node:child_process";
import type {
  VerificationCommandCheck,
  VerificationCommandResult,
  VerificationPlan,
} from "./types";

const MAX_PREVIEW_CHARS = 12_000;

function appendPreview(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString();
  return next.length > MAX_PREVIEW_CHARS
    ? next.slice(next.length - MAX_PREVIEW_CHARS)
    : next;
}

function commandForSpawn(
  check: Pick<VerificationCommandCheck, "command" | "args">
): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: check.command, args: check.args };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", commandLineForWindows(check)],
  };
}

function commandLineForWindows(
  check: Pick<VerificationCommandCheck, "command" | "args">
): string {
  return [check.command, ...check.args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value: string): string {
  if (/^[A-Za-z0-9._\-/:\\]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function isAllowedVerificationCommand(
  check: Pick<VerificationCommandCheck, "command" | "args">
): boolean {
  const [first, second] = check.args;
  if (check.command === "npm") {
    if (first === "test") return check.args.length === 1;
    if (first === "run") {
      return (
        check.args.length === 2 &&
        ["test", "lint", "build", "typecheck"].includes(second ?? "")
      );
    }
  }
  if (check.command === "npx") {
    return (
      check.args.length === 4 &&
      first === "tsc" &&
      second === "--noEmit" &&
      check.args[2] === "--pretty" &&
      check.args[3] === "false"
    );
  }
  return false;
}

export async function runVerificationCommand(
  check: VerificationCommandCheck,
  input: { planId?: string; env?: Record<string, string>; now?: () => number } = {}
): Promise<VerificationCommandResult> {
  if (!isAllowedVerificationCommand(check)) {
    throw new Error(`verification command is not allowed: ${check.command} ${check.args.join(" ")}`);
  }
  const now = input.now ?? Date.now;
  const startedAt = now();
  let stdoutPreview = "";
  let stderrPreview = "";
  let timedOut = false;

  return await new Promise<VerificationCommandResult>((resolve) => {
    let settled = false;
    let clearTimer = () => {};
    const finish = (result: VerificationCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimer();
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      const spawnCommand = commandForSpawn(check);
      child = spawn(spawnCommand.command, spawnCommand.args, {
        cwd: check.cwd,
        env: {
          ...process.env,
          CI: process.env.CI ?? "1",
          ...input.env,
        },
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      stderrPreview = appendPreview(
        stderrPreview,
        error instanceof Error ? error.message : String(error)
      );
      const completedAt = now();
      finish({
        planId: input.planId,
        commandId: check.id,
        kind: check.kind,
        label: check.label,
        command: check.command,
        args: check.args,
        cwd: check.cwd,
        required: check.required,
        evidenceRequired: check.evidenceRequired,
        rationale: check.rationale,
        status: "failed",
        exitCode: null,
        stdoutPreview,
        stderrPreview,
        durationMs: Math.max(0, completedAt - startedAt),
        startedAt,
        completedAt,
        timedOut,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, check.timeoutMs);
    clearTimer = () => clearTimeout(timer);

    child.stdout?.on("data", (chunk) => {
      stdoutPreview = appendPreview(stdoutPreview, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderrPreview = appendPreview(stderrPreview, chunk);
    });
    child.on("error", (error) => {
      stderrPreview = appendPreview(stderrPreview, error.message);
      const completedAt = now();
      finish({
        planId: input.planId,
        commandId: check.id,
        kind: check.kind,
        label: check.label,
        command: check.command,
        args: check.args,
        cwd: check.cwd,
        required: check.required,
        evidenceRequired: check.evidenceRequired,
        rationale: check.rationale,
        status: "failed",
        exitCode: null,
        stdoutPreview,
        stderrPreview,
        durationMs: Math.max(0, completedAt - startedAt),
        startedAt,
        completedAt,
        timedOut,
      });
    });
    child.on("close", (code) => {
      const completedAt = now();
      finish({
        planId: input.planId,
        commandId: check.id,
        kind: check.kind,
        label: check.label,
        command: check.command,
        args: check.args,
        cwd: check.cwd,
        required: check.required,
        evidenceRequired: check.evidenceRequired,
        rationale: check.rationale,
        status: timedOut ? "timed_out" : code === 0 ? "passed" : "failed",
        exitCode: code,
        stdoutPreview,
        stderrPreview,
        durationMs: Math.max(0, completedAt - startedAt),
        startedAt,
        completedAt,
        timedOut,
      });
    });
  });
}

export async function runVerificationPlan(
  plan: VerificationPlan,
  input: { env?: Record<string, string>; now?: () => number } = {}
): Promise<VerificationCommandResult[]> {
  const results: VerificationCommandResult[] = [];
  for (const check of plan.checks) {
    if (check.type !== "command") continue;
    results.push(
      await runVerificationCommand(check, {
        planId: plan.id,
        env: input.env,
        now: input.now,
      })
    );
  }
  return results;
}
