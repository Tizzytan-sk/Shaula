# Shaula Next Optimization Plan

> Date: 2026-06-15
> Status: Active execution document
> Basis: Local runtime dogfood, GLM-5.1 provider dogfood, current Shaula
> verifier/evidence/profile-router implementation.

## 1. Core Judgment

下一阶段不要先继续铺 UI，也不要直接做泛化性能优化。

当前最核心的问题是：Shaula 已经具备 goal、contract、evidence、verifier、
closure 和真实 provider 调用能力，但还没有形成稳定的“真实 agent 闭环评测”
能力。

所以后续优化主线应当是：

```text
先把真实模型路径的闭环行为测准，再修 evidence/router，再做 UI 和性能。
```

如果先做 UI，可能只是把尚不稳定的判断结果展示得更漂亮；如果先做性能，
可能优化的是错误路径。现在最值钱的是让 Shaula 能持续发现“模型是否真的按
harness 工作”。

## 2. Confirmed Baseline

已经确认的基础能力：

- local deterministic dogfood 已覆盖 5 类状态：
  - code change success;
  - UI check success;
  - verifier rejection;
  - needs-user pause;
  - blocked pause.
- `zhipu/glm-5.1` 已接入本机 provider path，并通过真实 SDK 调用。
- `deepseek/deepseek-v4-pro` 已接入本机 provider path，并通过真实 SDK 调用。
- GLM-5.1 已跑通 `analysis.research` goal：
  - required evidence: `source_note`, `analysis_artifact`;
  - goal status: `complete`;
  - evaluation status: `passed`;
  - score: `1`.
- 本轮 dogfood 暴露并修复了一个 evidence bug：
  - 带 `href` 的 progress artifact 之前仍被判为 `agent_reported`;
  - 修复后可作为 `artifact_reference`;
  - 自报 `test` 仍不能冒充 deterministic `test_result`.
- 当前验证通过：
  - targeted evidence/goal tests;
  - full test suite;
  - lint;
  - typecheck.

## 3. P0 - Real Provider Dogfood Runner

### Purpose

把手工 dogfood 固化成可重复运行的 provider-backed run set。

它不是 benchmark 排行榜，而是 Shaula 自己的“行为体检”：

- 模型会不会过早完成；
- verifier 拒绝后模型会不会继续；
- evidence 是否被正确记录和识别；
- goal closure 是否进入正确状态；
- pause/block 边界是否被尊重。

### Scope

建议新增一个真实 provider dogfood runner，覆盖以下 case：

| Case | Contract profile | Required evidence | Expected final state |
| --- | --- | --- | --- |
| Coding diff success | `coding.default` | `diff`, `test_result` | `complete` or `ready_to_finalize` then complete |
| Verifier rejection recovery | `coding.default` or `analysis.research` | intentionally missing first, then supplied | first reject, then pass |
| Needs-user pause | goal requires user choice | `user_confirmed_direction` | `needs_user`, no autonomous guessing |
| Blocked pause | missing external dependency | blocker evidence | `blocked`, no retry loop |
| UI/browser observation | `coding.frontend-ui` | `browser_observation` | pass only with host-observed evidence |

### Output Schema

Each run should record:

- provider/model;
- session file;
- objective;
- inferred contract profile;
- required evidence;
- emitted progress artifacts;
- ledger evidence with trust level;
- verifier decision and score;
- closure verdict;
- open action count;
- user intervention category;
- final outcome;
- notes on model behavior.

### Acceptance Criteria

This phase is done only when:

- all cases can run from one local command or script;
- report generation is deterministic enough to compare runs;
- no secret is written to repo logs or reports;
- failed runs produce actionable reasons, not just “model failed”.

### Implementation Status - 2026-06-15

Done:

- Added `scripts/provider-dogfood.mjs`.
- Added `npm run dogfood:provider`.
- Added `scripts/provider-dogfood.test.mjs`.
- Added per-case markdown reporting with secret redaction.
- Added request timeout handling so slow `goal_set` calls produce diagnostic
  reports instead of disappearing.
