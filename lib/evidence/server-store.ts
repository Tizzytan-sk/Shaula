import type { EvidenceListFilter, EvidenceRef } from "./types";
import { normalizeEvidenceRef } from "./ledger";

interface EvidenceStore {
  byId: Map<string, EvidenceRef>;
}

const MAX_EVIDENCE_REFS = 5000;

const g = globalThis as unknown as { __shaulaAgentEvidenceStore?: EvidenceStore };
if (!g.__shaulaAgentEvidenceStore) {
  g.__shaulaAgentEvidenceStore = { byId: new Map() };
}
const store = g.__shaulaAgentEvidenceStore;

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

export function appendEvidence(evidence: EvidenceRef): EvidenceRef {
  const normalized = normalizeEvidenceRef(evidence);
  const current = store.byId.get(evidence.id);
  const next = normalizeEvidenceRef(
    current ? { ...current, ...normalized } : normalized
  );
  store.byId.set(evidence.id, next);
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
}
