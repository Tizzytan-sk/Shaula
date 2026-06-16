import { describe, expect, it, vi, afterEach } from "vitest";
import { getShaulaFileAccessRoot } from "./shaula-paths";
import { normalizeRequestedFsPath } from "./file-access";

describe("file access path helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves file browsing unrestricted unless SHAULA_WEB_ROOT is explicit", () => {
    vi.stubEnv("SHAULA_WEB_ROOT", undefined);
    expect(getShaulaFileAccessRoot()).toBeUndefined();

    vi.stubEnv("SHAULA_WEB_ROOT", "");
    expect(getShaulaFileAccessRoot()).toBeUndefined();

    vi.stubEnv("SHAULA_WEB_ROOT", "/");
    expect(getShaulaFileAccessRoot()).toBeUndefined();
  });

  it("treats Windows drive-only input as a drive root", () => {
    expect(normalizeRequestedFsPath("D:", "win32")).toBe("D:\\");
    expect(normalizeRequestedFsPath("D:\\projects", "win32")).toBe("D:\\projects");
  });

  it("treats a drive-only SHAULA_WEB_ROOT as the drive root on Windows", () => {
    if (process.platform !== "win32") return;

    vi.stubEnv("SHAULA_WEB_ROOT", "D:");

    expect(getShaulaFileAccessRoot()).toBe("D:\\");
  });
});