- Fixed Windows verification command spawning for `npm test`.

Current real-provider evidence:

- `docs/quality/2026-06-15-shaula-provider-dogfood-run.md`
- `docs/quality/2026-06-15-shaula-provider-dogfood-blocked-check.md`
- `docs/quality/2026-06-15-shaula-provider-dogfood-blocked-check-fixed.md`
- `docs/quality/2026-06-15-shaula-provider-dogfood-coding-check.md`
- `docs/quality/2026-06-15-shaula-provider-dogfood-needs-user-check.md`
- `docs/quality/2026-06-15-shaula-provider-dogfood-coding-diff-check-fixed-7.md`
  - final status: `complete`;
  - evaluation: `passed`;
  - score: `1`;
  - runner completion: accepted.
- `docs/quality/2026-06-15-shaula-provider-dogfood-needs-user-check-fixed-4.md`
  - final status: `paused`;
  - evaluation: `unknown`;
  - failed criteria: none.
- `docs/quality/2026-06-15-shaula-provider-dogfood-blocked-check-fixed-2.md`
  - final status: `blocked`;
  - evaluation: `unknown`;
  - failed criteria: none.
- `docs/quality/2026-06-15-shaula-provider-dogfood-rejection-recovery-check.md`
  - final status: `complete`;
  - evaluation: `passed`;
  - score: `1`;
  - exposed a reporting gap: the original report did not count the
    intermediate rejected completion attempt even though runtime events showed
    reject-then-recover behavior.
- `docs/quality/2026-06-15-shaula-provider-dogfood-browser-observation-check.md`
  - final status: `paused`;
  - evaluation: `unknown`;
  - exposed two runner gaps:
    - no host-observed browser evidence was being recorded;
    - frontend profile forced an unrelated npm test when the explicit contract
      only required `browser_observation`.
- `docs/quality/2026-06-15-shaula-provider-dogfood-deepseek-rejection-browser-check.md`
  - provider/model: `deepseek/deepseek-v4-pro`;
  - `verifier-rejection-recovery`:
    - final status: `complete`;
    - evaluation: `passed`;
    - score: `1`;
    - intermediate evaluations: `rejected=1`, `accepted=1`;
  - `browser-observation`:
    - final status: `complete`;
    - evaluation: `passed`;
    - score: `1`;
    - runner actions: `host_browser_observation:passed`,
      `goal_run_verification:ok`, `runner_goal_update_complete:accepted`;
    - evidence: `browser_snapshot` with `trustLevel: "host_observed"`.

Fixed in this pass:

- `goal_set` now starts the model turn in the background and returns
  immediately with `promptStarted: "background"`.
- Agent meta now treats prompt-starting as busy, so the runner does not verify
  before the first model turn actually starts.
- The finish watchdog now only reacts to assistant `message_end` events; user
  message completion no longer falsely closes a run before the model responds.
- `ask_user` pending clarification now pauses the active goal immediately, and
  the provider dogfood runner treats pending clarification as a valid
  needs-user stop condition.
- Coding diff success now passes with:
  - artifact-reference `diff`;
  - deterministic `test_result`;
  - accepted runner-side `goal_update complete`.
- Provider dogfood cases now send explicit `rubricProfile` and
  `requiredEvidence` into `goal_set`, so the runner no longer relies only on
  prompt wording to select the contract.
- Provider dogfood reports now count intermediate verifier evaluations, so a
  reject-then-recover run can show rejected and accepted completion attempts.
- Added a narrow host-observed browser evidence path:
  - runner opens the prepared fixture through Playwright;
  - API records `browser_snapshot` evidence with `trustLevel:
    "host_observed"`;
  - browser-only frontend contracts no longer force `npm test` when
    `requiredEvidence` is explicitly `browser_observation`.
- Added local fake-API regression coverage for browser-observation completion
  after host evidence passes.

Known remaining gaps:

