import { spawn } from "node:child_process";
import type {
  VerificationBrowserCheck,
  VerificationBrowserResult,
  VerificationCommandCheck,
  VerificationCommandResult,
  VerificationPlan,
  VerificationResult,
} from "./types";

const MAX_PREVIEW_CHARS = 12_000;

export interface VerificationBrowserObservation {
  browserId?: string;
  status?: VerificationBrowserResult["status"];
  passed?: boolean;
  url?: string | null;
  title?: string | null;
  screenshotDataUrl?: string | null;
  textPreview?: string;
  error?: string;
  timedOut?: boolean;
}

export type VerificationBrowserObserver = (
  check: VerificationBrowserCheck,
  input: { planId?: string; now: () => number }
) => Promise<VerificationBrowserObservation>;

class BrowserVerificationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`browser verification timed out after ${timeoutMs}ms`);
    this.name = "BrowserVerificationTimeoutError";
  }
}

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

function browserFailureResult(
  check: VerificationBrowserCheck,
  input: {
    planId?: string;
    startedAt: number;
    completedAt: number;
    error: string;
    timedOut?: boolean;
  }
): VerificationBrowserResult {
  return {
    planId: input.planId,
    checkId: check.id,
    kind: "browser_observation",
    label: check.label,
    targetUrl: check.targetUrl,
    selector: check.selector,
    text: check.text,
    expectation: check.expectation,
    required: check.required,
    evidenceRequired: check.evidenceRequired,
    rationale: check.rationale,
    status: input.timedOut ? "timed_out" : "failed",
    passed: false,
    error: input.error,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    timedOut: input.timedOut,
  };
}

function browserStatus(
  observation: VerificationBrowserObservation
): VerificationBrowserResult["status"] {
  if (observation.status) return observation.status;
  if (observation.timedOut) return "timed_out";
  return observation.passed === true ? "passed" : "failed";
}

async function observeBrowserWithTimeout(
  check: VerificationBrowserCheck,
  input: {
    planId?: string;
    now: () => number;
    browserObserver: VerificationBrowserObserver;
  }
): Promise<VerificationBrowserObservation> {
  const timeoutMs = check.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    return input.browserObserver(check, {
      planId: input.planId,
      now: input.now,
    });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.browserObserver(check, {
        planId: input.planId,
        now: input.now,
      }),
      new Promise<VerificationBrowserObservation>((_, reject) => {
        timer = setTimeout(
          () => reject(new BrowserVerificationTimeoutError(timeoutMs)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runVerificationBrowserCheck(
  check: VerificationBrowserCheck,
  input: {
    planId?: string;
    now?: () => number;
    browserObserver?: VerificationBrowserObserver;
  } = {}
): Promise<VerificationBrowserResult> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  if (!input.browserObserver) {
    const completedAt = now();
    return browserFailureResult(check, {
      planId: input.planId,
      startedAt,
      completedAt,
      error:
        "browser observer unavailable; open the Browser panel or configure a browser observer before running browser verification",
    });
  }

  try {
    const observation = await observeBrowserWithTimeout(check, {
      planId: input.planId,
      now,
      browserObserver: input.browserObserver,
    });
    const completedAt = now();
    const status = browserStatus(observation);
    return {
      planId: input.planId,
      checkId: check.id,
      kind: "browser_observation",
      label: check.label,
      browserId: observation.browserId,
      targetUrl: check.targetUrl,
      selector: check.selector,
      text: check.text,
      expectation: check.expectation,
      required: check.required,
      evidenceRequired: check.evidenceRequired,
      rationale: check.rationale,
      status,
      passed: status === "passed",
      url: observation.url,
      title: observation.title,
      screenshotDataUrl: observation.screenshotDataUrl,
      textPreview: observation.textPreview,
      error: observation.error,
      durationMs: Math.max(0, completedAt - startedAt),
      startedAt,
      completedAt,
      timedOut: observation.timedOut === true || status === "timed_out",
    };
  } catch (error) {
    const completedAt = now();
    return browserFailureResult(check, {
      planId: input.planId,
      startedAt,
      completedAt,
      error: error instanceof Error ? error.message : String(error),
      timedOut: error instanceof BrowserVerificationTimeoutError,
    });
  }
}

export async function runVerificationPlan(
  plan: VerificationPlan,
  input: {
    env?: Record<string, string>;
    now?: () => number;
    browserObserver?: VerificationBrowserObserver;
  } = {}
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const check of plan.checks) {
    if (check.type === "command") {
      results.push(
        await runVerificationCommand(check, {
          planId: plan.id,
          env: input.env,
          now: input.now,
        })
      );
    } else {
      results.push(
        await runVerificationBrowserCheck(check, {
          planId: plan.id,
          now: input.now,
          browserObserver: input.browserObserver,
        })
      );
    }
  }
  return results;
}
