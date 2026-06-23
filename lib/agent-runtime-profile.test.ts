import { describe, expect, it } from "vitest";
import {
  describeAgentRuntime,
  type AgentRecord,
} from "./agent-registry";

describe("describeAgentRuntime", () => {
  it("labels SDK-backed agents as full structured runtime", () => {
    expect(describeAgentRuntime({} as AgentRecord)).toMatchObject({
      kind: "sdk_agent",
      structuredTools: true,
      structuredProgress: true,
      structuredEvidence: true,
      verifier: "full",
    });
  });

  it("labels local-coding-assistant as external text-only runner", () => {
    expect(
      describeAgentRuntime({
        external: {
          kind: "local-coding-assistant",
          child: null,
          emittedText: "",
        },
      } as AgentRecord)
    ).toMatchObject({
      kind: "external_text_runner",
      structuredTools: false,
      structuredProgress: false,
      structuredEvidence: false,
      verifier: "host_only",
    });
  });
});