- Live GLM rerun is currently blocked by provider quota/resources:
  - `npm run dogfood:provider -- --provider zhipu --model glm-5.1 ...`
    returned `429 余额不足或无可用资源包,请充值。` during `/api/auth/test`;
  - no new live `rejection-recovery-check-2` or
    `browser-observation-check-fixed` report was generated in this pass.
- DeepSeek has already covered the two blocked reruns as a real provider
  substitute:
  - `verifier-rejection-recovery` confirms the new intermediate evaluation
    reporting against a real model run;
  - `browser-observation` confirms host-observed browser evidence can complete
    the provider case.
- Re-run these two GLM cases later only if we need provider-specific GLM
  comparison:
  - `verifier-rejection-recovery`, to confirm the new intermediate evaluation
    reporting against a real model run;
  - `browser-observation`, to confirm host-observed browser evidence completes
    the real provider case.

## 4. P1 - Evidence Hardening

### Problem

Evidence is now the main correctness boundary. The system must not confuse:

- model-reported text;
- artifact references;
- deterministic checks;
- host-observed browser evidence;
- user-confirmed decisions.

### Proposed Changes

1. Add explicit evidence tags to progress artifacts.

   `update_progress` should allow an artifact to declare:

   ```text
   requiredEvidence: ["source_note", "analysis_artifact"]
   contractCriterionId?: string
   rubricCriterionId?: string
   ```

   This reduces reliance on title string matching.

2. Validate artifact references.

   For local file references, check that the file exists and is inside allowed
   workspace or user-approved paths. For URLs, mark as reference only when the
   source is explicit; do not fetch external URLs without a separate policy.

3. Re-normalize stored evidence at read time.

   Old evidence may carry stale trust labels. The read path should be able to
   recompute derived fields where safe, while preserving original metadata.

4. Keep deterministic gates strict.

   `test_result`, `build_result`, `lint_result`, and typecheck evidence should
   still require deterministic command output, not progress text.

### Acceptance Criteria

- Analysis evidence can pass through structured tags, not only titles.
- Self-reported tests cannot satisfy deterministic test requirements.
- Evidence timeline explains why each item did or did not satisfy a contract.

### Implementation Status - 2026-06-15

Done:

- Referenced progress artifacts with `href` can now be promoted to
  `artifact_reference` for source-note and analysis-artifact requirements.
- Self-reported `test` progress artifacts still cannot satisfy deterministic
  `test_result` requirements.
- `blocker_log` / `blocked_state` evidence requirements now accept structured
  blocker evidence without weakening deterministic evidence gates.
- When a goal becomes `blocked`, stale completion `lastEvaluation` is cleared
  so a previous `goal-evidence` failure does not pollute the blocked state.
- When a goal becomes `paused`, stale failed completion evaluation is cleared;
  meaningful `needs_user` closures remain available when present.
- `diff` evidence now requires `artifact_reference`, not
  `deterministic_check`.
- Progress artifacts with `kind: "diff"` and a concrete `href` can satisfy
  `diff` requirements as artifact references.
- Progress artifacts can now carry structured evidence tags:
  - `requiredEvidence`;
  - `contractCriterionId`;
  - `rubricCriterionId`.
- The progress runtime bridge writes these tags into ledger `criteria` and
  `metadata.evidenceRequired`, so verifier matching no longer has to depend on
  artifact titles for analysis requirements.
- Deterministic gates remain strict: a progress artifact tagged as
  `test_result` is still `agent_reported` unless it comes from a deterministic
  verification result.
- Local progress artifact references now require workspace validation before
  they can become `artifact_reference`:
  - runtime progress evidence records `metadata.cwd`;
  - relative and absolute local `href` values must resolve inside that cwd;
  - unscoped or outside-workspace local references stay `agent_reported`.
- Evidence store reads now re-normalize evidence at read time, so stale
  progress evidence with an old `artifact_reference` trust label is downgraded
  unless it still passes the current validation rule.

Verification:

