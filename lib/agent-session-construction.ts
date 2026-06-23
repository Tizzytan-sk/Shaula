import "server-only";
import {
  DefaultResourceLoader,
  SessionManager,
  type ExtensionFactory,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE } from "./local-coding-assistant/adapter";
import { createShaulaShellExtension } from "./shaula-shell-extension";
import { createSubagentWriteBoundaryExtension } from "./subagents/write-boundary-extension";

export interface CreateAgentSessionManagerInput {
  cwd: string;
  sessionPath?: string;
  parentSessionPath?: string;
}

export interface AgentSessionManagerFactories<TSessionManager> {
  open: (sessionPath: string) => TSessionManager;
  create: (
    cwd: string,
    sessionDir?: string,
    options?: { parentSession?: string }
  ) => TSessionManager;
}

export function createAgentSessionManager<TSessionManager = SessionManager>(
  input: CreateAgentSessionManagerInput,
  factories: AgentSessionManagerFactories<TSessionManager> = {
    open: (sessionPath) => SessionManager.open(sessionPath) as TSessionManager,
    create: (cwd, sessionDir, options) =>
      SessionManager.create(cwd, sessionDir, options) as TSessionManager,
  }
): TSessionManager {
  if (input.sessionPath) {
    return factories.open(input.sessionPath);
  }
  return factories.create(
    input.cwd,
    undefined,
    input.parentSessionPath
      ? { parentSession: input.parentSessionPath }
      : undefined
  );
}

export interface BuildAgentExtensionFactoriesInput {
  cwd: string;
  parentAgentId?: string;
  writePaths?: string[];
  extensionFactories: ExtensionFactory[];
  createWriteBoundaryExtension?: typeof createSubagentWriteBoundaryExtension;
  createShellExtension?: typeof createShaulaShellExtension;
}

export function buildAgentExtensionFactories({
  cwd,
  parentAgentId,
  writePaths,
  extensionFactories,
  createWriteBoundaryExtension = createSubagentWriteBoundaryExtension,
  createShellExtension = createShaulaShellExtension,
}: BuildAgentExtensionFactoriesInput): ExtensionFactory[] {
  return [
    ...(parentAgentId
      ? [
          createWriteBoundaryExtension({
            cwd,
            writePaths,
          }),
        ]
      : []),
    createShellExtension({ cwd }),
    ...extensionFactories,
  ];
}

export function appendShaulaSystemPrompt(base: string[]): string[] {
  return [...base, SHAULA_CODING_SYSTEM_PROMPT_OVERRIDE];
}

export interface CreateAgentResourceLoaderInput {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  extensionFactories: ExtensionFactory[];
  resourceLoaderFactory?: (
    options: ConstructorParameters<typeof DefaultResourceLoader>[0]
  ) => DefaultResourceLoader;
}

export function createAgentResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  extensionFactories,
  resourceLoaderFactory = (options) => new DefaultResourceLoader(options),
}: CreateAgentResourceLoaderInput): DefaultResourceLoader {
  return resourceLoaderFactory({
    cwd,
    agentDir,
    settingsManager,
    appendSystemPromptOverride: appendShaulaSystemPrompt,
    extensionFactories,
  });
}
