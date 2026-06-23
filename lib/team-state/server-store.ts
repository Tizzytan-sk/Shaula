import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getShaulaStateRoot } from "@/lib/shaula-paths";
import type {
  TeamTask,
  TeamTaskEvent,
  TeamTaskListFilter,
  TeamTaskStatus,
  TeamTaskUpdate,
} from "./types";

const TEAM_TASK_STATE_SCHEMA_VERSION = 1;

interface PersistedTeamTaskState {
  schemaVersion: 1;
  kind: "team-task-state";
  agentId: string;
  tasks: TeamTask[];
  events: TeamTaskEvent[];
  persistedAt: number;
}

interface TeamTaskStore {
  tasks: Map<string, TeamTask>;
  events: Map<string, TeamTaskEvent>;
  byAgentId: Map<string, Set<string>>;
  hydratedAgents: Set<string>;
  hydratedAll: boolean;
  rootOverride?: string | null;
}

const g = globalThis as unknown as { __shaulaAgentTeamTaskStore?: TeamTaskStore };
if (!g.__shaulaAgentTeamTaskStore) {
  g.__shaulaAgentTeamTaskStore = {
    tasks: new Map(),
    events: new Map(),
    byAgentId: new Map(),
    hydratedAgents: new Set(),
    hydratedAll: false,
    rootOverride: null,
  };
}

const store = g.__shaulaAgentTeamTaskStore;
if (!("rootOverride" in store)) store.rootOverride = null;

function getRoot(): string {
  return store.rootOverride ?? getShaulaStateRoot();
}

function stateDir(): string {
  return path.join(getRoot(), "team-state", "agents");
}

function assertSafeId(kind: string, id: string): void {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`invalid ${kind} id: ${id}`);
  }
}

function stateFilePath(agentId: string): string {
  assertSafeId("agent", agentId);
  return path.join(stateDir(), `${agentId}.json`);
}

function compareTasks(a: TeamTask, b: TeamTask): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.id.localeCompare(b.id);
}

function compareEvents(a: TeamTaskEvent, b: TeamTaskEvent): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((item): item is string => Boolean(item)))];
}

function indexTask(task: TeamTask): void {
  let ids = store.byAgentId.get(task.agentId);
  if (!ids) {
    ids = new Set();
    store.byAgentId.set(task.agentId, ids);
  }
  ids.add(task.id);
}

function isTeamTaskStatus(value: unknown): value is TeamTaskStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "blocked" ||
    value === "completed" ||
    value === "warning" ||
    value === "failed"
  );
}

function sanitizeTask(raw: unknown): TeamTask | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TeamTask>;
  if (
    typeof item.id !== "string" ||
    typeof item.agentId !== "string" ||
    typeof item.title !== "string" ||
    !isTeamTaskStatus(item.status) ||
    !item.source ||
    typeof item.source.id !== "string" ||
    typeof item.source.type !== "string"
  ) {
    return null;
  }
  const now = Date.now();
  return {
    ...item,
    id: item.id,
    agentId: item.agentId,
    sessionId:
      typeof item.sessionId === "string" || item.sessionId === null
        ? item.sessionId
        : undefined,
    title: item.title,
    status: item.status,
    ownerType:
      item.ownerType === "subagent" ||
      item.ownerType === "workflow" ||
      item.ownerType === "human"
        ? item.ownerType
        : "main",
    dependsOn: Array.isArray(item.dependsOn)
      ? uniqueStrings(item.dependsOn)
      : [],
    writePaths: Array.isArray(item.writePaths)
      ? uniqueStrings(item.writePaths)
      : [],
    requiredEvidence: Array.isArray(item.requiredEvidence)
      ? uniqueStrings(item.requiredEvidence)
      : [],
    evidenceIds: Array.isArray(item.evidenceIds)
      ? uniqueStrings(item.evidenceIds)
      : [],
    artifactRefs: Array.isArray(item.artifactRefs)
      ? uniqueStrings(item.artifactRefs)
      : [],
    source: {
      type:
        item.source.type === "subagent" || item.source.type === "workflow"
          ? item.source.type
          : "manual",
      id: item.source.id,
      parentId:
        typeof item.source.parentId === "string"
          ? item.source.parentId
          : undefined,
    },
    createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
  } as TeamTask;
}