- `npx vitest run lib/evidence/ledger.test.ts lib/goal/update.test.ts lib/goal/verifier.test.ts`
- `npx vitest run scripts/provider-dogfood.test.mjs lib/verification/infer.test.ts lib/evidence/ledger.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts`
- `npx vitest run lib/progress/server-store.test.ts lib/goal/evidence-bridge.test.ts lib/runtime/agent-event-bridge.test.ts lib/evidence/ledger.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts`
- `npx vitest run lib/evidence/ledger.test.ts lib/evidence/server-store.test.ts lib/runtime/agent-event-bridge.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts lib/progress/server-store.test.ts lib/goal/evidence-bridge.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Real DeepSeek rerun after file-reference validation:
  - `docs/quality/2026-06-15-shaula-provider-dogfood-deepseek-rejection-browser-file-validation-check.md`
  - `verifier-rejection-recovery`: final status `complete`, evaluation
    `passed`, score `1`, intermediate evaluations `rejected=1`,
    `accepted=1`;
  - `browser-observation`: final status `complete`, evaluation `passed`,
    score `1`, runner completion accepted;
  - source-note/analysis artifacts remained `artifact_reference` because
    their local file refs resolved inside the fixture workspace cwd.
- Real GLM blocked dogfood rerun:
  - `docs/quality/2026-06-15-shaula-provider-dogfood-blocked-check-fixed-2.md`
  - final status: `blocked`;
  - evaluation: `unknown`;
  - failed criteria: none.
- Real GLM needs-user dogfood rerun:
  - `docs/quality/2026-06-15-shaula-provider-dogfood-needs-user-check-fixed-4.md`
  - final status: `paused`;
  - evaluation: `unknown`;
  - failed criteria: none.
- Real GLM coding diff dogfood rerun:
  - `docs/quality/2026-06-15-shaula-provider-dogfood-coding-diff-check-fixed-7.md`
  - final status: `complete`;
  - evaluation: `passed`;
  - score: `1`.

Still pending:

- optional user-approved path registry for references outside the active cwd.

## 5. P1 - Profile Router Correction

### Problem

The profile router currently may overreact to safety boundary words in the
objective, such as “do not delete” or “do not use external services”. In a
dogfood prompt, those words are often constraints, not the actual task.

### Proposed Changes

1. Add negation-aware routing.

   The router should distinguish:

   ```text
   delete the file
   ```

   from:

   ```text
   do not delete any file
   ```

2. Prefer task intent over safety constraints.

   If the objective is “inspect package metadata and cite evidence”, the
   profile should stay `analysis.research`, even when the objective includes
   safety constraints.

3. Allow explicit profile override for dogfood and advanced goal setup.

   This can be internal first:

   ```text
   goal_set({ objective, rubricProfile })
   ```

4. Add router regression tests.

   Cases should include negative phrases in both English and Chinese.

### Acceptance Criteria

- Safety constraints no longer dominate task profile selection.
- Route decision remains visible in `goal_status` and `goal_timeline`.
- Explicit override is recorded in contract metadata.

### Implementation Status - 2026-06-15

Done:

- `goal_set` accepts internal `rubricProfile` and `requiredEvidence`
  overrides.
- Provider dogfood uses those overrides per case:
  - coding: `coding.default` with `diff`, `test_result`;
  - rejection recovery: `analysis.research` with `source_note`,
    `analysis_artifact`;
  - needs-user/blocking: `workflow.default` with their specific evidence;
  - browser observation: `coding.frontend-ui` with `browser_observation`.
- `inferVerificationPlan` no longer adds default frontend npm-test checks when
  an explicit browser-only evidence contract is provided.
- `inferEvaluationProfileId` now strips negated safety-constraint clauses
  before external-action detection:
  - English: `do not delete`, `do not use external services`, etc.;
  - Chinese: `不要删除`, `不要调用外部服务`, etc.
- Strong research/source/citation signals now win over generic coding words
  such as `file`, so “research package metadata and cite evidence” stays
  `analysis.research`.
- Execution contracts now record profile-selection provenance:
  - `source: "inferred"` for normal routing;
  - `source: "override"` with `overrideProfile` when dogfood/advanced setup
    supplies `rubricProfile`.

Verification:

- `npx vitest run lib/evaluation/profile-selector.test.ts lib/execution-contract/build.test.ts lib/execution-contract/store.test.ts`
- `npx vitest run lib/evaluation/profile-selector.test.ts lib/execution-contract/build.test.ts lib/execution-contract/store.test.ts lib/evidence/ledger.test.ts lib/evidence/server-store.test.ts lib/runtime/agent-event-bridge.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts scripts/provider-dogfood.test.mjs lib/verification/infer.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Still pending:

- optional UI/debug display for `profileSelection`.

## 6. P2 - Provider/Auth Experience

### Purpose

Make real provider setup legible without exposing secrets.

### Proposed Changes

- Show provider, model, endpoint, auth source, and last test result in UI.
- Never render the key itself.
- Add a “refresh registry/auth” action when config changes while dev server is
  already running.
- Improve `/api/auth` error reporting so a stale service or path mismatch is
  diagnosable.
- Record non-sensitive provider readiness in quality reports.

### Acceptance Criteria

- User can see whether `zhipu/glm-5.1` is usable without opening local files.
- Auth errors explain whether the issue is missing key, stale registry, endpoint
  failure, or model-not-found.
- Provider quota/resource errors are shown as provider readiness problems, not
  as generic runner failures.
- No secret appears in logs, reports, screenshots, or git diff.

### Current Finding - 2026-06-15

The live GLM provider dogfood rerun reached `/api/auth/test` and failed before
any model task started:

```text
429 余额不足或无可用资源包,请充值。
```

This should feed the P2 provider/auth UI: the user needs to see “provider
configured but currently unusable due to quota/resource package”, without
revealing the API key.

DeepSeek fallback worked in the same local service:

- provider/model: `deepseek/deepseek-v4-pro`;
- `/api/auth/test`: passed;
- registry models: `deepseek-v4-flash`, `deepseek-v4-pro`;
- dogfood report:
  `docs/quality/2026-06-15-shaula-provider-dogfood-deepseek-rejection-browser-check.md`.

So provider readiness UI should distinguish:

- configured and usable;
- configured but quota/resource-blocked;
- model not found in registry;
- missing credential.

### Implementation Status - 2026-06-15

Done:

- Added provider readiness classification for `/api/auth/test`:
  - `usable`;
  - `missing_credential`;
  - `model_not_found`;
  - `quota_or_resources`;
  - `timeout`;
  - `provider_error`;
  - `configuration_error`.
- `/api/auth/test` now returns non-sensitive `category` and `userMessage`
  fields on both success and failure.
- AuthPanel result display now shows the classified reason first, then the
  readable message. Raw key material is never rendered.
- The GLM `429 余额不足或无可用资源包` case is classified as
  `quota_or_resources`.

Verification:

- `npx vitest run lib/auth/readiness.test.ts lib/evaluation/profile-selector.test.ts lib/execution-contract/build.test.ts lib/evidence/ledger.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- Manual API check on local production server:
  - `deepseek/deepseek-chat` returned `category: "model_not_found"`;
  - `deepseek/deepseek-v4-pro` returned `category: "usable"`.

Still pending:

- expose the same readiness category in the main model picker/provider list;
- optional last-test-result persistence instead of only showing it in the
  current AuthPanel session.

## 7. P2 - UI Goal/Evidence Surfaces

### Purpose

UI work should make the harness state easier to understand, not just larger or
more decorative.

### Proposed Changes

- Make active goal, contract, required evidence, and verifier status more
  prominent.
- Add a clearer “what is missing” area for rejected completion.
- Show evidence trust level with plain labels:
  - reported by agent;
  - file/reference evidence;
  - verified check;
  - browser observed;
  - user confirmed.
- Use Shaula iconography consistently.
- Increase density only where repeated agent operations need scanning.

### Acceptance Criteria

- User can tell in under 5 seconds:
  - whether the goal is active, complete, blocked, or needs user input;
  - which evidence is missing;
  - what the next action is.
- UI does not hide verifier failures behind generic status text.
- Mobile and desktop screenshots pass visual review.

### Implementation Status - 2026-06-15

Done:

- `GoalTimeline` now has a dedicated `Needs attention` summary for:
  - missing evidence;
  - failed required criteria;
  - blocked completion checks;
  - open verifier actions that still need resolution.
- Evidence ledger trust levels now use plain labels instead of raw enum values:
  - `reported by agent`;
  - `text log`;
  - `file/reference`;
  - `verified check`;
  - `browser observed`;
  - `user confirmed`.
- Execution contract summary now exposes route provenance:
  - `route: inferred` for normal profile selection;
  - `route: override` when dogfood or advanced goal setup supplies a profile.
- `GoalTimeline` attention items now de-duplicate the same missing evidence
  across closure, evaluation, and action sources.
- Action queue badges now use readable labels instead of raw internal enum
  values such as `missing_evidence`.
- Profile route context is now visible in the contract summary instead of only
  being hidden in a tooltip.
- `GoalTimeline` and `RuntimeTimeline` now share the same readable evidence
  trust labels.

Still pending:

- desktop/mobile visual screenshot review after the UI patch;
- optional main model picker/provider-list readiness display;
- broader Shaula icon sweep outside the Goal/Evidence surface.

## 8. P2 - UI Style And Appearance Settings

### Purpose

This is the UI polish lane that should travel with P2, but stay separate from
model, auth, and safety settings.

The target is a friendlier, larger, more readable Shaula workbench without
turning the surface into marketing cards or decorative glass UI.

### Style Direction

Use an Apple/macOS-like control feeling, but avoid exaggerated glassmorphism.

Rules:

- controls should be larger and easier to hit, roughly `40-44px` tall where
  the control is frequently clicked;
- use light borders, soft backgrounds, hover micro-shadows, and subtle active
  states;
- place icons on the left and short text on the right;
- put state/detail text in subtitles instead of long button labels;
- primary actions use a clearer accent color;
- ordinary modules stay restrained;
- avoid turning the page into stacked cards or a marketing landing page.

### Priority Surfaces

1. Home status modules:
   - model;
   - goal;
   - evidence;
   - next step.
2. Workbench home entry modules:
   - files;
   - browser;
   - command reference;
   - overview.
3. Sidebar bottom area:
   - model;
   - authorization;
   - settings.
4. Top icon buttons:
   - keep the icon buttons small;
   - unify hover and active states;
   - do not inflate the top bar.

### Appearance Settings

Add a separate `Appearance` settings area. Do not mix this into model, provider,
auth, or safety settings.

Initial settings should be local-only and low risk. `localStorage` is enough for
the first version; move to the settings store only when cross-device or
workspace sync is needed.

### Font Size Controls

First version:

- make font size adjustable;
- there must not be a single global font-size control that changes both areas;
- sidebar/workbench chrome and main assistant answer text must be adjustable
  independently;
- changing sidebar font size must not change assistant answer text;
- changing assistant answer font size must not change sidebar, workbench chrome,
  tool logs, code blocks, or settings panels;
- the settings UI should label the controls clearly as `Sidebar` and
  `Assistant answer`, so the user understands what each control affects;
- do not open font-family selection yet.

Recommended settings:

| Setting | Affects | Options |
| --- | --- | --- |
| Sidebar font size | sidebar task list, search, bottom buttons, cwd display | small, standard, large, extra large |
| Assistant answer font size | assistant answer body only | standard, comfortable, large, extra large |

Assistant answer font size must not affect:

- code blocks;
- tool logs;
- system prompts;
- sidebar;
- model/auth/settings panels.

Open questions deferred:

- whether answer font size should apply only to assistant answers or also user
  messages;
- whether font family should later support system default, Apple, Microsoft
  YaHei, or other choices.

Default decision for v1:

```text
Only font size is adjustable.
Assistant answer text and sidebar/workbench chrome are separate controls.
The two controls are independent and must not cascade into each other.
There is no global font-size control in v1.
Font family is not configurable yet.
```

### Acceptance Criteria

- Main click targets feel easier to hit without bloating dense work areas.
- User can enlarge assistant answer text without breaking code/tool/system
  rendering.
- Sidebar font size can be adjusted independently from assistant answer text.
- Assistant answer font size can be adjusted independently from sidebar and
  workbench chrome.
- The UI exposes separate controls for sidebar font size and assistant answer
  font size; neither control is presented as a global typography setting.
- Appearance settings are discoverable but not mixed with provider/security
  settings.
- Screenshots confirm no text overlap at desktop and mobile widths.

### Implementation Status - 2026-06-15

Done:

- Added a separate `Appearance` settings section under desktop/access settings.
- Added local-only persistence in `localStorage` via
  `lib/appearance/settings.ts`.
- Added independent controls for:
  - sidebar/workbench font size;
  - assistant answer body font size.
- Applied the sidebar setting through `--sidebar-font-size` on the sidebar and
  Workbench chrome.
- Applied the assistant answer setting through `--assistant-answer-font-size`
  only on assistant text parts.
- Left tool logs, approval cards, workflow/subagent cards, settings panels, and
  code blocks outside the assistant answer font-size path.
- Kept assistant code block line-height fixed at a compact code-reading value,
  so larger answer text does not stretch code blocks.
- Made the settings shell usable on narrow mobile widths so the Appearance
  section is not pushed off-screen.

Verification:

- `npx vitest run lib/appearance/settings.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Production Playwright check on a temporary local port confirmed:
  - the Appearance section renders;
  - sidebar font variable can be `17px`;
  - assistant answer font variable can be `18px`;
  - the two variables remain independent on the main app shell.
