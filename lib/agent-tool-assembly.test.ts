import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  buildAgentCustomTools,
  customToolsForSession,
  enableDefaultBrowserTools,
  loadAgentMcpTools,
} from "./agent-tool-assembly";

function tool(name: string): ToolDefinition {
  return { name } as ToolDefinition;
}

function toolInfo(name: string) {
  return {
    name,
    description: "",
    parameters: {},
    promptGuidelines: [],
  } as unknown as ReturnType<
    Parameters<typeof enableDefaultBrowserTools>[0]["getAllTools"]
  >[number];
}

describe("agent tool assembly", () => {
  it("includes subagent/workflow tools by default before MCP tools", () => {
    const delegate = tool("delegate_subagents");
    const dynamicWorkflow = tool("run_dynamic_workflow");
    const workflowScript = tool("run_workflow_script");
    const mcp = tool("mcp__server__tool");

    expect(
      buildAgentCustomTools({
        delegateSubagentsTool: delegate,
        dynamicWorkflowTool: dynamicWorkflow,
        workflowScriptTool: workflowScript,
        mcpTools: [mcp],
      })
    ).toEqual([delegate, dynamicWorkflow, workflowScript, mcp]);
  });

  it("omits subagent/workflow tools when subagents are disabled", () => {
    const mcp = tool("mcp__server__tool");

    expect(
      buildAgentCustomTools({
        enableSubagents: false,
        delegateSubagentsTool: tool("delegate_subagents"),
        dynamicWorkflowTool: tool("run_dynamic_workflow"),
        workflowScriptTool: tool("run_workflow_script"),
        mcpTools: [mcp],
      })
    ).toEqual([mcp]);
  });

  it("returns undefined custom tools for an empty tool list", () => {
    expect(customToolsForSession([])).toBeUndefined();
    expect(customToolsForSession([tool("x")])).toHaveLength(1);
  });

  it("loads MCP tools with the default agent policy envelope", async () => {
    const loaded = [tool("mcp__fs__read")];
    const requestApproval = vi.fn();
    const loader = vi.fn(async (opts) => {
      expect(opts.allowedMcpServers).toEqual(["fs"]);
      expect(opts.rules).toEqual([]);
      expect(opts.requestApproval).toBe(requestApproval);
      expect(opts.onAudit).toBeTypeOf("function");
      return loaded;
    });

    await expect(
      loadAgentMcpTools(
        {
          allowedMcpServers: ["fs"],
          requestApproval,
        },
        loader
      )
    ).resolves.toBe(loaded);
  });

  it("treats MCP loading failure as no tools", async () => {
    await expect(
      loadAgentMcpTools({}, async () => {
        throw new Error("mcp registry unavailable");
      })
    ).resolves.toEqual([]);
  });

  it("enables available default browser tools without dropping active tools", () => {
    let active = ["bash"];
    const setActiveToolsByName = vi.fn((names: string[]) => {
      active = names;
    });
    const changed = enableDefaultBrowserTools({
      getAllTools: () => [
        toolInfo("bash"),
        toolInfo("browser_open"),
        toolInfo("browser_verify"),
      ],
      getActiveToolNames: () => active,
      setActiveToolsByName,
    });

    expect(changed).toBe(true);
    expect(setActiveToolsByName).toHaveBeenCalledWith([
      "bash",
      "browser_open",
      "browser_verify",
    ]);
  });

  it("does not update active tools when browser defaults are already active", () => {
    const setActiveToolsByName = vi.fn();
    const changed = enableDefaultBrowserTools({
      getAllTools: () => [toolInfo("browser_open")],
      getActiveToolNames: () => ["browser_open"],
      setActiveToolsByName,
    });

    expect(changed).toBe(false);
    expect(setActiveToolsByName).not.toHaveBeenCalled();
  });
});
