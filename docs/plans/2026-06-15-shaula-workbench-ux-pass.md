# Shaula Workbench UX Pass

> Date: 2026-06-15
> Status: Active execution document
> Scope: Workbench usability, message readability, provider/model setup clarity,
> and lightweight project/task information architecture.

## 1. Core Judgment

当前问题不是单点视觉瑕疵，而是 Shaula 的主界面仍偏“开发调试台”：

- 控件过小，像内部工具；
- 回复流把答案、执行步骤、工具日志混在一起；
- 任务只有 `Task` 入口，缺少用户理解上的 `Project` 容器；
- 配置页直接暴露 provider/model 的底层字段；
- 后端已有可用模型时，前端仍可能显示“没有可用模型”。

下一步应该先做一轮 Workbench UX 收敛，再做完整安装包打包。否则安装包会固化
这些明显体验问题。

## 2. Design Direction

目标不是营销化，也不是玻璃拟态。目标是更像一个亲民、清晰、可长期工作的
agent workbench：

- 主路径更大、更容易点；
- 默认只展示用户真正需要读的答案；
- 执行过程可审计，但默认折叠；
- 配置项按普通用户语言表达；
- 高级配置仍保留，但不压在第一层；
- Project / Task 层级清楚，但第一版不重做大数据模型。

## 3. Priority Issues

### P0 - Model Availability Bug

Observed:

- `/api/providers` returns usable authenticated providers:
  - `deepseek / deepseek-v4-flash`;
  - `deepseek / deepseek-v4-pro`;
  - `zhipu / glm-5.1`.
- `/api/providers` reports default provider/model:
  - `defaultProvider: deepseek`;
  - `defaultModelId: deepseek-v4-flash`.
- UI can still show “还不能开始：没有可用模型”.

Likely cause:

- Composer state and provider readiness state are not consistently normalized
  after provider reload, stored local model values, or auth changes.

Acceptance:

- If `/api/providers` has at least one authenticated provider with models,
  Composer must select a valid provider/model.
- Stale `localStorage` values cannot leave Composer in an unusable state.
- Empty model state should explain the real cause:
  - no authenticated provider;
  - authenticated provider has no models;
  - provider list failed to load.

## 4. P1 - Message Flow: Answer First, Process Folded

Observed:

- The transcript shows model text, tool calls, failed browser/tool output, token
  counters, and final answer in one vertical stream.
- This makes the agent look noisy and hard to trust.

Target behavior:

- Default view:
  - show the actual assistant answer;
  - show a compact status line for work done, if useful.
- Collapsed `Process` view:
  - model/tool steps;
  - command/test/browser checks;
  - failed attempts and diagnostics;
  - token counters and low-level action metadata.

Important boundary:

- Do not expose private chain-of-thought.
- The folded section should be execution summary and audit trail, not raw hidden
  reasoning.

Acceptance:

- Routine tool/process entries do not visually dominate the answer.
- User can expand a process block when they want to audit what happened.
- Errors remain visible enough to diagnose without reading a raw log dump.

## 5. P1 - Larger, Friendlier Controls

Observed:

- Auth panel and many modal buttons are visually too small.
- Destructive actions are small icon-only controls.
- Frequent controls look like debug widgets.

Target:

- Frequent actions: `40-44px` height.
- Secondary icon buttons: may stay compact but must have clear hover/active
  states and accessible labels.
- Dialog rows use clearer spacing, less internal-field language, and more
  obvious primary actions.

First surfaces:

- Composer provider/model controls;
- Auth provider rows;
- modal close/refresh buttons;
- task/workbench primary actions.

## 6. P2 - Configuration Simplification

Observed:

- Auth and model config expose internal implementation terms:
  - `stored_api_key`;
  - `oauth available`;
  - provider source fields;
  - raw compatibility fields.

Target:

- Default layer:
  - model access catalog grouped by usage:
    - recommended/common;
    - China models;
    - international/professional models;
    - aggregators/local/enterprise endpoints;
  - provider name;
  - status: ready / needs login / key saved / quota issue / test failed;
  - primary action: Login, Add key, Replace key, Test.
