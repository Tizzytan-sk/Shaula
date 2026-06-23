# Shaula Agent Team Context Orchestration Plan

> Date: 2026-06-22
> Status: ROI/article mapping revised; Phase 0/1 implemented; Phase 2 minimal team-state implemented; Phase 3 Team templates, Team Plan panel/editor, deterministic synthesis, LLM-assisted synthesis guardrail/cache, provider isolation, and unpacked Windows Team acceptance implemented on 2026-06-23
> Scope: Shaula as a local-first coding-agent workbench.

## 0. Core Judgment

这次优化不应该理解成“给 Shaula 多加几个专家 agent”。更准确的方向是：

```text
context boundary router + shared team task state + evidence-backed convergence
```

外部文章的关键提醒是：Agent Team 的核心不是 agent 数量，也不是角色组织架构，而是上下文管理。对 Shaula 来说，下一步要补的是“什么时候单 agent，什么时候拆 subagent，什么时候进入 workflow-backed team；每个执行单元拿哪些上下文、排除哪些上下文、能写哪里、产出什么证据、由谁收敛”。

因此，本方案不建议重写 runtime，也不建议做去中心化 swarm。Shaula 现阶段最适合做的是 manager-led hybrid：

- single agent 仍是默认生产模式；
- subagent 是可审计、默认只读的并行 worker；
- Agent Team 是绑定 `/goal + workflow + worktree + verifier + approval` 的受控工作流；
- shared whiteboard/task list 是工作状态索引，不是验收证据本身。

## 0.1 Expected Benefit And ROI

这条路线有收益，但收益不是“多开几个 agent 后模型立刻变聪明”。收益来自三件更实际的事：

1. **降低复杂 coding 任务失控率**。通过 context packet、write boundary、evidence requirement，让每个执行单元知道自己该看什么、不该看什么、能改哪里、最后要交什么证据。
2. **提高长任务可解释性和可恢复性**。通过 execution mode、team task state、workflow checkpoint，把“现在谁在做什么、为什么这么做、哪里卡住、哪个结果可信”从聊天流里提出来。
3. **减少假完成和假协作**。通过 verifier、evidence id、fake-evidence benchmark，避免 whiteboard 或 subagent 自述替代真实测试、浏览器观察、diff、artifact。

收益最明显的任务类型：

| Task type | Expected benefit |
| --- | --- |
| 大型重构 / 多模块改造 | 能把读取、实现、review、验证分阶段管理，减少上下文混杂 |
| 多文件代码审查 | subagent 可并行只读审查，主 agent 负责冲突收敛 |
| 前端功能验收 | browser/test evidence 与 Team 任务绑定，减少“看起来完成”的假绿 |
| 长时间 `/goal` 任务 | Workbench 能解释执行模式、缺口和下一步，不必回读完整聊天 |
| workflow 模板化任务 | 可把稳定协作链沉淀成模板，而不是每次让模型临场编排 |

收益不明显或不值得使用的任务类型：

| Task type | Reason |
| --- | --- |
| 单文件小改动 | single agent 更快，Team 编排开销大于收益 |
| 强顺序依赖任务 | 并行 worker 容易拿到过期上下文 |
| 需求不清的任务 | 应先 ask_user 或收敛 contract，而不是拆 agent |
| 无明确证据要求的创作任务 | 多 agent 容易造成口径漂移，收益不稳定 |

ROI 判断：

| Item | ROI | Why |
| --- | --- | --- |
| Context Boundary Router | High | 低风险，不改变执行语义，却能解释何时升级/降级 |
| Context Packet Protocol | High | 直接减少 subagent 跑偏和上下文污染 |
| Workbench Execution Mode Strip | High | 让用户理解当前执行形态，产品收益立刻可见 |
| Fake-evidence / router-shadow benchmarks | High | 防止后续 Team 功能把 verifier 和 tool policy 弄假绿 |
| Shared Team Task State | Medium | 对长任务有价值，但要设计 store/schema 和 UI 恢复 |
| Workflow-backed Team Template | Medium | 对复杂任务有价值，但开发和验收成本较高 |
| Feature-flagged hard routing | Low now | 风险高，应等 P0/P1 数据稳定后再做 |

结论：值得改，但应先做 P0 的“治理与可见性”，不要直接全量实现 Team/swarm。

## 0.2 Decision: What To Change Now

如果按这份文档改，收益是成立的，但只成立在“分阶段、先治理、后自治”的前提下。

| Decision | Scope | Why |
| --- | --- | --- |
| Implemented now | Context Boundary Router、Context Packet、Workbench Execution Mode、router-shadow / fake-evidence benchmark | 低风险，不增加 agent 自治权，却能立刻提升可解释性和防跑偏能力 |
| Implemented with guardrails | Shared Team Task State、subagent/workflow evidence linking、failed/warning result visibility、read-only Team Plan panel | 对长任务恢复和协作收敛有价值；已保持 whiteboard/task state 不是验收证据 |
| Implemented as controlled templates | Workflow-backed read-only Team template、worktree-backed implementation Team template、rule-based conflict synthesis | 只通过 workflow capability、worktree isolation、merge approval 进入执行，不做自由 swarm |
| Do next | No further current-phase Team optimization required | 当前阶段收益项已实现并验证；继续保持 `goal_timeline` 不自动触发昂贵模型调用，hard routing 留到未来 feature flag |
| Do not do now | hard routing、generic “Team is stronger” button、role-org-chart personas、recursive swarm、provider/model routing | 风险高，且当前收益不如上下文边界、证据治理和 Workbench 可见性 |