function sanitizeEvent(raw: unknown): TeamTaskEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TeamTaskEvent>;
  if (
    typeof item.id !== "string" ||
    typeof item.taskId !== "string" ||
    typeof item.agentId !== "string" ||
    typeof item.type !== "string" ||
    typeof item.createdAt !== "number"
  ) {
    return null;
  }
  return {
    id: item.id,
    taskId: item.taskId,
    agentId: item.agentId,
    sessionId:
      typeof item.sessionId === "string" || item.sessionId === null
        ? item.sessionId
        : undefined,
    type: item.type as TeamTaskEvent["type"],
    status: isTeamTaskStatus(item.status) ? item.status : undefined,
    evidenceIds: Array.isArray(item.evidenceIds)
      ? uniqueStrings(item.evidenceIds)
      : undefined,
    artifactRefs: Array.isArray(item.artifactRefs)
      ? uniqueStrings(item.artifactRefs)
      : undefined,
    note: typeof item.note === "string" ? item.note : undefined,
    createdAt: item.createdAt,
    metadata:
      item.metadata && typeof item.metadata === "object"
        ? item.metadata
        : undefined,
  };
}

function parsePersistedState(raw: unknown): PersistedTeamTaskState | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<PersistedTeamTaskState>;
  if (
    item.schemaVersion !== TEAM_TASK_STATE_SCHEMA_VERSION ||
    item.kind !== "team-task-state" ||
    typeof item.agentId !== "string" ||
    !Array.isArray(item.tasks) ||
    !Array.isArray(item.events)
  ) {
    return null;
  }
  const tasks = item.tasks
    .map(sanitizeTask)
    .filter((task): task is TeamTask => Boolean(task));
  const events = item.events
    .map(sanitizeEvent)
    .filter((event): event is TeamTaskEvent => Boolean(event));
  return {
    schemaVersion: TEAM_TASK_STATE_SCHEMA_VERSION,
    kind: "team-task-state",
    agentId: item.agentId,
    tasks,
    events,
    persistedAt: typeof item.persistedAt === "number" ? item.persistedAt : Date.now(),
  };
}

function persistAgent(agentId: string): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    const ids = store.byAgentId.get(agentId) ?? new Set<string>();
    const tasks = Array.from(ids)
      .map((id) => store.tasks.get(id))
      .filter((task): task is TeamTask => Boolean(task))
      .sort(compareTasks);
    const events = Array.from(store.events.values())
      .filter((event) => event.agentId === agentId)
      .sort(compareEvents);
    const persisted: PersistedTeamTaskState = {
      schemaVersion: TEAM_TASK_STATE_SCHEMA_VERSION,
      kind: "team-task-state",
      agentId,
      tasks,
      events,
      persistedAt: Date.now(),
    };
    const fp = stateFilePath(agentId);
    const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(persisted, null, 2), "utf8");
    renameSync(tmp, fp);
  } catch {
    // Team task state is recovery metadata. Runtime work should continue if
    // local persistence is temporarily unavailable.
  }
}

function hydrateAgent(agentId: string): void {
  if (store.hydratedAgents.has(agentId)) return;
  store.hydratedAgents.add(agentId);
  if (!existsSync(stateFilePath(agentId))) return;
  try {
    const parsed = parsePersistedState(
      JSON.parse(readFileSync(stateFilePath(agentId), "utf8"))
    );
    if (!parsed) return;
    for (const task of parsed.tasks) {
      store.tasks.set(task.id, task);
      indexTask(task);
    }
    for (const event of parsed.events) {
      store.events.set(event.id, event);
    }
  } catch {
    // Ignore corrupt task state for one agent. It should not block the app.
  }
}

function hydrateAll(): void {
  if (store.hydratedAll) return;
  store.hydratedAll = true;
  if (!existsSync(stateDir())) return;
  for (const file of readdirSync(stateDir())) {
    if (!file.endsWith(".json")) continue;
    hydrateAgent(file.slice(0, -5));
  }
}

