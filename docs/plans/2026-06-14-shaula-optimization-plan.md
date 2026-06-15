# Shaula Optimization Execution Plan

> Status: Executed locally, pending user review
> Date: 2026-06-14
> Scope: Phase 11+ optimization plan after the current execution-spine build.
> Principle: Do not build a second platform. Strengthen the existing
> contract -> evidence -> rubric -> action -> retry loop.

## 1. Core Judgment

Shaula 下一阶段的核心不是继续堆功能，也不是先做大规模 UI 重构。
真正要优化的是一件事：

> 长程任务结束时，Shaula 能否判断自己是不是真的完成，并把未完成的部分转成下一步行动。

参考用户提供的 Harness Engineering 文章：
https://mp.weixin.qq.com/s/mSjb20PDsfiK88C9AQB7og

文章里最有价值的点不是某个 prompt 技巧，而是工程框架：

- agent loop 保持简单；
- planner / developer / evaluator 职责分离；
- context 要够用，但不能泛滥；
- rubric 和 quality vision 是验收系统，不是文档装饰；
- evaluator 的输出要反哺下一轮执行；
- skills 的好坏要靠可复跑的 case suite 评估。

Shaula 现在已经有 contract、Evidence Ledger、rubric evaluator、
EvaluationAction、VerificationPlan、read-only verifier 和 benchmark task
雏形。下一阶段应该把这些连接成闭环，而不是另起一套 Skill Eval 平台。

## 2. Current Local Reality

当前仓库已经完成 Phase 0-10 的执行脊柱建设，详见：

- `docs/plans/2026-06-14-shaula-execution-plan.md`
- `docs/plans/2026-06-14-shaula-agent-benchmark-tasks.md`

同时，当前工作区存在一批未提交的品牌/UI 改动：

- 多处用户可见文案从 Shaula 改为 Shaula；
- 新增 `public/brand/shaula-scorpion-*.png`；
- package / Electron / layout / e2e 文本均有修改；
- 部分地方把正式应用名从 `Shaula Agent` 缩短成 `Shaula`。

这些改动不应和 Phase 11+ runtime 优化混在同一批完成。先收口品牌/UI，再动
goal closure 和 evaluator loop。

## 3. Execution Order

### Batch A: Brand And UI Diff Closure

Purpose: 先把当前已经发生的品牌/UI 改动收干净，避免后续 runtime 改动叠在脏
工作区上。

Work items:

1. 统一命名规则：
   - 短品牌名、导航、小型 logo：`Shaula`
   - 应用正式名、窗口标题、安装包、Electron product name：`Shaula Agent`

2. 收口 icon 资产：
   - 保留运行时真正需要的 32px / 256px 资产；
   - 大尺寸源图不要直接放进 `public/` 运行包；
   - 小尺寸深色背景下必须可辨认。

3. 收口 EmptyState：
   - 不只展示 slogan；
   - 展示模型状态、目标状态、证据状态、下一步动作。

4. 修正 e2e anchor：
   - 不用过宽的 `text=Shaula` 作为唯一断言；
   - 用稳定 test id 或 `Shaula Agent` boot anchor。

Acceptance criteria:

- `Shaula` 和 `Shaula Agent` 使用边界一致；
- icon 在暗色、小尺寸、mobile 和 Electron 场景下可见；
- e2e 文本断言稳定；
- 品牌/UI 改动可以单独提交。

Validation:

- `npm run lint`
- `npm test`
- `npm run build`
- related Playwright smoke tests

## 4. Phase 11: Goal Run Closure v0

Purpose: 每次 goal run 结束时，不让 agent 只靠自我汇报结束，而是由 harness
判断当前状态。

Closure verdict:

- `ready_to_finalize`: 可以进入最终收尾，但不能自动完成；
- `continue`: 证据不足、action 未完成或下一步明确，继续执行；
- `needs_user`: 需要用户决策；
- `blocked`: 明确卡住，且继续自动跑没有意义。

Work items:

1. 新增纯逻辑模块：
   - `lib/goal/closure.ts`
   - 输入 goal、contract summary、evidence、evaluation、open actions、
     verification result；
   - 输出 closure verdict、missing evidence、open actions、next action、
     user question。

2. 抽出统一验证输入：
   - 从现有 completion verifier 和 goal update 路径抽出共享 collector；
   - 避免 completion gate 和 closure gate 各读一套数据。

