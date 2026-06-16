import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveShaulaShellConfig } from "./shaula-shell-extension";

const tempRoots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "shaula-shell-"));
  tempRoots.push(dir);
  return dir;
}

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveShaulaShellConfig", () => {
  it("honors an explicit PowerShell path", () => {
    const root = tempRoot();
    const shell = touch(join(root, "pwsh.exe"));

    const config = resolveShaulaShellConfig({ SHAULA_SHELL_PATH: shell });

    expect(config.kind).toBe("powershell");
    expect(config.shell).toBe(shell);
  });

  it("prefers Git Bash when it is installed in a known location", () => {
    const root = tempRoot();
    const gitBin = join(root, "Git", "bin");
    const shell = touch(join(gitBin, "bash.exe"));

    const config = resolveShaulaShellConfig({
      ProgramFiles: root,
      "ProgramFiles(x86)": join(root, "x86"),
      LOCALAPPDATA: join(root, "local"),
      PATH: "",
    });

    expect(config.kind).toBe("bash");
    expect(config.shell).toBe(shell);
  });

  it("falls back to PowerShell when Git Bash is not available", () => {
    const root = tempRoot();
    const bin = join(root, "bin");
    const shell = touch(join(bin, "pwsh.exe"));

    const config = resolveShaulaShellConfig({
      ProgramFiles: join(root, "program-files"),
      "ProgramFiles(x86)": join(root, "program-files-x86"),
      LOCALAPPDATA: join(root, "local"),
      PATH: bin,
    });

    expect(config.kind).toBe("powershell");
    expect(config.shell).toBe(shell);
    expect(config.args("Get-ChildItem")).toContain("-Command");
  });

  it("finds bash from PATH before falling back to PowerShell", () => {
    const root = tempRoot();
    const bashBin = join(root, "bash-bin");
    const psBin = join(root, "ps-bin");
    const shell = touch(join(bashBin, "bash.exe"));
    touch(join(psBin, "pwsh.exe"));

    const config = resolveShaulaShellConfig({
      ProgramFiles: join(root, "program-files"),
      "ProgramFiles(x86)": join(root, "program-files-x86"),
      LOCALAPPDATA: join(root, "local"),
      PATH: [bashBin, psBin].join(delimiter),
    });

    expect(config.kind).toBe("bash");
    expect(config.shell).toBe(shell);
  });
});
