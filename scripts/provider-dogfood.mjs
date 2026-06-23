import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_PROVIDER = "zhipu";
const DEFAULT_MODEL = "glm-5.1";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const SECRET_PATTERNS = [
  /[A-Za-z0-9]{24,}\.[A-Za-z0-9_-]{12,}/g,
  /\b(?:sk|sk-ant|sk-proj|key)-[A-Za-z0-9_-]{16,}\b/g,
];

export const PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES = Object.freeze([
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

export const PROVIDER_DOGFOOD_CASES = [
  {
    id: "coding-diff-success",
    title: "Coding diff success",
    expectedProfile: "coding.default",
    expectedEvidence: ["diff", "test_result"],
    rubricProfile: "coding.default",
    requiredEvidence: ["diff", "test_result"],
    expectedFinalState: "complete or ready_to_finalize",
    workspace: "fixture",
    runVerification: true,
    objective({ workspacePath }) {
      return [
        "Provider dogfood coding task.",
        `Work only inside this prepared fixture workspace: ${workspacePath}.`,
        "Change src/value.json so the value field becomes \"after\".",
        "Do not edit files outside this fixture workspace.",
        "After the edit, record progress artifacts for the diff and test evidence.",
        "The runner will execute required verification after your first turn.",
        "When evidence exists, call goal_update with status=complete.",
      ].join(" ");
    },
  },
  {
    id: "verifier-rejection-recovery",
    title: "Verifier rejection recovery",
    expectedProfile: "analysis.research",
    expectedEvidence: ["source_note", "analysis_artifact"],
    rubricProfile: "analysis.research",
    requiredEvidence: ["source_note", "analysis_artifact"],
    expectedFinalState: "first reject, then pass",
    workspace: "fixture",
    runVerification: false,
    objective({ workspacePath }) {
      const source = path.join(workspacePath, "package.json").replace(/\\/g, "/");
      return [
        "Research evidence dogfood rejection-recovery task.",
        "First attempt goal_update complete before adding evidence; the verifier should reject it.",
        "Then inspect the existing package metadata source and recover by recording evidence.",
        `Use ${source} as the source_note href and analysis_artifact href.`,
        "Report the package name exactly.",
        "After source_note and analysis_artifact evidence exists, call goal_update with status=complete again.",
        "The second goal_update must include a finalSummary that names the package exactly",
        "and evidenceIds containing the returned source_note and analysis_artifact evidence ids.",
      ].join(" ");
    },
  },
  {
    id: "needs-user-pause",
    title: "Needs-user pause",
    expectedProfile: "workflow.default or ask_user",
    expectedEvidence: ["user_confirmed_direction"],
    rubricProfile: "workflow.default",
    requiredEvidence: ["user_confirmed_direction"],
    expectedFinalState: "needs_user or explicit user-decision pause",
    workspace: "fixture",
    runVerification: false,
    objective() {
      return [
        "Provider dogfood user-decision task.",
        "You must choose between Product Direction A and Product Direction B,",
        "but the choice depends on the user's business preference that is not available in the workspace.",
        "Do not guess the direction.",
        "If a user decision is required, pause and ask for that decision rather than marking the goal complete.",
      ].join(" ");
    },
  },
  {
    id: "blocked-pause",
    title: "Blocked pause",
    expectedProfile: "workflow.default",
    expectedEvidence: ["blocker_log"],
    rubricProfile: "workflow.default",
    requiredEvidence: ["blocker_log"],
    expectedFinalState: "blocked",
    workspace: "fixture",
    runVerification: false,
    objective() {
      return [
        "Provider dogfood blocked-state protocol test.",
        "The task requires a credential named SHAULA_DOGFOOD_MISSING_TOKEN.",
        "Do not invent this credential and do not ask external services for it.",
        "No file inspection, shell command, workflow, browser, or subagent call is needed.",
        "Immediately record a concise blocker progress artifact titled \"Blocker log\"",
        "that mentions SHAULA_DOGFOOD_MISSING_TOKEN.",
        "Then immediately call goal_update with status=blocked and blockedReason",
        "explaining that SHAULA_DOGFOOD_MISSING_TOKEN is required to continue.",
      ].join(" ");
    },
  },
  {
    id: "browser-observation",
    title: "UI browser observation",
    expectedProfile: "coding.frontend-ui",
    expectedEvidence: ["browser_observation"],
    rubricProfile: "coding.frontend-ui",
    requiredEvidence: ["browser_observation"],
    expectedFinalState: "pass only with host-observed browser evidence",
    workspace: "fixture",
    codeFixture: false,
    runVerification: true,
    objective({ workspacePath }) {
      return [
        "Frontend UI browser-observation dogfood task.",
        `Use the prepared fixture workspace at ${workspacePath}.`,
        "Inspect the simple HTML UI fixture and report whether the heading is visible.",
        "Do not start local servers or background processes.",
        "Do not claim completion from text alone; browser_observation evidence is required.",
        "If no host-observed browser evidence is available, keep the goal active or blocked rather than falsely completing.",
      ].join(" ");
    },
  },
];

export function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    cwd: process.cwd(),
    out: "",
    cases: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    keepWorkspaces: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (arg === "--base-url") options.baseUrl = requireValue(arg, next());
    else if (arg === "--provider") options.provider = requireValue(arg, next());
    else if (arg === "--model") options.model = requireValue(arg, next());
    else if (arg === "--cwd") options.cwd = path.resolve(requireValue(arg, next()));
    else if (arg === "--out") options.out = requireValue(arg, next());
    else if (arg === "--case") {
      options.cases.push(...splitCases(requireValue(arg, next())));
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number(requireValue(arg, next()));
    } else if (arg === "--poll-ms") {
      options.pollMs = Number(requireValue(arg, next()));
    } else if (arg === "--request-timeout-ms") {
      options.requestTimeoutMs = Number(requireValue(arg, next()));
    } else if (arg === "--keep-workspaces") {
      options.keepWorkspaces = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }
  if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) {
    throw new Error("--poll-ms must be a positive number");
  }
  if (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
    throw new Error("--request-timeout-ms must be a positive number");
  }
  return options;
}

