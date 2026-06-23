import { describe, expect, it, vi } from "vitest";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { createCollabExtension } from "./extension";
import { DEFAULT_RULES } from "./rules";
import type { ApprovalRule } from "./types";

function makeEvent(command: string): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "tc-test",
    toolName: "bash",
    input: { command },
  } as ToolCallEvent;
}

function registerHandler(rules: ApprovalRule[], opts?: {
  hasRemember?: (ruleId: string) => boolean;
  onApprovalNeeded?: ReturnType<typeof vi.fn>;
}) {
  let handler:
    | ((event: ToolCallEvent) => Promise<{ block: boolean; reason?: string } | void>)
    | undefined;
  const onApprovalNeeded =
    opts?.onApprovalNeeded ??
    vi.fn(async () => ({ decision: "allow" as const }));
  const factory = createCollabExtension({
    getRules: () => rules,
    getAgentId: () => "agent-1",
    hasRemember: opts?.hasRemember,
    onApprovalNeeded,
  });
  factory({
    on: (name: string, cb: typeof handler) => {
      if (name === "tool_call") handler = cb;
    },
  } as never);
  if (!handler) throw new Error("tool_call handler not registered");
  return { handler, onApprovalNeeded };
}

describe("createCollabExtension", () => {
  it("does not silently allow remembered high-risk rules", async () => {
    const { handler, onApprovalNeeded } = registerHandler(DEFAULT_RULES, {
      hasRemember: () => true,
    });

    const result = await handler(makeEvent("git reset --hard HEAD~1"));

    expect(result).toBeUndefined();
    expect(onApprovalNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleId: "dangerous-shell-destructive",
        allowRemember: false,
        defaultDecision: "deny",
      })
    );
  });

  it("blocks high-risk commands if approval handling throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { handler } = registerHandler(DEFAULT_RULES, {
      onApprovalNeeded: vi.fn(async () => {
        throw new Error("approval channel unavailable");
      }),
    });

    try {
      const result = await handler(makeEvent("git push origin main"));

      expect(result).toMatchObject({
        block: true,
        reason: expect.stringContaining("public or external"),
      });
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
