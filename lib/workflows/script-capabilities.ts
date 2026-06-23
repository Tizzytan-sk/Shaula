import type {
  RunWorkflowScriptDeps,
  RunWorkflowScriptInput,
  WorkflowCapability,
  WorkflowManifest,
  WorkflowTraceEvent,
} from "./types";

const DEFAULT_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_AGENTS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;

const SAFE_WORKFLOW_AGENT_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_WORKFLOW_AGENT_TOOLS = new Set(["edit", "write", "apply_patch"]);
const SHELL_WORKFLOW_AGENT_TOOLS = new Set(["bash", "shell"]);
const BROWSER_WORKFLOW_AGENT_TOOLS = new Set([
  "browser_open",
  "browser_screenshot",
  "browser_click",
  "browser_click_text",
  "browser_fill",
  "browser_type",
  "browser_search",
  "browser_wait",
  "browser_extract",
  "browser_verify",
  "browser_close",
]);

const DEFAULT_CAPABILITIES: WorkflowCapability[] = [
  "spawn_agent",
  "read_files",
];
const IMPLEMENTED_CAPABILITIES = new Set<WorkflowCapability>([
  "spawn_agent",
  "read_files",
  "write_files",
  "shell",
  "browser",
  "network",
  "worktree",
  "ask_user",
  "mcp",
]);
const APPROVAL_REQUIRED_CAPABILITIES = new Set<WorkflowCapability>([
  "write_files",
  "shell",
  "browser",
  "network",
  "worktree",
  "ask_user",
  "mcp",
]);

function normalizeCapabilities(
  raw: WorkflowCapability[] | undefined
): WorkflowCapability[] {
  const source = raw === undefined ? DEFAULT_CAPABILITIES : raw;
  const out: WorkflowCapability[] = [];
  for (const capability of source) {
    if (
      capability === "spawn_agent" ||
      capability === "read_files" ||
      capability === "write_files" ||
      capability === "shell" ||
      capability === "browser" ||
      capability === "network" ||
      capability === "worktree" ||
      capability === "ask_user" ||
      capability === "mcp"
    ) {
      if (!out.includes(capability)) out.push(capability);
    }
  }
  return out;
}

export function normalizeManifest(
  input: RunWorkflowScriptInput
): WorkflowManifest {
  const capabilities = normalizeCapabilities(input.capabilities);
  return {
    capabilities,
    maxAgents: Math.max(
      1,
      Math.min(Math.floor(input.maxAgents ?? DEFAULT_MAX_AGENTS), 32)
    ),
    maxConcurrency: Math.max(
      1,
      Math.min(
        Math.floor(input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
        16
      )
    ),
    timeoutMs: Math.max(
      1000,
      Math.min(
        input.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
        DEFAULT_SCRIPT_TIMEOUT_MS
      )
    ),
    runtime: "process",
  };
}

export async function approveManifestCapabilities(
  deps: RunWorkflowScriptDeps,
  input: RunWorkflowScriptInput,
  workflowId: string,
  manifest: WorkflowManifest,
  onTrace?: (trace: WorkflowTraceEvent) => void
): Promise<void> {
  const approvalRequired = manifest.capabilities.filter((capability) =>
    APPROVAL_REQUIRED_CAPABILITIES.has(capability)
  );
  if (approvalRequired.length === 0) return;
  if (!deps.approveCapability) {
    throw new Error(
      `Workflow capability approval broker is not implemented for: ${approvalRequired.join(", ")}`
    );
  }
  for (const capability of approvalRequired) {
    const resp = await deps.approveCapability({
      workflowId,
      capability,
      manifest,
      objective: input.objective,
      rationale: input.rationale,
    });
    onTrace?.({
      type: "approval",
      workflowId,
      capability,
      decision: resp.decision,
      createdAt: Date.now(),
    });
    if (resp.decision !== "allow") {
      throw new Error(
        resp.denyReason ?? `Workflow capability denied: ${capability}`
      );
    }
  }
}

export function assertRuntimeSupportsCapabilities(
  manifest: WorkflowManifest
): void {
  const unimplemented = manifest.capabilities.filter(
    (capability) => !IMPLEMENTED_CAPABILITIES.has(capability)
  );
  if (unimplemented.length > 0) {
    throw new Error(
      `Workflow runtime support is not implemented for: ${unimplemented.join(", ")}`
    );
  }
}

export function hasCapability(
  manifest: WorkflowManifest,
  capability: WorkflowCapability
): boolean {
  return manifest.capabilities.includes(capability);
}

export function requireCapability(
  manifest: WorkflowManifest,
  capability: WorkflowCapability
) {
  if (!hasCapability(manifest, capability)) {
    throw new Error(`workflow capability required: ${capability}`);
  }
}

export function safeAllowedTools(
  manifest: WorkflowManifest,
  tools: string[] | undefined
): string[] | undefined {
  if (!tools) return undefined;
  const cleaned = tools.map((tool) => tool.trim()).filter(Boolean);
  const unknown: string[] = [];
  for (const tool of cleaned) {
    if (SAFE_WORKFLOW_AGENT_TOOLS.has(tool)) {
      requireCapability(manifest, "read_files");
      continue;
    }
    if (WRITE_WORKFLOW_AGENT_TOOLS.has(tool)) {
      requireCapability(manifest, "write_files");
      continue;
    }
    if (SHELL_WORKFLOW_AGENT_TOOLS.has(tool)) {
      requireCapability(manifest, "shell");
      continue;
    }
    if (BROWSER_WORKFLOW_AGENT_TOOLS.has(tool)) {
      requireCapability(manifest, "browser");
      continue;
    }
    unknown.push(tool);
  }
  if (unknown.length > 0) {
    throw new Error(
      `workflow.spawnAgent tool(s) are not mapped to workflow capabilities: ${unknown.join(", ")}`
    );
  }
  return cleaned;
}
