import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";
import {
  parseArgs,
  PROVIDER_DOGFOOD_CASES,
  redactSecrets,
  renderMarkdownReport,
  runProviderDogfood,
  selectCases,
} from "./provider-dogfood.mjs";

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

  it("promotes browser-observation cases after host evidence passes", async () => {
    const state = {
      completed: false,
      evidence: [],
      runnerCompletionAttempts: 0,
    };
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const body = await readJson(request);
        const send = (data) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(data));
        };

        if (request.method === "POST" && url.pathname === "/api/auth/test") {
          send({ ok: true });
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/agent/new") {
          send({ id: "agent-browser", sessionFile: "C:/tmp/session.jsonl" });
          return;
        }
        if (url.pathname === "/api/agent/agent-browser") {
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
          if (body.type === "evidence_record_browser_observation") {
            state.evidence.push({
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
      expect(record.runnerActions).toContain("host_browser_observation:passed");
      expect(record.runnerActions).toContain("runner_goal_update_complete:accepted");
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