- Visual evidence:
  - `docs/quality/2026-06-15-shaula-appearance-settings-desktop.png`
  - `docs/quality/2026-06-15-shaula-appearance-settings-mobile.png`

Remaining note:

- The existing dev server on `3000` served updated HTML but did not hydrate
  settings interactions during the check; the same page worked with the fresh
  production build. Treat the `3000` dev runtime as a local server-state issue
  rather than evidence against the implementation.

## 9. P3 - Performance And Package Optimization

### Timing

Do this after the provider dogfood runner and evidence/router fixes.

### Proposed Changes

- Bundle size review after current feature set stabilizes.
- Reduce unnecessary runtime event payload duplication.
- Audit session/evidence/progress state growth.
- Keep logs and reports bounded.
- Re-check Electron package contents after Shaula asset changes.

### Acceptance Criteria

- No large accidental assets in package output.
- Event and evidence stores remain bounded under repeated dogfood runs.
- Build/package checks remain green.

### Findings - 2026-06-15

Package/assets:

- `npm run perf:size` after the current standalone Electron build:
  - `.next/static`: `2.36 MB`;
  - `.next/server`: `3.27 MB`;
  - `.next/standalone`: `12.0 MB`;
  - `public`: `51.3 KB`;
  - `dist`: missing until Electron package build runs.
- The largest local disk usage is `.next/cache` and `.next/dev`, not release
  assets. These are local build caches and should be handled by `npm run clean`,
  not by product-level asset compression.
- Public Shaula assets are already small. Further icon compression is not a
  meaningful optimization target right now.
- Electron package slimming should be handled carefully later because the
  current build scripts intentionally copy Next/runtime dependencies for
  compatibility.
- Standalone package review shows the largest bundled files are
  `playwright-core` bundles:
  - `playwright-core/lib/coreBundle.js`: `3.06 MB`;
  - `playwright-core/lib/utilsBundle.js`: `2.95 MB`.

Runtime growth:

- `lib/goal/file-store.ts` already caps goal turns and goal evidence.
- `lib/progress/server-store.ts` already capped steps and artifacts, but not
  progress groups.
- `lib/runtime/event-store.ts` and `lib/evidence/server-store.ts` were global
  in-memory maps without a retention cap.
- Task `runs/findings` also needed a separate retention policy because it
  affects task history semantics and unread findings must stay actionable.

### Implementation Status - 2026-06-15

Done:

