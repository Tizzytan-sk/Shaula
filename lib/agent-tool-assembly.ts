import "server-only";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ApprovalResponse } from "./collab/types";
import { loadMcpToolDefinitions } from "./mcp/loader";
import type { LoadMcpToolsOptions } from "./mcp/loader";

export const DEFAULT_BROWSER_TOOL_NAMES = [
  "browser_open",
  "browser_screenshot",
  "browser_click",
  "browser_click_text",
  "browser_fill",
  "browser_type",
  "browser_search",
  "browser_wait",
  "browser_wait_for",
  "browser_extract",
  "browser_verify",
  "browser_annotations",
  "browser_resolve_annotation",
  "browser_close",
];

export interface BuildAgentCustomToolsInput {
  enableSubagents?: boolean;
  delegateSubagentsTool: unknown;
  dynamicWorkflowTool: unknown;
  workflowScriptTool: unknown;
  mcpTools: ToolDefinition[];
}

export interface LoadAgentMcpToolsInput {
  allowedMcpServers?: string[];
  requestApproval?: (params: {
    serverId: string;
    tool: string;
    input: Record<string, unknown>;
  }) => Promise<ApprovalResponse>;
}

export function buildAgentCustomTools({
  enableSubagents,
  delegateSubagentsTool,
  dynamicWorkflowTool,
  workflowScriptTool,
  mcpTools,
}: BuildAgentCustomToolsInput): ToolDefinition[] {
  const baseCustomTools: ToolDefinition[] =
    enableSubagents === false
      ? []
      : [
          delegateSubagentsTool as ToolDefinition,
          dynamicWorkflowTool as ToolDefinition,
          workflowScriptTool as ToolDefinition,
        ];
  return [...baseCustomTools, ...mcpTools];
}

export function customToolsForSession(
  tools: ToolDefinition[]
): ToolDefinition[] | undefined {
  return tools.length > 0 ? tools : undefined;
}

export async function loadAgentMcpTools(
  input: LoadAgentMcpToolsInput,
  loader: (opts: LoadMcpToolsOptions) => Promise<ToolDefinition[]> =
    loadMcpToolDefinitions
): Promise<ToolDefinition[]> {
  try {
    return await loader({
      allowedMcpServers: input.allowedMcpServers,
      rules: [],
      requestApproval: input.requestApproval,
      onAudit: () => {},
    });
  } catch {
    return [];
  }
}

export function enableDefaultBrowserTools(
  session: Pick<
    AgentSession,
    "getAllTools" | "getActiveToolNames" | "setActiveToolsByName"
  >,
  names = DEFAULT_BROWSER_TOOL_NAMES
): boolean {
  const available = new Set(session.getAllTools().map((tool) => tool.name));
  const active = new Set(session.getActiveToolNames());
  let changed = false;
  for (const name of names) {
    if (available.has(name) && !active.has(name)) {
      active.add(name);
      changed = true;
    }
  }
  if (changed) session.setActiveToolsByName(Array.from(active));
  return changed;
}
