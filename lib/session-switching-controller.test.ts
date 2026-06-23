import { describe, expect, it } from "vitest";
import type { AgentProgress } from "./progress/types";
import { emptyRunner } from "./session-runner";
import type { SessionInfoLite } from "./types";
import {
  buildRestoredSessionPatch,
  findSessionById,
  shouldReuseLoadedRunner,
} from "../app/hooks/useSessionSwitchingController";

function session(id: string, path = `${id}.jsonl`): SessionInfoLite {
  return {
    id,
    path,
    cwd: "C:/work",
    created: "2026-06-18T00:00:00.000Z",
    modified: "2026-06-18T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
}

describe("session switching controller helpers", () => {
  it("finds sessions by id without inventing a fallback", () => {
    const sessions = [session("a"), session("b", "C:/sessions/b.jsonl")];

    expect(findSessionById(sessions, "b")?.path).toBe("C:/sessions/b.jsonl");
    expect(findSessionById(sessions, "missing")).toBeNull();
    expect(findSessionById(sessions, null)).toBeNull();
  });

  it("reuses only runners that have already finished cold loading", () => {
    expect(shouldReuseLoadedRunner(undefined)).toBe(false);
    expect(shouldReuseLoadedRunner(emptyRunner())).toBe(true);
    expect(
      shouldReuseLoadedRunner({
        ...emptyRunner(),
        sessionLoading: true,
      })
    ).toBe(false);
  });

  it("restores messages, forkable metadata, progress, and loading state", () => {
    const progress: AgentProgress = {
      steps: [],
      groups: [],
      artifacts: [],
      updatedAt: 1,
    };

    const patch = buildRestoredSessionPatch({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "continue the task" }],
        },
      ],
      forkableUserMessages: [{ entryId: "entry-1", text: "continue" }],
      progress,
    });

    expect(patch.sessionLoading).toBe(false);
    expect(patch.chatState?.messages).toHaveLength(1);
    expect(patch.chatState?.messages[0]?.role).toBe("user");
    expect(patch.forkableUserMessages).toEqual([
      { entryId: "entry-1", text: "continue" },
    ]);
    expect(patch.progress).toBe(progress);
  });
});
