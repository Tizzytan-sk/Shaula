"use client";

import { useEffect, useState } from "react";

// Shaula 自有短句轮播。默认首页使用静态标语，保留组件供后续动效入口复用。
export const TYPEWRITER_PHRASES = [
  "抓住关键，直接完成。",
  "Strike the core. Finish the work.",
  "把目标说清楚，Shaula 接住执行。",
];

export function Typewriter({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setPhraseIdx(Math.floor(Math.random() * phrases.length));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phrases.length]);

  useEffect(() => {
    const blink = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    const current = phrases[phraseIdx];
    let timeout: ReturnType<typeof setTimeout>;
    if (!deleting && text === current) {
      timeout = setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === "") {
      queueMicrotask(() => {
        setDeleting(false);
        setPhraseIdx((i) => (i + 1) % phrases.length);
      });
    } else {
      const next = deleting
        ? current.slice(0, text.length - 1)
        : current.slice(0, text.length + 1);
      timeout = setTimeout(() => setText(next), deleting ? 28 : 55);
    }
    return () => clearTimeout(timeout);
  }, [text, deleting, phraseIdx, phrases]);

  return (
    <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
      {text}
      <span
        style={{
          opacity: caretOn ? 1 : 0,
          color: "var(--accent)",
          marginLeft: 1,
        }}
      >
        ▍
      </span>
    </span>
  );
}