export function selectCases(ids = []) {
  const wanted = ids.length === 0 || ids.includes("all")
    ? PROVIDER_DOGFOOD_CASES.map((item) => item.id)
    : ids;
  const byId = new Map(PROVIDER_DOGFOOD_CASES.map((item) => [item.id, item]));
  return wanted.map((id) => {
    const found = byId.get(id);
    if (!found) {
      throw new Error(
        `Unknown dogfood case: ${id}. Known cases: ${PROVIDER_DOGFOOD_CASES.map((item) => item.id).join(", ")}`
      );
    }
    return found;
  });
}

export function redactSecrets(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  return text;
}

export function renderMarkdownReport(report) {
  const lines = [
    `# Shaula Provider Dogfood Run`,
    "",
    `> Generated: ${report.generatedAt}`,
    `> Provider: \`${report.provider}\``,
    `> Model: \`${report.model}\``,
    `> Base URL: \`${report.baseUrl}\``,
    "",
    "## Summary",
    "",
    "| Case | Expected profile | Required evidence | Goal status | Evaluation | Closure | Open actions | Notes |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ...report.records.map((record) =>
      [
        record.id,
        record.expectedProfile,
        record.expectedEvidence.join(", "),
        record.final.goalStatus ?? "unknown",
        record.final.evaluationStatus ?? "unknown",
        record.final.closureVerdict ?? "none",
        String(record.final.openActionCount),
        record.notes,
      ].map(markdownCell).join(" | ")
    ).map((row) => `| ${row} |`),
    "",
    "## Records",
    "",
  ];

  for (const record of report.records) {
    lines.push(
      `### ${record.title}`,
      "",
      `- case id: \`${record.id}\``,
      `- agent id: \`${record.agentId ?? "not-created"}\``,
      `- session file: \`${record.sessionFile ?? "none"}\``,
      `- expected final state: ${record.expectedFinalState}`,
      `- final goal status: \`${record.final.goalStatus ?? "unknown"}\``,
      `- evaluation: \`${record.final.evaluationStatus ?? "unknown"}\``,
      `- score: \`${record.final.evaluationScore ?? "n/a"}\``,
      `- failed criteria: ${record.final.failedCriteria.length ? record.final.failedCriteria.map((item) => `\`${item}\``).join(", ") : "none"}`,
      `- open actions: ${record.final.openActionCount}`,
      `- runner actions: ${record.runnerActions.length ? record.runnerActions.join(", ") : "none"}`,
      `- intermediate evaluations: rejected=${record.intermediateEvaluations?.rejectedCount ?? 0}, accepted=${record.intermediateEvaluations?.acceptedCount ?? 0}`,
      "",
      "Evidence:",
      "",
      "| ID | Kind | Title | Trust | Preview | Metadata |",
      "| --- | --- | --- | --- | --- | --- |",
      ...record.evidence.map((item) =>
        `| ${markdownCell(item.id ?? "")} | ${markdownCell(item.kind)} | ${markdownCell(item.title)} | ${markdownCell(item.trustLevel ?? "")} | ${markdownCell(item.textPreview ?? "")} | ${markdownCell(JSON.stringify(item.metadata ?? {}))} |`
      ),
      "",
      "Notes:",
      "",
      record.notes || "No notes.",
      ""
    );
  }

  return redactSecrets(lines.join("\n"));
}

export function isProviderDogfoodReportSuccessful(report) {
  return (report.records ?? []).every((record) =>
    isProviderDogfoodRecordSuccessful(record)
  );
}

function isProviderDogfoodRecordSuccessful(record) {
  const final = record.final ?? {};
  if (final.goalStatus === "error" || final.evaluationStatus === "error") {
    return false;
  }

  switch (record.id) {
    case "coding-diff-success":
      return (
        final.goalStatus === "complete" &&
        final.evaluationStatus === "passed" &&
        hasExpectedEvidence(record, "diff") &&
        hasExpectedEvidence(record, "test_result")
      );
    case "verifier-rejection-recovery":
      return (
        final.goalStatus === "complete" &&
        final.evaluationStatus === "passed" &&
        (record.intermediateEvaluations?.rejectedCount ?? 0) > 0 &&
        !hasRunnerCompletion(record) &&
        hasExpectedEvidence(record, "source_note") &&
        hasExpectedEvidence(record, "analysis_artifact")
      );
    case "needs-user-pause":
      return final.goalStatus === "paused" || final.closureVerdict === "needs_user";
    case "blocked-pause":
      return final.goalStatus === "blocked" && hasExpectedEvidence(record, "blocker_log");
    case "browser-observation":
      return (
        final.goalStatus === "complete" &&
        final.evaluationStatus === "passed" &&
        (record.evidence ?? []).some(
          (item) =>
            item.kind === "browser_snapshot" &&
            item.trustLevel === "host_observed" &&
            (item.metadata?.outcome === "passed" || item.metadata?.passed === true)
        )
      );
    default:
      return final.goalStatus === "complete" && final.evaluationStatus === "passed";
  }
}

function hasRunnerCompletion(record) {
  return (record.runnerActions ?? []).some((action) =>
    String(action).startsWith("runner_goal_update_complete:accepted")
  );
}

function hasExpectedEvidence(record, expected) {
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  return evidence.some((item) => evidenceMatchesExpected(item, expected));
}

function evidenceMatchesExpected(item, expected) {
  const id = String(item?.id ?? "").toLowerCase();
  const kind = String(item?.kind ?? "").toLowerCase();
  const title = String(item?.title ?? "").toLowerCase();
  const trustLevel = String(item?.trustLevel ?? "").toLowerCase();
  const metadata = item?.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const metadataKind = String(metadata.kind ?? "").toLowerCase();
  const metadataStatus = String(metadata.status ?? metadata.outcome ?? "").toLowerCase();
  const requiredEvidence = Array.isArray(metadata.evidenceRequired)
    ? metadata.evidenceRequired.map((value) => String(value).toLowerCase())
    : [];
  const evidenceText = [
    id,
    kind,
    title,
    trustLevel,
    String(item?.textPreview ?? ""),
    JSON.stringify(metadata),
  ].join(" ").toLowerCase();

  switch (expected) {
    case "diff":
      return (
        metadataKind === "diff" ||
        requiredEvidence.includes("diff") ||
        id.includes("diff") ||
        title.includes("diff")
      );
    case "test_result":
      return (
        metadataKind === "test" ||
        metadata.verificationKind === "test" ||
        requiredEvidence.includes("test_result") ||
        (kind === "verification_result" && metadataStatus === "passed") ||
        id.includes("test") ||
        title.includes("test")
      );
    case "source_note":
      return (
        requiredEvidence.includes("source_note") ||
        id.includes("source-note") ||
        id.includes("source_note") ||
        title.includes("source")
      );
    case "analysis_artifact":
      return (
        requiredEvidence.includes("analysis_artifact") ||
        id.includes("analysis-artifact") ||
        id.includes("analysis_artifact") ||
        title.includes("analysis")
      );
    case "blocker_log":
      return (
        kind === "progress_artifact" &&
        metadataKind === "log" &&
        title === "blocker log" &&
        evidenceText.includes("shaula_dogfood_missing_token")
      );
    case "browser_observation":
      return (
        kind === "browser_snapshot" &&
        trustLevel === "host_observed" &&
        (metadata.outcome === "passed" || metadata.passed === true)
      );
    default:
      return requiredEvidence.includes(expected);
  }
}

export async function runProviderDogfood(options) {
  const generatedAt = new Date().toISOString();
  const cases = selectCases(options.cases);
  if (options.dryRun) {
    const dryReport = {
      generatedAt,
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      records: cases.map((dogfoodCase) => dryRunRecord(dogfoodCase, options)),
    };
    writeReportIfRequested(options, dryReport);
    return dryReport;
  }

  await assertProviderDogfoodReady(options);

  const readiness = await postJson(
    options.baseUrl,
    "/api/auth/test",
    {
      provider: options.provider,
      modelId: options.model,
    },
    { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
  );
  if (!readiness.ok || readiness.data?.ok !== true) {
    throw new Error(
      `Provider auth test failed: ${readiness.status} ${redactSecrets(JSON.stringify(readiness.data))}`
    );
  }

  const report = {
    generatedAt,
    provider: options.provider,
    model: options.model,
    baseUrl: options.baseUrl,
    records: [],
  };
  for (const dogfoodCase of cases) {
    const prepared = await prepareWorkspace(dogfoodCase, generatedAt);
    try {
      report.records.push(await runDogfoodCase(dogfoodCase, options, prepared));
    } catch (error) {
      report.records.push(errorRecord(dogfoodCase, options, prepared, error));
    } finally {
      writeReportIfRequested(options, report);
      if (!options.keepWorkspaces && prepared.cleanup) {
        try {
          await prepared.cleanup();
        } catch (error) {
          console.warn(`Provider dogfood cleanup warning: ${describeError(error)}`);
        }
      }
    }
  }

  return report;
}

async function assertProviderDogfoodReady(options) {
  const providers = await getJson(
    options.baseUrl,
    "/api/providers",
    { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
  );
  if (!providers.ok) {
    const detail = providers.status === 0
      ? providers.data?.error ?? "request failed"
      : `${providers.status} ${redactSecrets(JSON.stringify(providers.data))}`;
    throw new Error(
      `Provider dogfood preflight failed: cannot query /api/providers at ${options.baseUrl}. ${detail}`
    );
  }

  const providerList = Array.isArray(providers.data?.providers)
    ? providers.data.providers
    : [];
  const provider = providerList.find((item) => item?.provider === options.provider);
  if (!provider) {
    const available = providerList
      .map((item) => item?.provider)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Provider dogfood preflight failed: provider "${options.provider}" is not registered. Available providers: ${available || "none"}`
    );
  }

  const models = Array.isArray(provider.models) ? provider.models : [];
  if (options.model && !models.some((model) => model?.id === options.model)) {
    const available = models
      .map((model) => model?.id)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Provider dogfood preflight failed: model "${options.model}" is not registered for provider "${options.provider}". Available models: ${available || "none"}`
    );
  }

  if (!provider.hasAuth) {
    const authHint = [
      provider.authSource ? `source=${provider.authSource}` : "",
      provider.authLabel ? `label=${provider.authLabel}` : "",
    ].filter(Boolean).join(", ");
    throw new Error(
      `Provider dogfood preflight failed: provider "${options.provider}" is registered but has no configured auth${authHint ? ` (${authHint})` : ""}. Configure a provider credential in Shaula settings or via the provider environment variable, then rerun npm run dogfood:provider.`
    );
  }
}

async function runDogfoodCase(dogfoodCase, options, prepared) {
  const runnerActions = [];
  const created = await postJson(
    options.baseUrl,
    "/api/agent/new",
    {
      provider: options.provider,
      modelId: options.model,
      cwd: prepared.workspacePath ?? options.cwd,
      thinkingLevel: "low",
    },
    { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
  );
  if (!created.ok) {
    throw new Error(`agent/new failed: ${created.status} ${JSON.stringify(created.data)}`);
  }
  const agentId = created.data.id;
  await applyDogfoodToolPolicy({ options, agentId, dogfoodCase, runnerActions });
  const objective = dogfoodCase.objective({
    workspacePath: (prepared.workspacePath ?? options.cwd).replace(/\\/g, "/"),
    rootCwd: options.cwd.replace(/\\/g, "/"),
  });
  const goalSet = await postJson(
    options.baseUrl,
    `/api/agent/${agentId}`,
    {
      type: "goal_set",
      objective,
      rubricProfile: dogfoodCase.rubricProfile,
      requiredEvidence: dogfoodCase.requiredEvidence,
    },
    { timeoutMs: options.requestTimeoutMs }
  );
  if (!goalSet.ok) {
    await postJson(
      options.baseUrl,
      `/api/agent/${agentId}`,
      { type: "abort" },
      { timeoutMs: 15_000 }
    ).catch(() => undefined);
    throw new Error(`goal_set failed: ${goalSet.status} ${JSON.stringify(goalSet.data)}`);
  }

  let timeline = await waitForCaseIdle(options, agentId, {
    returnOnIdle: dogfoodCase.runVerification === true,
  });
  if (dogfoodCase.expectedEvidence.includes("browser_observation")) {
    const observation = await recordHostBrowserObservation({
      options,
      prepared,
      agentId,
    });
    runnerActions.push(
      `host_browser_observation:${observation.passed ? "passed" : "failed"}`
    );
    timeline = await getJson(options.baseUrl, `/api/agent/${agentId}?action=goal_timeline`);
  }
  if (dogfoodCase.runVerification) {
    const verification = await postJson(
      options.baseUrl,
      `/api/agent/${agentId}`,
      {
        type: "goal_run_verification",
      },
      { timeoutMs: options.requestTimeoutMs }
    );
    runnerActions.push(`goal_run_verification:${verification.ok ? "ok" : verification.status}`);
    timeline = await getJson(options.baseUrl, `/api/agent/${agentId}?action=goal_timeline`);
  }
  timeline = await maybeSubmitStructuredCompletion({
    dogfoodCase,
    options,
    agentId,
    timeline,
    runnerActions,
  });

  const events = await getJson(options.baseUrl, `/api/agent/${agentId}?action=runtime_events`);
  return summarizeRecord({
    dogfoodCase,
    options,
    prepared,
    agentId,
    sessionFile: created.data.sessionFile,
    goalSet: goalSet.data,
    timeline: timeline.data,
    events: events.data,
    runnerActions,
  });
}

async function applyDogfoodToolPolicy({ options, agentId, dogfoodCase, runnerActions }) {
  const tools = await getJson(options.baseUrl, `/api/agent/${agentId}?action=get_tools`, {
    timeoutMs: Math.min(options.requestTimeoutMs, 30_000),
  });
  if (!tools.ok) {
    throw new Error(`get_tools failed: ${tools.status} ${JSON.stringify(tools.data)}`);
  }

  const allToolNames = Array.isArray(tools.data?.tools)
    ? tools.data.tools
        .map((item) => (typeof item?.name === "string" ? item.name : ""))
        .filter(Boolean)
    : [];
  const activeToolNames = Array.isArray(tools.data?.active)
    ? tools.data.active.filter((item) => typeof item === "string")
    : [];
  const currentTools = Array.isArray(tools.data?.active) ? activeToolNames : allToolNames;
  if (currentTools.length === 0) {
    runnerActions.push("tool_policy:skipped_no_tools");
    return;
  }

  const nextTools = currentTools.filter(
    (name) => !isProviderDogfoodToolDisabled(name, dogfoodCase)
  );
  if (nextTools.length === currentTools.length) {
    runnerActions.push("tool_policy:unchanged");
    return;
  }

  const updated = await postJson(
    options.baseUrl,
    `/api/agent/${agentId}`,
    {
      type: "set_tools",
      tools: nextTools,
    },
    { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
  );
  if (!updated.ok) {
    throw new Error(`set_tools failed: ${updated.status} ${JSON.stringify(updated.data)}`);
  }
  runnerActions.push(`tool_policy:disabled:${currentTools.length - nextTools.length}`);
}

export function providerDogfoodDisabledToolRules(dogfoodCase) {
  const disabled = [
    ...PROVIDER_DOGFOOD_ORCHESTRATION_TOOL_RULES,
  ];
  if (!dogfoodCase.expectedEvidence.includes("browser_observation")) {
    disabled.push("browser_");
  }
  if (dogfoodCase.id === "blocked-pause") {
    disabled.push(
      "apply_patch",
      "bash",
      "edit",
      "list_files",
      "powershell",
      "read_file",
      "run_command",
      "search_files",
      "shell",
      "write_file"
    );
  }
  return disabled;
}

export function isProviderDogfoodToolDisabled(name, dogfoodCase) {
  return providerDogfoodDisabledToolRules(dogfoodCase).some(
    (rule) => name === rule || name.startsWith(rule)
  );
}

async function maybeSubmitStructuredCompletion({
  dogfoodCase,
  options,
  agentId,
  timeline,
  runnerActions,
}) {
  if (!shouldRunnerSubmitCompletion(dogfoodCase)) return timeline;
  if (timeline.data?.goal?.status === "complete") return timeline;

  const completion = buildRunnerCompletionClaim(dogfoodCase, timeline.data);
  if (completion.evidenceIds.length === 0) {
    runnerActions.push("runner_goal_update_complete:skipped_no_evidence");
    return timeline;
  }

  const complete = await postJson(
    options.baseUrl,
    `/api/agent/${agentId}`,
    {
      type: "goal_update",
      status: "complete",
      finalSummary: completion.finalSummary,
      evidenceIds: completion.evidenceIds,
    },
    { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
  );
  runnerActions.push(
    `runner_goal_update_complete:${complete.data?.accepted === true ? "accepted" : "rejected"}`
  );
  return getJson(options.baseUrl, `/api/agent/${agentId}?action=goal_timeline`);
}

function shouldRunnerSubmitCompletion(dogfoodCase) {
  return !["needs-user-pause", "blocked-pause", "verifier-rejection-recovery"].includes(
    dogfoodCase.id
  );
}

function buildRunnerCompletionClaim(dogfoodCase, timeline) {
  const evidence = Array.isArray(timeline?.ledgerEvidence)
    ? timeline.ledgerEvidence
    : [];
  const evidenceIds = evidence
    .map((item) => (typeof item?.id === "string" ? item.id : ""))
    .filter(Boolean)
    .slice(0, 50);
  const evidenceTitles = evidence
    .map((item) => `${item.kind ?? "evidence"}: ${item.title ?? item.id ?? "untitled"}`)
    .slice(0, 12)
    .join("; ");
  return {
    evidenceIds,
    finalSummary: [
      `Provider dogfood case ${dogfoodCase.id} is complete.`,
      `Required evidence: ${dogfoodCase.requiredEvidence.join(", ") || "none"}.`,
      evidenceTitles ? `Cited evidence: ${evidenceTitles}.` : "",
    ].filter(Boolean).join(" "),
  };
}

async function waitForCaseIdle(options, agentId, input = {}) {
  const returnOnIdle = input.returnOnIdle !== false;
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    latest = await getJson(options.baseUrl, `/api/agent/${agentId}?action=goal_timeline`);
    if (!latest.ok) {
      throw new Error(`goal_timeline failed: ${latest.status} ${JSON.stringify(latest.data)}`);
    }
    const meta = await getJson(options.baseUrl, `/api/agent/${agentId}`);
    if (!meta.ok) {
      throw new Error(`agent meta failed: ${meta.status} ${JSON.stringify(meta.data)}`);
    }
    const goalStatus = latest.data?.goal?.status;
    const pendingClarificationCount =
      typeof meta.data?.pendingClarificationCount === "number"
        ? meta.data.pendingClarificationCount
        : 0;
    const closureVerdict =
      latest.data?.lastClosure?.verdict ?? latest.data?.goal?.lastClosure?.verdict;
    if (pendingClarificationCount > 0 && latest) return latest;
    if (
      meta.data?.isStreaming === false &&
      (goalStatus === "complete" ||
        goalStatus === "blocked" ||
        goalStatus === "paused" ||
        closureVerdict === "ready_to_finalize" ||
        closureVerdict === "needs_user" ||
        closureVerdict === "blocked")
    ) {
      return latest;
    }
    if (returnOnIdle && meta.data?.isStreaming === false && latest) return latest;
    await sleep(options.pollMs);
  }
  if (latest) return latest;
  throw new Error(`Timed out waiting for agent ${agentId}`);
}

function summarizeRecord({
  dogfoodCase,
  options,
  prepared,
  agentId,
  sessionFile,
  goalSet,
  timeline,
  events,
  runnerActions,
}) {
  const goal = timeline?.goal ?? null;
  const evaluation = goal?.lastEvaluation ?? null;
  const closure = timeline?.lastClosure ?? goal?.lastClosure ?? null;
  const intermediateEvaluations = summarizeIntermediateEvaluations(events?.events);
  const evidence = (timeline?.ledgerEvidence ?? []).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: redactSecrets(item.title ?? ""),
    trustLevel: item.trustLevel,
    textPreview: redactSecrets(item.textPreview ?? ""),
    metadata: redactEvidenceMetadata(item.metadata),
  }));
  return {
    id: dogfoodCase.id,
    title: dogfoodCase.title,
    provider: options.provider,
    model: options.model,
    agentId,
    sessionFile: sessionFile ? redactPath(sessionFile) : "",
    workspace: prepared.workspacePath ? redactPath(prepared.workspacePath) : "",
    expectedProfile: dogfoodCase.expectedProfile,
    expectedEvidence: dogfoodCase.expectedEvidence,
    expectedFinalState: dogfoodCase.expectedFinalState,
    inferredProfile: goalSet?.contract?.rubricProfile ?? "",
    requiredEvidence: goalSet?.contract?.requiredEvidence ?? [],
    runnerActions,
    evidence,
    intermediateEvaluations,
    final: {
      goalStatus: goal?.status ?? null,
      blockedReason: redactSecrets(goal?.blockedReason ?? ""),
      evaluationStatus: evaluation?.status ?? null,
      evaluationScore: evaluation?.totalScore ?? null,
      failedCriteria: evaluation?.failedCriteria ?? [],
      closureVerdict: closure?.verdict ?? null,
      openActionCount: Array.isArray(timeline?.actions) ? timeline.actions.length : 0,
      eventCount: Array.isArray(events?.events) ? events.events.length : 0,
    },
    notes: buildRecordNotes(
      dogfoodCase,
      goal,
      evaluation,
      timeline,
      intermediateEvaluations
    ),
  };
}

function buildRecordNotes(
  dogfoodCase,
  goal,
  evaluation,
  timeline,
  intermediateEvaluations = { rejectedCount: 0, acceptedCount: 0 }
) {
  const notes = [];
  if (!goal) notes.push("No goal was returned by timeline.");
  if (goal?.status === "complete" && evaluation?.status === "passed") {
    notes.push("Goal completed with passing evaluation.");
  }
  if (goal?.status === "blocked") {
    notes.push(`Goal blocked: ${redactSecrets(goal.blockedReason ?? "no reason")}`);
  }
  if (evaluation?.status === "failed") {
    notes.push(`Evaluation failed: ${(evaluation.failedCriteria ?? []).join(", ") || "unknown criteria"}.`);
  }
  if (intermediateEvaluations.rejectedCount > 0 && evaluation?.status === "passed") {
    notes.push(
      `Observed ${intermediateEvaluations.rejectedCount} rejected completion attempt(s) before recovery.`
    );
  }
  if (
    dogfoodCase.expectedEvidence.includes("diff") &&
    !(timeline?.ledgerEvidence ?? []).some(
      (item) => item.kind === "verification_result" && /diff/i.test(JSON.stringify(item))
    )
  ) {
    notes.push("No deterministic diff evidence was observed; this is an expected current harness gap.");
  }
  if (notes.length === 0) notes.push("Run finished without a specific note.");
  return notes.join(" ");
}

function summarizeIntermediateEvaluations(events = []) {
  const evaluations = [];
  for (const event of events) {
    const evaluation = event?.payload?.lastEvaluation;
    if (!evaluation || typeof evaluation !== "object") continue;
    evaluations.push({
      status: evaluation.status,
      score: evaluation.totalScore,
      failedCriteria: Array.isArray(evaluation.failedCriteria)
        ? evaluation.failedCriteria
        : [],
    });
  }
  const rejectedCount = evaluations.filter((item) => item.status === "failed").length;
  const acceptedCount = evaluations.filter((item) => item.status === "passed").length;
  return { rejectedCount, acceptedCount, evaluations };
}

function dryRunRecord(dogfoodCase, options) {
  const objective = dogfoodCase.objective({
    workspacePath: "<prepared-workspace>",
    rootCwd: options.cwd.replace(/\\/g, "/"),
  });
  return {
    id: dogfoodCase.id,
    title: dogfoodCase.title,
    provider: options.provider,
    model: options.model,
    agentId: "",
    sessionFile: "",
    workspace: "",
    expectedProfile: dogfoodCase.expectedProfile,
    expectedEvidence: dogfoodCase.expectedEvidence,
    expectedFinalState: dogfoodCase.expectedFinalState,
    inferredProfile: "",
    requiredEvidence: [],
    runnerActions: ["dry_run"],
    evidence: [],
    intermediateEvaluations: {
      rejectedCount: 0,
      acceptedCount: 0,
      evaluations: [],
    },
    final: {
      goalStatus: "dry_run",
      blockedReason: "",
      evaluationStatus: "dry_run",
      evaluationScore: null,
      failedCriteria: [],
      closureVerdict: null,
      openActionCount: 0,
      eventCount: 0,
    },
    notes: `Dry run objective preview: ${objective.slice(0, 240)}`,
  };
}

function errorRecord(dogfoodCase, options, prepared, error) {
  return {
    id: dogfoodCase.id,
    title: dogfoodCase.title,
    provider: options.provider,
    model: options.model,
    agentId: "",
    sessionFile: "",
    workspace: prepared.workspacePath ? redactPath(prepared.workspacePath) : "",
    expectedProfile: dogfoodCase.expectedProfile,
    expectedEvidence: dogfoodCase.expectedEvidence,
    expectedFinalState: dogfoodCase.expectedFinalState,
    inferredProfile: "",
    requiredEvidence: [],
    runnerActions: ["case_error"],
    evidence: [],
    intermediateEvaluations: {
      rejectedCount: 0,
      acceptedCount: 0,
      evaluations: [],
    },
    final: {
      goalStatus: "error",
      blockedReason: "",
      evaluationStatus: "error",
      evaluationScore: null,
      failedCriteria: [],
      closureVerdict: null,
      openActionCount: 0,
      eventCount: 0,
    },
    notes: redactSecrets(error instanceof Error ? error.message : String(error)),
  };
}

async function prepareWorkspace(dogfoodCase, generatedAt) {
  if (dogfoodCase.workspace !== "fixture") return { workspacePath: "", cleanup: null };
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const workspacePath = path.join(os.tmpdir(), "shaula-provider-dogfood", stamp, dogfoodCase.id);
  fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspacePath, "package.json"),
    JSON.stringify(
      {
        name: `shaula-dogfood-${dogfoodCase.id}`,
        version: "0.0.0",
        private: true,
        scripts: dogfoodCase.codeFixture === false ? {} : { test: "node test.js" },
      },
      null,
      2
    ),
    "utf8"
  );
  if (dogfoodCase.codeFixture !== false) {
    fs.writeFileSync(
      path.join(workspacePath, "src", "value.json"),
      `${JSON.stringify({ value: "before" }, null, 2)}\n`,
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspacePath, "test.js"),
      [
        "const fs = require('node:fs');",
        "const data = JSON.parse(fs.readFileSync('src/value.json', 'utf8'));",
        "if (data.value !== 'after') {",
        "  console.error(`Expected src/value.json value to be after, got ${data.value}`);",
        "  process.exit(1);",
        "}",
        "console.log('fixture test passed');",
        "",
      ].join("\n"),
      "utf8"
    );
  }
  fs.writeFileSync(
    path.join(workspacePath, "index.html"),
    "<!doctype html><html><body><h1>Shaula Dogfood Fixture</h1></body></html>\n",
    "utf8"
  );
  return {
    workspacePath,
    cleanup: async () => {
      await removePathWithRetries(workspacePath);
    },
  };
}

async function removePathWithRetries(targetPath) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastError;
}

async function recordHostBrowserObservation({ options, prepared, agentId }) {
  if (!prepared.workspacePath) {
    throw new Error("browser observation requires a prepared workspace");
  }
  const targetPath = path.join(prepared.workspacePath, "index.html");
  const url = pathToFileURL(targetPath).href;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const heading = page.locator("h1").first();
    const headingText = (await heading.textContent({ timeout: 5000 }).catch(() => ""))?.trim() ?? "";
    const visible = await heading.isVisible().catch(() => false);
    const evidence = await postJson(
      options.baseUrl,
      `/api/agent/${agentId}`,
      {
        type: "evidence_record_browser_observation",
        title: visible
          ? "Host browser observation: heading visible"
          : "Host browser observation: heading not visible",
        url,
        textPreview: `h1=${headingText || "<missing>"}`,
        passed: visible && headingText.includes("Shaula Dogfood Fixture"),
      },
      { timeoutMs: Math.min(options.requestTimeoutMs, 30_000) }
    );
    if (!evidence.ok) {
      throw new Error(
        `record browser evidence failed: ${evidence.status} ${JSON.stringify(evidence.data)}`
      );
    }
    return {
      passed: evidence.data?.evidence?.metadata?.outcome === "passed",
      url,
      headingText,
    };
  } finally {
    await browser.close();
  }
}

function redactEvidenceMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/key|token|secret|authorization/i.test(key)) {
      output[key] = "[redacted]";
    } else if (typeof value === "string") {
      output[key] = redactSecrets(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function redactPath(value) {
  const text = String(value ?? "").replace(/\\/g, "/");
  const home = os.homedir().replace(/\\/g, "/");
  return text.startsWith(home) ? text.replace(home, "~") : text;
}

async function getJson(baseUrl, pathName, input) {
  return requestJson("GET", baseUrl, pathName, undefined, input);
}

async function postJson(baseUrl, pathName, body, input) {
  return requestJson("POST", baseUrl, pathName, body, input);
}

async function requestJson(method, baseUrl, pathName, body, input = {}) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${pathName}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: describeError(error), timeoutMs },
    };
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { text: redactSecrets(text.slice(0, 1000)) };
  }
  return { ok: response.ok, status: response.status, data };
}

function describeError(error) {
  if (!(error instanceof Error)) return redactSecrets(String(error));
  const cause = error.cause instanceof Error ? `; cause: ${error.cause.message}` : "";
  return redactSecrets(`${error.message}${cause}`);
}

function splitCases(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function requireValue(flag, value) {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function markdownCell(value) {
  return redactSecrets(String(value ?? ""))
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/provider-dogfood.mjs [options]

Options:
  --base-url <url>      Local Shaula service URL (default: ${DEFAULT_BASE_URL})
  --provider <id>       Provider id (default: ${DEFAULT_PROVIDER})
  --model <id>          Model id (default: ${DEFAULT_MODEL})
  --cwd <path>          Root cwd for non-fixture cases (default: current cwd)
  --case <ids>          Comma-separated case ids, or all (default: all)
  --out <path>          Write markdown report to this path
  --timeout-ms <n>      Per-case wait timeout (default: ${DEFAULT_TIMEOUT_MS})
  --poll-ms <n>         Poll interval (default: ${DEFAULT_POLL_MS})
  --request-timeout-ms <n>  Individual HTTP request timeout (default: ${DEFAULT_REQUEST_TIMEOUT_MS})
  --keep-workspaces     Keep prepared temp workspaces for debugging
  --dry-run             Render report without calling the local service
`);
}

function writeReportIfRequested(options, report) {
  if (!options.out) return;
  const outPath = path.resolve(options.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderMarkdownReport(report), "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = await runProviderDogfood(options);
  const markdown = renderMarkdownReport(report);
  if (options.out) {
    console.log(`Wrote ${path.resolve(options.out)}`);
  } else {
    console.log(markdown);
  }
  if (!options.dryRun && !isProviderDogfoodReportSuccessful(report)) {
    console.error("Provider dogfood failed: one or more cases did not reach the expected final state.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
