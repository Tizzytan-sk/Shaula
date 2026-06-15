"use client";

import type { CSSProperties } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Crosshair,
  GitBranch,
  ListChecks,
  ShieldCheck,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { AgentGoal } from "@/lib/goal/types";
import { BrandLogo } from "./BrandLogo";

interface EmptyStateProps {
  providerLabel?: string | null;
  modelLabel?: string | null;
  goal?: AgentGoal | null;
  onOpenModelSetup?: () => void;
  onStartGoal?: () => void;
  onFocusComposer?: () => void;
  onUseStarter?: (prompt: string) => void;
}

interface StatusItem {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface StarterItem {
  eyebrow: string;
  title: string;
  body: string;
  prompt: string;
  icon: LucideIcon;
  tone: string;
  tint: string;
}

const STARTERS: StarterItem[] = [
  {
    eyebrow: "CORE",
    title: "抓核心",
    body: "先判断真正问题、当前阶段重点和可暂缓内容。",
    prompt:
      "请先判断这件事的核心问题是什么，哪些是当前阶段必须处理的，哪些可以暂缓；然后给出最小可执行方案、验证方式和剩余风险。",
    icon: Crosshair,
    tone: "var(--color-accent)",
    tint: "var(--color-accent-bg)",
  },
  {
    eyebrow: "PLAN",
    title: "规划改动",
    body: "定位相关文件、现有模式、风险点，再给最小方案。",
    prompt:
      "请先定位这个需求涉及的文件、现有实现模式和风险点，然后给出最小改动计划、验收标准和需要运行的检查；在方向明确前先不要扩大范围。",
    icon: GitBranch,
    tone: "var(--color-warning)",
    tint: "var(--color-warning-bg)",
  },
  {
    eyebrow: "FANOUT",
    title: "并行派工",
    body: "把复杂任务拆成互不踩线的小块，明确合并口径。",
    prompt:
      "请把这个任务拆成可以并行推进的小块，标出每块的边界、输入、输出、适合的子 agent 类型，以及最后合并和验收的标准。",
    icon: ListChecks,
    tone: "var(--color-success)",
    tint: "var(--color-success-bg)",
  },
  {
    eyebrow: "VERIFY",
    title: "验收收口",
    body: "按证据、测试、风险和未决问题做一次完成判断。",
    prompt:
      "请对当前工作做一次收口验收：列出实际变化、证据和检查结果，判断是否真的完成；如果没有完成，请给出下一步最小动作和需要我决策的事项。",
    icon: ShieldCheck,
    tone: "var(--color-info)",
    tint: "var(--color-info-bg)",
  },
];

function statusItems({
  providerLabel,
  modelLabel,
  goal,
  onOpenModelSetup,
  onStartGoal,
  onFocusComposer,
}: EmptyStateProps): StatusItem[] {
  const modelReady = Boolean(providerLabel && modelLabel);
  const goalActive = Boolean(goal);
  return [
    {
      label: "模型",
      value: modelReady ? `${providerLabel} / ${modelLabel}` : "等待接入",
      icon: modelReady ? CheckCircle2 : CircleDot,
      tone: modelReady ? "var(--color-success)" : "var(--text-muted)",
      actionLabel: modelReady ? "切换" : "接入",
      onAction: onOpenModelSetup,
    },
    {
      label: "目标",
      value: goalActive ? goal?.status ?? "active" : "等待创建",
      icon: Target,
      tone: goalActive ? "var(--accent)" : "var(--text-muted)",
      actionLabel: goalActive ? "继续" : "创建",
      onAction: onStartGoal,
    },
    {
      label: "证据",
      value: goalActive ? "按 contract 检查" : "完成前检查",
      icon: ShieldCheck,
      tone: "var(--text-muted)",
      actionLabel: goalActive ? "验收" : "准备",
      onAction: goalActive ? onFocusComposer : undefined,
    },
  ];
}

export function EmptyState(props: EmptyStateProps) {
  const items = statusItems(props);
  const applyStarter = (prompt: string) => {
    props.onUseStarter?.(prompt);
    if (!props.onUseStarter) props.onFocusComposer?.();
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-4 py-8 md:justify-center">
      <div className="w-full max-w-[960px]">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 24,
            marginLeft: 8,
            marginRight: 8,
            fontFamily: "var(--font-mono)",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
              flex: 1,
              lineHeight: 1.4,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 68,
                height: 68,
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--radius-md)",
                background:
                  "linear-gradient(145deg, var(--bg-panel), color-mix(in srgb, var(--accent) 8%, var(--bg)))",
                boxShadow: "var(--shadow-popover)",
                flexShrink: 0,
              }}
            >
              <BrandLogo size={54} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  fontWeight: 700,
                  letterSpacing: 0,
                  textTransform: "uppercase",
                }}
              >
                SHAULA WORKBENCH
              </div>
              <h1
                style={{
                  margin: "4px 0 0",
                  fontSize: 34,
                  lineHeight: 1.08,
                  color: "var(--text)",
                  fontWeight: 800,
                  letterSpacing: 0,
                }}
              >
                抓住关键，直接完成。
              </h1>
              <p
                style={{
                  margin: "10px 0 0",
                  maxWidth: 560,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                  lineHeight: 1.65,
                }}
              >
                从任务契约、执行证据到验收闭环，把一次对话压成可以交付的工作。
              </p>
            </div>
          </div>
          <div
            aria-label="Shaula control status"
            data-testid="empty-control-status"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(126px, 100%), 1fr))",
              gap: 8,
              width: "100%",
              minWidth: 0,
              maxWidth: 520,
              flex: "1 1 360px",
            }}
          >
            {items.map((item) => {
              const Icon = item.icon;
              const interactive = Boolean(item.onAction);
              const body = (
                <>
                  <Icon size={14} style={{ color: item.tone, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, lineHeight: 1.25, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.value}
                    >
                      {item.value}
                    </div>
                  </div>
                  {interactive && item.actionLabel ? (
                    <span
                      style={{
                        color: "var(--accent)",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {item.actionLabel}
                    </span>
                  ) : null}
                </>
              );
              const cardStyle: CSSProperties = {
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 42,
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--radius-md)",
                background:
                  "linear-gradient(180deg, var(--bg-panel), color-mix(in srgb, var(--bg) 42%, var(--bg-panel)))",
                padding: "8px 10px",
                minWidth: 0,
                textAlign: "left",
                cursor: interactive ? "pointer" : "default",
                transition:
                  "border-color var(--motion-base) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
              };
              return interactive ? (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onAction}
                  aria-label={`${item.label}：${item.value}，${item.actionLabel}`}
                  style={cardStyle}
                >
                  {body}
                </button>
              ) : (
                <div key={item.label} style={cardStyle}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>

        <div
          aria-label="Shaula starter prompts"
          data-testid="empty-starter-prompts"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))",
            gap: 10,
            marginTop: 28,
            marginLeft: 8,
            marginRight: 8,
          }}
        >
          {STARTERS.map((starter) => {
            const Icon = starter.icon;
            return (
              <button
                key={starter.title}
                type="button"
                onClick={() => applyStarter(starter.prompt)}
                className="group"
                style={{
                  display: "flex",
                  minHeight: 132,
                  minWidth: 0,
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: 16,
                  border: "1px solid var(--border-soft)",
                  borderRadius: "var(--radius-md)",
                  background:
                    "linear-gradient(145deg, color-mix(in srgb, var(--bg-panel) 92%, transparent), var(--bg))",
                  padding: 14,
                  textAlign: "left",
                  color: "var(--text)",
                  boxShadow: "0 1px 0 color-mix(in srgb, var(--text) 6%, transparent)",
                  transition:
                    "border-color var(--motion-base) var(--motion-ease), background var(--motion-base) var(--motion-ease), transform var(--motion-fast) var(--motion-ease)",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = starter.tone;
                  event.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = "var(--border-soft)";
                  event.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      border: "1px solid var(--border-soft)",
                      borderRadius: "var(--radius-md)",
                      background: starter.tint,
                      color: starter.tone,
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={17} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        color: starter.tone,
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: 0,
                      }}
                    >
                      {starter.eyebrow}
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 3,
                        fontSize: 17,
                        fontWeight: 750,
                        lineHeight: 1.25,
                        color: "var(--text)",
                      }}
                    >
                      {starter.title}
                    </span>
                  </span>
                </span>
                <span
                  style={{
                    display: "block",
                    minHeight: 42,
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--text-muted)",
                  }}
                >
                  {starter.body}
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    borderTop: "1px solid var(--border-soft)",
                    paddingTop: 10,
                    color: "var(--text-muted)",
                    fontSize: 12,
                    fontWeight: 650,
                  }}
                >
                  <span>填入输入框</span>
                  <ArrowRight size={14} style={{ color: starter.tone }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
