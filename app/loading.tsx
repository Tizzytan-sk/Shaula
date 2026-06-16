import { BrandLogo } from "./components/BrandLogo";

export default function Loading() {
  return (
    <div
      className="flex h-screen min-w-0 overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <aside
        className="flex h-full w-[260px] shrink-0 flex-col border-r"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border)" }}
      >
        <div className="border-b px-3 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-3 flex items-center gap-2">
            <BrandLogo size={32} />
            <span className="font-mono text-token-mobile font-bold">Shaula</span>
          </div>
          <div
            className="h-[var(--control-lg)] rounded-[var(--button-radius)]"
            style={{ background: "var(--bg-hover)" }}
          />
        </div>
        <div className="space-y-3 p-3">
          <div className="h-5 w-28 rounded" style={{ background: "var(--bg-hover)" }} />
          <div className="h-9 rounded" style={{ background: "var(--bg-hover)" }} />
          <div className="h-5 w-24 rounded" style={{ background: "var(--bg-hover)" }} />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-10 rounded"
                style={{ background: "var(--bg-hover)" }}
              />
            ))}
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="h-12 border-b" style={{ borderColor: "var(--border)" }} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]" />
            <div className="text-token-sm text-[color:var(--text-muted)]">
              正在打开 Shaula 工作台
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