- Advanced layer:
  - raw base URL;
  - API type;
  - token fields;
  - compatibility flags.

Acceptance:

- A non-developer can understand whether a model can be used.
- Common model choices are visible without opening a raw provider table:
  - DeepSeek;
  - GLM / zhipu;
  - OpenAI;
  - ChatGPT / Codex login;
  - Claude;
  - Gemini;
  - xAI / Grok;
  - Kimi / Moonshot;
  - MiniMax;
  - Qwen;
  - Doubao;
  - Groq;
  - Mistral;
  - Together / Fireworks;
  - OpenRouter;
  - Ollama;
  - LM Studio;
  - Azure OpenAI;
  - company/custom OpenAI-compatible gateways.
- Advanced fields remain accessible but are not the first thing the user sees.

## 7. P2 - Project Before Task

Observed:

- Users can create a task, but not clearly create or choose a project.
- This makes long-running work hard to organize.

Target v1:

- Add a visible Project concept in the workbench:
  - project name;
  - project path;
  - default model;
  - open tasks.
- Keep existing task store intact in v1.
- New task can be optionally attached to a project later.

Acceptance for first pass:

- UI copy and entry points distinguish `Project` from `Task`.
- No large persistence migration is required in this pass.

## 8. Execution Order

1. Fix Composer provider/model normalization.
2. Add folded process presentation for noisy message/tool entries.
3. Enlarge primary workbench/modal controls.
4. Simplify Auth provider row copy and actions.
5. Add lightweight Project entry language and placeholder path.

## 9. Verification

Required:

- targeted unit tests for provider/model selection;
- `npm run typecheck`;
- `npm run lint`;
- browser visual check on local preview;
- confirm `/api/providers` usable providers appear selectable.

Optional after first pass:

- desktop and mobile screenshots;
- full Electron package build after UX pass stabilizes.

## 10. Implementation Status - 2026-06-15

Done in first pass:

- Fixed provider/model availability path:
  - curated provider list now keeps authenticated providers that are not in the
    small curated default list;
  - DeepSeek and zhipu can remain selectable when already authorized;
  - added regression coverage for authenticated provider fallback.
- Tightened message/process separation:
  - assistant process-only messages between a user request and the final answer
    are folded into a compact process block;
  - final assistant answer stays visible;
  - pending approvals and clarifications stay visible because they require user
    action;
  - execution-style text before a final answer can be folded inside the process
    block.
- Enlarged baseline controls:
  - `control-xs`: `30px`;
  - `control-sm`: `40px`;
  - `control-md`: `42px`;
  - primary send remains `44px`.
- Simplified Auth provider rows:
  - replaced raw `stored_api_key` / `oauth available` copy with readable status
    labels;
  - enlarged Set/Replace/Test/Remove actions;
  - removed emoji lock icon and used real UI icons.
- Expanded model access choices in the setup wizard:
  - grouped providers into recommended, China models, international/professional
    models, and aggregator/local/enterprise endpoints;
  - direct API-key/OAuth providers open the Auth panel focused on that provider;
  - local models, Qwen/Doubao gateways, Azure/company endpoints, and custom
    OpenAI-compatible services open the advanced model configuration panel;
  - each provider card now shows a readable status such as `已接入`, `可登录`,
    `可填 Key`, or `高级配置`.
- Added lightweight Project language to the task workbench:
  - sidebar shows `当前项目`;
  - task form first section is now `项目与任务`;
  - `工作目录` is relabeled as `项目目录`;
  - no persistence migration yet.

Verification so far:

- `npx vitest run lib/default-model.test.ts`
- `npm run typecheck`
- `npm run lint`

Still pending:

- browser visual review on the running preview;
- possible follow-up patch after looking at Auth modal and message transcript
  in the browser;
- full installer/asar build after this UX pass is accepted.

## 11. Non-goals

- Do not rebuild the full task persistence model in this pass.
- Do not expose full hidden reasoning.
- Do not remove advanced provider/model configuration entirely.
- Do not run a full installer build until the UI pass has been reviewed.