function mergeTask(current: TeamTask | undefined, next: TeamTask): TeamTask {
  if (!current) return next;
  return {
    ...current,
    ...next,
    id: current.id,
    agentId: current.agentId,
    sessionId: next.sessionId ?? current.sessionId,
    dependsOn: uniqueStrings([...(current.dependsOn ?? []), ...(next.dependsOn ?? [])]),
    writePaths: uniqueStrings([...(current.writePaths ?? []), ...(next.writePaths ?? [])]),
    requiredEvidence: uniqueStrings([
      ...(current.requiredEvidence ?? []),
      ...(next.requiredEvidence ?? []),
    ]),
    evidenceIds: uniqueStrings([
      ...(current.evidenceIds ?? []),
      ...(next.evidenceIds ?? []),
    ]),
    artifactRefs: uniqueStrings([
      ...(current.artifactRefs ?? []),
      ...(next.artifactRefs ?? []),
    ]),
    source: next.source ?? current.source,
    createdAt: Math.min(current.createdAt, next.createdAt),
    updatedAt: Math.max(current.updatedAt, next.updatedAt),
  };
}

export function upsertTeamTask(update: TeamTaskUpdate): TeamTask {
  hydrateAgent(update.task.agentId);
  const current = store.tasks.get(update.task.id);
  const next = mergeTask(current, update.task);
  store.tasks.set(next.id, next);
  indexTask(next);
  if (!store.events.has(update.event.id)) {
    store.events.set(update.event.id, update.event);
  }
  persistAgent(next.agentId);
  return next;
}

export function upsertTeamTasks(updates: TeamTaskUpdate[]): TeamTask[] {
  return updates.map(upsertTeamTask);
}

export function getTeamTask(taskId: string): TeamTask | null {
  hydrateAll();
  return store.tasks.get(taskId) ?? null;
}

export function listTeamTasks(filter: TeamTaskListFilter = {}): TeamTask[] {
  if (filter.agentId) hydrateAgent(filter.agentId);
  else hydrateAll();
  const candidateIds = filter.agentId
    ? store.byAgentId.get(filter.agentId) ?? new Set<string>()
    : new Set(store.tasks.keys());
  return Array.from(candidateIds)
    .map((id) => store.tasks.get(id))
    .filter((task): task is TeamTask => Boolean(task))
    .filter((task) => {
      if (filter.sessionId !== undefined && task.sessionId !== filter.sessionId) {
        return false;
      }
      if (filter.goalId !== undefined && task.goalId !== filter.goalId) return false;
      if (filter.workflowId !== undefined && task.workflowId !== filter.workflowId) {
        return false;
      }
      if (filter.batchId !== undefined && task.batchId !== filter.batchId) return false;
      if (filter.status !== undefined && task.status !== filter.status) return false;
      if (filter.ownerType !== undefined && task.ownerType !== filter.ownerType) {
        return false;
      }
      return true;
    })
    .sort(compareTasks);
}

export function listTeamTaskEvents(filter: TeamTaskListFilter = {}): TeamTaskEvent[] {
  if (filter.agentId) hydrateAgent(filter.agentId);
  else hydrateAll();
  const taskIds = new Set(listTeamTasks(filter).map((task) => task.id));
  return Array.from(store.events.values())
    .filter((event) => taskIds.has(event.taskId))
    .sort(compareEvents);
}

export function __setTeamTaskStoreRootForTest(root: string | null): void {
  store.rootOverride = root;
  store.tasks.clear();
  store.events.clear();
  store.byAgentId.clear();
  store.hydratedAgents.clear();
  store.hydratedAll = false;
}

export function __resetTeamTaskStoreForTest(): void {
  store.tasks.clear();
  store.events.clear();
  store.byAgentId.clear();
  store.hydratedAgents.clear();
  store.hydratedAll = false;
  if (store.rootOverride) {
    rmSync(path.join(store.rootOverride, "team-state"), {
      recursive: true,
      force: true,
    });
  }
}