因此，当前最佳执行线不是“把 Shaula 改成多 agent 产品”，而是：

```text
先让 Shaula 知道自己为什么选择某种执行方式
再让每个协作单元拿到边界清楚的上下文
最后再把稳定协作链沉淀为 workflow-backed Team
```

## 0.3 Success Metrics

后续实现不应只看“功能是否做出来”，而应看这些指标是否变好：

| Metric | Target |
| --- | --- |
| Mode explainability | active goal / Workbench 能展示当前 execution mode、原因、证据要求、是否 advisory |
| Context isolation | subagent/workflow 任务都有 bounded context packet，明确 include/exclude/write/evidence 边界 |
| Evidence integrity | whiteboard 或 worker 自述不能满足 `test_result` / `browser_observation` 等强证据 |
| Recovery quality | refresh/reopen 后能恢复 team task 摘要、状态、blocked/warning/failed 子结果 |
| Conflict visibility | 多 worker 结论冲突时产生 warning/partial，而不是被最终总结静默吞掉 |
| Cost discipline | 单文件小改、需求不清、强顺序任务默认仍走 single agent，不强推 Team |

如果这些指标没有改善，即使 Team UI 看起来更完整，也不算有效优化。

## 0.4 Practical Benefit Boundary

这次优化的真实收益主要是“降低复杂任务失败率”，不是“让每次回答更聪明”。

可以期待的收益：

- 长任务中更容易看清当前执行形态、缺口和下一步；
- subagent 结果更容易被审计、复用和追责；
- workflow 输出能更自然地进入 goal evidence/verifier 链路；
- fake completion 的空间变小，尤其是测试、浏览器验收、diff/artifact 这类证据；
- 后续做 Team template 时不需要重写现有 runtime。

不应期待的收益：

- 小任务速度不会明显提升，甚至可能因为编排增加开销；
- 模型能力本身不会因为 Team 状态存在而增强；
- 没有明确证据要求的开放式创作任务，收益不稳定；
- 未经过 feature flag 的 hard routing 不应作为近期目标。

## 0.5 Article Mapping And Revised Benefit Gate

