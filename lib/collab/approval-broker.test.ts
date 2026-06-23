import { describe, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "./types";
import {
  createApprovalResolvedEvent,
  inferApprovalResolvedBy,
  runApprovalRequest,
  type ApprovalBrokerEvent,
} from "./approval-broker";

function approvalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "agent-1:tool-1",
    agentId: "agent-1",
    toolCallId: "tool-1",
    toolName: "shell",
    input: { command: "rm -rf tmp" },
    reason: "manual",
    ruleId: "dangerous-command",
    defaultDecision: "deny",
    createdAt: 1,
    ...overrides,
  };
}

describe("approval broker", () => {
  it("infers timeout only when the default decision resolves without a deny reason", () => {
    const request = approvalRequest({ defaultDecision: "deny" });

    expect(inferApprovalResolvedBy(request, { decision: "deny" })).toBe(
      "timeout"
    );
    expect(
      inferApprovalResolvedBy(request, {
        decision: "deny",
        denyReason: "User denied",
      })
    ).toBe("user");
    expect(inferApprovalResolvedBy(request, { decision: "allow" })).toBe(
      "user"
    );
  });

  it("builds the resolved event from the request and response", () => {
    expect(
      createApprovalResolvedEvent(
        approvalRequest({ id: "agent-1:abc", toolCallId: "abc" }),
        { decision: "deny", denyReason: "Nope" },
        "user"
      )
    ).toEqual({
      type: "approval_resolved",
      id: "agent-1:abc",
      toolCallId: "abc",
      decision: "deny",
      resolvedBy: "user",
      denyReason: "Nope",
    });
  });

  it("emits request and resolved events around pending approval registration", async () => {
    const request = approvalRequest();
    const events: ApprovalBrokerEvent[] = [];
    const registerPendingApproval = vi.fn(async () => ({ decision: "allow" as const }));

    const response = await runApprovalRequest({
      request,
      registerPendingApproval,
      pushEvent: (event) => events.push(event),
    });

    expect(response).toEqual({ decision: "allow" });
    expect(registerPendingApproval).toHaveBeenCalledWith(request);
    expect(events).toEqual([
      { type: "approval_request", request },
      {
        type: "approval_resolved",
        id: request.id,
        toolCallId: request.toolCallId,
        decision: "allow",
        resolvedBy: "user",
        denyReason: undefined,
      },
    ]);
  });

  it("can map timeout responses before emitting the resolved event", async () => {
    const request = approvalRequest({ defaultDecision: "deny" });
    const events: ApprovalBrokerEvent[] = [];

    const response = await runApprovalRequest({
      request,
      registerPendingApproval: async () => ({ decision: "deny" }),
      pushEvent: (event) => events.push(event),
      mapResponse: ({ response: raw, resolvedBy }) =>
        resolvedBy === "timeout" && raw.decision === "deny"
          ? { ...raw, denyReason: "Timed out" }
          : raw,
    });

    expect(response).toEqual({ decision: "deny", denyReason: "Timed out" });
    expect(events.at(-1)).toMatchObject({
      type: "approval_resolved",
      decision: "deny",
      resolvedBy: "timeout",
      denyReason: "Timed out",
    });
  });
});
