"use client";

import { CheckCircle2, Download, Loader2, X } from "lucide-react";
import type { UpdateState } from "@/lib/electron-bridge";
import type { SessionInfoLite } from "@/lib/types";
import { Button, TokenIconButton } from "./DesignPrimitives";

export function UpdateNotice({
  onView,
  onClose,
}: {
  state: UpdateState;
  onView: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-12 z-40 w-[300px] rounded-token-lg border border-[color:var(--border)] bg-[color:var(--bg-panel)] p-2.5 text-[color:var(--text)] shadow-popover">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-[var(--control-sm)] w-[var(--control-sm)] shrink-0 items-center justify-center rounded-token border border-[color:var(--color-info)] bg-[color:var(--color-info-bg)] text-[color:var(--color-info)]">
          <Download size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-token-ui font-semibold">
            Shaula 有可用更新
          </div>
          <div className="mt-0.5 text-token-sm text-[color:var(--text-muted)]">
            安装后可以使用最新能力。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              onClick={onView}
              tone="info"
              variant="soft"
              size="sm"
              leading={<Download size={13} />}
            >
              查看
            </Button>
          </div>
        </div>
        <TokenIconButton
          onClick={onClose}
          icon={<X size={14} />}
          size="xs"
          variant="ghost"
          title="关闭"
          aria-label="关闭更新提醒"
        />
      </div>
    </div>
  );
}

export function UpdateLatestNotice({
  onClose,
}: {
  state: UpdateState;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-12 z-40 w-[300px] rounded-token-lg border border-[color:var(--border)] bg-[color:var(--bg-panel)] p-2.5 text-[color:var(--text)] shadow-popover">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-[var(--control-sm)] w-[var(--control-sm)] shrink-0 items-center justify-center rounded-token border border-[color:var(--color-success)] bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]">
          <CheckCircle2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-token-ui font-semibold">Shaula 已是最新</div>
          <div className="mt-0.5 text-token-sm text-[color:var(--text-muted)]">
            现在可以继续工作。
          </div>
        </div>
        <TokenIconButton
          onClick={onClose}
          icon={<X size={14} />}
          size="xs"
          variant="ghost"
          title="关闭"
          aria-label="关闭更新状态提示"
        />
      </div>
    </div>
  );
}

export function SessionLoadingState({
  session,
}: {
  session: SessionInfoLite | null;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <Loader2
          size={22}
          className="mb-3 animate-spin text-[color:var(--accent)]"
        />
        <div className="text-token-ui font-semibold text-[color:var(--text)]">
          正在打开任务
        </div>
        <div className="mt-1 max-w-[320px] truncate text-token-sm text-[color:var(--text-muted)]">
          {session?.meta?.title || session?.name || session?.firstMessage || "加载历史上下文"}
        </div>
      </div>
    </div>
  );
}
