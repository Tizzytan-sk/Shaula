import { describe, expect, it } from "vitest";
import {
  getFilesContainerWidth,
  getRightPanelMaxWidth,
  resolveInitialWorkbenchOpen,
  resolveInitialWorkbenchView,
} from "../app/hooks/useWorkbenchController";

function storage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: () => undefined,
  };
}

describe("workbench controller helpers", () => {
  it("prefers explicit workbench view and disables persisted UI in e2e mode", () => {
    const s = storage({
      "pi-workbench-view": "browser",
      "pi-workbench-open": "1",
    });

    expect(resolveInitialWorkbenchView("", s)).toEqual({ type: "browser" });
    expect(resolveInitialWorkbenchOpen("", s)).toBe(true);
    expect(resolveInitialWorkbenchView("?e2e=1", s)).toEqual({
      type: "overview",
    });
    expect(resolveInitialWorkbenchOpen("?e2e=1", s)).toBe(false);
  });

  it("falls back to legacy right-panel storage keys", () => {
    expect(
      resolveInitialWorkbenchView("", storage({ "pi-right-panel": "files" }))
    ).toEqual({ type: "files" });
    expect(
      resolveInitialWorkbenchView("", storage({ "pi-show-files": "1" }))
    ).toEqual({ type: "files" });
    expect(
      resolveInitialWorkbenchOpen("", storage({ "pi-right-panel": "browser" }))
    ).toBe(true);
  });

  it("clamps workbench widths to preserve the chat column", () => {
    expect(getRightPanelMaxWidth(1440, true)).toBe(816);
    expect(getRightPanelMaxWidth(600, true)).toBe(320);
    expect(
      getFilesContainerWidth(
        { treeCollapsed: false, viewerHidden: false },
        900,
        816
      )
    ).toBe(816);
    expect(
      getFilesContainerWidth(
        { treeCollapsed: true, viewerHidden: true },
        900,
        816
      )
    ).toBe(56);
  });
});