- Split Markdown code highlighting into lazy client chunk:
  - `app/components/Markdown.tsx` no longer statically imports
    `react-syntax-highlighter` and all Prism language modules;
  - `app/components/MarkdownCodeBlock.tsx` owns the highlighter and language
    registration;
  - build manifest now records `Markdown.tsx -> ./MarkdownCodeBlock`, so code
    highlighting loads when a code block is actually rendered.
- Added bounded retention:
  - runtime events keep the most recent `5000` entries;
  - evidence refs keep the most recent `5000` entries;
  - progress groups keep the most recent `50` groups;
  - persisted progress sanitize also trims groups, steps, and artifacts.
- Added regression tests for runtime event, evidence, and progress group
  retention.
- Added task history retention:
  - task runs keep the most recent `50` runs per task;
  - active runs are retained even when older than the normal cap;
  - runs referenced by retained findings are retained;
  - unread findings are retained;
  - closed/resolved/dismissed findings keep the most recent `100` entries per
    task;
  - orphaned runs/findings for deleted tasks are pruned;
  - retained run `findingIds` are sanitized after pruning.
- Extended `npm run perf:size` into an Electron package review helper:
  - reports `dist` buckets and artifact classes when a full package build is
    present;
  - detects standalone duplicate candidates between source `.next/static` /
    `public` and their `.next/standalone` copies;
  - accounts for `package.json` Electron `build.files` so local source folders
    are not counted as duplicate package bytes when they are not packaged.
- Removed root `.next/static/**/*` and `public/**/*` from Electron
  `build.files`; Electron now packages the standalone copies only:
  - `.next/standalone/.next/static`;
  - `.next/standalone/public`.

Verification:

- `npx vitest run lib/runtime/event-store.test.ts lib/evidence/server-store.test.ts lib/progress/server-store.test.ts lib/evidence/ledger.test.ts lib/runtime/agent-event-bridge.test.ts lib/goal/verifier.test.ts lib/goal/update.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run perf:size`
- `npm run build:electron`
- `npx vitest run lib/tasks/store.test.ts scripts/package-scripts.test.mjs`
- `npm run lint`
- Secret scan after the API key incident found only known non-secret matches:
  a dummy provider-dogfood token, `appendSystemPrompt` text, and
  `tokenPresent` field names.
- Local port cleanup check found no listeners on `3104-3107`.
- Latest `npm run perf:size` after package-list pruning:
  - `Next static copied into standalone`: source exists, not packaged;
  - `Public assets copied into standalone`: source exists, not packaged.

Still pending:

- Electron package build and asar/unpacked size review.
- Optional `perf:size` redlines for CI-style size budgets.
- Optional Playwright runtime closure review if we want to reduce standalone
  size further.

## 10. Not Recommended Right Now

Do not prioritize these yet:

- more visual polish before verifier/evidence behavior is stable, except for
  the bounded P2 readability and appearance settings above;
- broad multi-provider benchmarking before one provider-backed runner is stable;
- public deployment or push flow;
- large architecture refactor of goal/evidence stores;
- replacing the current model SDK path before dogfood proves it insufficient.

## 11. Recommended Execution Order

1. Implement real provider dogfood runner.
2. Add structured evidence tags to progress artifacts.
3. Fix profile router negation and add optional profile override.
4. Run GLM-5.1 dogfood matrix and write a quality report.
5. Upgrade goal/evidence UI based on states actually seen in dogfood.
6. Add bounded appearance settings for font sizes and core controls.
7. Do performance/package review after behavior stabilizes.

## 12. Immediate Next Task

Current next action:

```text
Decide whether to run a full Electron installer/asar build review now, or defer
it until the UI/provider P2 surface settles.
```

Do next:

- run full Electron package review only when we are ready for a slower package
  build and a new `dist` output;
- add optional `perf:size` thresholds if we want CI-style regression budgets;
- keep GLM-specific reruns optional until its resource package is restored.

DeepSeek already proved the runner/verifier path with a real provider, so GLM
comparison is useful but not blocking.
