"use client";

import { useEffect, type DragEvent, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { DropOverlay } from "./DropOverlay";

interface ChatAppShellProps {
  sidebar: ReactNode;
  header: ReactNode;
  notices: ReactNode;
  mainContent: ReactNode;
  composer: ReactNode;
  workbench: ReactNode;
  overlays: ReactNode;
  isDragOver: boolean;
  showScrollToBottom: boolean;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onScrollToBottom: () => void;
}

export function ChatAppShell({
  sidebar,
  header,
  notices,
  mainContent,
  composer,
  workbench,
  overlays,
  isDragOver,
  showScrollToBottom,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onScrollToBottom,
}: ChatAppShellProps) {
  useEffect(() => {
    document.documentElement.dataset.shaulaHydrated = "app";
  }, []);

  return (
    <div
      className="flex h-screen overflow-hidden min-w-0"
      data-testid="shaula-app-shell"
      style={{
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {sidebar}

      <main
        className="flex flex-1 flex-col min-w-0 relative"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <DropOverlay isDragOver={isDragOver} />
        {header}
        {notices}
        {mainContent}

        <div className="relative shrink-0">
          {showScrollToBottom ? (
            <button
              type="button"
              onClick={onScrollToBottom}
              className="absolute left-1/2 top-0 z-20 inline-flex h-9 w-9 -translate-x-1/2 -translate-y-[calc(100%+8px)] items-center justify-center rounded-full border shadow-lg backdrop-blur transition-all hover:-translate-y-[calc(100%+10px)] hover:shadow-xl"
              style={{
                borderColor: "var(--border)",
                background:
                  "color-mix(in srgb, var(--bg-panel) 88%, transparent)",
                color: "var(--text)",
              }}
              aria-label="滚动到底部"
              title="滚动到底部"
            >
              <ArrowDown size={16} />
            </button>
          ) : null}

          {composer}
        </div>
      </main>

      {workbench}
      {overlays}
    </div>
  );
}
