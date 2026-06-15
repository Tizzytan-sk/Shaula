"use client";

import {
  ArrowRight,
  CheckCircle2,
  Clipboard,
  KeyRound,
  Layers3,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "./ProviderIcon";
import {
  useProviderStatus,
  type AuthProviderStatus,
} from "@/app/hooks/useProviderStatus";

interface ProviderSetupWizardProps {
  onClose: () => void;
  onOpenAuth: (provider?: string) => void;
  onOpenModelsConfig: () => void;
}

const cardBase =
  "group flex w-full items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-[color:var(--bg-hover)]";
const quarantineCommand = "xattr -dr com.apple.quarantine /Applications/Shaula\\ Agent.app";
const localCodingAssistantNpmInstallCommand =
  "# 请联系管理员获取公司内部 npm 源地址和包名\nnpm config set @company:registry https://npm.company.example\nnpm install -g @company/coding-assistant@latest\ncoding-assistant -version";
const localCodingAssistantScriptInstallCommand =
  '# 请联系管理员获取公司内部一键安装脚本\ncurl -fsSL "https://example.company/coding-assistant/install.sh" | bash\ncoding-assistant -version';
const localCodingAssistantLoginCommand = "coding-assistant login --force";

interface LocalCodingAssistantStatus {
  installed: boolean;
  version?: string;
  sessionPath: string;
  sessionExists: boolean;
  tokenPresent: boolean;
  error?: string;
}

type ModelAccessAction =
  | { kind: "auth"; provider?: string }
  | { kind: "models" };

interface ModelAccessCard {
  id: string;
  title: string;
  provider: string;
  description: string;
  modelHint: string;
  badge?: string;
  actionLabel: string;
  action: ModelAccessAction;
}

interface ModelAccessGroup {
  title: string;
  description: string;
  cards: ModelAccessCard[];
}

const modelAccessGroups: ModelAccessGroup[] = [
  {
    title: "推荐优先",
    description: "先放最常用、最容易接入的模型资源。",
    cards: [
      {
        id: "deepseek",
        title: "DeepSeek",
        provider: "deepseek",
        badge: "推荐",
        description: "国内常用，成本和速度都适合日常 agent 任务。",
        modelHint: "DeepSeek V4 Flash / Pro",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "deepseek" },
      },
      {
        id: "zhipu",
        title: "GLM / 智谱",
        provider: "zhipu",
        badge: "国内",
        description: "适合继续复用你现在已经配置过的 GLM 资源。",
        modelHint: "GLM-5.1",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "zhipu" },
      },
      {
        id: "openai",
        title: "OpenAI API",
        provider: "openai",
        badge: "通用",
        description: "粘贴 OpenAI Platform API Key，走官方 API。",
        modelHint: "GPT 系列 / Responses API",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "openai" },
      },
      {
        id: "openai-codex",
        title: "ChatGPT / Codex 登录",
        provider: "openai-codex",
        badge: "订阅",
        description: "用浏览器登录 ChatGPT/Codex 订阅账号，不需要 Platform Key。",
        modelHint: "Codex subscription",
        actionLabel: "网页登录",
        action: { kind: "auth", provider: "openai-codex" },
      },
    ],
  },
  {
    title: "国内大模型",
    description: "把常见国产模型入口放到第一层，但保留高级端点能力。",
    cards: [
      {
        id: "kimi",
        title: "Kimi / Moonshot",
        provider: "moonshotai-cn",
        description: "适合长上下文、中文资料处理和 coding 场景。",
        modelHint: "Moonshot / Kimi models",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "moonshotai-cn" },
      },
      {
        id: "minimax-cn",
        title: "MiniMax",
        provider: "minimax-cn",
        description: "适合需要国内模型备选和多模态扩展的场景。",
        modelHint: "MiniMax China",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "minimax-cn" },
      },
      {
        id: "qwen",
        title: "通义千问 / Qwen",
        provider: "qwen",
        description: "通过 OpenRouter、公司网关或 OpenAI 兼容接口接入。",
        modelHint: "Qwen Coder / Qwen long-context",
        actionLabel: "配置网关",
        action: { kind: "models" },
      },
      {
        id: "doubao",
        title: "豆包 / 火山方舟",
        provider: "doubao",
        description: "适合后续通过公司网关、火山接口或聚合平台接入。",
        modelHint: "Doubao / Ark compatible endpoint",
        actionLabel: "配置端点",
        action: { kind: "models" },
      },
    ],
  },
  {
    title: "国际与专业模型",
    description: "补充 Claude、Gemini、Grok 以及高速推理平台。",
    cards: [
      {
        id: "anthropic",
        title: "Anthropic / Claude",
        provider: "anthropic",
        description: "粘贴 Anthropic Console API Key，使用 Claude 系列模型。",
        modelHint: "Claude Sonnet / Opus",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "anthropic" },
      },
      {
        id: "google",
        title: "Google Gemini",
        provider: "google",
        description: "使用 Google AI Studio 或 Gemini API Key。",
        modelHint: "Gemini Pro / Flash",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "google" },
      },
      {
        id: "xai",
        title: "xAI / Grok",
        provider: "xai",
        description: "接入 xAI 官方 API，作为国际模型备选。",
        modelHint: "Grok models",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "xai" },
      },
      {
        id: "groq",
        title: "Groq",
        provider: "groq",
        description: "适合低延迟、高速推理的轻量任务。",
        modelHint: "Llama / Mixtral on Groq",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "groq" },
      },
      {
        id: "mistral",
        title: "Mistral",
        provider: "mistral",
        description: "欧洲模型服务，适合作为 Claude/OpenAI 之外的备选。",
        modelHint: "Mistral Large / Codestral",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "mistral" },
      },
      {
        id: "together",
        title: "Together / Fireworks",
        provider: "together",
        description: "开源模型托管平台，适合试不同 Llama/Qwen/Mixtral 模型。",
        modelHint: "Together AI / Fireworks",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "together" },
      },
    ],
  },
  {
    title: "聚合、本地与企业端点",
    description: "一个入口覆盖多模型平台、本地模型和公司网关。",
    cards: [
      {
        id: "openrouter",
        title: "OpenRouter",
        provider: "openrouter",
        badge: "聚合",
        description: "一个 Key 接入多家模型，适合快速横向比较。",
        modelHint: "Claude / OpenAI / Gemini / Qwen 等",
        actionLabel: "添加 Key",
        action: { kind: "auth", provider: "openrouter" },
      },
      {
        id: "company-claude-3p",
        title: "公司 Claude 3P",
        provider: "company-claude-3p",
        description: "使用公司统一领取的 toB Claude Token 和内部模型额度。",
        modelHint: "Internal Claude 3P resource",
        actionLabel: "配置资源",
        action: { kind: "models" },
      },
      {
        id: "ollama",
        title: "Ollama / 本地模型",
        provider: "ollama",
        description: "连接本机 Ollama OpenAI 兼容接口，适合离线和本地测试。",
        modelHint: "qwen-coder / llama / local models",
        actionLabel: "配置本地",
        action: { kind: "models" },
      },
      {
        id: "lmstudio",
        title: "LM Studio",
        provider: "lmstudio",
        description: "连接 LM Studio 本地服务，选择已经加载的本地模型。",
        modelHint: "LM Studio local server",
        actionLabel: "配置本地",
        action: { kind: "models" },
      },
      {
        id: "azure-openai",
        title: "Azure OpenAI",
        provider: "azure-openai-responses",
        description: "适合企业 Azure 资源，需要 endpoint、deployment 和 Key。",
        modelHint: "Azure Responses / deployments",
        actionLabel: "配置端点",
        action: { kind: "models" },
      },
      {
        id: "custom-openai",
        title: "OpenAI 兼容网关",
        provider: "openrouter",
        description: "公司网关、One API、LiteLLM、代理服务都放这里。",
        modelHint: "Custom base URL + model id",
        actionLabel: "配置网关",
        action: { kind: "models" },
      },
    ],
  },
];

