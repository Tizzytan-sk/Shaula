import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __setLongTaskStoreRootForTest,
  createLongTask,
  createTaskFinding,
  createTaskRun,
  listLongTasksDashboard,
  updateTaskFinding,
  updateTaskRun,
} from "./store";

describe("long task store", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "long-task-store-"));
    __setLongTaskStoreRootForTest(root);
  });

  afterEach(() => {
    vi.useRealTimers();
    __setLongTaskStoreRootForTest(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates scheduled tasks and reports due items", () => {
    const task = createLongTask({
      title: "每日检查 CI",
      prompt: "检查 CI 是否有新增失败。",
      projectPath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      cadence: "daily",
    });

    expect(task.status).toBe("scheduled");
    expect(task.nextRunAt).toEqual(expect.any(Number));

    const dashboard = listLongTasksDashboard((task.nextRunAt ?? 0) + 1);
    expect(dashboard.dueTasks.map((item) => item.id)).toEqual([task.id]);
  });

  it("tracks run lifecycle and finding inbox status", () => {
    const task = createLongTask({
      title: "盯反馈",
      prompt: "检查用户反馈。",
      projectPath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      cadence: "manual",
    });
    const run = createTaskRun(task.id);

    expect(listLongTasksDashboard().tasks[0]?.status).toBe("running");

    const finding = createTaskFinding({
      taskId: task.id,
      runId: run.id,
      title: "发现高优先级反馈",
      body: "移动端登录失败。",
      severity: "critical",
    });
    updateTaskRun(run.id, {
      status: "completed_with_findings",
      endedAt: Date.now(),
      summary: "发现 1 个需要处理的反馈。",
      findingIds: [finding.id],
    });

    let dashboard = listLongTasksDashboard();
    expect(dashboard.inboxCount).toBe(1);
    expect(dashboard.runs[0]).toMatchObject({
      status: "completed_with_findings",
      findingIds: [finding.id],
    });
    expect(dashboard.runs[0]?.checkpoints.map((item) => item.kind)).toEqual([
      "queued",
      "completed",
    ]);
    expect(dashboard.tasks[0]).toMatchObject({
      status: "completed",
      lastSummary: "发现 1 个需要处理的反馈。",
    });

    updateTaskFinding(finding.id, { status: "resolved" });
    dashboard = listLongTasksDashboard();
    expect(dashboard.inboxCount).toBe(0);
    expect(dashboard.findings[0]?.status).toBe("resolved");
  });

  it("keeps task status aligned with waiting decisions", () => {
    const task = createLongTask({
      title: "等决策任务",
      prompt: "需要用户确认后继续。",
      projectPath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      cadence: "manual",
    });
    const run = createTaskRun(task.id);

    updateTaskRun(run.id, {
      status: "waiting_user",
      waitingReason: "需要授权 · bash",
      summary: "等待你确认授权后继续执行。",
    });

    let dashboard = listLongTasksDashboard();
    expect(dashboard.tasks[0]).toMatchObject({
      id: task.id,
      status: "waiting_user",
    });
    expect(dashboard.runs[0]).toMatchObject({
      status: "waiting_user",
      waitingReason: "需要授权 · bash",
    });
    expect(dashboard.runs[0]?.checkpoints.map((item) => item.kind)).toEqual([
      "queued",
      "waiting_user",
    ]);

    updateTaskRun(run.id, {
      status: "running",
      waitingReason: undefined,
      summary: "已收到你的决策，继续执行。",
    });

    dashboard = listLongTasksDashboard();
    expect(dashboard.tasks[0]?.status).toBe("running");
    expect(dashboard.runs[0]).toMatchObject({
      status: "running",
      waitingReason: undefined,
    });
    expect(dashboard.runs[0]?.checkpoints.map((item) => item.kind)).toEqual([
      "queued",
      "waiting_user",
      "resumed",
    ]);
  });

  it("retains recent runs and prunes old runs per task", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const task = createLongTask({
      title: "长期巡检",
      prompt: "持续运行。",
      projectPath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      cadence: "manual",
    });

    for (let i = 0; i < 60; i += 1) {
      vi.setSystemTime(2_000 + i);
      const run = createTaskRun(task.id);
      updateTaskRun(run.id, {
        status: "completed_empty",
        endedAt: Date.now(),
        summary: `run ${i}`,
      });
    }

    const dashboard = listLongTasksDashboard();
    const taskRuns = dashboard.runs.filter((run) => run.taskId === task.id);
    expect(taskRuns).toHaveLength(50);
    expect(taskRuns.some((run) => run.summary === "run 0")).toBe(false);
    expect(taskRuns[0]?.summary).toBe("run 59");
    expect(dashboard.tasks[0]?.lastRunId).toBe(taskRuns[0]?.id);
  });

  it("keeps unread findings and only recent closed findings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const task = createLongTask({
      title: "反馈巡检",
      prompt: "检查反馈。",
      projectPath: "/tmp/project",
      provider: "openai-codex",
      modelId: "gpt-5.5",
      cadence: "manual",
    });
    const run = createTaskRun(task.id);

    const unreadIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      vi.setSystemTime(11_000 + i);
      const finding = createTaskFinding({
        taskId: task.id,
        runId: run.id,
        title: `unread ${i}`,
        body: "still actionable",
      });
      unreadIds.push(finding.id);
    }

    for (let i = 0; i < 110; i += 1) {
      vi.setSystemTime(12_000 + i);
      const finding = createTaskFinding({
        taskId: task.id,
        runId: run.id,
        title: `closed ${i}`,
        body: "already handled",
      });
      updateTaskFinding(finding.id, { status: "resolved" });
    }

    const dashboard = listLongTasksDashboard();
    const taskFindings = dashboard.findings.filter(
      (finding) => finding.taskId === task.id
    );
    expect(taskFindings.filter((finding) => finding.status === "unread")).toHaveLength(3);
    expect(
      unreadIds.every((id) => taskFindings.some((finding) => finding.id === id))
    ).toBe(true);
    expect(taskFindings.filter((finding) => finding.status !== "unread")).toHaveLength(100);
    expect(taskFindings.some((finding) => finding.title === "closed 0")).toBe(false);

    const retainedRun = dashboard.runs.find((item) => item.id === run.id);
    expect(retainedRun?.findingIds).toHaveLength(103);
  });
});
