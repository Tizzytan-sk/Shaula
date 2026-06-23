import { test, expect, pushSseEvent } from "./fixtures";

async function activeAgentId(page: import("@playwright/test").Page): Promise<string> {
  const handle = await page.waitForFunction(() => {
    const w = window as unknown as {
      __mockEventSources: Array<{ url: string; readyState: number }>;
    };
    const open = [...w.__mockEventSources]
      .reverse()
      .find((h) => h.readyState === 1);
    if (!open) return null;
    const m = open.url.match(/\/api\/agent\/([^/]+)\/events/);
    return m ? m[1] : null;
  });
  return (await handle.jsonValue()) as string;
}

test("workbench: Overview 作为右侧 root 并支持折叠分组", async ({
  bootedPage: page,
}) => {
  await expect(page.getByRole("button", { name: "展开文件夹" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );

  await page.getByLabel("Workbench 面板").click();

  await expect(page.getByTestId("workbench-overview")).toBeVisible();
  await expect(page.getByTestId("workbench-task-cockpit")).toBeVisible();
  await expect(page.getByTestId("workbench-task-cockpit")).toContainText("当前任务");
  await expect(page.getByTestId("workbench-section-progress")).toBeVisible();
  await expect(page.getByTestId("workbench-section-outputs")).toBeVisible();
  await expect(page.getByTestId("workbench-section-files")).toBeVisible();
  await expect(page.getByTestId("workbench-section-context")).toBeVisible();
  await expect(page.getByTestId("workbench-section-browser")).toBeVisible();
  await expect(page.getByTestId("workbench-section-files-toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.getByTestId("workbench-section-context-toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.getByTestId("workbench-section-progress-toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.getByTestId("workbench-section-outputs-toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(page.getByTestId("workbench-section-browser-toggle")).toHaveAttribute(
    "aria-expanded",
    "false"
  );

  await page.getByTestId("workbench-section-outputs-toggle").click();
  await expect(page.getByText("0 个产物")).toBeVisible();
  await page.getByTestId("workbench-section-outputs-toggle").click();
  await expect(page.getByText("0 个产物")).toBeHidden();

  await page.getByTestId("workbench-section-context-action").click();
  await expect(page.getByTestId("workbench-context-detail")).toBeVisible();
  await expect(page.getByText("sessionId")).toBeVisible();

  await page.getByTestId("workbench-tab-home").click();
  await expect(page.getByTestId("workbench-overview")).toBeVisible();

  await page.getByTestId("workbench-section-progress-action").click();
  await expect(page.getByTestId("workbench-progress-detail")).toBeVisible();
  await expect(page.getByText("暂无进度")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByTestId("workbench-overview")).toBeVisible();
});

test("workbench: 运行中的任务显示任务契约、主产物和终止入口", async ({
  bootedPage: page,
}) => {
  await page.route("**/api/agent/*", async (route) => {
    const url = route.request().url();
    if (!url.includes("action=goal_timeline")) {
      return route.fallback();
    }
    const now = Date.now();
    return route.fulfill({
      json: {
        goal: {
          objective: "run a long task",
          status: "active",
          turns: 1,
          blockedStreak: 0,
          createdAt: now,
          updatedAt: now,
          lastEvaluation: {
            id: "eval-1",
            rubricId: "goal-completion",
            evaluatorVersion: "test",
            subject: {},
            status: "passed",
            totalScore: 1,
            targetScore: 0.9,
            dimensionScores: [],
            criteria: [
              {
                criterionId: "goal-evidence",
                status: "pass",
                score: 1,
                reason: "Required evidence is present.",
                evidenceIds: ["diff-proof", "test-proof"],
              },
            ],
            hardFails: [],
            failedCriteria: [],
            triggeredPitfalls: [],
            missingEvidence: [],
            minScoreFailures: [],
            recommendation: "pass",
            nextAction: "Finalize with cited evidence.",
            weightSnapshot: {
              profileId: "goal.completion",
              targetScore: 0.9,
              dimensions: [],
              importanceWeights: {},
              exitPolicy: {},
            },
            createdAt: now,
          },
          lastClosure: {
            id: "closure-1",
            verdict: "ready_to_finalize",
            reason: "Required checks passed.",
            missingEvidence: [],
            openActions: [],
            nextAction: "Summarize and call goal_update complete.",
            evaluationStatus: "passed",
            evaluationScore: 1,
            evaluationTargetScore: 0.9,
            createdAt: now,
          },
        },
        contract: {
          id: "contract-e2e",
          objective: "run a long task",
          scope: ["Only edit `app/feature.ts`."],
          nonGoals: [],
          acceptanceCriteria: [],
          requiredEvidence: ["diff", "test_result"],
          mainArtifact: {
            kind: "file",
            label: "app/feature.ts",
            href: "app/feature.ts",
            source: "explicit",
          },
          rubricProfile: "coding.default",
          allowedCapabilities: ["read_workspace", "edit_workspace"],
        },
        turns: [],
        evidence: [],
        ledgerEvidence: [
          {
            id: "diff-proof",
            kind: "progress_artifact",
            title: "app/feature.ts diff",
            agentId: "agent-1",
            source: { type: "progress", id: "diff-proof" },
            metadata: {
              kind: "diff",
              evidenceRequired: ["diff"],
              outcome: "passed",
            },
            createdAt: now,
          },
          {
            id: "test-proof",
            kind: "verification_result",
            title: "Verification passed: npm test",
            agentId: "agent-1",
            source: { type: "system", id: "verification-plan" },
            metadata: {
              verificationKind: "test",
              evidenceRequired: ["test_result"],
              outcome: "passed",
            },
            createdAt: now,
          },
        ],
        actions: [],
        routeDecision: null,
        lastClosure: {
          id: "closure-1",
          verdict: "ready_to_finalize",
          reason: "Required checks passed.",
          missingEvidence: [],
          openActions: [],
          nextAction: "Summarize and call goal_update complete.",
          evaluationStatus: "passed",
          evaluationScore: 1,
          evaluationTargetScore: 0.9,
          createdAt: now,
        },
      },
    });
  });

  await page.locator("textarea").first().fill("run a long task");
  await page.getByTitle("Send", { exact: true }).click();
  const agentId = await activeAgentId(page);

  await pushSseEvent(page, agentId, { type: "agent_start" }, "run-start");

  await expect(page.getByTestId("composer-stop-task")).toBeVisible();
  await page.getByLabel("Workbench 面板").click();
  await expect(page.getByTestId("workbench-task-cockpit")).toContainText("run a long task");
  await expect(page.getByTestId("workbench-goal-state")).toContainText("可收尾");
  await expect(page.getByTestId("workbench-goal-state-objective")).toContainText("run a long task");
  await expect(page.getByTestId("workbench-goal-state-artifact")).toContainText("app/feature.ts");
  await expect(page.getByTestId("workbench-goal-state-required")).toContainText("diff, test_result");
  await expect(page.getByTestId("workbench-goal-state-verified")).toContainText("2/2");
  await expect(page.getByTestId("workbench-goal-state-missing")).toContainText("0");
  await expect(page.getByTestId("workbench-task-cockpit")).toContainText("主产物");
  await expect(page.getByTestId("workbench-task-cockpit")).toContainText("待锁定");
  await expect(page.getByTestId("workbench-task-cockpit")).toContainText("diff");
  await expect(page.getByTestId("workbench-section-progress")).toContainText(
    "锁定主产物"
  );
  await expect(page.getByTestId("workbench-progress-stop")).toBeVisible();

  await page.getByTestId("workbench-progress-stop").click();
  await expect(page.getByTestId("workbench-progress-stop")).toBeHidden();
});

test("workbench: Team Plan 面板展示 team task、证据和 verifier 状态", async ({
  bootedPage: page,
}) => {
  let assistGenerated = false;
  let assistRequestCount = 0;
  const assistForceValues: boolean[] = [];
  await page.route("**/api/agent/*", async (route) => {
    const url = route.request().url();
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        type?: string;
        force?: boolean;
      };
      if (body.type === "team_synthesis_assist") {
        assistRequestCount += 1;
        assistForceValues.push(body.force === true);
        if (assistRequestCount === 1) {
          return route.fulfill({
            status: 401,
            json: {
              error:
                "当前 provider 的 API key 或 OAuth 凭证缺失、过期或被拒绝。修复凭证后再试。",
              rawError: 'No API key or OAuth token found for "openai"',
              userError: {
                code: "missing_credential",
                title: "模型凭证不可用",
                message:
                  "当前 provider 的 API key 或 OAuth 凭证缺失、过期或被拒绝。修复凭证后再试。",
                actionLabel: "去设置",
                retryable: true,
              },
            },
          });
        }
        assistGenerated = true;
        return route.fulfill({
          json: {
            ok: true,
            cached: false,
            assistance: {
              status: "accepted",
              source: "llm_assisted",
              generatedAt: Date.now(),
              headline: "Cached Team assist",
              summary: "Only cites existing team evidence.",
              itemIds: ["task:task-review-auth", "check:warning-team-tasks"],
              taskIds: ["task-review-auth"],
              evidenceIds: ["subagent-proof"],
              warnings: [],
              meta: {
                cached: false,
                model: { provider: "openai", id: "gpt-test" },
                latencyMs: 42,
                httpStatus: 200,
                tokenCount: 12,
                estimatedCost: 0.0001,
              },
            },
          },
        });
      }
      return route.fallback();
    }
    if (!url.includes("action=goal_timeline")) {
      return route.fallback();
    }
    const now = Date.now();
    return route.fulfill({
      json: {
        goal: {
          id: "goal-team-e2e",
          objective: "coordinate team review",
          status: "active",
          turns: 1,
          blockedStreak: 0,
          createdAt: now,
          updatedAt: now,
        },
        contract: {
          id: "contract-team-e2e",
          objective: "coordinate team review",
          scope: ["Review auth and verify Team evidence display."],
          nonGoals: [],
          acceptanceCriteria: [],
          requiredEvidence: ["subagent_result", "test_result"],
          mainArtifact: {
            kind: "file",
            label: "docs/team-plan.md",
            href: "docs/team-plan.md",
            source: "explicit",
          },
          rubricProfile: "coding.default",
          allowedCapabilities: ["read_workspace"],
        },
        turns: [],
        evidence: [],
        ledgerEvidence: [
          {
            id: "subagent-proof",
            kind: "subagent_result",
            title: "Subagent warning: auth boundary mismatch",
            agentId: "agent-1",
            summary: "Child reviewer found a possible auth boundary mismatch.",
            source: { type: "subagent", id: "child-auth" },
            metadata: {
              outcome: "warning",
              evidenceRequired: ["subagent_result"],
            },
            createdAt: now,
          },
          {
            id: "test-proof",
            kind: "verification_result",
            title: "Verification passed: npm test",
            agentId: "agent-1",
            source: { type: "system", id: "verification-plan" },
            metadata: {
              verificationKind: "test",
              evidenceRequired: ["test_result"],
              outcome: "passed",
            },
            createdAt: now,
          },
        ],
        actions: [],
        routeDecision: null,
        lastClosure: null,
        teamTasks: [
          {
            id: "task-review-auth",
            agentId: "agent-1",
            sessionId: null,
            goalId: "goal-team-e2e",
            batchId: "batch-1",
            title: "Review auth boundary",
            status: "warning",
            ownerType: "subagent",
            ownerId: "child-auth",
            dependsOn: [],
            contextPacketId: "packet-auth",
            contextPacket: {
              objective: "coordinate team review",
              taskTitle: "Review auth boundary",
              taskBoundary: "Read-only review of auth routes; do not edit files.",
              includeContext: [],
              excludeContext: ["full transcript"],
              relevantPaths: ["app/api/auth/route.ts"],
              writePaths: [],
              requiredEvidence: ["subagent_result"],
              outputContract: {
                format: "review",
                mustInclude: ["findings", "evidence ids"],
                mustNotDo: ["edit files"],
              },
            },
            writePaths: [],
            requiredEvidence: ["subagent_result"],
            evidenceIds: ["subagent-proof"],
            artifactRefs: [],
            blockedBy: "Needs parent synthesis before completion.",
            source: { type: "subagent", id: "child-auth", parentId: "batch-1" },
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "task-verify-tests",
            agentId: "agent-1",
            sessionId: null,
            goalId: "goal-team-e2e",
            workflowId: "wf-1",
            title: "Verify Team evidence path",
            status: "completed",
            ownerType: "workflow",
            ownerId: "wf-1",
            dependsOn: ["task-review-auth"],
            contextPacketId: "packet-verify",
            contextPacket: {
              objective: "coordinate team review",
              taskTitle: "Verify Team evidence path",
              taskBoundary: "Run deterministic checks for Team evidence rendering.",
              includeContext: [],
              relevantPaths: ["app/components/WorkbenchSidebar.tsx"],
              writePaths: ["app/components/WorkbenchSidebar.tsx"],
              requiredEvidence: ["test_result"],
              outputContract: {
                format: "summary",
                mustInclude: ["test result"],
                mustNotDo: ["claim browser evidence"],
              },
            },
            writePaths: ["app/components/WorkbenchSidebar.tsx"],
            requiredEvidence: ["test_result"],
            evidenceIds: ["test-proof"],
            artifactRefs: ["workflow-artifact:wf-1"],
            source: { type: "workflow", id: "wf-1" },
            createdAt: now,
            updatedAt: now + 1,
          },
        ],
        teamTaskVerification: {
          status: "warning",
          verifiedAt: now,
          summary: "5 passed, 1 warning, 0 failed.",
          passed: 5,
          warnings: 1,
          failed: 0,
          missingEvidence: [],
          matchedEvidenceIds: ["subagent-proof", "test-proof"],
          checks: [
            {
              id: "warning-team-tasks",
              status: "warning",
              message: "1 team task carries warnings: task-review-auth.",
            },
            {
              id: "team-task-evidence-coverage",
              status: "passed",
              message: "Linked team task evidence covers declared requirements.",
            },
          ],
        },
        teamTaskSynthesis: {
          status: "warning",
          generatedAt: now,
          headline: "1 conclusions; 2 warning(s) need synthesis.",
          domains: ["security/auth", "frontend"],
          evidenceIds: ["subagent-proof", "test-proof"],
          taskIds: ["task-review-auth", "task-verify-tests"],
          items: [
            {
              id: "task:task-review-auth",
              kind: "risk",
              severity: "warning",
              title: "Review auth boundary",
              detail: "Needs parent synthesis before completion.",
              domain: "security/auth",
              taskIds: ["task-review-auth"],
              evidenceIds: ["subagent-proof"],
            },
            {
              id: "task:task-verify-tests",
              kind: "conclusion",
              severity: "info",
              title: "Verify Team evidence path",
              detail: "Verification passed: npm test",
              domain: "frontend",
              taskIds: ["task-verify-tests"],
              evidenceIds: ["test-proof"],
            },
            {
              id: "check:warning-team-tasks",
              kind: "next_action",
              severity: "warning",
              title: "warning-team-tasks",
              detail: "1 team task carries warnings: task-review-auth.",
              taskIds: [],
              evidenceIds: [],
            },
          ],
          ...(assistGenerated
            ? {
                assistance: {
                  status: "accepted",
                  source: "llm_assisted",
                  generatedAt: now + 2,
                  headline: "Cached Team assist",
                  summary: "Only cites existing team evidence.",
                  itemIds: ["task:task-review-auth", "check:warning-team-tasks"],
                  taskIds: ["task-review-auth"],
                  evidenceIds: ["subagent-proof"],
                  warnings: [],
                  meta: {
                    cached: true,
                    model: { provider: "openai", id: "gpt-test" },
                    latencyMs: 42,
                    httpStatus: 200,
                    tokenCount: 12,
                    estimatedCost: 0.0001,
                  },
                },
              }
            : {}),
        },
      },
    });
  });

  await page.locator("textarea").first().fill("coordinate team review");
  await page.getByTitle("Send", { exact: true }).click();
  await activeAgentId(page);

  await page.getByLabel("Workbench 面板").click();
  await expect(page.getByTestId("workbench-team-tasks")).toContainText(
    "verification warning"
  );
  await expect(page.getByTestId("workbench-launch-Team")).toBeVisible();
  await page.getByTestId("workbench-launch-Team").click();

  await expect(page.getByTestId("workbench-team-plan")).toBeVisible();
  await expect(page.getByTestId("workbench-team-plan")).toContainText(
    "coordinate team review"
  );
  await expect(page.getByTestId("workbench-team-plan-count")).toContainText("2");
  await expect(page.getByTestId("workbench-team-plan-status")).toContainText(
    "warning"
  );
  await expect(page.getByTestId("workbench-team-plan-evidence")).toContainText(
    "2"
  );
  await expect(page.getByTestId("workbench-team-plan-verification")).toContainText(
    "warning-team-tasks"
  );
  await expect(page.getByTestId("workbench-team-plan-verification")).toContainText(
    "team-task-evidence-coverage"
  );
  await expect(page.getByTestId("workbench-team-plan-synthesis")).toContainText(
    "Synthesis"
  );
  await expect(page.getByTestId("workbench-team-plan-synthesis")).toContainText(
    "security/auth"
  );
  await expect(page.getByTestId("workbench-team-plan-synthesis")).toContainText(
    "warning-team-tasks"
  );
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assist")
  ).toBeVisible();
  await page.getByTestId("workbench-team-plan-synthesis-assist").click();
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assist-error")
  ).toContainText("模型凭证不可用");
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assist-error")
  ).toContainText("去设置");
  expect(assistRequestCount).toBe(1);
  expect(assistForceValues).toEqual([false]);

  await page.getByTestId("workbench-team-plan-synthesis-assist").click();
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assistance")
  ).toContainText("LLM assist: accepted");
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assistance")
  ).toContainText("cached");
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assistance")
  ).toContainText("openai/gpt-test");
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assistance")
  ).toContainText("42ms");
  expect(assistRequestCount).toBe(2);
  expect(assistForceValues).toEqual([false, false]);

  await expect(page.getByTestId("workbench-team-plan-synthesis-assist")).toContainText(
    "Refresh assist"
  );
  await page.getByTestId("workbench-team-plan-synthesis-assist").click();
  await expect(
    page.getByTestId("workbench-team-plan-synthesis-assistance")
  ).toContainText("LLM assist: accepted");
  expect(assistRequestCount).toBe(3);
  expect(assistForceValues).toEqual([false, false, true]);
  const teamEditor = page.getByTestId("workbench-team-plan-editor");
  const composer = page.locator("textarea[placeholder]").first();
  await expect(teamEditor).toBeVisible();
  await expect(page.getByTestId("workbench-team-plan-prompt-preview")).toContainText(
    "team-readonly-review"
  );
  await expect(page.getByTestId("workbench-team-plan-prompt-preview")).toContainText(
    "coordinate team review"
  );

  let workflowRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().includes("/workflows")) {
      workflowRequestCount += 1;
    }
  });
  await page.getByTestId("workbench-team-plan-prepare").click();
  await expect(composer).toHaveValue(/run_workflow_template/);
  await expect(composer).toHaveValue(/team-readonly-review/);

  await page.getByTestId("workbench-team-plan-mode-worktree").click();
  await expect(page.getByTestId("workbench-team-plan-prompt-preview")).toContainText(
    "team-worktree-implementation"
  );
  await expect(page.getByTestId("workbench-team-plan-prompt-preview")).toContainText(
    '"requestMerge": false'
  );
  await page.getByTestId("workbench-team-plan-prepare").click();
  await expect(composer).toHaveValue(/team-worktree-implementation/);
  await expect(composer).toHaveValue(/"requestMerge": false/);
  await page.waitForTimeout(100);
  expect(workflowRequestCount).toBe(0);

  const authTask = page
    .getByTestId("workbench-team-plan-task")
    .filter({ hasText: "Review auth boundary" });
  const verifyTask = page
    .getByTestId("workbench-team-plan-task")
    .filter({ hasText: "Verify Team evidence path" });
  await expect(authTask).toContainText("Review auth boundary");
  await expect(authTask).toContainText(
    "Read-only review of auth routes"
  );
  await expect(authTask).toContainText("read-only");
  await expect(authTask).toContainText(
    "Subagent warning: auth boundary mismatch"
  );
  await expect(verifyTask).toContainText("Verification passed: npm test");
});

