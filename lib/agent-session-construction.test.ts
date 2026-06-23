import type {
  DefaultResourceLoader,
  ExtensionFactory,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  appendShaulaSystemPrompt,
  buildAgentExtensionFactories,
  createAgentResourceLoader,
  createAgentSessionManager,
} from "./agent-session-construction";
import { SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE } from "./local-coding-assistant/adapter";

const noopFactory: ExtensionFactory = () => undefined;

describe("agent session construction", () => {
  it("opens an existing session when a session path is provided", () => {
    const open = vi.fn((sessionPath: string) => ({ kind: "open", sessionPath }));
    const create = vi.fn();

    expect(
      createAgentSessionManager(
        {
          cwd: "C:/repo",
          sessionPath: "C:/sessions/one.jsonl",
          parentSessionPath: "ignored",
        },
        { open, create }
      )
    ).toEqual({ kind: "open", sessionPath: "C:/sessions/one.jsonl" });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a new session and preserves parent session lineage", () => {
    const open = vi.fn();
    const create = vi.fn((cwd, sessionDir, options) => ({
      kind: "create",
      cwd,
      sessionDir,
      options,
    }));

    expect(
      createAgentSessionManager(
        {
          cwd: "C:/repo",
          parentSessionPath: "C:/sessions/parent.jsonl",
        },
        { open, create }
      )
    ).toEqual({
      kind: "create",
      cwd: "C:/repo",
      sessionDir: undefined,
      options: { parentSession: "C:/sessions/parent.jsonl" },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("orders write boundary, shell, then supplied extension factories", () => {
    const boundary = vi.fn(() => noopFactory);
    const shell = vi.fn(() => noopFactory);
    const extensionA: ExtensionFactory = () => undefined;
    const extensionB: ExtensionFactory = () => undefined;

    const factories = buildAgentExtensionFactories({
      cwd: "C:/repo",
      parentAgentId: "parent",
      writePaths: ["src"],
      extensionFactories: [extensionA, extensionB],
      createWriteBoundaryExtension: boundary,
      createShellExtension: shell,
    });

    expect(boundary).toHaveBeenCalledWith({
      cwd: "C:/repo",
      writePaths: ["src"],
    });
    expect(shell).toHaveBeenCalledWith({ cwd: "C:/repo" });
    expect(factories).toEqual([noopFactory, noopFactory, extensionA, extensionB]);
  });

  it("omits write boundary for main agents", () => {
    const boundary = vi.fn(() => noopFactory);
    const shell = vi.fn(() => noopFactory);
    const extensionA: ExtensionFactory = () => undefined;

    expect(
      buildAgentExtensionFactories({
        cwd: "C:/repo",
        extensionFactories: [extensionA],
        createWriteBoundaryExtension: boundary,
        createShellExtension: shell,
      })
    ).toEqual([noopFactory, extensionA]);
    expect(boundary).not.toHaveBeenCalled();
  });

  it("appends Shaula's system prompt override", () => {
    expect(appendShaulaSystemPrompt(["base"])).toEqual([
      "base",
      SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE,
    ]);
  });

  it("creates a resource loader with Shaula prompt and extension factories", () => {
    const settingsManager = {} as SettingsManager;
    const extensionFactories = [noopFactory];
    const resourceLoader = { reload: vi.fn() } as unknown as DefaultResourceLoader;
    const resourceLoaderFactory = vi.fn(() => resourceLoader);

    expect(
      createAgentResourceLoader({
        cwd: "C:/repo",
        agentDir: "C:/agent",
        settingsManager,
        extensionFactories,
        resourceLoaderFactory,
      })
    ).toBe(resourceLoader);
    expect(resourceLoaderFactory).toHaveBeenCalledWith({
      cwd: "C:/repo",
      agentDir: "C:/agent",
      settingsManager,
      appendSystemPromptOverride: appendShaulaSystemPrompt,
      extensionFactories,
    });
  });
});
