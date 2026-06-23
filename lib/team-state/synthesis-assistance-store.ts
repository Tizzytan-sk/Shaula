import "server-only";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getShaulaStateRoot } from "@/lib/shaula-paths";
import type {
  TeamTaskSynthesisAssistance,
  TeamTaskSynthesisAssistanceMeta,
} from "./synthesis";

const TEAM_SYNTHESIS_ASSISTANCE_SCHEMA_VERSION = 1;
const MAX_RECORDS_PER_AGENT = 20;

export interface TeamSynthesisAssistanceModelInfo {
  provider: string;
  id: string;
  name?: string;
}

export interface TeamSynthesisAssistanceRecord {
  agentId: string;
  fingerprint: string;
  assistance: TeamTaskSynthesisAssistance;
  model?: TeamSynthesisAssistanceModelInfo;
  latencyMs?: number;
  httpStatus?: number;
  tokenCount?: number;
  estimatedCost?: number;
  createdAt: number;
  updatedAt: number;
}

interface PersistedTeamSynthesisAssistance {
  schemaVersion: 1;
  kind: "team-synthesis-assistance";
  agentId: string;
  records: TeamSynthesisAssistanceRecord[];
  persistedAt: number;
}

interface TeamSynthesisAssistanceStore {
  records: Map<string, TeamSynthesisAssistanceRecord>;
  byAgentId: Map<string, Set<string>>;
  hydratedAgents: Set<string>;
  rootOverride?: string | null;
}

const g = globalThis as unknown as {
  __shaulaTeamSynthesisAssistanceStore?: TeamSynthesisAssistanceStore;
};
if (!g.__shaulaTeamSynthesisAssistanceStore) {
  g.__shaulaTeamSynthesisAssistanceStore = {
    records: new Map(),
    byAgentId: new Map(),
    hydratedAgents: new Set(),
    rootOverride: null,
  };
}

const store = g.__shaulaTeamSynthesisAssistanceStore;
if (!("rootOverride" in store)) store.rootOverride = null;

function getRoot(): string {
  return store.rootOverride ?? getShaulaStateRoot();
}

