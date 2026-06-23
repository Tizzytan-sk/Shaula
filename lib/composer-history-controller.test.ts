import { describe, expect, it } from "vitest";
import {
  INPUT_HISTORY_KEY,
  addComposerHistoryEntry,
  readComposerHistory,
} from "../app/hooks/useComposerHistoryController";

function storage(raw: string | null) {
  return {
    getItem: (key: string) => (key === INPUT_HISTORY_KEY ? raw : null),
  };
}

describe("composer history controller helpers", () => {
  it("reads only string history entries", () => {
    expect(
      readComposerHistory(storage(JSON.stringify(["one", 2, null, "two"])))
    ).toEqual(["one", "two"]);
    expect(readComposerHistory(storage("{bad json"))).toEqual([]);
    expect(readComposerHistory(storage(JSON.stringify({ nope: true })))).toEqual(
      []
    );
  });

  it("adds trimmed entries, deduplicates, and preserves recency order", () => {
    expect(addComposerHistoryEntry(["a", "b", "c"], "  b  ")).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(addComposerHistoryEntry(["a"], "   ")).toEqual(["a"]);
  });

  it("keeps only the newest entries within the limit", () => {
    expect(addComposerHistoryEntry(["a", "b", "c"], "d", 3)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});
