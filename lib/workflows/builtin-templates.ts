import type { WorkflowTemplate } from "./types";

const BUILTIN_CREATED_AT = 1;

export const TEAM_READONLY_REVIEW_TEMPLATE_ID = "team-readonly-review";
export const TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID =
  "team-worktree-implementation";

const TEAM_READONLY_REVIEW_SCRIPT = `
const params = workflow.params || {};
const subject = String(params.subject || workflow.objective || "Review target").slice(0, 2000);
const rubric = String(
  params.rubric ||
    "Prioritize correctness, missing tests, behavioral regressions, unsupported claims, and unresolved risk."
).slice(0, 2000);
const rawQuestions = Array.isArray(params.questions) ? params.questions : [subject];
const questions = rawQuestions
  .map((item) => String(item || "").trim())
  .filter(Boolean)
  .slice(0, 8);
if (questions.length === 0) {
  throw new Error("team-readonly-review requires at least one review question");
}
workflow.checkpoint("team-readonly-plan", {
  subject,
  rubric,
  questions,
  mode: "readonly",
});
const schema = {
  type: "object",
  required: ["question", "verdict", "summary", "evidenceNotes", "risks"],
  properties: {
    question: { type: "string" },
    verdict: { enum: ["yes", "no", "mixed", "unknown"] },
    summary: { type: "string" },
    evidenceNotes: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } }
  }
};
const reviews = await workflow.parallel(
  questions.map((question, index) => () =>
    workflow.agent(
      [
        "You are one read-only reviewer in a workflow-backed coding Agent Team.",
        "Do not edit files. Do not claim tests or browser checks passed unless you cite real evidence provided in context.",
        "Subject:",
        subject,
        "Question:",
        question,
        "Rubric:",
        rubric,
        "Return only JSON that matches the schema."
      ].join("\\n\\n"),
      {
        id: "readonly-review-" + (index + 1),
        title: "Read-only review " + (index + 1),
        agentType: "reviewer",
        schema,
        maxTurns: Number(params.maxTurns) > 0 ? Number(params.maxTurns) : 3
      }
    )
  )
);
function polarity(verdict) {
  if (verdict === "yes") return "yes";
  if (verdict === "no") return "no";
  return "unknown";
}
const byQuestion = new Map();
for (const review of reviews) {
  const key = String(review.data?.question || review.title || "").toLowerCase().replace(/[^a-z0-9\\u4e00-\\u9fff]+/g, "");
  if (!key) continue;
  const list = byQuestion.get(key) || [];
  list.push(review);
  byQuestion.set(key, list);
}
const conflicts = [];
for (const list of byQuestion.values()) {
  const yes = list.filter((item) => polarity(item.data?.verdict) === "yes");
  const no = list.filter((item) => polarity(item.data?.verdict) === "no");
  if (yes.length > 0 && no.length > 0) {
    conflicts.push({
      question: list[0]?.data?.question || list[0]?.title,
      yes: yes.map((item) => item.taskId),
      no: no.map((item) => item.taskId)
    });
  }
}
const failed = reviews.filter((item) => item.status !== "completed");
const status = failed.length > 0 ? "failed" : conflicts.length > 0 ? "warning" : "passed";
const synthesis = {
  templateId: workflow.template?.id || "team-readonly-review",
  status,
  subject,
  rubric,
  questionCount: questions.length,
  reviewCount: reviews.length,
  conflicts,
  failed: failed.map((item) => ({
    taskId: item.taskId,
    status: item.status,
    error: item.error
  })),
  reviews: reviews.map((item) => ({
    taskId: item.taskId,
    agentId: item.agentId,
    title: item.title,
    status: item.status,
    data: item.data,
    text: item.text
  }))
};
workflow.artifact("team-readonly-review", synthesis);
workflow.checkpoint("team-readonly-synthesis", {
  status,
  conflictCount: conflicts.length,
  failedCount: failed.length
});
if (params.requirePass === true && status !== "passed") {
  throw new Error("team-readonly-review did not pass: " + status);
}
return synthesis;
`;

