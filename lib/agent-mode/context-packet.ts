import type { BuildContextPacketInput, ContextPacket } from "./types";

function cleanText(value: string | undefined, fallback: string, max = 1000): string {
  const text = value?.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, max);
}

function cleanList(values: string[] | undefined, maxItems = 12): string[] {
  return [...new Set((values ?? []).map((item) => item.trim()).filter(Boolean))]
    .slice(0, maxItems)
    .map((item) => item.slice(0, 500));
}

export function buildContextPacket(input: BuildContextPacketInput): ContextPacket {
  const modeSummary = input.modeSummary;
  const objective = cleanText(input.objective, "No objective provided.", 2000);
  return {
    objective,
    taskTitle: cleanText(input.taskTitle, objective, 160),
    taskBoundary: cleanText(
      input.taskBoundary,
      modeSummary?.contextBoundary ?? "Work only inside the assigned task boundary.",
      1000
    ),
    includeContext: (input.includeContext ?? [])
      .filter((item) => item.ref.trim())
      .slice(0, 12)
      .map((item) => ({
        kind: cleanText(item.kind, "context", 80),
        ref: cleanText(item.ref, "unknown", 500),
        summary: cleanText(item.summary, item.ref, 500),
      })),
    excludeContext: cleanList(input.excludeContext, 12),
    relevantPaths: cleanList(input.relevantPaths, 16),
    writePaths: cleanList(input.writePaths, 16),
    requiredEvidence: cleanList(input.requiredEvidence, 12),
    outputContract: {
      format: input.outputFormat ?? "summary",
      mustInclude: cleanList(input.mustInclude, 12),
      mustNotDo: cleanList(input.mustNotDo, 12),
    },
    mode: modeSummary?.mode,
    routeDecisionId: input.routeDecision?.id,
  };
}

export function renderContextPacketForPrompt(packet: ContextPacket): string {
  const lines = [
    "Context packet:",
    `- objective: ${packet.objective}`,
    `- task title: ${packet.taskTitle}`,
    `- task boundary: ${packet.taskBoundary}`,
    `- execution mode: ${packet.mode ?? "unspecified"}`,
    `- write boundary: ${
      packet.writePaths.length > 0 ? packet.writePaths.join(", ") : "read-only or parent-controlled"
    }`,
    `- required evidence: ${
      packet.requiredEvidence.length > 0 ? packet.requiredEvidence.join(", ") : "not declared"
    }`,
  ];
  if (packet.includeContext.length > 0) {
    lines.push(
      "- include context:",
      ...packet.includeContext.map(
        (item) => `  - [${item.kind}] ${item.ref}: ${item.summary}`
      )
    );
  }
  if (packet.excludeContext.length > 0) {
    lines.push(
      "- exclude context:",
      ...packet.excludeContext.map((item) => `  - ${item}`)
    );
  }
  if (packet.relevantPaths.length > 0) {
    lines.push(
      "- relevant paths:",
      ...packet.relevantPaths.map((item) => `  - ${item}`)
    );
  }
  lines.push(`- output format: ${packet.outputContract.format}`);
  if (packet.outputContract.mustInclude.length > 0) {
    lines.push(
      "- output must include:",
      ...packet.outputContract.mustInclude.map((item) => `  - ${item}`)
    );
  }
  if (packet.outputContract.mustNotDo.length > 0) {
    lines.push(
      "- output must not do:",
      ...packet.outputContract.mustNotDo.map((item) => `  - ${item}`)
    );
  }
  return lines.join("\n");
}