test("workbench: Outputs 作为产物 inbox 展示 URL 和文件动作", async ({
  bootedPage: page,
}) => {
  await page.locator("textarea").first().fill("produce outputs");
  await page.getByTitle("Send", { exact: true }).click();
  const agentId = await activeAgentId(page);

  await pushSseEvent(
    page,
    agentId,
    {
      type: "progress_updated",
      progress: {
        steps: [],
        groups: [],
        artifacts: [
          {
            id: "url-1",
            kind: "url",
            title: "localhost:3000",
            href: "http://localhost:3000",
            createdAt: Date.now(),
          },
          {
            id: "file-1",
            kind: "file",
            title: "architecture.md",
            href: "/tmp/e2e-cwd/architecture.md",
            createdAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      },
    },
    "41"
  );

  await page.getByLabel("Workbench 面板").click();
  await expect(page.getByTestId("workbench-section-outputs")).toContainText("2");
  await page.getByTestId("workbench-section-outputs-action").click();
  await expect(page.getByTestId("workbench-outputs-detail")).toContainText("URLs");
  await expect(page.getByTestId("workbench-outputs-detail")).toContainText("Files");
  await expect(page.getByText("打开 Browser")).toBeVisible();
  await expect(page.getByText("打开 Files")).toBeVisible();
});

test("workbench: Tab OS 支持创建菜单、推荐项和本地 URL 过滤", async ({
  bootedPage: page,
}) => {
  const origin = new URL(page.url()).origin;
  await page.route("**/api/files?**", async (route) => {
    const url = new URL(route.request().url());
    const filePath = url.searchParams.get("path") ?? "";
    if (filePath.endsWith("/README.md")) {
      return route.fulfill({
        json: {
          kind: "file",
          path: filePath,
          size: 128,
          modified: new Date().toISOString(),
          content: "# README fixture\n\nOpened from Workbench recommendation.",
        },
      });
    }
    return route.fulfill({
      json: {
        kind: "dir",
        path: filePath,
        entries: [{ name: "README.md", isDir: false, isFile: true, isSymlink: false }],
      },
    });
  });

  await page.locator("textarea").first().fill("produce browser recommendations");
  await page.getByTitle("Send", { exact: true }).click();
  const agentId = await activeAgentId(page);

  await pushSseEvent(
    page,
    agentId,
    {
      type: "progress_updated",
      progress: {
        steps: [],
        groups: [],
        artifacts: [
          {
            id: "self-url",
            kind: "url",
            title: "Shaula self",
            href: `${origin}/`,
            createdAt: Date.now(),
          },
          {
            id: "fixture-url",
            kind: "url",
            title: "Browser fixture",
            href: `${origin}/browser-task-fixture`,
            createdAt: Date.now(),
          },
          {
            id: "file-1",
            kind: "file",
            title: "architecture.md",
            href: "/tmp/e2e-cwd/architecture.md",
            createdAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      },
    },
    "42"
  );

  await page.getByLabel("Workbench 面板").click();
  await expect(page.getByTestId("workbench-home-launcher")).toBeVisible();
  await expect(page.getByTestId("workbench-launch-文件")).toBeVisible();
  await expect(page.getByTestId("workbench-launch-浏览器")).toBeVisible();
  await expect(page.getByTestId("workbench-launch-命令参考")).toBeVisible();
  await expect(page.getByTestId("workbench-launch-概览")).toBeVisible();

  await page.getByTestId("workbench-create-tab").click();
  await expect(page.getByTestId("workbench-create-menu")).toBeVisible();
  await expect(page.getByTestId("workbench-create-文件")).toBeVisible();
  await expect(page.getByTestId("workbench-create-浏览器")).toBeVisible();
  await expect(page.getByTestId("workbench-create-命令参考")).toBeVisible();

  await page.getByTestId("workbench-create-浏览器").click();
  await expect(page.getByTestId("workbench-browser-launcher")).toBeVisible();
  await expect(page.getByText("Browser fixture")).toBeVisible();
  await expect(page.getByText("Shaula self")).toBeHidden();

  await page.getByText("Browser fixture").click();
  await expect(page.getByTestId("workbench-tab-browser")).toHaveCount(2);
  await expect(page.getByText(`${origin}/browser-task-fixture`)).toBeVisible();

  await page.getByTestId("workbench-tab-home").click();
  await page.getByText("README.md").first().click();
  await expect(page.getByTestId("workbench-tab-files")).toBeVisible();
  await expect(page.getByText("Opened from Workbench recommendation.")).toBeVisible();
});