const TEAM_WORKTREE_IMPLEMENTATION_SCRIPT = `
const params = workflow.params || {};
const objective = String(params.objective || workflow.objective || "Implement scoped change").slice(0, 2000);
const implementationPrompt = String(params.implementationPrompt || objective).slice(0, 4000);
const verificationPrompt = String(
  params.verificationPrompt ||
    "Review the produced diff for correctness, missing tests, regressions, and unsupported claims."
).slice(0, 3000);
const worktreeName = String(params.worktreeName || "team-implementation").slice(0, 80);
const requestMerge = params.requestMerge === true;
workflow.checkpoint("team-worktree-plan", {
  objective,
  worktreeName,
  requestMerge,
  mode: "worktree"
});
const worktree = await workflow.createWorktree({
  name: worktreeName,
  baseRef: typeof params.baseRef === "string" ? params.baseRef : undefined
});
const implementation = await workflow.agent(
  [
    "You are the implementation worker in a workflow-backed coding Agent Team.",
    "Work only inside the provided isolated workflow worktree.",
    "Do not claim tests, browser checks, or merge status unless the workflow records real evidence.",
    "Objective:",
    objective,
    "Implementation instructions:",
    implementationPrompt
  ].join("\\n\\n"),
  {
    id: "worktree-implementer",
    title: "Worktree implementer",
    agentType: "implementer",
    cwd: worktree.path,
    tools: ["read", "grep", "find", "ls", "edit", "write", "apply_patch"],
    maxTurns: Number(params.maxTurns) > 0 ? Number(params.maxTurns) : 8
  }
);
const diff = await workflow.diffWorktree(worktree);
const diffText = String(diff.diff || "");
const verifierSchema = {
  type: "object",
  required: ["verdict", "summary", "risks", "requiredEvidence"],
  properties: {
    verdict: { enum: ["pass", "warning", "fail"] },
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    requiredEvidence: { type: "array", items: { type: "string" } }
  }
};
const verifier = await workflow.agent(
  [
    "You are the verifier for a worktree-backed coding Agent Team.",
    "Review the implementation result and diff. Do not assume tests or browser checks passed unless they are in the provided evidence.",
    "Objective:",
    objective,
    "Verification rubric:",
    verificationPrompt,
    "Implementation worker status:",
    implementation.status,
    "Implementation worker text:",
    implementation.text || "",
    "Diff stat:",
    diff.stat || "(empty)",
    "Diff preview:",
    diffText.slice(0, 12000)
  ].join("\\n\\n"),
  {
    id: "worktree-verifier",
    title: "Worktree verifier",
    agentType: "verifier",
    schema: verifierSchema,
    maxTurns: Number(params.verifyMaxTurns) > 0 ? Number(params.verifyMaxTurns) : 4
  }
);
const verifierVerdict = verifier.data?.verdict || "warning";
const status =
  implementation.status !== "completed"
    ? "failed"
    : verifierVerdict === "fail"
      ? "failed"
      : verifierVerdict === "warning" || !diffText.trim()
        ? "warning"
        : "ready";
let merge = null;
if (requestMerge && status === "ready") {
  merge = await workflow.mergeWorktree(worktree);
}
const synthesis = {
  templateId: workflow.template?.id || "team-worktree-implementation",
  status: merge?.applied ? "merged" : status,
  objective,
  worktree: {
    id: worktree.id,
    path: worktree.path,
    branchName: worktree.branchName,
    baseRef: worktree.baseRef
  },
  implementation: {
    taskId: implementation.taskId,
    agentId: implementation.agentId,
    status: implementation.status,
    text: implementation.text,
    error: implementation.error
  },
  verifier: {
    taskId: verifier.taskId,
    agentId: verifier.agentId,
    status: verifier.status,
    data: verifier.data,
    text: verifier.text,
    error: verifier.error
  },
  diff: {
    stat: diff.stat,
    truncated: diffText.length > 12000,
    preview: diffText.slice(0, 12000)
  },
  mergeRequested: requestMerge,
  merge
};
workflow.artifact("team-worktree-implementation", synthesis);
workflow.checkpoint("team-worktree-synthesis", {
  status: synthesis.status,
  diffStat: diff.stat,
  mergeRequested: requestMerge,
  merged: Boolean(merge?.applied)
});
return synthesis;
`;

export const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: TEAM_READONLY_REVIEW_TEMPLATE_ID,
    name: "Team Read-only Review",
    version: "1.0.0",
    description:
      "Workflow-backed read-only Agent Team template: fan out bounded reviewers, detect obvious conflicts, and emit a synthesis artifact without write/shell/browser/network capability.",
    script: TEAM_READONLY_REVIEW_SCRIPT,
    capabilities: ["spawn_agent", "read_files"],
    maxAgents: 8,
    maxConcurrency: 4,
    timeoutMs: 300000,
    tags: ["team", "review", "readonly", "verification"],
    paramsSchema: {
      type: "object",
      required: ["subject", "questions"],
      properties: {
        subject: { type: "string" },
        questions: {
          type: "array",
          minItems: 1,
          items: { type: "string" },
        },
        rubric: { type: "string" },
        maxTurns: { type: "integer" },
        requirePass: { type: "boolean" },
      },
    },
    defaultParams: {
      questions: [],
      rubric:
        "Prioritize correctness, missing tests, behavioral regressions, unsupported claims, and unresolved risk.",
      requirePass: false,
    },
    createdAt: BUILTIN_CREATED_AT,
    updatedAt: BUILTIN_CREATED_AT,
  },
  {
    id: TEAM_WORKTREE_IMPLEMENTATION_TEMPLATE_ID,
    name: "Team Worktree Implementation",
    version: "1.0.0",
    description:
      "Workflow-backed implementation Team template: create an isolated worktree, run a bounded implementation agent inside it, review the diff, and optionally merge only through workflow merge approval.",
    script: TEAM_WORKTREE_IMPLEMENTATION_SCRIPT,
    capabilities: ["spawn_agent", "read_files", "write_files", "worktree"],
    maxAgents: 4,
    maxConcurrency: 2,
    timeoutMs: 600000,
    tags: ["team", "implementation", "worktree", "verification"],
    paramsSchema: {
      type: "object",
      required: ["objective", "implementationPrompt"],
      properties: {
        objective: { type: "string" },
        implementationPrompt: { type: "string" },
        verificationPrompt: { type: "string" },
        worktreeName: { type: "string" },
        baseRef: { type: "string" },
        requestMerge: { type: "boolean" },
        maxTurns: { type: "integer" },
        verifyMaxTurns: { type: "integer" },
      },
    },
    defaultParams: {
      requestMerge: false,
      verificationPrompt:
        "Review the produced diff for correctness, missing tests, regressions, and unsupported claims.",
    },
    createdAt: BUILTIN_CREATED_AT,
    updatedAt: BUILTIN_CREATED_AT,
  },
];

export function getBuiltinWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return BUILTIN_WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