3. 接入运行结束路径：
   - 在 `finishStreamingRun` 后；
   - 在 `maybeContinueGoal` 前；
   - closure 先判断，auto-continue 再决定。

4. 回灌下一轮 prompt：
   - 如果 verdict 是 `continue`，下一轮 prompt 必须包含：
     - missing evidence；
     - failed criteria；
     - open EvaluationAction；
     - concrete next action。

5. 保持人工完成边界：
   - `ready_to_finalize` 不等于自动 `goal_update complete`；
   - 只要求模型生成最终总结并显式调用完成动作。

6. UI/API:
   - `goal_timeline` 暴露 `lastClosure`；
   - GoalBar 折叠态显示 closure badge；
   - GoalTimeline 顶部显示 closure summary。

Acceptance criteria:

- completion 被拒绝时，下一轮不是泛化继续，而是按 open action 修；
- closure 结果可以在 timeline 里追溯；
- ready 状态不会静默自动完成；
- blocked / needs_user 不会无限自动续跑。

Validation:

- Unit tests for `evaluateGoalRunClosure`;
- goal update / timeline tests;
- rejected completion -> action -> continuation prompt regression test.

## 5. Phase 12: Runtime VerificationPlan Wiring

Purpose: 让 VerificationPlan 从“可推断计划”变成“可受控执行的证据来源”。

Work items:

1. 增加显式入口：
   - UI 或 action 中提供 `Run required checks`；
   - 只执行 allowlisted commands。

2. 完成前验证：
   - completion 前如果 required checks 未跑，closure 给出缺失验证；
   - 只在必要节点跑，不每轮强制跑完整 lint/test/build。

3. Typecheck fallback:
   - 当前只在 package script 存在时推断 typecheck；
   - 如果没有 script，但项目有 TypeScript，则 fallback:
     `npx tsc --noEmit --pretty false`。

4. 证据入账：
   - 每次 verification run 写入 Evidence Ledger；
   - 记录 command、exit code、duration、required/optional、trust level。

Acceptance criteria:

- 没有验证证据时，不能把高风险代码任务判为完成；
- required check 失败会生成 open action；
- fallback typecheck 能覆盖没有 `typecheck` script 的项目；
- 用户可以看见检查结果和失败原因。

Validation:

- Verification inference tests;
- command allowlist tests;
- evidence ledger command-result tests;
- benchmark Task A.

## 6. Phase 13: Skill Eval Suite v1

Purpose: 不先做独立 Skill Eval 平台，而是用现有 execution spine 做可复跑的
skill evaluation loop。

Current gap:

- `lib/skill-eval/harness.ts` 目前主要是汇总已给出的 case results；
- `SkillEvalCaseResult` 缺少 model tier、verifier rejection、open actions、
  files changed、tests run、browser evidence 等字段；
- read-only verifier 已有隔离和 prompt，但 JSON parser 偏严格；
- evaluator action 已创建，但没有充分回灌下一轮 prompt。

Work items:

1. 把 benchmark tasks 变成 Skill Eval Suite v1：
   - Preflight；
   - Task A: VerificationPlan fallback；
   - Task B: read-only verifier dirty JSON；
   - Task C: route decision visibility；
   - 后续再加 weak-model pressure cases。

2. 扩展 run metadata：
   - model tier；
   - turn count；
   - verifier rejection count；
   - open action count；
   - changed files；
   - tests run；
   - browser evidence；
   - manual intervention。

3. 保持一个 evidence truth:
   - 仍写入共享 Evidence Ledger；
   - 不新增一套独立 skill evidence model。

4. 修 read-only verifier JSON parser：
   - strict JSON；
   - fenced JSON；
   - 单个 wrapped JSON；
   - 多对象、无效 JSON、混杂输出一律 `needs_review`；
   - parser 异常绝不转成 accept。

5. EvaluationAction 回灌：
   - rejected completion 生成 open actions；
   - auto-continue prompt 带上 open actions 和 hard fail；
   - 弱模型拿到的是窄上下文，不是笼统“继续做”。

6. Rubric profiles + Quality Vision:
   - `coding.default`;
   - `coding.frontend-ui`;
   - `skill.eval`;
   - 每个 profile 写清：
     - 什么算完成；
     - 什么是假完成；
     - 什么证据可信；
     - 哪些情况 hard fail。

Acceptance criteria:

- Skill Eval Suite 能复跑 Preflight / Task A / B / C；
- 每个 run 都能看到失败原因和下一步 action；
- weak model 假完成会被 evidence/rubric/action gate 拦住；
- parser 容错不会扩大 accept 面。

Validation:

- Skill eval harness tests;
- verifier parser tests;
- benchmark suite dry run;
- manual review of false accept / false reject cases.

## 7. Phase 14: UI Control Center And Quality Vision

Purpose: UI 优化不是装饰，而是让用户更容易判断 agent 是否可控。

Work items:

1. GoalBar folded state:
   - current status；
   - objective；
   - next action；
   - missing evidence count；
   - open action count；
   - pause / resume / clear controls。

2. GoalTimeline top summary:
   - route decision；
   - contract status；
   - verification state；
   - evaluation verdict；
   - open actions。

3. EmptyState as control surface:
   - provider/model ready state；
   - active goal state；
   - evidence gate state；
   - suggested next action。

4. `docs/quality/shaula-ui-quality-vision.md`:
   - product tone；
   - density and sizing；
   - icon usage；
   - mobile expectations；
   - screenshot pass/fail rubric。

5. Screenshot cases:
   - unconfigured empty；
   - ready empty；
   - active goal folded；
   - blocked goal；
   - failed evaluation；
   - expanded timeline；
   - dark mode；
   - mobile pairing；
   - pet surface。

Acceptance criteria:

- 用户不用展开长日志也能判断“现在卡在哪里”；
- UI 变大但不变成营销页；
- control status 不可读应当导致 screenshot review 失败；
- brand、icon、title、copy 在各入口一致。

Validation:

- Playwright screenshots;
- browser smoke;
- design token check;
- targeted mobile viewport tests.

## 8. Phase 15: Engineering Guardrails And Performance

Purpose: 在主闭环稳定后，补工程护栏和性能，不抢 Phase 11-13 的主线。

Work items:

1. Package scripts:
   - add `typecheck`;
   - add explicit `test:e2e`;
   - fix Windows-unsafe `electron:dev`;
   - fix Windows-unsafe `clean`.

2. Route decision visibility:
   - `goal_status` 返回 current route decision；
   - 保持 advisory router，不升级成 hard router。

3. Local CLI / model switching:
   - 检查 fake AgentSession 和 manual SSE path；
   - `set_model` 后的 agent replacement / dispose 行为要稳定。

4. Performance:
   - 保持 `npm run perf:size`；
   - 优先优化证据明确的 bundle / render / streaming hot path；
   - 不做无 profile 的大重构。

Acceptance criteria:

- Windows 本地开发脚本可用；
- typecheck/e2e 可以被 VerificationPlan 引用；
- route status 在 UI/API 中可见；
- 性能优化有测量前后对比。

Validation:

Run these checks sequentially. Do not parallelize commands that read or write
`.next`.

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run perf:size`
6. `npm run design-tokens:check`
7. `npm run workflow:sandbox:check`
8. `npm run test:e2e`

Guardrail evidence:

| Guardrail | Verification |
| --- | --- |
| Windows-safe `clean` | `npm run clean` only removes Shaula root `dist` and `.next`. |
| Windows-safe Electron dev | `npm run electron:dev` launches from the Shaula repo root. |
| Typecheck package script | `npm run typecheck` runs `next typegen` before `tsc`. |
| E2E server isolation | `npm run test:e2e` starts its own local Next dev server on port 3100. |
| Verification command safety | `lib/verification/runner.test.ts` rejects argument expansion. |
| Read-only verifier safety | `lib/verifier/read-only.test.ts` uses a positive tool allowlist. |

## 9. Explicitly Deferred

这些方向不是错，但现在不应该抢主线：

- 独立 Skill Eval 平台；
- 技能市场或复杂版本发布系统；
- 强制所有任务都跑 LLM evaluator；
- LLM hard router 替代 advisory router；
- 全量 ChatApp / agent-registry 大重构；
- 数据目录迁移；
- OS 级 sandbox；
- 大 UI 重做；
- very weak probe。

只有当 Phase 11-13 能稳定复跑，且 benchmark 显示当前闭环确实不足时，再进入这些
方向。

## 10. Recommended Next Move

建议下一步按这个顺序执行：

1. Batch A: 收口当前 Shaula 品牌/UI dirty diff；
2. Phase 11: 实现 Goal Run Closure v0；
3. Phase 12: 接 VerificationPlan runtime；
4. Phase 13: 把 benchmark tasks 变成 Skill Eval Suite v1；
5. Phase 14: 做 UI Control Center 和 Quality Vision；
6. Phase 15: 补脚本、typecheck/e2e、Windows guardrail 和性能证据。

如果只能选一个最核心的优化项，选 Phase 11。

原因很简单：没有 run closure，evidence、rubric、verifier、skill eval 都只能证明
“某次检查有结果”；有了 run closure，它们才会变成“任务继续推进或正确收尾”的
运行时控制系统。

## 11. Execution Result On 2026-06-14

This plan has been executed locally in the Shaula workspace.

Completed scope:

1. Brand/UI closure:
   - Runtime brand assets now use Shaula scorpion icons only.
   - Retired legacy brand assets were removed from the repository.
   - EmptyState, provider setup, headers, pet/mobile surfaces and e2e anchors
     now use Shaula-facing wording.
   - GoalBar controls are larger and easier to use.

2. Goal Run Closure v0:
   - Added closure verdict logic and persistence.
   - Goal timeline exposes the latest closure summary.
   - `needs_user`, `blocked`, and repeated `ready_to_finalize` states pause
     instead of spinning in auto-continue.
   - Stale closure state is cleared when a goal becomes blocked.

3. VerificationPlan runtime wiring:
   - Added shared verification input collection.
   - Required checks write command evidence with exit code, duration and
     rationale metadata.
   - Typecheck fallback is inferred for TypeScript projects without a package
     `typecheck` script.
   - Command execution records spawn failures as failed check results.
   - Read-only verifier uses an explicit positive tool allowlist.

4. Skill Eval Suite v1:
   - Extended run metadata with verifier rejection, actions, files, tests and
     browser evidence fields.
   - Added suite definitions for preflight and benchmark tasks.
   - JSON parser behavior is stricter: wrapped accept can downgrade, malformed
     or mixed output stays `needs_review`.

5. Engineering guardrails and performance:
   - Added `typecheck`, `test:e2e`, `clean`, and Electron dev guardrails.
   - Build script now applies the Next patch before production build.
   - E2E starts an isolated Next dev server on port 3100.
   - Windows workflow sandbox absence is treated as informational locally.
   - Public asset size dropped to 51.3 KB after moving legacy assets out of the
     runtime package.

## 12. Final Validation Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `npm run lint` | Passed | ESLint clean. |
| `npm run typecheck` | Passed | `next typegen` plus `tsc --noEmit`. |
| `npm test` | Passed | 72 test files, 561 tests. |
| `npm run build` | Passed | Production Next build succeeded. |
| `npm run perf:size` | Passed | `public` is 51.3 KB; `.next/static` is 2.34 MB. |
| `npm run design-tokens:check` | Passed | Informational report: 174 existing findings, mostly `app/globals.css`. |
| `npm run workflow:sandbox:check` | Passed | Windows local result is informational; strong sandbox still belongs to deployed Linux/macOS workers. |
| `npm run test:e2e` | Passed | Playwright 37/37. |

## 13. Post-Test Review Direction

Subagent post-test consensus:

- Closure/runtime review: this batch can close; the highest residual risk is
  real long-running goal behavior across providers and event order.
- UI/brand review: this batch can close; the highest residual risk is visual
  quality without screenshot baselines for narrow screens, long text and dense
  GoalBar states.
- Verification review: this batch can close; keep watching command allowlists,
  typecheck evidence semantics and read-only verifier tool boundaries.
- Guardrail review: this batch can close; the highest residual risk is
  happy-path fixture coverage hiding failure-path regressions.

The current batch can be treated as closed after user review. Do not start a
new broad refactor immediately.

Recommended next optimization direction:

1. Make Skill Eval cases executable end to end, not just defined as suite
   metadata.
2. Add negative and boundary cases for closure and verification, especially
   false-complete, stale-evidence, failed-check and user-decision states.
3. Add an adversarial guardrail suite for wrong cwd clean, unknown API fixture
   fail-fast, required-check failure, typecheck/build sequencing and Windows
   Electron dev paths.
4. Add UI screenshot review cases for active goal, blocked goal, failed
   evaluation, expanded timeline, mobile and pet surfaces.
5. Keep OS-level sandboxing deferred until worker deployment target is clear.
6. Only pursue bundle/render performance work with measured hotspots; current
   public asset package has already been reduced materially.

## 14. Follow-Up Execution On 2026-06-15

This follow-up batch started the next optimization direction without opening a
new platform or broad UI refactor.

Completed scope:

1. Executable Skill Eval runner:
   - Added `lib/skill-eval/runner.ts`.
   - `SHAULA_SKILL_EVAL_SUITE_V1` now has deterministic local case executors.
   - The runner executes preflight evidence wiring, typecheck fallback,
     read-only verifier JSON behavior and route decision visibility.
   - Missing case executors fail explicitly instead of producing a false pass.

2. Adversarial guardrail suite:
   - E2E fixtures now fail fast for unhandled `/api/*` routes by default.
   - Mobile remote status and ping were added as explicit fixtures after
     fail-fast exposed the missing startup API.
   - Verification command spawn failures, including synchronous `spawn`
     failures, are recorded as failed verification results.
   - `clean.mjs` now exposes testable root and target guardrails while keeping
     the command behavior unchanged.
   - Package script tests lock the important sequencing for build/typecheck and
     the addressability of e2e/sandbox checks.

3. Test collection:
   - `vitest.config.ts` now includes `scripts/**/*.{test,spec}.mjs` so Node
     script guardrails run in the normal unit suite.

Validation:

| Check | Result | Notes |
| --- | --- | --- |
| Targeted Vitest | Passed | 4 files, 13 tests for skill-eval runner and guardrails. |
| `npm run typecheck` | Passed | `next typegen` plus `tsc --noEmit`. |
| `npm test` | Passed | 75 test files, 571 tests. |
| `npm run lint` | Passed | ESLint clean. |
| `npm run test:e2e` | Passed | Playwright 38/38; includes unhandled API fail-fast test. |
| `npm run clean` | Passed | Clean command executed after adding guardrail helpers. |
| `npm run build` | Passed | Production Next build succeeded after clean. |
| `npm run perf:size` | Passed | `public` remains 51.3 KB; `.next/static` remains 2.34 MB. |
| `npm run workflow:sandbox:check` | Passed | Windows local result remains informational. |

Next recommended move:

1. Add closure/verification negative cases for false-complete, stale evidence,
   failed required checks and user-decision pauses.
2. Start the first real dogfood goal run set and record mis-completion,
   unnecessary continuation and missing-evidence cases.
3. Add UI screenshot review only after the runtime negative cases are stable.

## 15. Negative Closure And Verification Cases On 2026-06-15

This batch executed the next recommended runtime hardening step.

Completed scope:

1. False-complete guard:
   - Added a closure regression where `verification.decision === "accept"` but
     the rubric evaluation is failed.
   - Fixed closure logic so failed/non-passed evaluations continue instead of
     entering `ready_to_finalize`.

2. Stale evidence guard:
   - Added a collector regression where stored goal evidence predates the active
     goal.
   - Fixed `collectGoalVerificationInput` so stored goal evidence is filtered by
     `goal.createdAt`, matching the existing Evidence Ledger filtering.

3. Required-check failure guard:
   - Added a verifier regression where older required check evidence passed but
     the newer required check failed.
   - Existing latest-required-check logic correctly rejected completion; the
     test now locks this behavior.

4. Lint/e2e concurrency guard:
   - Repeated parallel lint/e2e runs exposed ESLint scanning Playwright's
     volatile `test-results` directory.
   - Added `test-results/**` and `playwright-report/**` to ESLint ignores so the
     quality gates do not race each other.

Validation:

| Check | Result | Notes |
| --- | --- | --- |
| Targeted Vitest | Passed | 3 files, 25 tests for closure, verifier and verification input collector. |
| `npm run typecheck` | Passed | `next typegen` plus `tsc --noEmit`. |
| `npm test` | Passed | 76 test files, 574 tests. |
| `npm run test:e2e` | Passed | Playwright 38/38. |
| `npm run lint` | Passed | ESLint clean after ignoring volatile Playwright output. |
| `npm run build` | Passed | Production Next build succeeded. |
| `npm run perf:size` | Passed | `public` remains 51.3 KB; `.next/static` remains 2.34 MB. |
| `npm run workflow:sandbox:check` | Passed | Windows local result remains informational. |

Next recommended move:

1. Start a small real dogfood run set: 5 goal cases covering code change,
   UI check, verifier rejection, needs-user pause and blocked pause.
2. Record each run's closure verdict, verification evidence, auto-continue
   count, user intervention and final outcome.
3. Only after dogfood data exists, add UI screenshot review cases for the states
   that actually appear in those runs.

## 16. Local Runtime Dogfood Run Set On 2026-06-15

This batch ran the first dogfood layer as a deterministic local runtime set.
It does not use an external model/provider. It exercises the current Shaula
runtime logic directly:

- `verifyGoalCompletion`
- `evaluateGoalRunClosure`
- required evidence coverage
- evaluation action pause/continue boundaries

Implemented files:

- `lib/dogfood/goal-run-set.ts`
- `lib/dogfood/goal-run-set.test.ts`
- `docs/quality/2026-06-15-shaula-local-dogfood-run-set.md`

Dogfood cases:

| Case | Closure verdict | Verification | Evidence | Auto-continue | Outcome |
| --- | --- | --- | --- | ---: | --- |
| Code change success | `ready_to_finalize` | accept | `diff`, `test_result` | 1 | ready to finalize |
| UI check success | `ready_to_finalize` | accept | host-observed screenshot | 1 | ready to finalize |
| Verifier rejection | `continue` | reject | missing `test_result` | 1 | continued after rejection |
| Needs-user pause | `needs_user` | reject | user decision missing | 0 | paused for user |
| Blocked pause | `blocked` | accept with blocked goal state | blocker log | 0 | paused blocked |

Finding:

The deterministic harness decisions are correct for the five baseline states.
This batch did not expose a new runtime bug.

Validation:

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run lib/dogfood/goal-run-set.test.ts` | Passed | 1 file, 2 tests. |

Next recommended move:

1. Run the same five cases with a real model/provider path.
2. Record premature completion attempts, closure-following behavior,
   `goal_update complete` timing and final pause/finalization state.
3. Add screenshot review only for states seen in real model-backed runs.

## 17. GLM-5.1 Provider Dogfood On 2026-06-15

This batch connected a real GLM-5.1 provider path and ran model-backed goal
dogfood through the app API.

Provider/model:

```text
provider: zhipu
model: glm-5.1
baseUrl: https://open.bigmodel.cn/api/coding/paas/v4
```

The API key is stored only in the local user auth store. No key is recorded in
this repository or in the dogfood report.

Validated path:

- raw OpenAI-compatible call;
- SDK `completeSimple`;
- app `/api/auth/test`;
- `/api/agent/new`;
- `goal_set`;
- `update_progress`;
- `goal_update complete`;
- stop-time verifier evidence coverage.

Dogfood result:

| Run | Contract | Result | Finding |
| --- | --- | --- | --- |
| First analysis run | `source_note`, `analysis_artifact` | Blocked | Progress artifacts with `href` were still treated as `agent_reported`, so the verifier rejected required `artifact_reference` evidence. |
| Fixed analysis run | `source_note`, `analysis_artifact` | Passed | Referenced progress artifacts now satisfy analysis evidence requirements. |

Fix shipped in this batch:

- `lib/evidence/ledger.ts` now upgrades referenced progress artifacts of
  `file`, `url`, `screenshot`, or `other` kinds to `artifact_reference`.
- Self-reported `test` progress artifacts remain `agent_reported`; deterministic
  `test_result` still requires real verification evidence.
- `lib/evidence/ledger.test.ts` covers the new analysis evidence case.

Quality report:

- `docs/quality/2026-06-15-shaula-glm-5-1-provider-dogfood.md`

Validation:

| Check | Result | Notes |
| --- | --- | --- |
| `npx vitest run lib/evidence/ledger.test.ts` | Passed | 1 file, 6 tests. |
| `npx tsc --noEmit --pretty false --incremental false` | Passed | Type-level regression check. |
| `npx vitest run lib/evidence/ledger.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts lib/goal/verification-input.test.ts` | Passed | 4 files, 37 tests. |
| `npm test` | Passed | 77 files, 577 tests. |
| `npm run lint` | Passed | No lint errors. |
| `npm run typecheck` | Passed | Next typegen plus TypeScript. |

Next recommended move:

1. Run GLM-5.1 on a coding.default goal that creates a real `diff` and
   deterministic test evidence.
2. Run a verifier-rejection case and confirm the model continues instead of
   forcing completion.
3. Run a UI/browser observation case before making more UI surface changes.

Detailed next-stage execution plan:

- `docs/plans/2026-06-15-shaula-next-optimization-plan.md`
