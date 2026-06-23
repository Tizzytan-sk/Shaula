import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("playwright", () => ({
  chromium: {
    launch: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        locator: () => ({
          first() {
            return this;
          },
          textContent: async () => "Shaula Dogfood Fixture",
          isVisible: async () => true,
        }),
      }),
      close: async () => undefined,
    }),
  },
}));

let parseArgs;
let PROVIDER_DOGFOOD_CASES;
let PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES;
let isProviderDogfoodToolDisabled;
let isProviderDogfoodReportSuccessful;
let redactSecrets;
let renderMarkdownReport;
let runProviderDogfood;
let selectCases;

beforeAll(async () => {
  const dogfood = await import("./provider-dogfood.mjs");
  parseArgs = dogfood.parseArgs;
  PROVIDER_DOGFOOD_CASES = dogfood.PROVIDER_DOGFOOD_CASES;
  PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES =
    dogfood.PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES;
  isProviderDogfoodToolDisabled = dogfood.isProviderDogfoodToolDisabled;
  isProviderDogfoodReportSuccessful = dogfood.isProviderDogfoodReportSuccessful;
  redactSecrets = dogfood.redactSecrets;
  renderMarkdownReport = dogfood.renderMarkdownReport;
  runProviderDogfood = dogfood.runProviderDogfood;
  selectCases = dogfood.selectCases;
});