export function ProviderSetupWizard({
  onClose,
  onOpenAuth,
  onOpenModelsConfig,
}: ProviderSetupWizardProps) {
  const { authProviders, authLoading } = useProviderStatus({
    autoLoadAuth: true,
  });
  const [showLocalCodingAssistant, setShowLocalCodingAssistant] = useState(false);
  const [localCodingAssistantStatus, setLocalCodingAssistantStatus] = useState<LocalCodingAssistantStatus | null>(
    null
  );
  const [localCodingAssistantLoading, setLocalCodingAssistantLoading] = useState(true);
  const authByProvider = useMemo(
    () => new Map(authProviders.map((p) => [p.provider, p])),
    [authProviders]
  );
  const detectedProviders = authProviders.filter((p) => p.hasAuth);
  const detectedResources = [
    ...detectedProviders.map((p) => ({
      key: p.provider,
      provider: p.provider,
      displayName: p.displayName,
      source: p.status.source,
    })),
    ...(localCodingAssistantStatus?.installed && localCodingAssistantStatus.tokenPresent
      ? [
          {
            key: "local-coding-assistant",
            provider: "local-coding-assistant",
            displayName: "自研 Coding 助手",
            source: "session",
          },
        ]
      : []),
  ].slice(0, 6);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/local-coding-assistant/status")
      .then((r) => r.json() as Promise<LocalCodingAssistantStatus>)
      .then((data) => {
        if (!cancelled) setLocalCodingAssistantStatus(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setLocalCodingAssistantStatus({
            installed: false,
            sessionPath: "",
            sessionExists: false,
            tokenPresent: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLocalCodingAssistantLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openAuth = (provider?: string) => {
    onClose();
    onOpenAuth(provider);
  };
  const openModels = () => {
    onClose();
    onOpenModelsConfig();
  };
  const openAccessCard = (card: ModelAccessCard) => {
    if (card.action.kind === "auth") {
      openAuth(card.action.provider);
      return;
    }
    openModels();
  };
  const copyQuarantineCommand = () => {
    void navigator.clipboard?.writeText(quarantineCommand);
  };
  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-overlay)" }}
      onClick={onClose}
    >
      <section
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-md border"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border)",
          color: "var(--fg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-panel-2)",
              }}
            >
              <Sparkles size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold">开始使用 Shaula Agent</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                先完成模型接入；有本机账号可直接复用，没有就按下面任选一种方式。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded border hover:bg-[color:var(--bg-hover)]"
            style={{ borderColor: "var(--border)" }}
            aria-label="Close provider setup"
          >
            <X size={14} />
          </button>
        </header>

        <div className="overflow-auto p-4">
          <div
            className="mb-4 rounded-md border p-3 text-xs"
            style={{
              borderColor: "var(--color-warning)",
              background: "var(--color-warning-bg)",
              color: "var(--fg)",
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">macOS 提示“已损坏”或“无法打开”</div>
                <div className="mt-0.5" style={{ color: "var(--text-muted)" }}>
                  当前 DMG 未做 Apple 开发者签名。安装到 Applications 后，在终端执行：
                </div>
              </div>
              <button
                type="button"
                onClick={copyQuarantineCommand}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded border px-2 hover:bg-[color:var(--bg-hover)]"
                style={{ borderColor: "var(--border)" }}
                title="复制终端命令"
              >
                <Clipboard size={13} />
                复制
              </button>
            </div>
            <code
              className="block overflow-x-auto rounded border px-2 py-1.5 font-mono"
              style={{
                borderColor: "var(--border-soft)",
                background: "var(--bg-panel)",
              }}
            >
              {quarantineCommand}
            </code>
          </div>

          <div
            className="mb-4 rounded-md border p-3 text-xs"
            style={{
              borderColor: "var(--color-warning)",
              background: "var(--color-warning-bg)",
              color: "var(--fg)",
            }}
          >
            <div className="font-medium">Windows 提示“已保护你的电脑”</div>
            <div className="mt-1 leading-5" style={{ color: "var(--text-muted)" }}>
              当前 Windows 安装包如果未签名，SmartScreen 可能拦截。确认来源后点
              “更多信息” → “仍要运行”。正式对外发布前应补 Windows 代码签名。
            </div>
          </div>

          {detectedResources.length > 0 && (
            <div
              className="mb-4 rounded-md border p-3 text-xs"
              style={{
                borderColor: "var(--color-success)",
                background: "var(--color-success-bg)",
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={14} />
                已检测到本机可用账号 / 资源
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detectedResources.map((p) => (
                  <span
                    key={p.key}
                    className="inline-flex items-center gap-1 rounded border px-2 py-1"
                    style={{
                      borderColor: "var(--border-soft)",
                      background: "var(--bg-panel)",
                    }}
                  >
                    <ProviderIcon provider={p.provider} size={14} />
                    {p.displayName}
                    {p.source ? ` · ${p.source}` : ""}
                  </span>
                ))}
              </div>
              <p className="mt-2" style={{ color: "var(--text-muted)" }}>
                如果模型下拉框已经出现可用模型，可以关闭此窗口直接发送任务。
              </p>
            </div>
          )}

          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div
                className="inline-flex items-center gap-1.5 text-xs font-medium"
                style={{ color: "var(--fg)" }}
              >
                <Layers3 size={14} />
                选择模型接入
              </div>
              <p
                className="mt-1 text-xs leading-5"
                style={{ color: "var(--text-muted)" }}
              >
                先选模型服务，再粘贴 API Key；本地模型、公司网关和特殊端点放到高级配置。
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-[var(--control-sm)] shrink-0 items-center gap-1.5 rounded border px-3 text-xs font-medium hover:bg-[color:var(--bg-hover)]"
              style={{ borderColor: "var(--accent)" }}
              onClick={() => openAuth()}
            >
              <KeyRound size={14} />
              全部授权
            </button>
          </div>

          <div className="space-y-4">
            {modelAccessGroups.map((group) => (
              <section key={group.title}>
                <div className="mb-2">
                  <div
                    className="text-xs font-medium"
                    style={{ color: "var(--fg)" }}
                  >
                    {group.title}
                  </div>
                  <div
                    className="mt-0.5 text-token-xs"
                    style={{ color: "var(--fg-faint)" }}
                  >
                    {group.description}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.cards.map((card) => (
                    <ModelAccessCardButton
                      key={card.id}
                      card={card}
                      authStatus={
                        card.action.kind === "auth" && card.action.provider
                          ? authByProvider.get(card.action.provider)
                          : undefined
                      }
                      onSelect={openAccessCard}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div
            className="mb-2 mt-4 text-xs font-medium"
            style={{ color: "var(--fg)" }}
          >
            内部客户端资源
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              className={cardBase}
              style={{ borderColor: "var(--border)" }}
              onClick={() => {
                const next = !showLocalCodingAssistant;
                if (next && !localCodingAssistantStatus) setLocalCodingAssistantLoading(true);
                setShowLocalCodingAssistant(next);
              }}
            >
              <Terminal size={24} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  自研 Coding 助手
                </span>
                <span
                  className="mt-1 block text-xs leading-5"
                  style={{ color: "var(--text-muted)" }}
                >
                  检测并配置公司内部 Claude Code 客户端。它是独立客户端资源，
                  不等同于 Claude 3P 模型 API。
                </span>
              </span>
            </button>
          </div>

          {showLocalCodingAssistant && (
            <div
              className="mt-3 rounded-md border p-3 text-xs"
              style={{
                borderColor: "var(--border-soft)",
                background: "var(--bg-panel-2)",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">自研 Coding 助手 状态</div>
                  <p className="mt-1 leading-5" style={{ color: "var(--text-muted)" }}>
                    自研 Coding 助手 是完整的 Claude Code 客户端，使用公司统一模型服务和
                    Token 额度。当前已通过 CLI adapter 接入，安装并登录后可在“供应商”里选择。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLocalCodingAssistantStatus(null);
                    setLocalCodingAssistantLoading(true);
                    fetch("/api/local-coding-assistant/status")
                      .then((r) => r.json() as Promise<LocalCodingAssistantStatus>)
                      .then(setLocalCodingAssistantStatus)
                      .finally(() => setLocalCodingAssistantLoading(false));
                  }}
                  className="h-7 rounded border px-2 hover:bg-[color:var(--bg-hover)]"
                  style={{ borderColor: "var(--border)" }}
                >
                  {localCodingAssistantLoading ? "检测中…" : "重新检测"}
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <StatusBox
                  label="客户端"
                  value={localCodingAssistantStatus?.installed ? "已安装" : "未检测到"}
                  ok={!!localCodingAssistantStatus?.installed}
                />
                <StatusBox
                  label="登录缓存"
                  value={localCodingAssistantStatus?.sessionExists ? "已存在" : "未找到"}
                  ok={!!localCodingAssistantStatus?.sessionExists}
                />
                <StatusBox
                  label="Access Token"
                  value={localCodingAssistantStatus?.tokenPresent ? "已就绪" : "未就绪"}
                  ok={!!localCodingAssistantStatus?.tokenPresent}
                />
                <StatusBox
                  label="供应商列表"
                  value={
                    localCodingAssistantStatus?.installed && localCodingAssistantStatus.tokenPresent
                      ? "已可选择"
                      : "未就绪"
                  }
                  ok={!!(localCodingAssistantStatus?.installed && localCodingAssistantStatus.tokenPresent)}
                />
              </div>

              <div
                className="mt-3 rounded border px-2 py-1.5 leading-5"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text-muted)",
                }}
              >
                选择供应商
                <span className="font-medium" style={{ color: "var(--fg)" }}>
                  {" "}
                  自研 Coding 助手
                </span>
                后，Shaula 会调用本机自研 Coding 助手 CLI 执行任务并回传流式输出；Claude
                3P 模型 API 仍然是独立资源方。
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <CommandBlock
                  title="研发序列 npm 安装"
                  command={localCodingAssistantNpmInstallCommand}
                  onCopy={copyText}
                />
                <CommandBlock
                  title="非研发序列脚本安装"
                  command={localCodingAssistantScriptInstallCommand}
                  onCopy={copyText}
                />
                <CommandBlock
                  title="重新登录"
                  command={localCodingAssistantLoginCommand}
                  onCopy={copyText}
                />
                <div
                  className="rounded border p-2 leading-5"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--bg-panel)",
                    color: "var(--text-muted)",
                  }}
                >
                  <div className="font-medium" style={{ color: "var(--fg)" }}>
                    在项目里直接使用
                  </div>
                  <code className="mt-1 block font-mono">
                    cd /path/to/project
                    <br />
                    coding-assistant
                  </code>
                </div>
              </div>
            </div>
          )}

          {authLoading && (
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              正在检测本机账号配置…
            </p>
          )}
        </div>

        <footer
          className="flex items-start gap-2 border-t px-4 py-3 text-xs"
          style={{
            borderColor: "var(--border-soft)",
            color: "var(--text-muted)",
          }}
        >
          <KeyRound size={14} className="mt-0.5 shrink-0" />
          <span>
            API Key 和 OAuth token 只保存在本机 <code>~/.pi/auth.json</code>；
            自定义服务商和模型写入 <code>~/.pi/agent/models.json</code>。
          </span>
        </footer>
      </section>
    </div>
  );
}

function ModelAccessCardButton({
  card,
  authStatus,
  onSelect,
}: {
  card: ModelAccessCard;
  authStatus?: AuthProviderStatus;
  onSelect: (card: ModelAccessCard) => void;
}) {
  const status = modelAccessStatus(card, authStatus);
  const actionLabel = modelAccessActionLabel(card, authStatus);
  return (
    <button
      type="button"
      className={`${cardBase} min-h-[148px]`}
      style={{ borderColor: status.ready ? "var(--color-success)" : "var(--border)" }}
      onClick={() => onSelect(card)}
    >
      <span
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border"
        style={{
          borderColor: "var(--border-soft)",
          background: "var(--bg-panel-2)",
        }}
      >
        <ProviderIcon provider={card.provider} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{card.title}</span>
          {card.badge && (
            <span
              className="inline-flex h-5 items-center rounded border px-1.5 text-token-xs"
              style={{
                borderColor: "var(--border-soft)",
                background: "var(--bg-panel)",
                color: "var(--fg-muted)",
              }}
            >
              {card.badge}
            </span>
          )}
          <span
            className="inline-flex h-5 items-center rounded border px-1.5 text-token-xs"
            style={{
              borderColor: status.ready
                ? "var(--color-success)"
                : "var(--border-soft)",
              background: status.ready
                ? "var(--color-success-bg)"
                : "var(--bg-panel)",
              color: status.ready
                ? "var(--color-success)"
                : "var(--text-muted)",
            }}
          >
            {status.label}
          </span>
        </span>
        <span
          className="mt-1 line-clamp-2 text-xs leading-5"
          style={{ color: "var(--text-muted)" }}
        >
          {card.description}
        </span>
        <span
          className="mt-1 truncate text-token-xs"
          style={{ color: "var(--fg-faint)" }}
          title={card.modelHint}
        >
          {card.modelHint}
        </span>
        <span
          className="mt-auto pt-3 inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: "var(--accent)" }}
        >
          {actionLabel}
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

function modelAccessStatus(
  card: ModelAccessCard,
  authStatus?: AuthProviderStatus
): { label: string; ready: boolean } {
  if (authStatus?.hasAuth) {
    return { label: "已接入", ready: true };
  }
  if (authStatus?.supportsOAuth) {
    return {
      label: card.actionLabel.includes("登录") ? "可登录" : "Key/登录",
      ready: false,
    };
  }
  if (card.action.kind === "models") {
    return { label: "高级配置", ready: false };
  }
  return { label: "可填 Key", ready: false };
}

function modelAccessActionLabel(
  card: ModelAccessCard,
  authStatus?: AuthProviderStatus
): string {
  if (card.action.kind === "auth" && authStatus?.hasAuth) {
    return authStatus.credentialType === "oauth" ? "管理登录" : "替换 Key";
  }
  return card.actionLabel;
}

function StatusBox({
  label,
  value,
  ok,
  tone = "check",
}: {
  label: string;
  value: string;
  ok?: boolean;
  tone?: "check" | "neutral";
}) {
  const success = tone === "check" && ok;
  return (
    <div
      className="rounded border px-2 py-1.5"
      style={{
        borderColor: success ? "var(--color-success)" : "var(--border)",
        background: success ? "var(--color-success-bg)" : "var(--bg-panel)",
      }}
    >
      <div className="text-token-xs" style={{ color: "var(--fg-faint)" }}>
        {label}
      </div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}

function CommandBlock({
  title,
  command,
  onCopy,
}: {
  title: string;
  command: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div
      className="rounded border p-2"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <button
          type="button"
          onClick={() => onCopy(command)}
          className="h-6 rounded border px-2 hover:bg-[color:var(--bg-hover)]"
          style={{ borderColor: "var(--border)" }}
        >
          复制
        </button>
      </div>
      <code
        className="block max-h-24 overflow-auto whitespace-pre-wrap rounded px-2 py-1 font-mono leading-5"
        style={{
          background: "var(--bg-panel-2)",
          color: "var(--fg-muted)",
        }}
      >
        {command}
      </code>
    </div>
  );
}
