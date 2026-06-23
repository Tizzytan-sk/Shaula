"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { FilesLayout } from "../components/RightPanelContainer";
import type { WorkbenchView } from "../components/WorkbenchSidebar";

export const COMPACT_WORKBENCH_BREAKPOINT = 720;
const SIDEBAR_WIDTH_OPEN = 260;
const SIDEBAR_WIDTH_CLOSED = 0;
const SPLITTER_WIDTH = 4;
const CHAT_MIN_WIDTH = 360;
const MIN_RIGHT_PANEL_WIDTH = 320;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function resolveInitialWorkbenchView(
  search: string,
  storage: Pick<StorageLike, "getItem"> | null | undefined
): WorkbenchView {
  if (search.includes("e2e=1")) return { type: "overview" };
  try {
    const stored = storage?.getItem("pi-workbench-view");
    if (
      stored === "overview" ||
      stored === "progress" ||
      stored === "outputs" ||
      stored === "files" ||
      stored === "context" ||
      stored === "browser"
    ) {
      return { type: stored };
    }
    const legacy = storage?.getItem("pi-right-panel");
    if (legacy === "files" || storage?.getItem("pi-show-files") === "1") {
      return { type: "files" };
    }
    if (legacy === "browser") return { type: "browser" };
  } catch {
    /* noop */
  }
  return { type: "overview" };
}

export function resolveInitialWorkbenchOpen(
  search: string,
  storage: Pick<StorageLike, "getItem"> | null | undefined
): boolean {
  if (search.includes("e2e=1")) return false;
  try {
    const stored = storage?.getItem("pi-workbench-open");
    if (stored === "1") return true;
    if (stored === "0") return false;
    const legacy = storage?.getItem("pi-right-panel");
    return (
      legacy === "files" ||
      legacy === "browser" ||
      storage?.getItem("pi-show-files") === "1"
    );
  } catch {
    return false;
  }
}

export function getRightPanelMaxWidth(
  viewportWidth: number,
  sidebarOpen: boolean
): number {
  const sidebarWidth = sidebarOpen ? SIDEBAR_WIDTH_OPEN : SIDEBAR_WIDTH_CLOSED;
  return Math.max(
    MIN_RIGHT_PANEL_WIDTH,
    viewportWidth - sidebarWidth - SPLITTER_WIDTH - CHAT_MIN_WIDTH
  );
}

export function getFilesContainerWidth(
  filesLayout: FilesLayout,
  rightPanelWidth: number,
  rightPanelMaxWidth: number
): number {
  if (filesLayout.viewerHidden && filesLayout.treeCollapsed) return 56;
  return Math.min(rightPanelWidth, rightPanelMaxWidth);
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function browserSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search;
}

export function useWorkbenchController() {
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchView, setWorkbenchView] = useState<WorkbenchView>({
    type: "overview",
  });
  const [browserOpenRequest, setBrowserOpenRequest] = useState<{
    id: number;
    url: string;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(480);
  const [filesLayout, setFilesLayout] = useState<FilesLayout>({
    treeCollapsed: false,
    viewerHidden: false,
  });
  const [viewportWidth, setViewportWidth] = useState(1440);

  useEffect(() => {
    queueMicrotask(() => {
      const compactViewport = window.innerWidth < COMPACT_WORKBENCH_BREAKPOINT;
      const storage = browserStorage();
      const search = browserSearch();
      const view = resolveInitialWorkbenchView(search, storage);
      setWorkbenchView(view);
      setWorkbenchOpen(
        compactViewport ? false : resolveInitialWorkbenchOpen(search, storage)
      );
      if (compactViewport) setSidebarOpen(false);
      try {
        const stored = storage?.getItem("rightPanelWidth");
        const n = stored ? Number(stored) : NaN;
        if (!compactViewport && Number.isFinite(n) && n >= MIN_RIGHT_PANEL_WIDTH) {
          const liveMax = getRightPanelMaxWidth(window.innerWidth, true);
          setRightPanelWidth(Math.min(n, liveMax));
        }
      } catch {
        /* noop */
      }
    });
  }, []);

  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setViewportWidth(width);
      if (width < COMPACT_WORKBENCH_BREAKPOINT) {
        setSidebarOpen(false);
        setWorkbenchOpen(false);
      }
    };
    onResize();
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const rightPanelMaxWidth = getRightPanelMaxWidth(viewportWidth, sidebarOpen);
  const filesContainerWidth = getFilesContainerWidth(
    filesLayout,
    rightPanelWidth,
    rightPanelMaxWidth
  );
  const rightPanelStoredWidth = Math.min(rightPanelWidth, rightPanelMaxWidth);

  useEffect(() => {
    try {
      browserStorage()?.setItem("rightPanelWidth", String(rightPanelStoredWidth));
    } catch {
      /* noop */
    }
  }, [rightPanelStoredWidth]);

  const splitterDragRef = useRef<{ startX: number; startW: number } | null>(
    null
  );
  const [rightPanelResizing, setRightPanelResizing] = useState(false);
  const rightPanelMaxWidthRef = useRef(rightPanelMaxWidth);
  useEffect(() => {
    rightPanelMaxWidthRef.current = rightPanelMaxWidth;
  }, [rightPanelMaxWidth]);

  const onSplitterMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setRightPanelResizing(true);
      splitterDragRef.current = {
        startX: e.clientX,
        startW: filesContainerWidth,
      };
      const onMove = (ev: MouseEvent) => {
        const ref = splitterDragRef.current;
        if (!ref) return;
        const dx = ref.startX - ev.clientX;
        const liveMax = rightPanelMaxWidthRef.current;
        const next = Math.min(
          liveMax,
          Math.max(MIN_RIGHT_PANEL_WIDTH, ref.startW + dx)
        );
        setRightPanelWidth((prev) => (prev === next ? prev : next));
      };
      const onUp = () => {
        splitterDragRef.current = null;
        setRightPanelResizing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [filesContainerWidth]
  );

  const persistWorkbench = useCallback((open: boolean, view: WorkbenchView) => {
    try {
      const storage = browserStorage();
      storage?.setItem("pi-workbench-open", open ? "1" : "0");
      storage?.setItem("pi-workbench-view", view.type);
    } catch {
      /* noop */
    }
  }, []);

  const openWorkbench = useCallback(
    (view: WorkbenchView) => {
      setWorkbenchView(view);
      setWorkbenchOpen(true);
      persistWorkbench(true, view);
      if (view.type === "browser" && view.url) {
        setBrowserOpenRequest({ id: Date.now(), url: view.url });
      }
    },
    [persistWorkbench]
  );

  const closeWorkbench = useCallback(
    (view: WorkbenchView = { type: "overview" }) => {
      setWorkbenchOpen(false);
      persistWorkbench(false, view);
    },
    [persistWorkbench]
  );

  const toggleWorkbench = useCallback(() => {
    setWorkbenchOpen((prev) => {
      const next = !prev;
      persistWorkbench(next, workbenchView);
      return next;
    });
  }, [persistWorkbench, workbenchView]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  return {
    workbenchOpen,
    workbenchView,
    browserOpenRequest,
    sidebarOpen,
    filesLayout,
    filesContainerWidth,
    rightPanelResizing,
    setFilesLayout,
    setSidebarOpen,
    openWorkbench,
    closeWorkbench,
    toggleWorkbench,
    toggleSidebar,
    onSplitterMouseDown,
  };
}
