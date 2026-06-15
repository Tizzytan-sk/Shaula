"use client";

import { Check, FlaskConical, KeyRound, LogIn, Trash2 } from "lucide-react";
import type { AuthProviderStatus } from "@/app/hooks/useProviderStatus";
import type { ProviderReadinessCategory } from "@/lib/auth/readiness";
import { ProviderIcon } from "../ProviderIcon";
import { ConfirmButton } from "../ConfirmButton";
import { Button, FieldInput } from "../DesignPrimitives";

export interface AuthTestResult {
  ok: boolean;
  error?: string;
  category?: ProviderReadinessCategory;
  userMessage?: string;
  latencyMs?: number;
  status?: number;
  model?: { provider: string; id: string; name?: string };
}

interface AuthProviderRowProps {
  provider: AuthProviderStatus;
  isEditing: boolean;
  isBusy: boolean;
  isTesting: boolean;
  result?: AuthTestResult;
  keyInput: string;
  onStartEdit: (provider: string) => void;
  onTestAuth: (provider: string) => void;
  onRemoveKey: (provider: string) => void;
  onOpenOAuth: (provider: string) => void;
  onKeyInputChange: (value: string) => void;
  onSaveKey: (provider: string) => void;
  onCancelEdit: () => void;
}

export function AuthProviderRow({
  provider: p,
  isEditing,
  isBusy,
  isTesting,
  result,
  keyInput,
  onStartEdit,
  onTestAuth,
  onRemoveKey,
  onOpenOAuth,
  onKeyInputChange,
  onSaveKey,
  onCancelEdit,
}: AuthProviderRowProps) {
  const resultLabel = result ? authResultLabel(result) : "";
  const status = authProviderStatusLabel(p);
  return (
    <div className="rounded-token border border-[color:var(--border-soft)] bg-[color:var(--bg-selected)] px-3 py-3 text-token-sm">
      <div className="flex items-center gap-3">
        <span
          className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--button-radius)] border"
          style={{
            borderColor: "var(--border-soft)",
            background: "var(--bg-panel)",
          }}
          title={status.detail}
        >
          <ProviderIcon provider={p.provider} size={18} />
          {p.hasAuth && (
            <Check
              size={10}
              className="absolute -bottom-1 -right-1 rounded-full"
              style={{
                background: "var(--accent)",
                color: "var(--color-bg)",
                padding: 1,
              }}
            />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium truncate">{p.displayName}</span>
            <span
              className="inline-flex h-6 items-center rounded-[var(--button-radius)] border px-2 text-token-xs"
              style={{
                borderColor: p.hasAuth
                  ? "var(--color-success)"
                  : "var(--border-soft)",
                background: p.hasAuth
                  ? "var(--color-success-bg)"
                  : "var(--bg-panel)",
                color: p.hasAuth
                  ? "var(--color-success)"
                  : "var(--text-muted)",
              }}
            >
              {status.short}
            </span>
          </div>
          <div
            className="mt-0.5 truncate text-token-xs"
            style={{ color: "var(--fg-faint)" }}
            title={status.detail}
          >
            {status.detail}
          </div>
          {p.provider === "openai-codex" && (
            <div
              className="mt-0.5 text-token-xs"
              style={{ color: "var(--fg-faint)" }}
            >
              使用 ChatGPT 订阅登录，不是 OpenAI Platform API key。
            </div>
          )}
          {p.provider === "openai" && (
            <div
              className="mt-0.5 text-token-xs"
              style={{ color: "var(--fg-faint)" }}
            >
              使用 OpenAI Platform API key。
            </div>
          )}
        </span>
        {!isEditing && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              onClick={() => onStartEdit(p.provider)}
              disabled={isBusy}
              size="md"
              variant="outline"
              leading={<KeyRound size={14} />}
              title={
                p.credentialType === "api_key" ? "替换 API key" : "设置 API key"
              }
            >
              {p.credentialType === "api_key" ? "替换 Key" : "添加 Key"}
            </Button>
            {(p.credentialType === "api_key" ||
              p.credentialType === "oauth") && (
              <Button
                onClick={() => onTestAuth(p.provider)}
                disabled={isBusy || isTesting}
                size="md"
                variant="outline"
                leading={<FlaskConical size={14} />}
                title={`验证 ${p.provider} 凭证是否可调用模型`}
              >
                {isTesting ? "测试中" : "测试"}
              </Button>
            )}
            {(p.credentialType === "api_key" ||
              p.credentialType === "oauth") && (
              <ConfirmButton
                onConfirm={() => onRemoveKey(p.provider)}
                confirmLabel="确认移除"
                disabled={isBusy}
                className="inline-flex h-[var(--control-md)] items-center gap-1.5 rounded-[var(--button-radius)] border border-[color:var(--color-danger)] px-3 text-token-sm font-medium text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-bg)] disabled:opacity-50"
                title={`删除 ${p.provider} 的凭证`}
              >
                <Trash2 size={14} />
                移除
              </ConfirmButton>
            )}
          </div>
        )}
      </div>
      {result && (
        <div
          className="mt-2 rounded-token-sm border px-2 py-1 text-token-xs"
          style={{
            borderColor: result.ok
              ? "var(--color-success)"
              : "var(--color-danger)",
            background: result.ok
              ? "var(--color-success-bg)"
              : "var(--color-danger-bg)",
            color: result.ok ? "var(--color-success)" : "var(--color-danger)",
          }}
        >
          {result.ok
            ? `Test passed${
                result.model?.id ? ` · ${result.model.id}` : ""
              }${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}`
            : `Test failed${resultLabel ? ` · ${resultLabel}` : ""}: ${
                result.userMessage ?? result.error ?? "unknown error"
              }`}
        </div>
      )}
      {p.supportsOAuth && !isEditing && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            onClick={() => onOpenOAuth(p.provider)}
            disabled={isBusy}
            size="md"
            tone="accent"
            variant="solid"
            leading={<LogIn size={14} />}
            title={
              p.credentialType === "oauth"
                ? "Re-login to refresh tokens"
                : "Login via OAuth in browser"
            }
          >
            {p.credentialType === "oauth" ? "重新登录" : "登录"}
          </Button>
          <span className="text-token-xs" style={{ color: "var(--fg-faint)" }}>
            {p.credentialType === "oauth"
              ? "已连接，可重新登录刷新授权。"
              : "使用浏览器授权。"}
          </span>
        </div>
      )}
      {isEditing && (
        <div className="flex items-center gap-1 mt-2">
          <FieldInput
            type="password"
            value={keyInput}
            onChange={(e) => onKeyInputChange(e.target.value)}
            placeholder="API key"
            autoFocus
            disabled={isBusy}
            className="flex-1 font-mono"
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveKey(p.provider);
              if (e.key === "Escape") onCancelEdit();
            }}
          />
          <Button
            onClick={() => onSaveKey(p.provider)}
            disabled={isBusy || !keyInput.trim()}
            size="sm"
            tone="accent"
            variant="solid"
          >
            {isBusy ? "…" : "Save"}
          </Button>
          <Button
            onClick={onCancelEdit}
            disabled={isBusy}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function authResultLabel(result: AuthTestResult): string {
  switch (result.category) {
    case "usable":
      return "usable";
    case "missing_credential":
      return "credential";
    case "model_not_found":
      return "model";
    case "quota_or_resources":
      return "quota/resources";
    case "timeout":
      return "timeout";
    case "provider_error":
      return "provider";
    case "configuration_error":
      return "configuration";
    default:
      return "";
  }
}

function authProviderStatusLabel(provider: AuthProviderStatus): {
  short: string;
  detail: string;
} {
  if (provider.credentialType === "api_key") {
    return {
      short: "Key 已保存",
      detail: provider.status.source
        ? `已保存 API Key，可以测试连接。来源：${provider.status.source}`
        : "已保存 API Key，可以测试连接。",
    };
  }
  if (provider.credentialType === "oauth") {
    return {
      short: "已登录",
      detail: "已完成浏览器登录，可以测试连接。",
    };
  }
  if (provider.supportsOAuth) {
    return {
      short: "可登录",
      detail: "支持浏览器登录。未登录前不能调用模型。",
    };
  }
  return {
    short: "未配置",
    detail: "需要添加 API Key 后才能调用模型。",
  };
}
