import "server-only";

import fs from "node:fs";
import path from "node:path";
import { getShaulaStateRoot } from "@/lib/shaula-paths";

export type RuntimeLedgerName = "events" | "evidence";

interface RuntimeLedgerIndex {
  sessionId: string;
  updatedAt: number;
  ledgers: Partial<
    Record<
      RuntimeLedgerName,
      {
        path: string;
        updatedAt: number;
      }
    >
  >;
}

let activeRoot: string | null = null;

export function __setRuntimeLedgerRootForTest(root: string | null): void {
  activeRoot = root;
}

function getRoot(): string {
  return activeRoot ?? getShaulaStateRoot();
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

function runtimeDir(sessionId: string): string {
  assertSafeSessionId(sessionId);
  return path.join(getRoot(), "runtime", sessionId);
}

function ledgerFilePath(sessionId: string, name: RuntimeLedgerName): string {
  return path.join(runtimeDir(sessionId), `${name}.jsonl`);
}

function indexFilePath(sessionId: string): string {
  return path.join(runtimeDir(sessionId), "index.json");
}

function readIndex(sessionId: string): RuntimeLedgerIndex | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexFilePath(sessionId), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as RuntimeLedgerIndex;
  } catch {
    return null;
  }
}

function writeIndex(sessionId: string, name: RuntimeLedgerName): void {
  const now = Date.now();
  const current = readIndex(sessionId);
  const next: RuntimeLedgerIndex = {
    sessionId,
    updatedAt: now,
    ledgers: {
      ...(current?.ledgers ?? {}),
      [name]: {
        path: `${name}.jsonl`,
        updatedAt: now,
      },
    },
  };
  fs.writeFileSync(indexFilePath(sessionId), JSON.stringify(next, null, 2), "utf8");
}

export function appendRuntimeLedgerRecord(
  sessionId: string,
  name: RuntimeLedgerName,
  record: unknown
): void {
  const dir = runtimeDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    ledgerFilePath(sessionId, name),
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
  writeIndex(sessionId, name);
}

export function readRuntimeLedgerRecords<T>(
  sessionId: string,
  name: RuntimeLedgerName
): T[] {
  let text = "";
  try {
    text = fs.readFileSync(ledgerFilePath(sessionId, name), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
  const records: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {
      // Keep replay best-effort: one corrupt line should not hide later facts.
    }
  }
  return records;
}