参考来源：用户提供的公众号文章；[Claude Code Agent Teams 官方文档](https://code.claude.com/docs/en/agent-teams)。

用户提供的文章方向与 Claude Code Agent Teams 官方文档的核心判断一致：Agent Team 不是“更多角色名”，而是多个独立上下文窗口围绕 shared task list / mailbox / lead synthesis 协作；它适合并行探索、代码审查、竞争假设调试、跨层功能，但也带来更高 token 成本、协调开销、恢复/任务状态/关闭等稳定性风险。

映射到 Shaula 后，不能直接照搬“完整 agent team”。更稳的产品化翻译如下：

| External concept | Shaula translation | Adopt now? | Reason |
| --- | --- | --- | --- |
| 独立 teammate context | `ContextPacket` + bounded child prompt | Yes | 这是收益核心：减少上下文污染和任务跑偏 |
| Shared task list | append-only `team-state` + Workbench Team Plan | Yes | 让长任务可恢复、可审计、可解释 |
| Lead synthesis | deterministic synthesis + optional LLM assist | Yes, with guardrails | 收敛必须可追溯；LLM 只能辅助表达和聚合，不能改证据结论 |
| Direct teammate messaging | 暂不做自由 mailbox | Not now | 当前 Shaula 更需要 evidence-linked 状态，而不是 agent 间闲聊 |
| Multiple writable teammates | worktree-backed template + merge approval | Limited | 只有隔离工作区、明确写路径、可审核 diff 时才值得 |
| Automatic team spawn | advisory router / composer-prepared prompt | Not now | hard routing 容易误判任务复杂度，且成本和失败模式不可见 |

因此，文档后的收益判断应改成一个闸口，而不是一句“Team 有收益”：

| Gate | Must be true before using Team |
| --- | --- |
| Decomposition | 任务能拆成相互独立的 review / research / implementation slice |
| Evidence | 每个 slice 能产出明确 evidence、artifact、diff、test 或 browser observation |
| Conflict value | 多视角可能发现单 agent 容易漏掉的冲突、风险或假设 |
| Write isolation | 涉及写代码时，文件边界清楚，最好通过 worktree 隔离 |
| Recovery value | 任务足够长，值得把状态从聊天流抽成 Team Plan |
| Cost discipline | 预期收益高于 token、等待、协调和 UI 复杂度成本 |

如果这些 gate 不成立，应该继续走 single agent 或普通 subagent，不应升级为 Team。换句话说，这篇文章提供的是“何时值得拆上下文”的优化方向，不是“把 Shaula 全面改造成多 agent 公司”的方向。

## 1. Current Baseline

Shaula 已经具备多 agent 协作的底座，不是从零开始。

| Area | Current capability | Gap for this proposal |
| --- | --- | --- |
| Goal / contract | `/goal`、execution contract、required evidence、goal verifier | 仍不应让 Team state 替代 goal verifier；后续重点是更强 synthesis |
| Evidence | durable evidence/runtime events、verification evidence、browser/test/diff evidence、team task evidence refs | strong evidence 仍必须来自 deterministic/host-observed 来源 |
| Subagents | batch/task、verification、synthesis、audit、retry/resume、writePaths、worktree merge approval、team-state mirror、domain-aware Team synthesis、LLM-assisted synthesis guardrail、on-demand provider-backed synthesis assist/cache、assist model/cache/latency/token/cost visibility、manual force-refresh、provider-error/retry copy | LLM 输出仍不能覆盖或替代 evidence trust rules；查询面不应自动触发模型调用 |
| Workflows | generated script harness、patterns、checkpoint/artifact/resume、capability approval、worktree、built-in Team templates、provider dogfood orchestration-tool disabled matcher | unpacked Windows packaged-app acceptance 和 NSIS installer-mode acceptance 均已通过 |
| Router | advisory task-router 可推荐 goal/subagent/workflow/browser/ask_user；Workbench 可展示 execution mode | 仍是 advisory，不作为硬门禁；hard routing 需要 feature flag 和更多数据 |
| Workbench | 已展示 goal、main artifact、evidence、readiness、execution mode、team task summary、Team Plan panel；pre-execution editor 可把 readonly/worktree Team template prompt 准备到 composer | editor 不直接执行 Team template；用户仍需发送 prompt 并经过 agent/tool approval 链路 |

## 1.1 Implementation Progress

Started on 2026-06-23:

- Added `lib/agent-mode/*` for advisory execution-mode summaries and bounded context-packet rendering.
- Added focused context-packet tests proving subagent/team tasks can carry explicit context, write, and evidence boundaries.
- Surfaced the latest route decision in the Workbench overview as an advisory execution-mode strip.
- Added deterministic skill-eval cases for router shadow visibility and whiteboard fake-evidence rejection.
- Added `lib/team-state/*` as an independent append-only team task state store.
- Derived team task updates from real subagent/workflow runtime events and linked them to existing `subagent_result` / `workflow_artifact` evidence ids.
- Returned `teamTasks` from `goal_timeline` and surfaced compact team task summaries in Workbench overview and Goal Timeline.
- Added rule-based Team task verification for failed/warning/non-terminal tasks, linked evidence coverage, team-native subagent/workflow result references, and obvious cross-task yes/no conflicts.
- Added deterministic `team-readonly-conflict-synthesis` benchmark coverage so conflicting read-only child results produce warning convergence instead of silent green.
- Added built-in `team-readonly-review` workflow template with `spawn_agent + read_files` only, bounded reviewer fan-out, structured reviewer output, conflict detection, checkpointing, and a `team-readonly-review` artifact.
- Exposed built-in workflow templates through the existing template registry/API while allowing user templates with the same id to override them.
- Added deterministic `workflow-team-template-readonly` benchmark coverage so the built-in template runs through the workflow runtime and warns on conflicting child reviewers without unsafe capabilities.
- Added deterministic `workflow-team-capability-deny` benchmark coverage so denied high-risk workflow capability stops before script side effects, artifacts, or child agents.
- Added built-in `team-worktree-implementation` workflow template that creates an isolated worktree, runs a bounded implementation worker with cwd set to that worktree, records diff evidence, verifies the diff, and only merges when `requestMerge` is true and existing workflow merge approval allows it.
- Added deterministic `workflow-team-worktree-implementation` benchmark coverage so the implementation Team path proves worktree cwd isolation, write/worktree capability approval, diff artifact recording, and merge approval.
- Added a dedicated Workbench `Team` tab/panel that reads `goal_timeline` and shows active objective, task count/status/evidence count, verifier checks, task status, owner/source, context boundary, write paths, required evidence, evidence labels, and blocked state.
- Added Team tab creation, persisted tab restoration, and launcher entry without making Team the default execution mode.
- Added browser-level Workbench acceptance coverage for the Team Plan panel, including compact Team task summary, Team tab launch, task cards, context boundary, evidence labels, and verifier checks.
- Added `provider-team-tool-isolation` benchmark coverage and included `run_workflow_template` in provider dogfood orchestration-tool disabling, so reusable Team templates are disabled alongside subagent and dynamic workflow tools during provider dogfood.
- Added an env-gated Windows release acceptance Team window probe. During `release:acceptance:win`, Electron now opens the Workbench Team entry and records `team-window-probe.json`, proving the packaged shell can render the Team Plan panel when a Windows artifact is available.
- Added deterministic domain-aware Team synthesis that converts tasks, linked evidence, verifier warnings/conflicts/gaps, and inferred domains into a `teamTaskSynthesis` payload returned by `goal_timeline`.
- Surfaced Team synthesis in the Workbench Team Plan panel and Goal Timeline without making synthesis a trusted evidence source.
- Added `team-domain-aware-synthesis` benchmark coverage so Team conclusions, warnings, inferred domains, and evidence ids remain visible.
- Rebuilt the Electron Windows artifact and ran unpacked Windows release acceptance with the Team window probe enabled.
- Added a pre-execution Team Plan editor in `WorkbenchSidebar` that previews `team-readonly-review` and `team-worktree-implementation` prompts, keeps `requestMerge` false by default, and hands the prepared prompt to the composer through `ChatApp`.
- Added an LLM-assisted Team synthesis guardrail layer: bounded prompt builder, candidate-output sanitizer, strict id allowlists, required risk/conflict/gap item retention, and rejection of status upgrades or invented evidence. This does not call a provider automatically.
- Surfaced optional LLM-assistance status in the Workbench Team Plan panel and Goal Timeline without mixing it into deterministic synthesis status.
- Added explicit provider-backed `team_synthesis_assist` Team action that recomputes deterministic synthesis, fingerprints it, builds the bounded assistance prompt, calls the current provider model only on demand, sanitizes the returned JSON, and caches the assistance by deterministic synthesis fingerprint.
- Added `teamSynthesisAssistanceStore` persistence and made `goal_timeline` attach cached assistance only when the deterministic fingerprint matches; `goal_timeline` still never calls a provider.
- Added a Workbench Team Plan `LLM assist` button that triggers the explicit action, refreshes the cached synthesis view, and surfaces accepted/rejected assistance state.
- Added deterministic `team-llm-assisted-synthesis-cache` benchmark coverage so explicit provider assistance calls the model once and subsequent reads reuse the fingerprint cache.
- Added LLM assist metadata visibility: cached/fresh state, provider/model id, latency, HTTP status, token count, and estimated cost are persisted with the cache record and surfaced in the Workbench Team Plan panel and Goal Timeline.
- Added a manual cache invalidation path: once assistance exists, the Workbench button becomes `Refresh assist` and sends `force: true`, so users can explicitly rerun provider assistance without making query surfaces expensive.
- Added structured LLM assist provider-error handling: missing credentials, quota/resource errors, timeout, unsupported local CLI model, and invalid JSON output now return a user-facing `userError` with title/message/action label; Team Plan renders that copy and supports manual retry.
- Exported provider dogfood orchestration-tool disable rules and matcher so current and future `workflow_`, `run_workflow_`, `subagent_`, retry/continue/open-child subagent tools remain disabled during provider dogfood unless a case explicitly requires them.

Validated on 2026-06-23:

- TypeScript compile passed with no emitted output.
- Focused context-packet, advisory router, skill-eval, and evidence-ledger tests passed.
- `benchmark:shaula` passed after adding the router-shadow and fake-evidence cases.
- Focused team-state, runtime mirror, and goal timeline tests passed after adding Phase 2 minimal state.
- Focused Team verifier and skill-eval tests passed after adding the first Phase 3 convergence gate.
- Focused workflow template store/API/runtime and skill-eval tests passed after adding the built-in read-only Team template.
- Focused workflow capability-deny skill-eval coverage passed.
- Focused workflow runtime and skill-eval tests passed after adding the worktree implementation Team template.
- TypeScript compile passed after adding the Workbench Team Plan panel.
- Focused goal timeline, Team verifier, workflow template/runtime, and skill-eval tests passed after the Team Plan panel/doc update; 57 tests passed.
- `benchmark:shaula` passed after the Team Plan panel/doc update; 71 tests passed.
- `npx playwright test e2e/10-workbench.spec.ts` passed after adding Team Plan panel acceptance coverage; 5 tests passed.
- Focused skill-eval runner and provider dogfood tests passed after adding `provider-team-tool-isolation` and `run_workflow_template` disabling.
- `benchmark:shaula` passed after adding provider Team tool isolation; 71 tests passed.
- `npx vitest run scripts/release-acceptance-win.test.mjs` passed after adding the Team window probe to the Windows acceptance dry-run plan.
- Focused Team synthesis, goal timeline, skill-eval runner, and Workbench e2e tests passed after adding domain-aware Team synthesis.
- `benchmark:shaula` passed after adding domain-aware Team synthesis; 71 tests passed.
- `npm run build:electron` passed before Windows packaging.
- `node scripts/build-electron.mjs --win nsis --x64 --config.win.signAndEditExecutable=false` passed and regenerated `dist/win-unpacked` plus the NSIS artifact.
- `npm run release:acceptance:win:unpacked` passed after the Team probe timing fix; the packaged shell rendered the Team Plan panel, settings route, local assistant session creation, and clean shutdown.
- `npx tsc --noEmit --pretty false` passed after wiring the Team Plan editor composer handoff.
- `npx playwright test e2e/10-workbench.spec.ts -g "Team Plan"` passed after adding coverage for prompt preview, composer handoff, readonly template prompt, worktree template prompt, default `requestMerge: false`, and no direct workflow request.
- `npx playwright test e2e/10-workbench.spec.ts` passed after the editor handoff; 5 tests passed.
- `npm run benchmark:shaula` passed after the editor handoff; 71 tests passed.
- `npx vitest run lib/team-state/synthesis.test.ts lib/skill-eval/runner.test.ts` passed after adding the LLM-assisted synthesis guardrail; 7 tests passed.
- `npx tsc --noEmit --pretty false` passed after adding the LLM-assisted synthesis guardrail.
- `npm run benchmark:shaula` passed after adding the LLM-assisted synthesis guardrail; 71 tests passed.
- `npx playwright test e2e/10-workbench.spec.ts` passed after surfacing optional LLM-assistance status; 5 tests passed.
- `npx tsc --noEmit --pretty false` passed after adding on-demand provider-backed synthesis assist/cache.
- `npx vitest run lib/agent-actions/team-actions.test.ts lib/agent-actions/query-actions.test.ts lib/team-state/synthesis-assistance-store.test.ts lib/team-state/synthesis.test.ts lib/skill-eval/runner.test.ts` passed after adding the provider-backed cache path; 17 tests passed.
- `npm run benchmark:shaula` passed after adding `team-llm-assisted-synthesis-cache`; 71 tests passed.
- `npx playwright test e2e/10-workbench.spec.ts -g "Team Plan"` passed after wiring the Workbench `LLM assist` action.
- `npx playwright test e2e/10-workbench.spec.ts` passed after the provider-backed cache path; 5 tests passed.
- `npx tsc --noEmit --pretty false` passed after adding LLM assist operational metadata.
- The same 17 focused Team/action/query/synthesis/skill-eval tests passed after adding metadata persistence and cached/fresh decoration.
- `npx playwright test e2e/10-workbench.spec.ts -g "Team Plan"` passed after surfacing cached provider/model/latency metadata.
- `npm run benchmark:shaula` passed after metadata visibility; 71 tests passed.
- `npx tsc --noEmit --pretty false`, the same 17 focused tests, and `npx playwright test e2e/10-workbench.spec.ts -g "Team Plan"` passed after adding manual `Refresh assist` / `force: true` coverage.
- `npx tsc --noEmit --pretty false`, 19 focused Team/action/query/synthesis/skill-eval tests, `npm run benchmark:shaula`, `npx playwright test e2e/10-workbench.spec.ts -g "Team Plan"`, and full `npx playwright test e2e/10-workbench.spec.ts` passed after adding provider-error copy and retry coverage.
- `npx vitest run scripts/provider-dogfood.test.mjs` passed after adding direct orchestration-tool disabled matcher coverage; 13 tests passed.
- `npm run benchmark:shaula` passed after the provider-disabled matcher update; 72 tests passed.
- `npm run release:acceptance:win:install` passed with the existing NSIS artifact: silent temp install, packaged app launch, health check, main window, settings route, local-coding-assistant session creation, Team Plan probe, shutdown, and uninstaller cleanup all succeeded.

Still not implemented:

- Automatic/background provider-backed LLM synthesis is intentionally not implemented. Provider calls remain explicit/on-demand, and `goal_timeline` remains a read-only query surface.
- Feature-flagged hard routing.

Boundary preserved:

- No new hard routing was introduced.
- No new write, shell, network, MCP, browser, or worktree capability was granted.
- Whiteboard/progress self-reports still cannot satisfy deterministic or host-observed evidence.
- Team task state references evidence ids but does not create trusted evidence itself.
- Team-native `subagent_result` / `workflow_artifact` references are accepted as Team-layer evidence, but strong requirements like `test_result` and `browser_observation` still require deterministic or host-observed evidence.
- LLM-assisted synthesis candidates cannot upgrade deterministic Team synthesis status, introduce evidence ids outside the existing synthesis, or omit required risk/conflict/gap items.
- Provider-backed synthesis assistance runs only through an explicit Team action, caches by deterministic synthesis fingerprint, and `goal_timeline` can only attach the cached assistance.
- Denied workflow capabilities cannot execute the script body, create artifacts, spawn child agents, or mark the workflow successful.
- Implementation Team writes happen only inside a workflow-created worktree; applying the isolated patch back to the main workspace still requires merge approval.
- The Team Plan panel visualizes existing goal/team/evidence state. The pre-execution editor only prepares a composer prompt for `run_workflow_template`; it does not create trusted evidence, trigger Team execution directly, or bypass the agent/tool approval chain.

## 2. Mode Selection Matrix

| Mode | Use when | Entry | Visible state | Safety boundary |
| --- | --- | --- | --- | --- |
| Single agent | 默认；单一主产物；顺序代码改动；1-3 步能闭环；上下文连续性比并行更重要 | 普通 prompt 或 `/goal` | Workbench: contract、main artifact、progress、evidence、verifier | contract + required evidence + goal verifier |
| Subagent coordinator | 批量问答、多模块只读 review、多视角分析、多个文件/文档可独立读取 | 用户明确要求并行/subagent，或 router 给出高置信建议 | Workbench 协作计划 + chat subagent card | task/concurrency 上限、默认只读、writePaths、batch verification/synthesis |
| Workflow-backed Agent Team | 开放式复杂 coding 项目；需要 plan/implement/review/browser QA/verifier 多阶段循环；任务路径事先不可完全预测 | `/goal` 或 Team plan 确认后，由 workflow script/template 执行 | Team plan、阶段、依赖、checkpoint、artifact、worktree、approval、blocked state | workflow capabilities approval、maxAgents/maxConcurrency、worktree isolation、goal verifier |
| Handoff / full transfer | 客服路由、领域交接、用户意图分流 | 暂不作为 coding 主路径 | 不优先 | coding 场景容易丢上下文，不建议作为 Shaula 优化重点 |

原则：不要把三种模式做成三个平级按钮。用户不应该先学习架构名词。Shaula 应该默认走 single agent，只在有明确收益时建议升级，并解释原因。

## 3. Optimization Backlog

### P0. Context Boundary Router

新增一层 `Agent Mode Router`，目标不是替代现有 advisory router，而是让建议更可解释。

Input:

- user prompt / active goal;
- execution contract / main artifact / required evidence;
- current progress;
- available evidence and missing evidence;
- existing subagent batches / workflow runs / checkpoints;
- write scope and high-risk capabilities;
- explicit user trigger, such as "spawn agents", "并行", "team", "workflow".

Output:

- mode: `single_agent | subagent_coordinator | workflow_team | ask_user | browser_verify`;
- confidence;
- reason;
- context packet plan;
- permission profile;
- required evidence plan;
- whether user confirmation is required.

Acceptance:

- router remains advisory by default;
- every recommendation is visible in Workbench;
- disabled tools and provider dogfood tool policy must override router recommendation;
- no routing decision can bypass verifier, tool approval, or write boundary.

### P0. Context Packet Protocol

每个 worker/subagent/workflow agent 不应拿完整聊天历史，而应拿一个明确的 context packet。

Suggested shape:

```ts
interface ContextPacket {
  objective: string;
  taskTitle: string;
  taskBoundary: string;
  includeContext: Array<{ kind: string; ref: string; summary: string }>;
  excludeContext?: string[];
  relevantPaths?: string[];
  writePaths?: string[];
  requiredEvidence: string[];
  outputContract: {
    format: "summary" | "json" | "patch" | "review";
    mustInclude: string[];
    mustNotDo: string[];
  };
}
```

Acceptance:

- child prompt can be generated from context packet;
- packet is stored with the task for audit;
- packet explicitly records excluded context and write boundary;
- packet size is bounded and does not silently include full transcript.

### P0. Workbench Execution Mode Strip

在 Workbench 增加“当前执行模式”状态条。

It should show:

- current mode: 单 agent / 子任务协作 / Team workflow;
- why this mode was chosen;
- what evidence is required;
- whether the user can switch mode;
- whether the mode is only advisory or already active.

Acceptance:

- user can see why Shaula stayed single or suggested subagents;
- subagent/team state is not buried only in chat card;
- the UI does not market Team as always stronger.

### P0. Shared Team Task State

新增轻量 team task state，挂在 active goal 或 workflow run 下。不要复用 `lib/tasks` 的 long-running monitor model。

Suggested shape:

```ts
interface TeamTask {
  id: string;
  title: string;
  status: "pending" | "running" | "blocked" | "completed" | "warning" | "failed";
  ownerType: "main" | "subagent" | "workflow" | "human";
  ownerId?: string;
  dependsOn?: string[];
  contextPacketId?: string;
  writePaths?: string[];
  requiredEvidence: string[];
  evidenceIds: string[];
  artifactRefs: string[];
  blockedBy?: string;
  createdAt: number;
  updatedAt: number;
}
```

Rules:

- append-only event history;
- task completion is not automatically evidence completion;
- whiteboard/task state can reference evidence ids, but cannot fabricate evidence;
- failed/warning/rejected subtask must remain visible in final synthesis.

### P1. Evidence Integration For Subagent / Workflow Results

Subagent and workflow outputs should become first-class references in the goal evidence flow, without weakening evidence trust rules.

Rules:

- `subagent_result` and `workflow_artifact` can be referenced by team tasks;
- deterministic tests still require deterministic evidence;
- browser evidence still requires host-observed browser result;
- whiteboard notes like "tests passed" must not satisfy `test_result`;
- final completion must cite evidence ids.

### P1. Workflow-Backed Team Template

Do not turn `delegate_subagents` into a free-form swarm. Real Agent Team should use workflow script/template as the orchestration layer.

Minimum team template:

```text
plan -> create team task list -> fan out read-only workers -> verify conflicts
-> optional implementation in worktree -> browser/test verification -> synthesize
-> goal_update only after evidence passes
```

Required boundaries:

- maxAgents / maxConcurrency;
- explicit stop condition;
- capability approval for write/shell/browser/network/worktree/MCP;
- worktree for implementation;
- no nested uncontrolled subagents;
- checkpoints and artifacts at each phase.

### P1. Team Verifier / Conflict Synthesis

Subagent batch `completed` is not enough. Team output needs a convergence gate.

Verifier should check:

- missing tasks;
- failed/timeout tasks;
- conflicts between worker conclusions;
- unsupported claims;
- rejected/warning worker results included in final synthesis;
- evidence coverage against required evidence.

Output should support `passed | warning | failed`, and warning/failed must be visible in Workbench.

### P1. Benchmark / Dogfood Additions

Add deterministic cases before making team routing active:

| Case | Expected behavior |
| --- | --- |
| `team-readonly-conflict-synthesis` | conflicting child results produce warning/partial, not silent green |
| `team-domain-aware-synthesis` | implemented: team task synthesis exposes domain-aware conclusions, risks, conflicts, gaps, and linked evidence ids |
| `team-llm-assisted-synthesis-guardrail` | implemented: candidate LLM synthesis cannot upgrade warning status, invent evidence ids, or omit required risk/conflict/gap items |
| `team-llm-assisted-synthesis-cache` | implemented: explicit Team assist action may call provider once per deterministic synthesis fingerprint; `goal_timeline` only reads cached assistance |
| `team-write-boundary-denied` | missing or overlapping writePaths denies/strips write tools |
| `whiteboard-fake-evidence-rejected` | whiteboard says tests passed, verifier still rejects until deterministic evidence exists |
| `router-shadow-visibility` | router recommendation is visible but does not auto-execute |
| `router-disabled-tools-respected` | disabled subagent/workflow tools cannot be called or claimed |
| `workflow-team-capability-deny` | denied write/shell/network/MCP capability creates no side effect and cannot complete goal |
| `provider-team-tool-isolation` | implemented: provider dogfood disables subagent/workflow orchestration tools, including `run_workflow_template` |
| `windows-team-ui-acceptance` | implemented for unpacked artifact: packaged shell renders Team Plan, settings, local assistant session creation, and clean shutdown |

### P2. Feature-Flagged Hard Routing

Only after P0/P1 evidence is stable:

- allow hard routing for low-risk read-only subagent review;
- allow hard routing for browser observation when browser evidence is required;
- keep write/shell/network/MCP/worktree behind approval;
- keep provider/model routing out of scope until workflow SDK supports it explicitly.

## 4. Architecture Proposal

### 4.1 Logical Chain

```text
User prompt / goal
  -> Execution contract
  -> Agent Mode Router
  -> Context packet(s)
  -> Single agent OR Subagent batch OR Workflow-backed team
  -> Team task state / artifacts / checkpoints
  -> Evidence ledger
  -> Verifier
  -> Workbench handoff
```

### 4.2 Single Agent Chain

```text
prompt
  -> contract
  -> main agent works in current context
  -> records progress/evidence
  -> goal_update complete
  -> verifier accepts/rejects
```

Use this as the default. It is cheaper, easier to understand, and usually better for small coding tasks.

### 4.3 Subagent Coordinator Chain

```text
prompt / goal
  -> router suggests subagent_coordinator
  -> planner creates task list + context packets
  -> delegate_subagents
  -> child agents run bounded tasks
  -> batch verification + synthesis
  -> team task state references results
  -> parent agent synthesizes final answer
```

Use for independent read/review/research slices. Do not use it for tightly sequential edits or ambiguous write scopes.

### 4.4 Workflow-Backed Agent Team Chain

```text
/goal
  -> router suggests workflow_team
  -> user confirms or explicit Team command
  -> run_workflow_script / run_workflow_template
  -> workflow creates checkpoints, artifacts, team tasks
  -> workers run with capability limits
  -> implementation runs in worktree
  -> verifier checks evidence/conflicts
  -> final synthesis cites evidence ids
```

Use for complex coding projects where plan, implementation, review, browser QA, and verification need multiple stages.

## 5. Hard Boundaries

These boundaries should not be weakened by Agent Team:

- `goal_update complete` still requires verifier acceptance.
- Whiteboard/team task state is not trusted evidence by itself.
- Test evidence must remain deterministic.
- Browser evidence must remain host-observed.
- Subagent defaults remain read-only.
- Write-capable child tasks require `writePaths`.
- Workflow high-risk capabilities still require approval.
- Implementation team tasks should use worktree isolation and merge approval.
- Provider dogfood should keep orchestration tools disabled unless the case explicitly tests orchestration.
- Router stays advisory until a specific low-risk feature flag graduates it.
- No provider/model routing promise until the workflow SDK supports it.

## 6. Non-Goals

- Do not build a role-org-chart feature with PM/reviewer/coder personas as the main product.
- Do not make Team a generic "stronger mode" button.
- Do not implement decentralized swarm where workers can recursively spawn and hand off without a lead.
- Do not reuse long-running `lib/tasks` as the current goal's shared whiteboard.
- Do not create a second evidence database.
- Do not allow multiple implementation agents to write the same workspace without isolation and approval.
- Do not let route decisions replace verifier decisions.

## 7. Recommended Execution Order

### Phase 0: Characterize Before Changing Behavior

Purpose: prove current boundaries before adding new execution paths.

1. Add route characterization tests for current single/subagent/workflow recommendations.
2. Add `router-shadow-visibility`, `router-disabled-tools-respected`, and `whiteboard-fake-evidence-rejected` benchmark cases.
3. Confirm provider dogfood still disables orchestration tools unless the case explicitly tests them.

Exit criteria:

- no execution semantics changed;
- router recommendations are observable in tests;
- fake whiteboard evidence cannot satisfy required evidence.

### Phase 1: High-ROI Visibility And Context Boundaries

Purpose: deliver product clarity without increasing autonomy.

1. Add `ContextPacket` types and prompt rendering tests.
2. Add Workbench execution mode strip using existing advisory route decision.
3. Persist or display context packet summaries for subagent/workflow tasks.
4. Show why Shaula stayed single, suggested subagents, or recommended workflow team.

Exit criteria:

- user can see execution mode and reason;
- child prompts are generated from bounded context packets;
- no router decision bypasses tool policy, verifier, or write boundary.

### Phase 2: Shared Team Task State

Purpose: make long tasks auditable and recoverable.

1. Add shared team task state as append-only goal/workflow-scoped metadata.
2. Link subagent/workflow outputs to team task state and evidence ids.
3. Keep team task notes separate from trusted evidence.
4. Surface failed/warning/rejected child results in Workbench.

Exit criteria:

- each team task has owner, status, context packet, required evidence, and evidence refs;
- whiteboard/task state cannot itself satisfy deterministic or browser evidence;
- refresh/reopen can recover team task summaries.

### Phase 3: Workflow-Backed Team Templates

Purpose: introduce real Agent Team only where orchestration is worth the cost.

1. Add conflict synthesis/verifier for team batches.
2. Create a workflow-backed Team template for read-only review + synthesis.
3. Add worktree-backed implementation template only after read-only template is stable.
4. Add Windows packaged-app acceptance probe for Team/whiteboard UI.

Exit criteria:

- read-only Team can find and expose conflicting results;
- implementation Team writes only through worktree + merge approval;
- workflow capabilities remain approval-gated;
- final synthesis cites evidence ids.

### Phase 4: Limited Hard Routing

Purpose: automate only low-risk routes after evidence is stable.

1. Consider feature-flagged hard routing for read-only subagent review.
2. Consider feature-flagged hard routing for browser observation when browser evidence is required.
3. Keep write/shell/network/MCP/worktree behind explicit approval.
4. Keep provider/model routing out of scope until workflow SDK supports it explicitly.

As of 2026-06-23, Phase 0, Phase 1, the minimal Phase 2 state layer, the controlled Phase 3 templates, browser-level Team Plan UI/editor acceptance, provider Team tool isolation, deterministic domain-aware Team synthesis, LLM-assisted synthesis guardrail/cache, unpacked Windows Team acceptance, and Team Plan editor composer handoff are implemented.

If only one new engineering thread can start next, start with:

```text
Feature-flagged hard routing, only after separate approval
```

Reason: the current implementation has already delivered visibility, context boundaries, task state, controlled Team templates, browser UI/editor coverage, provider tool isolation, deterministic synthesis, LLM-assistance guardrails, on-demand provider-backed cache, cache/provider/cost metadata visibility, manual force-refresh, provider-error/retry copy, future orchestration-tool disabled coverage, unpacked Windows packaged-shell acceptance, and NSIS installer-mode acceptance. The only remaining expansion is hard routing, which is intentionally outside the current phase because it changes autonomy and needs a dedicated feature flag decision.

## 8. Subagent Review Summary

Three parallel reviews converged on the same direction:

- Architecture review: build `context boundary router + shared task state`; do not add role theater or second runtime.
- Product review: default single agent; subagent for independent parallel work; real Team must be workflow-backed and visible in Workbench.
- Risk review: Team/whiteboard/router must enter as visible/advisory layers first; verifier/tool policy/evidence trust boundaries remain hard.

## 9. Open Questions

Current recommended answers:

| Question | Current answer |
| --- | --- |
| Should the first UI surface be a compact Workbench strip only, or a full "Team Plan" panel? | Done in stages: compact execution-mode strip first, read-only Team Plan panel after team task state existed, then a prompt-preparation editor that hands controlled Team template prompts to the composer. |
| Should team task state live under goal store, workflow store, or a new `team-state` store with references to both? | Use a new `team-state` store. Reference goal/workflow/subagent ids instead of overloading goal or workflow stores. |
| Should context packet be persisted as a separate artifact or embedded in each team task event? | Embed the packet summary in team task state first; add separate artifacts later only if audit/debug requires full packet history. |
| What is the smallest useful Team template: read-only multi-review, or full plan-review-implement-verify? | Read-only multi-review was implemented first; implementation Team was added only through worktree isolation and merge approval. |
| Should route recommendations be shown before execution, after execution starts, or both? | Show after execution starts first, because it is easier to keep truthful. Pre-execution suggestions can prepare a composer prompt, but should not directly execute the Team template or bypass approval. |

Remaining open risk:

- The main unsolved design point is no longer basic UI, persistence, editor handoff, deterministic synthesis, LLM-assistance guardrails, the explicit provider-backed cache path, basic cost/provider visibility, manual force-refresh, provider-error copy, provider-disabled orchestration coverage, or Windows release acceptance. Remaining risk is only future hard routing, which should not be folded into this optimization pass.
- Hard routing should still wait. The current implementation is useful because it makes Team work visible and auditable; it does not yet prove that Shaula should automatically choose Team without user intent or a feature flag.
