import "server-only";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { getShaulaStateRoot } from "@/lib/shaula-paths";
import {
  EXECUTION_CONTRACT_VERSION,
  type ExecutionAcceptanceCriterion,
  type ExecutionContract,
  type ExecutionMainArtifact,
  type ExecutionMainArtifactKind,
  type ExecutionProfileSelection,
} from "./types";

interface ExecutionContractStore {
  byId: Map<string, ExecutionContract>;
}

const g = globalThis as unknown as {
  __shaulaExecutionContracts?: ExecutionContractStore;
};
if (!g.__shaulaExecutionContracts) {
  g.__shaulaExecutionContracts = { byId: new Map() };
}
const store = g.__shaulaExecutionContracts;

let activeRoot: string | null = null;
let hydrated = false;

function getRoot(): string {
  return activeRoot ?? getShaulaStateRoot();
}

function contractsDir(): string {
  return path.join(getRoot(), "execution-contracts");
}

function assertSafeId(kind: string, id: string): void {
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`invalid execution contract ${kind}: ${id}`);
  }
}

function agentDir(agentId: string): string {
  assertSafeId("agent id", agentId);
  return path.join(contractsDir(), agentId);
}

function contractFilePath(contract: Pick<ExecutionContract, "agentId" | "id">): string {
  assertSafeId("id", contract.id);
  return path.join(agentDir(contract.agentId), `${contract.id}.json`);
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizeCriteria(value: unknown): ExecutionAcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `criterion-${index + 1}`,
      description:
        typeof item.description === "string" ? item.description : "",
      required: item.required !== false,
      evidenceRequired: cleanStringArray(item.evidenceRequired),
    }))
    .filter((item) => item.description);
}

function sanitizeProfileSelection(value: unknown): ExecutionProfileSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const source =
    src.source === "override" || src.source === "inferred"
      ? src.source
      : undefined;
  if (!source) return undefined;
  const selectedProfile =
    typeof src.selectedProfile === "string" ? src.selectedProfile : "";
  const inferredProfile =
    typeof src.inferredProfile === "string" ? src.inferredProfile : "";
  if (!selectedProfile || !inferredProfile) return undefined;
  return {
    source,
    selectedProfile,
    inferredProfile,
    ...(typeof src.overrideProfile === "string" && src.overrideProfile
      ? { overrideProfile: src.overrideProfile }
      : {}),
  };
}

function isMainArtifactKind(value: unknown): value is ExecutionMainArtifactKind {
  return (
    value === "file" ||
    value === "directory" ||
    value === "url" ||
    value === "route" ||
    value === "other"
  );
}

function sanitizeMainArtifact(value: unknown): ExecutionMainArtifact | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const label = typeof src.label === "string" ? src.label.trim().slice(0, 500) : "";
  if (!label) return undefined;
  const source =
    src.source === "explicit" ||
    src.source === "attachment" ||
    src.source === "scope" ||
    src.source === "objective" ||
    src.source === "inferred"
      ? src.source
      : "inferred";
  return {
    kind: isMainArtifactKind(src.kind) ? src.kind : "other",
    label,
    ...(typeof src.href === "string" && src.href.trim()
      ? { href: src.href.trim().slice(0, 1000) }
      : {}),
    source,
  };
}

function sanitizeContract(raw: unknown): ExecutionContract | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.id !== "string" || !src.id) return null;
  if (typeof src.agentId !== "string" || !src.agentId) return null;
  if (typeof src.objective !== "string" || !src.objective) return null;
  if (typeof src.createdAt !== "number") return null;
  const contract: ExecutionContract = {
    id: src.id,
    version: EXECUTION_CONTRACT_VERSION,
    agentId: src.agentId,
    objective: src.objective,
    scope: cleanStringArray(src.scope),
    nonGoals: cleanStringArray(src.nonGoals),
    acceptanceCriteria: sanitizeCriteria(src.acceptanceCriteria),
    requiredEvidence: cleanStringArray(src.requiredEvidence),
    mainArtifact: sanitizeMainArtifact(src.mainArtifact),
    rubricProfile:
      typeof src.rubricProfile === "string" && src.rubricProfile
        ? src.rubricProfile
        : "workflow.default",
    profileSelection: sanitizeProfileSelection(src.profileSelection),
    allowedCapabilities: cleanStringArray(src.allowedCapabilities),
    budgetHints:
      src.budgetHints && typeof src.budgetHints === "object"
        ? (src.budgetHints as ExecutionContract["budgetHints"])
        : undefined,
    stopPolicy:
      src.stopPolicy && typeof src.stopPolicy === "object"
        ? (src.stopPolicy as ExecutionContract["stopPolicy"])
        : undefined,
    createdAt: src.createdAt,
    updatedAt:
      typeof src.updatedAt === "number" ? src.updatedAt : src.createdAt,
  };
  assertSafeId("agent id", contract.agentId);
  assertSafeId("id", contract.id);
  return contract;
}

function hydrateFromDisk(): void {
  if (hydrated) return;
  hydrated = true;
  const root = contractsDir();
  if (!existsSync(root)) return;
  for (const agentName of readdirSync(root)) {
    const dir = path.join(root, agentName);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const contract = sanitizeContract(
          JSON.parse(readFileSync(path.join(dir, name), "utf8"))
        );
        if (contract) store.byId.set(contract.id, contract);
      } catch {
        // Corrupt contracts should not block other agents.
      }
    }
  }
}

function persistContract(contract: ExecutionContract): void {
  mkdirSync(agentDir(contract.agentId), { recursive: true });
  const fp = contractFilePath(contract);
  const tmp = `${fp}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(contract, null, 2), "utf8");
  renameSync(tmp, fp);
}

export function putExecutionContract(
  contract: ExecutionContract
): ExecutionContract {
  const next = sanitizeContract(contract);
  if (!next) throw new Error("invalid execution contract");
  store.byId.set(next.id, next);
  try {
    persistContract(next);
  } catch {
    // Contract persistence is important but should not block goal start when
    // the local metadata directory is temporarily unavailable.
  }
  return next;
}

export function getExecutionContract(id: string | null | undefined): ExecutionContract | null {
  if (!id) return null;
  hydrateFromDisk();
  return store.byId.get(id) ?? null;
}

export function listExecutionContracts(filter?: {
  agentId?: string;
}): ExecutionContract[] {
  hydrateFromDisk();
  return [...store.byId.values()]
    .filter((contract) => !filter?.agentId || contract.agentId === filter.agentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function __setExecutionContractStoreRootForTest(root: string | null): void {
  activeRoot = root;
  hydrated = false;
  store.byId.clear();
}

export function __resetExecutionContractStoreForTest(): void {
  hydrated = false;
  store.byId.clear();
}
