"use client";

/**
 * Markdown 渲染（带 GFM + code highlight）。
 * 用 light/dark 两套主题，根据 documentElement 上的 data-theme 切。
 */
import dynamic from "next/dynamic";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useMemo, useSyncExternalStore } from "react";
import { previewStore } from "@/lib/preview-store";

const MarkdownCodeBlock = dynamic(() => import("./MarkdownCodeBlock"), {
  ssr: false,
  loading: () => <CodeBlockFallback />,
});

/**
 * 主题(light/dark)单例 store。
 * 之前每个 <Markdown> 实例都会建一个 MutationObserver,一屏 50 条消息 = 50 个 observer;
 * 改成模块级单例 + useSyncExternalStore,所有订阅者共享一份观察器。
 */
const themeStore = (() => {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  let cached = false;
  let observer: MutationObserver | null = null;

  const compute = () =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";

  const ensureObserver = () => {
    if (observer || typeof document === "undefined") return;
    cached = compute();
    observer = new MutationObserver(() => {
      const next = compute();
      if (next !== cached) {
        cached = next;
        for (const l of listeners) l();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  };

  return {
    subscribe(l: Listener): () => void {
      ensureObserver();
      listeners.add(l);
      return () => {
        listeners.delete(l);
        // 没人订阅了就拆掉 observer,留好资源(下次有人订阅再 ensureObserver)
        if (listeners.size === 0 && observer) {
          observer.disconnect();
          observer = null;
        }
      };
    },
    getSnapshot(): boolean {
      // SSR 期不能访问 DOM,用 cached 默认 false
      return cached;
    },
    getServerSnapshot(): boolean {
      return false;
    },
  };
})();

function useIsLight(): boolean {
  return useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot
  );
}

function CodeBlockFallback() {
  return (
    <pre
      style={{
        margin: "4px 0",
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        overflowX: "auto",
      }}
    >
      Loading code...
    </pre>
  );
}

interface Props {
  text: string;
  /** small=用于 tool 渲染器里，字体小一号 */
  size?: "normal" | "small";
  /**
   * 流式中:该消息还在 token-by-token 接收。此时不走 ReactMarkdown,
   * 直接 <pre> 显示纯文本。流完(message_end)后切回完整 markdown。
   * 收益:每 token 不再全文 re-parse + Prism re-tokenize。
   */
  streaming?: boolean;
  /** 当前会话 cwd:用于把消息里出现的相对图片路径解析成绝对路径并自动渲染 */
  cwd?: string;
  /** http(s) 链接点击处理；聊天区用于改走右侧 Browser Panel */
  onOpenUrl?: (href: string) => void;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)\b/i;
/**
 * 识别消息文本中的本地图片绝对路径,把它(以及 `路径`、 ![](路径) 形态)
 * 统一规范为 ![](api-url) ,让 ReactMarkdown 自然渲染成图片。
 *
 * 规则:
 * - 已经是 ![](...) 的不动
 * - inline code(反引号)里若是本地图片绝对路径,展开成图片
 * - 裸文本里独立成"词"的本地绝对路径(/ 开头,以图片扩展名结尾) → 图片
 * - 其他形式(URL 链接、相对路径)不处理,交给 markdown 原生处理
 */
function inlineLocalImages(input: string, cwd?: string): string {
  // 把"路径"规范成绝对路径:绝对路径直接用,相对路径前面拼 cwd
  const toAbs = (p: string): string | null => {
    if (p.startsWith("/")) return p;
    if (!cwd) return null;
    const clean = p.replace(/^\.\/+/, "");
    return cwd.endsWith("/") ? cwd + clean : cwd + "/" + clean;
  };
  const toUrl = (abs: string): string =>
    `/api/files?path=${encodeURIComponent(abs)}&raw=1`;

  // 1) inline code 形态:`abs.png` 或 `relative/path.png`
  let out = input.replace(/`([^`\n]+\.[a-z0-9]+)`/gi, (m, p1: string) => {
    if (!IMAGE_EXT_RE.test(p1)) return m;
    if (/^https?:\/\//i.test(p1)) return m;
    const abs = toAbs(p1);
    if (!abs) return m;
    return `![](${toUrl(abs)})`;
  });
  // 2) 裸路径:绝对路径(/ 开头)
  out = out.replace(
    /(^|\s)(\/[^\s)\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))(?=\s|$|[)\].,;])/gi,
    (_m, pre: string, p1: string) => `${pre}![](${toUrl(p1)})`
  );
  // 3) 裸路径:相对路径(只有给了 cwd 才认),要求至少一个斜杠避免误伤纯文件名
  if (cwd) {
    out = out.replace(
      /(^|\s)((?:\.\/)?[\w][\w./-]*\/[\w./-]*\.(?:png|jpe?g|gif|webp|svg|bmp|avif))(?=\s|$|[)\].,;])/gi,
      (m, pre: string, p1: string) => {
        if (p1.startsWith("/")) return m;
        const abs = toAbs(p1);
        if (!abs) return m;
        return `${pre}![](${toUrl(abs)})`;
      }
    );
  }
  return out;
}

function MarkdownInner({
  text,
  size = "normal",
  streaming = false,
  cwd,
  onOpenUrl,
}: Props) {
  const isLight = useIsLight();
  const proseSize = size === "small" ? "prose-xs" : "prose-sm";
  const processedText = useMemo(
    () => (streaming ? text : inlineLocalImages(text, cwd)),
    [text, cwd, streaming]
  );

  return (
    <div
      className={`prose ${proseSize} max-w-none break-words
        prose-pre:!bg-transparent prose-pre:!p-0
        prose-code:before:hidden prose-code:after:hidden
        ${isLight ? "prose-neutral" : "prose-invert"}`}
    >
      {streaming ? (
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
            fontFamily: "inherit",
            fontSize: size === "small" ? 12 : "inherit",
            lineHeight: 1.65,
            color: "var(--text)",
          }}
        >
          {processedText}
        </pre>
      ) : (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeText = String(children ?? "").replace(/\n$/, "");
            const isBlockCode = Boolean(match) || codeText.includes("\n");
            if (!inline && isBlockCode) {
              return (
                <MarkdownCodeBlock
                  code={codeText}
                  lang={match?.[1] ?? "text"}
                  fontSize={size === "small" ? 11 : 12.5}
                  isLight={isLight}
                />
              );
            }
            return (
              <code
                {...props}
                style={{
                  background: "var(--bg-selected)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.9em",
                  padding: "1px 4px",
                  borderRadius: 3,
                }}
              >
                {children}
              </code>
            );
          },
          a({ children, href, ...props }) {
            const isHttp = typeof href === "string" && /^https?:\/\//i.test(href);
            return (
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
                <a
                  {...props}
                  href={href}
                  target={onOpenUrl && isHttp ? undefined : "_blank"}
                  rel={onOpenUrl && isHttp ? undefined : "noopener noreferrer"}
                  onClick={
                    onOpenUrl && isHttp
                      ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onOpenUrl(href);
                        }
                      : undefined
                  }
                  className="text-[color:var(--accent)] hover:underline"
                >
                  {children}
                </a>
                {isHttp && !onOpenUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      previewStore.openUrl(href!);
                    }}
                    title="在右侧预览"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontSize: "0.85em",
                      padding: 0,
                    }}
                  >
                    ⧉
                  </button>
                )}
              </span>
            );
          },
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          img({ src, alt, node: _node, ...rest }) {
            const s = typeof src === "string" ? src : "";
            return (
               
              <Image
                {...rest}
                src={s}
                alt={alt ?? ""}
                width={960}
                height={640}
                unoptimized
                onClick={() => {
                  if (s) previewStore.openImage(s, alt || "图片");
                }}
                style={{
                  cursor: "zoom-in",
                  maxWidth: "100%",
                  borderRadius: 6,
                  ...(rest.style || {}),
                }}
              />
            );
          },
        }}
      >
        {processedText}
      </ReactMarkdown>
      )}
    </div>
  );
}

// P2-H: 包一层 React.memo。默认 shallow 比较 props（text/cwd/streaming/size/onOpenUrl），
// 不变则跳过重新渲染。主题变化仍由 useIsLight 的订阅触发。
const Markdown = memo(MarkdownInner);
export default Markdown;
