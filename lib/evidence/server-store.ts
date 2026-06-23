import type { EvidenceListFilter, EvidenceRef } from "./types";
import { normalizeEvidenceRef } from "./ledger";
import {
  appendRuntimeLedgerRecord,
  readRuntimeLedgerRecords,
} from "@/lib/runtime/file-ledger";

interface EvidenceStore {
  byId: Map<string, EvidenceRef>;
}

const MAX_EVIDENCE_REFS = 5000;

const g = globalThis as unknown as { __shaulaAgentEvidenceStore?: EvidenceStore };
if (!g.__shaulaAgentEvidenceStore) {
  g.__shaulaAgentEvidenceStore = { byId: new Map() };
}
const store = g.__shaulaAgentEvidenceStore;
const loadedSessions = new Set<string>();

function matches(value: string | null | undefined, expected?: string | null): boolean {
  return expected === undefined || value === expected;
}

function compareEvidence(a: EvidenceRef, b: EvidenceRef): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

function pruneEvidence(): void {
  const overflow = store.byId.size - MAX_EVIDENCE_REFS;
  if (overflow <= 0) return;
  const oldest = [...store.byId.values()]
    .map(normalizeEvidenceRef)
    .sort(compareEvidence)
    .slice(0, overflow);
  for (const item of oldest) {
    store.byId.delete(item.id);
  }
}

function isEvidenceKind(value: unknown): value is EvidenceRef["kind"] {
  return (
    value === "browser_snapshot" ||
    value === "browser_step" ||
    value === "browser_annotation" ||
    value === "workflow_artifact" ||
    value === "subagent_result" ||
    value === "goal_turn" ||
    value === "approval_decision" ||
    value === "progress_artifact" ||
    value === "verification_result" ||
    value === "log"
  );
}

function evidenceFromLedger(raw: unknown): EvidenceRef | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<EvidenceRef>;
  if (
    typeof item.id !== "string" ||
    !isEvidenceKind(item.kind) ||
    typeof item.title !== "string" ||
    typeof item.createdAt !== "number"
  ) {
    return null;
  }
  return normalizeEvidenceRef(item as EvidenceRef);
}

function persistEvidence(evidence: EvidenceRef): void {
  const sessionId = evidence.sessionId;
  if (!sessionId) return;
  try {
    appendRuntimeLedgerRecord(sessionId, "evidence", evidence);
    loadedSessions.add(sessionId);
  } catch (err) {
    console.warn("[evidence-ledger] persist failed:", err);
  }
}

function hydrateEvidenceForSession(sessionId: string | null | undefined): void {
  if (!sessionId || loadedSessions.has(sessionId)) return;
  loadedSessions.add(sessionId);
  for (const raw of readRuntimeLedgerRecords<unknown>(sessionId, "evidence")) {
    const evidence = evidenceFromLedger(raw);
    if (!evidence) continue;
    const current = store.byId.get(evidence.id);
    store.byId.set(
      evidence.id,
      normalizeEvidenceRef(current ? { ...current, ...evidence } : evidence)
    );
  }
  pruneEvidence();
}

export function appendEvidence(evidence: EvidenceRef): EvidenceRef {
  const normalized = normalizeEvidenceRef(evidence);
  const current = store.byId.get(evidence.id);
  const next = normalizeEvidenceRef(
    current ? { ...current, ...normalized } : normalized
  );
  store.byId.set(evidence.id, next);
  persistEvidence(next);
  pruneEvidence();
  return next;
}

export function appendEvidenceMany(items: EvidenceRef[]): EvidenceRef[] {
  return items.map(appendEvidence);
}

export function getEvidence(id: string): EvidenceRef | null {
  const evidence = store.byId.get(id);
  return evidence ? normalizeEvidenceRef(evidence) : null;
}

export function listEvidence(filter: EvidenceListFilter = {}): EvidenceRef[] {
  hydrateEvidenceForSession(filter.sessionId);
  return [...store.byId.values()]
    .map(normalizeEvidenceRef)
    .filter((item) => {
      if (filter.kind !== undefined && item.kind !== filter.kind) return false;
      if (filter.trustLevel !== undefined && item.trustLevel !== filter.trustLevel) {
        return false;
      }
      if (filter.sourceType !== undefined && item.source?.type !== filter.sourceType) {
        return false;
      }
      if (
        filter.contractCriterionId !== undefined &&
        !item.criteria?.some(
          (criterion) => criterion.contractCriterionId === filter.contractCriterionId
        )
      ) {
        return false;
      }
      if (
        filter.rubricCriterionId !== undefined &&
        !item.criteria?.some(
          (criterion) => criterion.rubricCriterionId === filter.rubricCriterionId
        )
      ) {
        return false;
      }
      return (
        matches(item.sessionId, filter.sessionId) &&
        matches(item.agentId, filter.agentId) &&
        matches(item.browserId, filter.browserId) &&
        matches(item.taskId, filter.taskId) &&
        matches(item.workflowId, filter.workflowId)
      );
    })
    .sort(compareEvidence);
}

export function removeEvidence(id: string): boolean {
  return store.byId.delete(id);
}

export function __resetEvidenceStoreForTest(): void {
  store.byId.clear();
  loadedSessions.clear();
}