function stateDir(): string {
  return path.join(getRoot(), "team-state", "synthesis-assistance", "agents");
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

function recordKey(agentId: string, fingerprint: string): string {
  assertSafeId("agent", agentId);
  assertSafeId("fingerprint", fingerprint);
  return `${agentId}:${fingerprint}`;
}

function indexRecord(record: TeamSynthesisAssistanceRecord): void {
  let fingerprints = store.byAgentId.get(record.agentId);
  if (!fingerprints) {
    fingerprints = new Set();
    store.byAgentId.set(record.agentId, fingerprints);
  }
  fingerprints.add(record.fingerprint);
}

function isAssistanceStatus(value: unknown): value is TeamTaskSynthesisAssistance["status"] {
  return value === "accepted" || value === "rejected";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sanitizeAssistance(raw: unknown): TeamTaskSynthesisAssistance | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TeamTaskSynthesisAssistance>;
  if (
    !isAssistanceStatus(item.status) ||
    item.source !== "llm_assisted" ||
    typeof item.generatedAt !== "number"
  ) {
    return null;
  }
  return {
    status: item.status,
    source: "llm_assisted",
    generatedAt: item.generatedAt,
    headline: typeof item.headline === "string" ? item.headline : undefined,
    summary: typeof item.summary === "string" ? item.summary : undefined,
    itemIds: stringList(item.itemIds),
    taskIds: stringList(item.taskIds),
    evidenceIds: stringList(item.evidenceIds),
    warnings: stringList(item.warnings),
  };
}

function sanitizeRecord(raw: unknown): TeamSynthesisAssistanceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<TeamSynthesisAssistanceRecord>;
  if (
    typeof item.agentId !== "string" ||
    typeof item.fingerprint !== "string" ||
    typeof item.createdAt !== "number" ||
    typeof item.updatedAt !== "number"
  ) {
    return null;
  }
  const assistance = sanitizeAssistance(item.assistance);
  if (!assistance) return null;
  return {
    agentId: item.agentId,
    fingerprint: item.fingerprint,
    assistance,
    model:
      item.model &&
      typeof item.model.provider === "string" &&
      typeof item.model.id === "string"
        ? {
            provider: item.model.provider,
            id: item.model.id,
            name: typeof item.model.name === "string" ? item.model.name : undefined,
          }
        : undefined,
    latencyMs: optionalNumber(item.latencyMs),
    httpStatus: optionalNumber(item.httpStatus),
    tokenCount: optionalNumber(item.tokenCount),
    estimatedCost: optionalNumber(item.estimatedCost),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function parsePersisted(raw: unknown): PersistedTeamSynthesisAssistance | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<PersistedTeamSynthesisAssistance>;
  if (
    item.schemaVersion !== TEAM_SYNTHESIS_ASSISTANCE_SCHEMA_VERSION ||
    item.kind !== "team-synthesis-assistance" ||
    typeof item.agentId !== "string" ||
    !Array.isArray(item.records)
  ) {
    return null;
  }
  return {
    schemaVersion: TEAM_SYNTHESIS_ASSISTANCE_SCHEMA_VERSION,
    kind: "team-synthesis-assistance",
    agentId: item.agentId,
    records: item.records
      .map(sanitizeRecord)
      .filter((record): record is TeamSynthesisAssistanceRecord => Boolean(record)),
    persistedAt: typeof item.persistedAt === "number" ? item.persistedAt : Date.now(),
  };
}

function hydrateAgent(agentId: string): void {
  if (store.hydratedAgents.has(agentId)) return;
  store.hydratedAgents.add(agentId);
  if (!existsSync(stateFilePath(agentId))) return;
  try {
    const parsed = parsePersisted(
      JSON.parse(readFileSync(stateFilePath(agentId), "utf8"))
    );
    if (!parsed) return;
    for (const record of parsed.records) {
      store.records.set(recordKey(record.agentId, record.fingerprint), record);
      indexRecord(record);
    }
  } catch {
    // Optional assist cache should not block Team state rendering.
  }
}

function persistAgent(agentId: string): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    const records = Array.from(store.byAgentId.get(agentId) ?? [])
      .map((fingerprint) => store.records.get(recordKey(agentId, fingerprint)))
      .filter((record): record is TeamSynthesisAssistanceRecord => Boolean(record))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECORDS_PER_AGENT);
    const keep = new Set(records.map((record) => record.fingerprint));
    for (const fingerprint of Array.from(store.byAgentId.get(agentId) ?? [])) {
      if (keep.has(fingerprint)) continue;
      store.records.delete(recordKey(agentId, fingerprint));
      store.byAgentId.get(agentId)?.delete(fingerprint);
    }
    const persisted: PersistedTeamSynthesisAssistance = {
      schemaVersion: TEAM_SYNTHESIS_ASSISTANCE_SCHEMA_VERSION,
      kind: "team-synthesis-assistance",
      agentId,
      records,
      persistedAt: Date.now(),
    };
    const fp = stateFilePath(agentId);
    const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(persisted, null, 2), "utf8");
    renameSync(tmp, fp);
  } catch {
    // Optional cache only.
  }
}

export function getTeamSynthesisAssistance(
  agentId: string,
  fingerprint: string
): TeamSynthesisAssistanceRecord | null {
  hydrateAgent(agentId);
  return store.records.get(recordKey(agentId, fingerprint)) ?? null;
}

export function putTeamSynthesisAssistance(
  record: TeamSynthesisAssistanceRecord
): TeamSynthesisAssistanceRecord {
  hydrateAgent(record.agentId);
  const key = recordKey(record.agentId, record.fingerprint);
  const current = store.records.get(key);
  const next: TeamSynthesisAssistanceRecord = {
    ...record,
    createdAt: current?.createdAt ?? record.createdAt,
    updatedAt: Math.max(current?.updatedAt ?? 0, record.updatedAt),
  };
  store.records.set(key, next);
  indexRecord(next);
  persistAgent(next.agentId);
  return next;
}

export function teamSynthesisAssistanceWithMeta(
  record: TeamSynthesisAssistanceRecord,
  cached: boolean
): TeamTaskSynthesisAssistance {
  const meta: TeamTaskSynthesisAssistanceMeta = {
    ...record.assistance.meta,
    fingerprint: record.fingerprint,
    cached,
    model: record.model,
    latencyMs: record.latencyMs,
    httpStatus: record.httpStatus,
    tokenCount: record.tokenCount,
    estimatedCost: record.estimatedCost,
    updatedAt: record.updatedAt,
  };
  return {
    ...record.assistance,
    meta,
  };
}

export function __setTeamSynthesisAssistanceStoreRootForTest(
  root: string | null
): void {
  store.rootOverride = root;
  store.records.clear();
  store.byAgentId.clear();
  store.hydratedAgents.clear();
}

export function __resetTeamSynthesisAssistanceStoreForTest(): void {
  store.records.clear();
  store.byAgentId.clear();
  store.hydratedAgents.clear();
  if (store.rootOverride) {
    rmSync(path.join(store.rootOverride, "team-state", "synthesis-assistance"), {
      recursive: true,
      force: true,
    });
  }
}
