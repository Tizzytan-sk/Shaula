"use client";

/**
 * SystemPromptModal —— 展示当前会话「拼出来的 system prompt」全文。
 * RFC-1 阶段 C4：从 ChatApp.tsx 抽出，纯展示组件。
 *
 * 设计要点：
 *   - 受控：父组件管理 open + text 两个 state，自己只负责渲染
 *   - text 三态：null = Loading / "" = 提示先发消息 / 非空 = pre 渲染
 *   - 点击遮罩 / Close 按钮触发 onClose
 */

export interface SystemPromptModalProps {
  text: string | null;
  onClose: () => void;
}

export function SystemPromptModal({ text, onClose }: SystemPromptModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-overlay)" }}
      onClick={onClose}
    >
      <div
        className="rounded-md w-full max-w-3xl max-h-[80vh] flex flex-col"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          color: "var(--fg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <h2 className="text-sm font-semibold">系统提示词</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (text) void navigator.clipboard.writeText(text);
              }}
              className="px-2 py-1 text-xs rounded border hover:opacity-80"
              style={{ borderColor: "var(--border)" }}
              disabled={!text}
            >
              复制
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-xs rounded border hover:opacity-80"
              style={{ borderColor: "var(--border)" }}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 p-3">
          {text == null ? (
            <div className="text-xs" style={{ color: "var(--fg-faint)" }}>
              正在读取系统提示词…
            </div>
          ) : text === "" ? (
            <div className="text-xs" style={{ color: "var(--fg-faint)" }}>
              当前会话还没有可显示的系统提示词。先发送一条消息后再查看。
            </div>
          ) : (
            <pre
              className="whitespace-pre-wrap font-mono text-token-sm leading-[1.45]"
              style={{ color: "var(--fg)" }}
            >
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
