import { constants, existsSync } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  createBashToolDefinition,
  type BashOperations,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

type ShellKind = "bash" | "powershell";
type ShellEnv = Record<string, string | undefined>;

interface ShellConfig {
  kind: ShellKind;
  shell: string;
  args: (command: string) => string[];
}

function splitPath(value: string | undefined): string[] {
  return (value ?? "").split(delimiter).filter(Boolean);
}

function findOnPath(command: string, env: ShellEnv): string | null {
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = env[pathKey];
  for (const dir of splitPath(currentPath)) {
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }

  try {
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    const result = spawnSync("where", [command], {
      encoding: "utf-8",
      timeout: 3000,
      windowsHide: true,
      env: spawnEnv,
    });
    if (result.status === 0 && result.stdout) {
      const first = result.stdout.trim().split(/\r?\n/)[0];
      if (first && existsSync(first)) return first;
    }
  } catch {
    // Ignore lookup failures; callers have a fallback.
  }

  return null;
}

function classifyShellPath(shellPath: string): ShellKind {
  return /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(shellPath)
    ? "powershell"
    : "bash";
}

export function resolveShaulaShellConfig(
  env: ShellEnv = process.env
): ShellConfig {
  const explicit = env.SHAULA_SHELL_PATH || env.SHAULA_BASH_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`Configured shell path not found: ${explicit}`);
    }
    const kind = classifyShellPath(explicit);
    return {
      kind,
      shell: explicit,
      args: kind === "powershell" ? powershellArgs : bashArgs,
    };
  }

  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];
  const localAppData = env.LOCALAPPDATA;
  const gitBashCandidates = [
    programFiles ? join(programFiles, "Git", "bin", "bash.exe") : null,
    programFiles ? join(programFiles, "Git", "usr", "bin", "bash.exe") : null,
    programFilesX86 ? join(programFilesX86, "Git", "bin", "bash.exe") : null,
    localAppData
      ? join(localAppData, "Programs", "Git", "bin", "bash.exe")
      : null,
  ].filter((p): p is string => !!p);
  const gitBash = gitBashCandidates.find((candidate) => existsSync(candidate));
  if (gitBash) {
    return { kind: "bash", shell: gitBash, args: bashArgs };
  }

  const bashOnPath = findOnPath("bash.exe", env);
  if (bashOnPath) {
    return { kind: "bash", shell: bashOnPath, args: bashArgs };
  }

  const pwsh = findOnPath("pwsh.exe", env);
  if (pwsh) {
    return { kind: "powershell", shell: pwsh, args: powershellArgs };
  }

  const windowsPowerShell =
    findOnPath("powershell.exe", env) ??
    `${env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  return {
    kind: "powershell",
    shell: windowsPowerShell,
    args: powershellArgs,
  };
}

function bashArgs(command: string): string[] {
  return ["-lc", command];
}

function powershellArgs(command: string): string[] {
  const utf8Prefix = [
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()",
    "$OutputEncoding=[System.Text.UTF8Encoding]::new()",
  ].join("; ");
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `${utf8Prefix}; ${command}`,
  ];
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Best-effort cleanup.
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

function createShaulaShellOperations(): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      await fsAccess(cwd, constants.F_OK);
      if (signal?.aborted) throw new Error("aborted");

      const shellEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
      const shellConfig = resolveShaulaShellConfig(shellEnv);
      const child = spawn(shellConfig.shell, shellConfig.args(command), {
        cwd,
        detached: process.platform !== "win32",
        env: shellEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const abort = () => killProcessTree(child.pid);

      try {
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            abort();
          }, timeout * 1000);
        }
        if (signal) {
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        const exitCode = await new Promise<number | null>((resolve, reject) => {
          let settled = false;
          child.once("error", (error) => {
            if (settled) return;
            settled = true;
            reject(error);
          });
          child.once("close", (code) => {
            if (settled) return;
            settled = true;
            resolve(code);
          });
        });

        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        return { exitCode };
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal) signal.removeEventListener("abort", abort);
      }
    },
  };
}

export function createShaulaShellExtension(opts: { cwd: string }): ExtensionFactory {
  return (pi) => {
    if (process.platform !== "win32") return;

    pi.on("before_agent_start", async (event) => ({
      systemPrompt: `${event.systemPrompt}

## Shaula Windows Shell

The bash tool is backed by Shaula's local Windows shell adapter. Prefer the built-in ls/read/find/grep tools for filesystem inspection. When you need to run a command on Windows, use commands that work in PowerShell unless the task clearly requires Git Bash syntax. Do not tell the user to install bash just because Git Bash is unavailable; this tool falls back to PowerShell.`,
    }));

    const tool = createBashToolDefinition(opts.cwd, {
      operations: createShaulaShellOperations(),
    });

    pi.registerTool({
      ...tool,
      label: "shell",
      description:
        "Execute a local shell command in the current working directory. On Windows, Shaula uses Git Bash when available and automatically falls back to PowerShell.",
      promptSnippet:
        "Execute local shell commands. On Windows, PowerShell is available even when Git Bash is not installed.",
      promptGuidelines: [
        "For directory inspection, prefer the built-in ls/read/find/grep tools when they are enough.",
        "On Windows shell commands, prefer PowerShell-compatible commands such as Get-ChildItem, Get-Content, Select-String, and Test-Path.",
        "If a user provides a Windows path like C:\\Users\\name\\folder, inspect it directly instead of asking them to install bash.",
      ],
    });
  };
}
