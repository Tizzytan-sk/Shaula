"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import langBash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import langC from "react-syntax-highlighter/dist/esm/languages/prism/c";
import langCpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import langCsharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import langCss from "react-syntax-highlighter/dist/esm/languages/prism/css";
import langDiff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import langDocker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import langGo from "react-syntax-highlighter/dist/esm/languages/prism/go";
import langGraphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import langJava from "react-syntax-highlighter/dist/esm/languages/prism/java";
import langJavascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import langJson from "react-syntax-highlighter/dist/esm/languages/prism/json";
import langJsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import langKotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import langMarkdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import langMarkup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import langPhp from "react-syntax-highlighter/dist/esm/languages/prism/php";
import langPython from "react-syntax-highlighter/dist/esm/languages/prism/python";
import langRust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import langScss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import langSql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import langSwift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import langToml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import langTsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import langTypescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import langYaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { previewStore } from "@/lib/preview-store";

// PrismLight only ships registered languages. Keep this in the lazy chunk so
// first paint does not load the highlighter when the screen has no code block.
SyntaxHighlighter.registerLanguage("bash", langBash);
SyntaxHighlighter.registerLanguage("sh", langBash);
SyntaxHighlighter.registerLanguage("shell", langBash);
SyntaxHighlighter.registerLanguage("zsh", langBash);
SyntaxHighlighter.registerLanguage("c", langC);
SyntaxHighlighter.registerLanguage("cpp", langCpp);
SyntaxHighlighter.registerLanguage("c++", langCpp);
SyntaxHighlighter.registerLanguage("csharp", langCsharp);
SyntaxHighlighter.registerLanguage("cs", langCsharp);
SyntaxHighlighter.registerLanguage("css", langCss);
SyntaxHighlighter.registerLanguage("diff", langDiff);
SyntaxHighlighter.registerLanguage("docker", langDocker);
SyntaxHighlighter.registerLanguage("dockerfile", langDocker);
SyntaxHighlighter.registerLanguage("go", langGo);
SyntaxHighlighter.registerLanguage("graphql", langGraphql);
SyntaxHighlighter.registerLanguage("java", langJava);
SyntaxHighlighter.registerLanguage("javascript", langJavascript);
SyntaxHighlighter.registerLanguage("js", langJavascript);
SyntaxHighlighter.registerLanguage("json", langJson);
SyntaxHighlighter.registerLanguage("json5", langJson);
SyntaxHighlighter.registerLanguage("jsx", langJsx);
SyntaxHighlighter.registerLanguage("kotlin", langKotlin);
SyntaxHighlighter.registerLanguage("kt", langKotlin);
SyntaxHighlighter.registerLanguage("markdown", langMarkdown);
SyntaxHighlighter.registerLanguage("md", langMarkdown);
SyntaxHighlighter.registerLanguage("markup", langMarkup);
SyntaxHighlighter.registerLanguage("html", langMarkup);
SyntaxHighlighter.registerLanguage("xml", langMarkup);
SyntaxHighlighter.registerLanguage("svg", langMarkup);
SyntaxHighlighter.registerLanguage("php", langPhp);
SyntaxHighlighter.registerLanguage("python", langPython);
SyntaxHighlighter.registerLanguage("py", langPython);
SyntaxHighlighter.registerLanguage("rust", langRust);
SyntaxHighlighter.registerLanguage("rs", langRust);
SyntaxHighlighter.registerLanguage("scss", langScss);
SyntaxHighlighter.registerLanguage("sass", langScss);
SyntaxHighlighter.registerLanguage("sql", langSql);
SyntaxHighlighter.registerLanguage("swift", langSwift);
SyntaxHighlighter.registerLanguage("toml", langToml);
SyntaxHighlighter.registerLanguage("tsx", langTsx);
SyntaxHighlighter.registerLanguage("typescript", langTypescript);
SyntaxHighlighter.registerLanguage("ts", langTypescript);
SyntaxHighlighter.registerLanguage("yaml", langYaml);
SyntaxHighlighter.registerLanguage("yml", langYaml);

const COLLAPSED_LINES = 12;

interface MarkdownCodeBlockProps {
  code: string;
  lang: string;
  fontSize: number;
  isLight: boolean;
}

export default function MarkdownCodeBlock({
  code,
  lang,
  fontSize,
  isLight,
}: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [inlineRender, setInlineRender] = useState(false);
  const totalLines = useMemo(() => code.split("\n").length, [code]);
  const canCollapse = totalLines > COLLAPSED_LINES;
  const [expanded, setExpanded] = useState(!canCollapse);
  const isHtml = /^x?html?$/i.test(lang);
  const codeStyle = isLight ? oneLight : oneDark;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const lineHeight = 1.6;
  const collapsedHeight =
    Math.round(fontSize * lineHeight * COLLAPSED_LINES) + 20;

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span>
          {lang}
          {canCollapse && (
            <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
              · {totalLines} 行
            </span>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {isHtml && (
            <>
              <button
                type="button"
                onClick={() => setInlineRender((v) => !v)}
                style={btnStyle(inlineRender ? "var(--accent)" : "var(--text-muted)")}
                title={inlineRender ? "隐藏内联渲染" : "在此处渲染 HTML"}
              >
                {inlineRender ? "源码" : "渲染"}
              </button>
              <button
                type="button"
                onClick={() => previewStore.openHtml(code)}
                style={btnStyle("var(--accent)")}
                title="在右侧预览渲染结果(可独立大屏查看)"
              >
                preview →
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onCopy}
            style={btnStyle("var(--text-muted)")}
          >
            {copied ? "copied" : "copy"}
          </button>
        </span>
      </div>

      {inlineRender && isHtml ? (
        <iframe
          title="inline-html-preview"
          srcDoc={code}
          sandbox="allow-scripts allow-forms"
          style={{
            width: "100%",
            height: 360,
            border: "none",
            background: "var(--browser-preview-bg)",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            position: "relative",
            maxHeight: expanded ? undefined : collapsedHeight,
            overflow: expanded ? "visible" : "hidden",
          }}
        >
          <SyntaxHighlighter
            language={lang || "text"}
            style={codeStyle}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "10px 12px",
              fontSize,
              lineHeight,
              borderRadius: 0,
              background: "var(--bg)",
            }}
            codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
          >
            {code}
          </SyntaxHighlighter>
          {!expanded && canCollapse && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 64,
                pointerEvents: "none",
                background:
                  "linear-gradient(to bottom, color-mix(in srgb, var(--bg) 0%, transparent) 0%, var(--bg) 90%)",
              }}
            />
          )}
        </div>
      )}

      {canCollapse && !inlineRender && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            width: "100%",
            padding: "4px 10px",
            background: "var(--bg-panel)",
            borderTop: "1px solid var(--border)",
            border: 0,
            borderTopWidth: 1,
            borderTopStyle: "solid",
            borderTopColor: "var(--border)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            display: "block",
            textAlign: "center",
          }}
        >
          {expanded
            ? `▲ 收起(显示前 ${COLLAPSED_LINES} 行)`
            : `▼ 展开剩余 ${totalLines - COLLAPSED_LINES} 行`}
        </button>
      )}
    </div>
  );
}

function btnStyle(color: string): CSSProperties {
  return {
    background: "none",
    border: "none",
    color,
    cursor: "pointer",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
    padding: 0,
  };
}
