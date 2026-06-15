import "server-only";

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { getShaulaStateRoot } from "@/lib/shaula-paths";
import type {
  AgentProgress,
  ProgressArtifact,
  ProgressGroup,
  ProgressStep,
} from "./types";

const MAX_STEPS = 20;
const MAX_ARTIFACTS = 30;
const MAX_GROUPS = 50;

function defaultRoot(): string {
  return getShaulaStateRoot();
}

let activeRoot: string | null = null;

export function __setProgressRuntimeRootForTests(root: string | null): void {
  activeRoot = root;
}

function getRoot(): string {
  return activeRoot ?? defaultRoot();
}

function assertSafeSessionId(sessionId: string): void {
  if (
    !sessionId ||
    sessionId.includes("/") ||
    sessionId.includes("\\") ||
    sessionId.includes("..")
  ) {
    throw new Error(`invalid sessionId: ${sessionId}`);
  }
}

function progressFilePath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return path.join(getRoot(), "runtime", sessionId, "progress.json");
}

async function ensureRuntimeDir(sessionId: string): Promise<void> {
  assertSafeSessionId(sessionId);
  await fs.mkdir(path.join(getRoot(), "runtime", sessionId), { recursive: true });
}

function isStepStatus(value: unknown): value is ProgressStep["status"] {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed"
  );
}

function sanitizeStringList(raw: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function sanitizeStep(raw: unknown): ProgressStep | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== "string" || typeof src.title !== "string") return null;
  if (!isStepStatus(src.status)) return null;
  return {
    id: src.id.slice(0, 80),
    title: src.title.slice(0, 160),
    status: src.status,
    ...(typeof src.summary === "string" ? { summary: src.summary.slice(0, 500) } : {}),
    ...(Array.isArray(src.evidenceIds)
      ? { evidenceIds: src.evidenceIds.filter((id): id is string => typeof id === "string").slice(0, 10) }
      : {}),
    ...(typeof src.startedAt === "number" ? { startedAt: src.startedAt } : {}),
    ...(typeof src.completedAt === "number" ? { completedAt: src.completedAt } : {}),
  };
}

function sanitizeArtifact(raw: unknown): ProgressArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const kind = src.kind;
  if (typeof src.id !== "string" || typeof src.title !== "string") return null;
  if (
    kind !== "file" &&
    kind !== "url" &&
    kind !== "screenshot" &&
    kind !== "test" &&
    kind !== "diff" &&
    kind !== "log" &&
    kind !== "browser" &&
    kind !== "other"
  ) {
    return null;
  }
  return {
    id: src.id.slice(0, 80),
    kind,
    title: src.title.slice(0, 160),
    ...(typeof src.href === "string" ? { href: src.href.slice(0, 1000) } : {}),
    ...(typeof src.summary === "string" ? { summary: src.summary.slice(0, 500) } : {}),
    ...(sanitizeStringList(src.requiredEvidence, 12, 80).length > 0
      ? { requiredEvidence: sanitizeStringList(src.requiredEvidence, 12, 80) }
      : {}),
    ...(typeof src.contractCriterionId === "string" && src.contractCriterionId.trim()
      ? { contractCriterionId: src.contractCriterionId.trim().slice(0, 120) }
      : {}),
    ...(typeof src.rubricCriterionId === "string" && src.rubricCriterionId.trim()
      ? { rubricCriterionId: src.rubricCriterionId.trim().slice(0, 120) }
      : {}),
    createdAt: typeof src.createdAt === "number" ? src.createdAt : Date.now(),
  };
}

function sanitizeGroup(raw: unknown): ProgressGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== "string" || typeof src.index !== "number") return null;
  const steps = Array.isArray(src.steps)
    ? src.steps.map(sanitizeStep).filter((s): s is ProgressStep => Boolean(s))
    : [];
  return {
    id: src.id.slice(0, 80),
    index: src.index,
    steps: steps.slice(-MAX_STEPS),
    startedAt: typeof src.startedAt === "number" ? src.startedAt : Date.now(),
    ...(typeof src.endedAt === "number" ? { endedAt: src.endedAt } : {}),
  };
}

function sanitizeProgress(raw: unknown): AgentProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const groups = Array.isArray(src.groups)
    ? src.groups
        .map(sanitizeGroup)
        .filter((g): g is ProgressGroup => Boolean(g))
        .slice(-MAX_GROUPS)
    : [];
  const fallbackSteps = Array.isArray(src.steps)
    ? src.steps.map(sanitizeStep).filter((s): s is ProgressStep => Boolean(s))
    : [];
  const steps = groups.at(-1)?.steps ?? fallbackSteps.slice(-MAX_STEPS);
  const artifacts = Array.isArray(src.artifacts)
    ? src.artifacts.map(sanitizeArtifact).filter((a): a is ProgressArtifact => Boolean(a))
    : [];
  return {
    steps,
    groups,
    artifacts: artifacts.slice(-MAX_ARTIFACTS),
    updatedAt: typeof src.updatedAt === "number" ? src.updatedAt : Date.now(),
  };
}

export async function readPersistedProgress(sessionId: string): Promise<AgentProgress | null> {
  let text: string;
  try {
    text = await fs.readFile(progressFilePath(sessionId), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
  try {
    return sanitizeProgress(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writePersistedProgress(
  sessionId: string,
  progress: AgentProgress
): Promise<void> {
  const sanitized = sanitizeProgress(progress);
  if (!sanitized) throw new Error("invalid progress payload");
  await ensureRuntimeDir(sessionId);
  const fp = progressFilePath(sessionId);
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(sanitized, null, 2), "utf8");
  await fs.rename(tmp, fp);
}

export async function deletePersistedProgress(sessionId: string): Promise<void> {
  try {
    await fs.unlink(progressFilePath(sessionId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