describe("provider dogfood runner", () => {
  it("defines the required provider-backed dogfood cases", () => {
    expect(PROVIDER_DOGFOOD_CASES.map((item) => item.id)).toEqual([
      "coding-diff-success",
      "verifier-rejection-recovery",
      "needs-user-pause",
      "blocked-pause",
      "browser-observation",
    ]);
    expect(
      PROVIDER_DOGFOOD_CASES.every((item) => item.expectedEvidence.length > 0)
    ).toBe(true);
  });

  it("selects explicit cases and rejects unknown ones", () => {
    expect(selectCases(["blocked-pause"]).map((item) => item.id)).toEqual([
      "blocked-pause",
    ]);
    expect(() => selectCases(["missing-case"])).toThrow(/Unknown dogfood case/);
  });

  it("keeps current and future orchestration tools disabled during provider dogfood", () => {
    const regularCase = { id: "coding-diff-success", expectedEvidence: ["diff"] };
    const browserCase = {
      id: "browser-observation",
      expectedEvidence: ["browser_observation"],
    };
    const blockedCase = {
      id: "blocked-pause",
      expectedEvidence: ["blocker_log"],
    };

    expect(PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES).toEqual([
      "delegate_subagents",
      "plan_subagents",
      "run_dynamic_workflow",
      "run_workflow_",
      "workflow_",
      "subagent_",
      "retry_subagent_",
      "continue_subagent_",
      "open_child_subagent",
    ]);
    expect(
      [
        "delegate_subagents",
        "plan_subagents",
        "run_dynamic_workflow",
        "run_workflow_script",
        "run_workflow_template",
        "run_workflow_template:team-readonly-review",
        "workflow_resume",
        "workflow_team_plan",
        "subagent_retry",
        "retry_subagent_task",
        "continue_subagent_batch",
        "open_child_subagent",
      ].every((name) => isProviderDogfoodToolDisabled(name, regularCase))
    ).toBe(true);
    expect(isProviderDogfoodToolDisabled("browser_open", regularCase)).toBe(true);
    expect(isProviderDogfoodToolDisabled("browser_open", browserCase)).toBe(false);
    expect(isProviderDogfoodToolDisabled("read_file", regularCase)).toBe(false);
    expect(isProviderDogfoodToolDisabled("read_file", blockedCase)).toBe(true);
    expect(isProviderDogfoodToolDisabled("goal_update", blockedCase)).toBe(false);
  });

  it("parses CLI arguments without reading secrets", () => {
    expect(
      parseArgs([
        "--base-url",
        "http://127.0.0.1:3051",
        "--provider",
        "zhipu",
        "--model",
        "glm-5.1",
        "--case",
        "blocked-pause,browser-observation",
        "--dry-run",
      ])
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:3051",
      provider: "zhipu",
      model: "glm-5.1",
      cases: ["blocked-pause", "browser-observation"],
      dryRun: true,
    });
  });

  it("redacts API-key-like values from reports", () => {
    const raw = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb";

    expect(redactSecrets(raw)).toBe("[redacted]");
    expect(
      renderMarkdownReport({
        generatedAt: "2026-06-15T00:00:00.000Z",
        provider: "zhipu",
        model: "glm-5.1",
        baseUrl: "http://127.0.0.1:3000",
        records: [
          {
            id: "blocked-pause",
            title: "Blocked pause",
            agentId: "agent-1",
            sessionFile: "none",
            expectedProfile: "workflow.default",
            expectedEvidence: ["blocker_log"],
            expectedFinalState: "blocked",
            runnerActions: ["dry_run"],
            evidence: [
              {
                kind: "log",
                title: raw,
                trustLevel: "textual_log",
                metadata: { token: raw },
              },
            ],
            final: {
              goalStatus: "blocked",
              evaluationStatus: "passed",
              evaluationScore: 1,
              failedCriteria: [],
              closureVerdict: "blocked",
              openActionCount: 0,
            },
            notes: raw,
          },
        ],
      })
    ).not.toContain(raw);
  });

  it("can render a dry-run report for all cases", async () => {
    const report = await runProviderDogfood({
      ...parseArgs(["--dry-run"]),
      cases: [],
    });
    const markdown = renderMarkdownReport(report);

    expect(report.records).toHaveLength(5);
    expect(markdown).toContain("Shaula Provider Dogfood Run");
    expect(markdown).toContain("coding-diff-success");
    expect(markdown).toContain("browser-observation");
  });

  it("classifies provider dogfood reports by expected case final states", () => {
    const baseRecord = {
      title: "case",
      agentId: "agent-1",
      sessionFile: "session.jsonl",
      expectedProfile: "profile",
      expectedEvidence: [],
      expectedFinalState: "",
      runnerActions: [],
      evidence: [],
      intermediateEvaluations: { rejectedCount: 0, acceptedCount: 0, evaluations: [] },
      final: {
        goalStatus: "complete",
        evaluationStatus: "passed",
        evaluationScore: 1,
        failedCriteria: [],
        closureVerdict: null,
        openActionCount: 0,
      },
      notes: "",
    };
    const codingEvidence = [
      {
        id: "diff-proof",
        kind: "progress_artifact",
        title: "Diff artifact",
        trustLevel: "artifact_reference",
        metadata: { kind: "diff" },
      },
      {
        id: "test-proof",
        kind: "verification_result",
        title: "Verification passed: npm test",
        trustLevel: "deterministic_check",
        metadata: { verificationKind: "test", status: "passed" },
      },
    ];
    const researchEvidence = [
      {
        id: "source_note",
        kind: "progress_artifact",
        title: "Package metadata source",
        trustLevel: "artifact_reference",
        metadata: { kind: "file" },
      },
      {
        id: "analysis_artifact",
        kind: "progress_artifact",
        title: "Package analysis artifact",
        trustLevel: "artifact_reference",
        metadata: { kind: "file" },
      },
    ];
    const blockerEvidence = [
      {
        id: "blocker-log",
        kind: "progress_artifact",
        title: "Blocker log",
        trustLevel: "agent_reported",
        textPreview: "Missing SHAULA_DOGFOOD_MISSING_TOKEN prevents progress.",
        metadata: { kind: "log" },
      },
    ];

    expect(
      isProviderDogfoodReportSuccessful({
        records: [
          { ...baseRecord, id: "coding-diff-success", evidence: codingEvidence },
          {
            ...baseRecord,
            id: "verifier-rejection-recovery",
            evidence: researchEvidence,
            intermediateEvaluations: { rejectedCount: 1, acceptedCount: 1, evaluations: [] },
          },
          {
            ...baseRecord,
            id: "needs-user-pause",
            final: { ...baseRecord.final, goalStatus: "paused", evaluationStatus: "unknown" },
          },
          {
            ...baseRecord,
            id: "blocked-pause",
            evidence: blockerEvidence,
            final: { ...baseRecord.final, goalStatus: "blocked", evaluationStatus: "unknown" },
          },
          {
            ...baseRecord,
            id: "browser-observation",
            evidence: [
              {
                id: "browser-proof",
                kind: "browser_snapshot",
                trustLevel: "host_observed",
                metadata: { outcome: "passed" },
              },
            ],
          },
        ],
      })
    ).toBe(true);

    expect(
      isProviderDogfoodReportSuccessful({
        records: [
          {
            ...baseRecord,
            id: "coding-diff-success",
            final: { ...baseRecord.final, goalStatus: "active", evaluationStatus: "failed" },
          },
        ],
      })
    ).toBe(false);

    expect(
      isProviderDogfoodReportSuccessful({
        records: [
          {
            ...baseRecord,
            id: "verifier-rejection-recovery",
            runnerActions: ["runner_goal_update_complete:accepted"],
            evidence: researchEvidence,
            intermediateEvaluations: { rejectedCount: 1, acceptedCount: 1, evaluations: [] },
          },
        ],
      })
    ).toBe(false);

    expect(
      isProviderDogfoodReportSuccessful({
        records: [
          {
            ...baseRecord,
            id: "blocked-pause",
            evidence: [
              {
                id: "blocker-log",
                kind: "progress_artifact",
                title: "Blocker log",
                trustLevel: "agent_reported",
                textPreview: "A blocker exists but the required credential is not named.",
                metadata: { kind: "log" },
              },
            ],
            final: { ...baseRecord.final, goalStatus: "blocked", evaluationStatus: "unknown" },
          },
        ],
      })
    ).toBe(false);

    expect(
      isProviderDogfoodReportSuccessful({
        records: [
          {
            ...baseRecord,
            id: "blocked-pause",
            final: { ...baseRecord.final, goalStatus: "blocked", evaluationStatus: "unknown" },
          },
        ],
      })
    ).toBe(false);
  });

  it("fails preflight before auth test when provider auth is missing", async () => {
    const state = {
      authTestRequests: 0,
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const send = (status, data) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };

      if (request.method === "GET" && url.pathname === "/api/providers") {
        send(200, {
          providers: [
            {
              provider: "zhipu",
              displayName: "Zhipu",
              hasAuth: false,
              models: [{ id: "glm-5.1", name: "GLM-5.1" }],
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/test") {
        state.authTestRequests += 1;
        send(200, { ok: true });
        return;
      }

      send(404, { error: "not found" });
    });

    await listen(server);
    try {
      const { port } = server.address();

      await expect(
        runProviderDogfood({
          ...parseArgs(["--case", "blocked-pause"]),
          baseUrl: `http://127.0.0.1:${port}`,
          timeoutMs: 10_000,
          requestTimeoutMs: 5_000,
          pollMs: 10,
        })
      ).rejects.toThrow(/provider "zhipu" is registered but has no configured auth/);
      expect(state.authTestRequests).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("applies a stricter tool policy for blocked-pause cases", async () => {
    const state = {
      toolUpdates: [],
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readJson(request);
      const send = (data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };

      if (request.method === "GET" && url.pathname === "/api/providers") {
        send({
          providers: [
            {
              provider: "zhipu",
              displayName: "Zhipu",
              hasAuth: true,
              models: [{ id: "glm-5.1", name: "GLM-5.1" }],
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/test") {
        send({ ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agent/new") {
        send({ id: "agent-blocked", sessionFile: "C:/tmp/session.jsonl" });
        return;
      }
      if (url.pathname === "/api/agent/agent-blocked") {
        if (request.method === "GET" && url.searchParams.get("action") === "get_tools") {
          send({
            tools: [
              { name: "delegate_subagents" },
              { name: "plan_subagents" },
              { name: "run_dynamic_workflow" },
              { name: "run_workflow_script" },
              { name: "run_workflow_template" },
              { name: "browser_open" },
              { name: "browser_verify" },
              { name: "bash" },
              { name: "read_file" },
              { name: "write_file" },
              { name: "apply_patch" },
              { name: "goal_update" },
              { name: "progress_update" },
            ],
            active: [
              "delegate_subagents",
              "plan_subagents",
              "run_dynamic_workflow",
              "run_workflow_script",
              "run_workflow_template",
              "browser_open",
              "browser_verify",
              "bash",
              "read_file",
              "write_file",
              "apply_patch",
              "goal_update",
              "progress_update",
            ],
          });
          return;
        }
        if (body.type === "set_tools") {
          state.toolUpdates.push(body.tools);
          send({ ok: true });
          return;
        }
        if (body.type === "goal_set") {
          send({
            ok: true,
            contract: {
              rubricProfile: body.rubricProfile,
              requiredEvidence: body.requiredEvidence,
            },
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "goal_timeline") {
          send({
            goal: {
              status: "blocked",
              blockedReason: "SHAULA_DOGFOOD_MISSING_TOKEN is required.",
              lastEvaluation: null,
            },
            ledgerEvidence: [
              {
                id: "blocker-log",
                kind: "progress_artifact",
                title: "Blocker log",
                trustLevel: "agent_reported",
                textPreview: "SHAULA_DOGFOOD_MISSING_TOKEN is required.",
                metadata: { kind: "log" },
              },
            ],
            actions: [],
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "runtime_events") {
          send({ events: [] });
          return;
        }
        if (request.method === "GET") {
          send({ ok: true, isStreaming: false, pendingClarificationCount: 0 });
          return;
        }
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });

    await listen(server);
    try {
      const { port } = server.address();
      const report = await runProviderDogfood({
        ...parseArgs(["--case", "blocked-pause"]),
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 10_000,
        requestTimeoutMs: 5_000,
        pollMs: 10,
      });
      const [record] = report.records;

      expect(record.runnerActions).toContain("tool_policy:disabled:11");
      expect(state.toolUpdates).toEqual([["goal_update", "progress_update"]]);
      expect(isProviderDogfoodReportSuccessful(report)).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("does not re-enable tools when the service reports an empty active tool list", async () => {
    const state = {
      setToolsRequests: 0,
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readJson(request);
      const send = (data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };

      if (request.method === "GET" && url.pathname === "/api/providers") {
        send({
          providers: [
            {
              provider: "zhipu",
              displayName: "Zhipu",
              hasAuth: true,
              models: [{ id: "glm-5.1", name: "GLM-5.1" }],
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/test") {
        send({ ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agent/new") {
        send({ id: "agent-empty-active", sessionFile: "C:/tmp/session.jsonl" });
        return;
      }
      if (url.pathname === "/api/agent/agent-empty-active") {
        if (request.method === "GET" && url.searchParams.get("action") === "get_tools") {
          send({
            tools: [{ name: "delegate_subagents" }, { name: "goal_update" }],
            active: [],
          });
          return;
        }
        if (body.type === "set_tools") {
          state.setToolsRequests += 1;
          send({ ok: true });
          return;
        }
        if (body.type === "goal_set") {
          send({
            ok: true,
            contract: {
              rubricProfile: body.rubricProfile,
              requiredEvidence: body.requiredEvidence,
            },
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "goal_timeline") {
          send({
            goal: {
              status: "blocked",
              blockedReason: "SHAULA_DOGFOOD_MISSING_TOKEN is required.",
              lastEvaluation: null,
            },
            ledgerEvidence: [
              {
                id: "blocker-log",
                kind: "progress_artifact",
                title: "Blocker log",
                trustLevel: "agent_reported",
                textPreview: "SHAULA_DOGFOOD_MISSING_TOKEN is required.",
                metadata: { kind: "log" },
              },
            ],
            actions: [],
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "runtime_events") {
          send({ events: [] });
          return;
        }
        if (request.method === "GET") {
          send({ ok: true, isStreaming: false, pendingClarificationCount: 0 });
          return;
        }
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });

    await listen(server);
    try {
      const { port } = server.address();
      const report = await runProviderDogfood({
        ...parseArgs(["--case", "blocked-pause"]),
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 10_000,
        requestTimeoutMs: 5_000,
        pollMs: 10,
      });
      const [record] = report.records;

      expect(record.runnerActions).toContain("tool_policy:skipped_no_tools");
      expect(state.setToolsRequests).toBe(0);
      expect(isProviderDogfoodReportSuccessful(report)).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("returns a non-zero CLI exit code when the final report is red", async () => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readJson(request);
      const send = (data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };

      if (request.method === "GET" && url.pathname === "/api/providers") {
        send({
          providers: [
            {
              provider: "zhipu",
              displayName: "Zhipu",
              hasAuth: true,
              models: [{ id: "glm-5.1", name: "GLM-5.1" }],
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/test") {
        send({ ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agent/new") {
        send({ id: "agent-red", sessionFile: "C:/tmp/session.jsonl" });
        return;
      }
      if (url.pathname === "/api/agent/agent-red") {
        if (request.method === "GET" && url.searchParams.get("action") === "get_tools") {
          send({ tools: [], active: [] });
          return;
        }
        if (body.type === "goal_set") {
          send({ ok: true, contract: { requiredEvidence: body.requiredEvidence } });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "goal_timeline") {
          send({
            goal: { status: "blocked", blockedReason: "missing evidence", lastEvaluation: null },
            ledgerEvidence: [],
            actions: [],
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "runtime_events") {
          send({ events: [] });
          return;
        }
        if (request.method === "GET") {
          send({ ok: true, isStreaming: false, pendingClarificationCount: 0 });
          return;
        }
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });

    await listen(server);
    try {
      const { port } = server.address();
      const result = await runCli([
        "--case",
        "blocked-pause",
        "--base-url",
        `http://127.0.0.1:${port}`,
        "--timeout-ms",
        "10000",
        "--request-timeout-ms",
        "5000",
        "--poll-ms",
        "10",
      ]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Provider dogfood failed");
    } finally {
      await close(server);
    }
  });

  it("waits for verifier-rejection recovery to reach a terminal pass", async () => {
    const state = {
      timelineCalls: 0,
    };
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const body = await readJson(request);
      const send = (data) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(data));
      };
      const evidence = [
        {
          id: "progress-artifact:agent-verifier:source_note",
          kind: "progress_artifact",
          title: "source_note",
          trustLevel: "artifact_reference",
          metadata: { kind: "file" },
        },
        {
          id: "progress-artifact:agent-verifier:analysis_artifact",
          kind: "progress_artifact",
          title: "analysis_artifact",
          trustLevel: "artifact_reference",
          metadata: { kind: "file" },
        },
      ];

      if (request.method === "GET" && url.pathname === "/api/providers") {
        send({
          providers: [
            {
              provider: "zhipu",
              displayName: "Zhipu",
              hasAuth: true,
              models: [{ id: "glm-5.1", name: "GLM-5.1" }],
            },
          ],
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/auth/test") {
        send({ ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/agent/new") {
        send({ id: "agent-verifier", sessionFile: "C:/tmp/session.jsonl" });
        return;
      }
      if (url.pathname === "/api/agent/agent-verifier") {
        if (request.method === "GET" && url.searchParams.get("action") === "get_tools") {
          send({ tools: [], active: [] });
          return;
        }
        if (body.type === "goal_set") {
          send({
            ok: true,
            contract: {
              rubricProfile: body.rubricProfile,
              requiredEvidence: body.requiredEvidence,
            },
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "goal_timeline") {
          state.timelineCalls += 1;
          const complete = state.timelineCalls >= 2;
          send({
            goal: {
              status: complete ? "complete" : "active",
              lastEvaluation: complete
                ? { status: "passed", totalScore: 1, failedCriteria: [] }
                : { status: "failed", totalScore: 0.65, failedCriteria: ["final-summary-evidence"] },
            },
            ledgerEvidence: evidence,
            actions: complete ? [] : [{ id: "fix-final-summary-evidence" }],
          });
          return;
        }
        if (request.method === "GET" && url.searchParams.get("action") === "runtime_events") {
          send({
            events: [
              { payload: { lastEvaluation: { status: "failed", totalScore: 0.65 } } },
              { payload: { lastEvaluation: { status: "passed", totalScore: 1 } } },
            ],
          });
          return;
        }
        if (request.method === "GET") {
          send({ ok: true, isStreaming: false, pendingClarificationCount: 0 });
          return;
        }
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });

    await listen(server);
    try {
      const { port } = server.address();
      const report = await runProviderDogfood({
        ...parseArgs(["--case", "verifier-rejection-recovery"]),
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 10_000,
        requestTimeoutMs: 5_000,
        pollMs: 10,
      });
      const [record] = report.records;

      expect(state.timelineCalls).toBeGreaterThanOrEqual(2);
      expect(record.runnerActions).not.toContain("runner_goal_update_complete:accepted");
      expect(record.final.goalStatus).toBe("complete");
      expect(record.final.evaluationStatus).toBe("passed");
      expect(isProviderDogfoodReportSuccessful(report)).toBe(true);
    } finally {
      await close(server);
    }
  });

  it("promotes browser-observation cases after host evidence passes", async () => {
    const state = {
      completed: false,
      evidence: [],
      runnerCompletionAttempts: 0,
      completionPayloads: [],
      toolUpdates: [],
    };
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const body = await readJson(request);
        const send = (data) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(data));
        };

        if (request.method === "GET" && url.pathname === "/api/providers") {
          send({
            providers: [
              {
                provider: "zhipu",
                displayName: "Zhipu",
                hasAuth: true,
                models: [{ id: "glm-5.1", name: "GLM-5.1" }],
              },
            ],
          });
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/auth/test") {
          send({ ok: true });
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/agent/new") {
          send({ id: "agent-browser", sessionFile: "C:/tmp/session.jsonl" });
          return;
        }
        if (url.pathname === "/api/agent/agent-browser") {
          if (request.method === "GET" && url.searchParams.get("action") === "get_tools") {
            send({
              tools: [
                { name: "delegate_subagents" },
                { name: "plan_subagents" },
                { name: "run_dynamic_workflow" },
                { name: "run_workflow_script" },
                { name: "run_workflow_template" },
                { name: "browser_open" },
                { name: "browser_verify" },
                { name: "read_file" },
              ],
              active: [
                "delegate_subagents",
                "plan_subagents",
                "run_dynamic_workflow",
                "run_workflow_script",
                "run_workflow_template",
                "browser_open",
                "browser_verify",
                "read_file",
              ],
            });
            return;
          }
          if (request.method === "GET" && url.searchParams.get("action") === "goal_timeline") {
            send({
              goal: {
                status: state.completed ? "complete" : "paused",
                lastEvaluation: state.completed
                  ? { status: "passed", totalScore: 1, failedCriteria: [] }
                  : null,
              },
              ledgerEvidence: state.evidence,
              actions: state.completed ? [] : [{ id: "awaiting-host-browser-evidence" }],
            });
            return;
          }
          if (request.method === "GET" && url.searchParams.get("action") === "runtime_events") {
            send({
              events: state.completed
                ? [{ payload: { lastEvaluation: { status: "passed", totalScore: 1 } } }]
                : [],
            });
            return;
          }
          if (request.method === "GET") {
            send({ ok: true, isStreaming: false, pendingClarificationCount: 0 });
            return;
          }
          if (body.type === "goal_set") {
            send({
              ok: true,
              contract: {
                rubricProfile: body.rubricProfile,
                requiredEvidence: body.requiredEvidence,
              },
            });
            return;
          }
          if (body.type === "set_tools") {
            state.toolUpdates.push(body.tools);
            send({ ok: true });
            return;
          }
          if (body.type === "evidence_record_browser_observation") {
            state.evidence.push({
              id: "browser-proof",
              kind: "browser_snapshot",
              title: body.title,
              trustLevel: "host_observed",
              metadata: { outcome: body.passed ? "passed" : "failed" },
            });
            send({ ok: true, evidence: state.evidence.at(-1) });
            return;
          }
          if (body.type === "goal_run_verification") {
            send({ ok: true });
            return;
          }
          if (body.type === "goal_update" && body.status === "complete") {
            state.completed = true;
            state.runnerCompletionAttempts += 1;
            state.completionPayloads.push(body);
            send({ ok: true, accepted: true });
            return;
          }
        }

        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: error.message }));
      }
    });

    await listen(server);
    try {
      const { port } = server.address();
      const report = await runProviderDogfood({
        ...parseArgs(["--case", "browser-observation"]),
        baseUrl: `http://127.0.0.1:${port}`,
        timeoutMs: 10_000,
        requestTimeoutMs: 5_000,
        pollMs: 10,
      });
      const [record] = report.records;

      expect(state.runnerCompletionAttempts).toBe(1);
      expect(state.completionPayloads[0]).toMatchObject({
        finalSummary: expect.stringContaining("browser-observation"),
        evidenceIds: ["browser-proof"],
      });
      expect(record.runnerActions).toContain("host_browser_observation:passed");
      expect(record.runnerActions).toContain("tool_policy:disabled:5");
      expect(record.runnerActions).toContain("runner_goal_update_complete:accepted");
      expect(state.toolUpdates).toEqual([
        ["browser_open", "browser_verify", "read_file"],
      ]);
      expect(record.final.goalStatus).toBe("complete");
      expect(record.final.evaluationStatus).toBe("passed");
      expect(record.evidence).toEqual([
        expect.objectContaining({
          kind: "browser_snapshot",
          trustLevel: "host_observed",
          metadata: { outcome: "passed" },
        }),
      ]);
    } finally {
      await close(server);
    }
  });
});

function runCli(args) {
  const scriptPath = fileURLToPath(new URL("./provider-dogfood.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("provider dogfood CLI test timed out"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function readJson(request) {
  if (request.method === "GET") return {};
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
