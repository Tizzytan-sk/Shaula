/**
 * 内置审批规则。
 *
 * 顺序敏感：matcher 按数组顺序短路。「更具体 / 破坏性更强」的规则放前面。
 */
import type { ApprovalRule } from "./types";

const SHELL_TOOLS = ["bash", "shell", "shell_command", "powershell", "cmd"];

export const DEFAULT_RULES: ApprovalRule[] = [
  {
    id: "dangerous-shell-network-execute",
    name: "网络下载后直接执行",
    riskCategory: "network_execute",
    match: {
      toolName: SHELL_TOOLS,
      inputMatch: {
        command: {
          regex:
            "\\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\\b[^\\n|;]*(\\||;)[^\\n]*\\b(sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\\b",
          flags: "i",
        },
      },
    },
    on: "ask",
    allowRemember: false,
    denyReason: "Permission denied by user (network-downloaded code execution).",
  },
  {
    id: "dangerous-shell-secret-exposure",
    name: "可能泄露密钥或凭证",
    riskCategory: "secret_exposure",
    match: {
      toolName: SHELL_TOOLS,
      inputMatch: {
        command: {
          regex:
            "(\\bprintenv\\b|\\benv\\b|get-childitem\\s+env:|\\b(cat|type|get-content)\\b[^\\n]*(\\.env\\b|id_rsa|id_ed25519|credentials|token|auth\\.json|models\\.json))",
          flags: "i",
        },
      },
    },
    on: "ask",
    allowRemember: false,
    denyReason: "Permission denied by user (possible secret exposure).",
  },
  {
    id: "dangerous-shell-destructive",
    name: "危险破坏性命令",
    riskCategory: "destructive_filesystem",
    match: {
      toolName: SHELL_TOOLS,
      inputMatch: {
        command: {
          regex:
            "(rm\\s+-[a-z]*r[a-z]*f|git\\s+reset\\s+--hard|git\\s+clean\\s+-[a-z]*[fdx][a-z]*|remove-item\\b[^\\n]*(\\s-(recurse|r)\\b)|\\b(del|erase|rd|rmdir)\\b[^\\n]*\\s/[sq]\\b|:\\(\\)\\{:\\|:&\\};:)",
          flags: "i",
        },
      },
    },
    on: "ask",
    allowRemember: false,
    denyReason: "Permission denied by user (potentially destructive command).",
  },
  {
    id: "dangerous-shell-public-action",
    name: "对外发布或公开写入",
    riskCategory: "public_external_action",
    match: {
      toolName: SHELL_TOOLS,
      inputMatch: {
        command: {
          regex:
            "(\\bgit\\s+push\\b|\\bnpm\\s+publish\\b|\\bpnpm\\s+publish\\b|\\bgh\\s+(pr\\s+create|issue\\s+(create|comment)|api)\\b|\\b(vercel|netlify|wrangler)\\b[^\\n]*(deploy|publish))",
          flags: "i",
        },
      },
    },
    on: "ask",
    allowRemember: false,
    denyReason: "Permission denied by user (public or external write action).",
  },
  {
    id: "dangerous-sensitive-file-write",
    name: "写入敏感配置或凭证文件",
    riskCategory: "sensitive_file_write",
    match: {
      toolName: ["write", "edit"],
      inputMatch: {
        path: {
          regex: "(^|[\\\\/])(\\.ssh|\\.env\\b|auth\\.json|models\\.json)([\\\\/]|$)",
          flags: "i",
        },
      },
    },
    on: "ask",
    allowRemember: false,
    denyReason: "Permission denied by user (sensitive file write).",
  },
];
