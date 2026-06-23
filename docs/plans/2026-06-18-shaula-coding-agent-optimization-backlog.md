# Shaula Coding Agent Optimization Backlog

> Date: 2026-06-18
> Status: P0, P1-1, P1-3, P1-4, P2-1, P2-2, and P2-3 implemented. P1-2 is implemented with structured pre-acceptance completion claims plus post-completion final-message audit; full NLI and hard gating on the already-sent final chat bubble remain accepted future hardening limits rather than current blocking gates.
> Scope: Shaula as a local-first coding-agent workbench.

## 0. Implementation Status

Implemented on 2026-06-18:

- P0-1 API access boundary: centralized `assertApiAccess`, explicit public route list, and static route guard.
- P0-2 durable evidence/runtime events: append-only session ledgers under `~/.shaula/runtime/{sessionId}`.
- P0-3 tool risk approval policy: expanded high-risk rules, non-rememberable risky approvals, and fail-closed built-in handling.
- P0-4 local-coding-assistant parity: labeled as an external text runner instead of full SDK-backed runtime.
- P1-1 browser verification: browser checks run through the verifier, record host-observed evidence, and block completion when missing or failed.
- P1-2 semantic completion partial: stale test-vs-diff ordering blocks completion; out-of-scope diff evidence opens a review action without blocking completion; actual final assistant messages are tracked and audited after completion against the accepted structured claim.
- P2-3 local benchmark/skill-eval hardening: `npm run benchmark:shaula` covers the local goal dogfood, skill-eval suite, write boundary, isolated workflow worktree merge approval, provider dogfood dry-run/mocked path, and local CLI shim behavior.

Current blocking backlog:

- None.

## 1. Core Judgment

Shaula 当前不是从零实现的 coding agent runtime。它更准确的定位是：

```text
local-first coding-agent workbench + task-governance harness
```

底层 agent/session/tool loop 主要托管给
`@earendil-works/pi-coding-agent`。Shaula 的核心价值在外层：

- 本地 Web/Electron 工作台；
- session、runner、SSE、Workbench UI；
- task contract、goal、progress、evidence、verification；
- approval、browser、subagent、workflow、MCP；
- Windows shell、Electron packaging、本地 credential/state 管理。

下一阶段不要先重写 runtime，也不要先大改 UI。核心优化线应当是：

```text
访问边界 -> 可恢复证据 -> 风险审批 -> 真实验收 -> 模块拆分
```

## 2. P0 Optimization Items

### P0-1. 统一 API 访问边界 - Implemented

Problem:

Shaula has high-privilege local APIs. Some agent routes call `assertRemoteAuth`,
but the access boundary is not visibly centralized across all sensitive
`/api/*` routes.

Target:

- Default all `/api/*` routes to authenticated/local-secret access.
- Explicitly allow only narrow public endpoints such as health and pairing.
- Document public route exceptions in one place.

Acceptance criteria:

- A new sensitive route cannot be added without passing through the auth wrapper
  or deliberately declaring itself public.
- Remote/tunnel mode cannot access local files, MCP config, model config, or
  browser control without the intended secret/auth path.
- Tests cover both allowed and denied paths.

### P0-2. 持久化 Evidence 和 Runtime Events - Implemented

Problem:

Goal, workflow, and progress have persistent stores, but evidence and runtime
events are mostly process memory. Restarting the app can preserve session text
while losing runtime facts that the verifier and Workbench need.

Target:

- Persist evidence and runtime events to a session-adjacent append-only ledger.
- Keep in-memory stores as cache, not source of truth.
- Let verifier and timeline read from durable evidence.

Suggested store shape:

```text
~/.shaula/runtime/{sessionId}/events.jsonl
~/.shaula/runtime/{sessionId}/evidence.jsonl
~/.shaula/runtime/{sessionId}/index.json
```

### P0-3. 强化工具风险审批策略 - Implemented

Problem:

Tool approval exists, but the built-in shell risk rules are narrow. The current
default catches a few obvious destructive Unix/Git patterns, while Windows and
remote/public actions need stronger coverage.

Risk categories to cover:

| Category | Examples |
| --- | --- |
| Windows destructive filesystem | `Remove-Item -Recurse`, `del /s`, `rd /s`, `rmdir /s` |
| Git destructive | `git reset --hard`, `git clean -fdx`, force push |
| Network execute | `curl ... | sh`, `irm ... | iex`, downloaded scripts |
| Public/external action | deploy, publish, push, email, issue/comment creation |
| Secret exposure | env dumps, credential files, token-bearing logs |
| Cross-workspace write | writes outside cwd or configured `SHAULA_WEB_ROOT` |

Acceptance criteria:

- High-risk commands require approval or are denied by default.
- The approval UI shows tool name, command/input, cwd, and rule reason.
- Approval extension exceptions do not silently allow high-risk actions.

### P0-4. Clarify `local-coding-assistant` Parity - Implemented

Problem:

`local-coding-assistant` is a CLI shim path. It maps stdout/stderr into assistant
message deltas, but it does not have the same structured tool/progress/evidence
parity as SDK-backed agents.

Target:

Choose one direction:

1. Make it a real SDK-compatible provider/runtime with structured events.
2. Label it as a text-only external runner and limit UI claims accordingly.

Acceptance criteria:

- Users can see whether a session is full SDK-backed or external text-only.
- Tool timeline, approval, progress, evidence, and verifier behavior are not
  misleading for CLI shim sessions.
- Abort, error, and exit-code behavior is tested.

## 3. P1 Optimization Items

### P1-1. Browser Verification As First-Class Verifier - Implemented

Target:

- Add browser checks to `VerificationPlan`.
- Support opening a target URL, checking visible text/selectors, capturing
  screenshot evidence, and recording host-observed pass/fail.
- Let frontend/UI goals fail completion when browser evidence is missing or
  failed.

Implemented:

- `VerificationBrowserCheck` now runs through `runVerificationPlan` via an injected browser observer.
- `goal_run_verification` passes browser context and records browser evidence in the durable ledger.
- `browser_verify` tool calls automatically record host-observed pass/fail evidence.
- `goal_update complete` runs a browser-only preflight when browser evidence is required but missing.
- Failed browser verification evidence no longer satisfies `browser_observation`.

### P1-2. Semantic Completion Verification - Partial

Target:

Add semantic checks that connect:

- objective and contract;
- changed files and declared main artifact;
- diff and test timing;
- browser observation and acceptance criteria;
- final answer and actual evidence.

Acceptance criteria:

- Stale evidence cannot satisfy a new goal.
- Tests must run after relevant changes.
- A browser screenshot alone cannot satisfy deterministic test evidence.
- A diff outside the declared artifact/scope is flagged for review.

Implemented:

- Active-goal evidence collection already filters evidence older than the current goal.
- Required deterministic checks must be newer than the latest diff evidence.
- Failed browser observations and browser screenshots cannot satisfy deterministic test requirements.
- Diff evidence outside path-like contract scope opens a review action via the evaluation-action channel.
- `goal_update complete` now accepts a structured `finalSummary` plus `evidenceIds`; when supplied, the verifier rejects unknown evidence ids and rejects summaries whose cited evidence does not cover required contract evidence.
- The goal tool and goal start/resume prompts now instruct agents to include `finalSummary` and supporting `evidenceIds` before the final handoff.
- Execution contracts now include an optional structured `mainArtifact` field, inferred conservatively from explicit input, attachments, path-like scope, or objective text.
- GoalTimeline and the Workbench cockpit use `contract.mainArtifact` when present instead of relying only on progress artifact guessing.
- The server now tracks actual assistant `message_start` / `message_update` / `message_end` text, deduplicates replayed start content, and stores a post-completion audit comparing the final chat message against the accepted structured completion claim and cited evidence.
- Formal `goal_update complete` attempts now require a structured `finalSummary` plus cited `evidenceIds` for contracted or acceptance-gated goals; readiness/closure checks stay claim-optional so they can still prompt the model to finalize once evidence is sufficient.

Accepted limitations:

- The actual final assistant chat message audit is still post-completion; it records warning/failed findings on the goal but cannot be a hard pre-acceptance gate because the final chat bubble arrives after `goal_update complete`.
- Semantic comparison is still heuristic token overlap, not a full entailment/NLI check.

### P1-3. CI And Real Dogfood Gates - Implemented

Target PR gate:

```text
npm ci
npm run typecheck
npm run lint
npm test
npm run benchmark:shaula
npm run design-tokens:check
npm run test:e2e
```

Implemented:

- Added GitHub Actions CI for pull requests and pushes to `main`.
- CI runs Node 24, `npm ci`, typecheck, lint, unit tests, design-token drift report, Playwright Chromium install, and e2e tests.
- CI now also runs `npm run benchmark:shaula` so the local agent-behavior benchmark cannot silently drift out of the PR gate.
- Added a package-script guardrail test so the backlog's PR CI gate cannot silently drift.
- Fixed the e2e fixture's initial progress title truncation to match the real API.
- Added defensive Workbench overview truncation so a long progress step title cannot bypass folded-message UI.
- The provider dogfood runner now preflights `/api/providers`, fails fast on missing provider/model/auth, preserves a red exit code when any live case misses its expected final state, includes evidence ids in the report, submits structured `finalSummary` plus `evidenceIds` when the harness finalizes verified work, and applies a per-case tool policy to keep workflow/subagent/browser tools from contaminating non-browser dogfood cases.
- The provider dogfood success classifier now rejects the `verifier-rejection-recovery` case if completion was supplied by the runner instead of the model, requires `blocked-pause` to include a `Blocker log` progress artifact whose preview names `SHAULA_DOGFOOD_MISSING_TOKEN`, treats an explicit empty active-tool list as empty rather than falling back to all tools, and waits for terminal verifier recovery instead of snapshotting a transient `active/failed` state.

Dogfood gate:

- Run at least one real provider path.
- Require a coding goal that produces a real diff and deterministic test
  evidence.
- Require a verifier-rejection case.
- Require a UI/browser observation case before frontend release claims.

Live result:

- `npm run dogfood:provider -- --provider deepseek --model deepseek-v4-flash --base-url http://127.0.0.1:3000 --timeout-ms 720000 --out docs/quality/2026-06-18-shaula-provider-dogfood-deepseek-prod-final.md` passed against a production `next start` server.
- The final live report covered `coding-diff-success`, `verifier-rejection-recovery`, `needs-user-pause`, `blocked-pause`, and `browser-observation`; all cases reached their expected final states.
- The strict verifier-rejection case finished `complete/passed` with 15 rejected intermediate evaluations and no `runner_goal_update_complete` action, proving the model recovered with cited ledger evidence rather than the runner completing on its behalf.
- A follow-up strict blocker live check is recorded in `docs/quality/2026-06-18-shaula-provider-dogfood-deepseek-blocker-strict.md`; it proves the `Blocker log` preview names `SHAULA_DOGFOOD_MISSING_TOKEN` under the stricter classifier.
- The explicit `active=[]` tool-policy behavior is covered by deterministic provider-dogfood unit tests and `npm run benchmark:shaula`; it is not a live-report field.

Operational note:

- `dogfood:provider` remains a manual/live gate rather than default PR CI because it depends on stored provider credentials, quota/resource availability, and model behavior.

### P1-4. Split Central Modules Along Runtime Boundaries - Implemented

Target split:

| Current hub | Suggested split |
| --- | --- |
| `agent-registry` | lifecycle, event bus, tool assembly, approval brokers, local CLI adapter |
| `agent/[id]/route` | prompt actions, goal actions, progress/evidence actions, model/tools actions |
| `ChatApp` | shell layout, session switching, composer controller, workbench controller |
| `electron/main` | app bootstrap and controller composition after staged desktop splits |
| `script-runtime` | capability broker, worker RPC, workflow SDK, network policy, worktree manager |

Acceptance criteria:

- No behavior rewrite in the first split.
- Tests remain green after each split.
- New provider/tool policy changes do not require editing unrelated UI or
  workflow code.

Implemented:

- Extracted goal POST actions from `app/api/agent/[id]/route.ts` into `lib/agent-actions/goal-actions.ts`.
- Extracted progress/evidence POST actions and progress persistence into `lib/agent-actions/progress-actions.ts`.
- Extracted model/tool POST actions from `app/api/agent/[id]/route.ts` into `lib/agent-actions/model-tool-actions.ts`.
- Extracted prompt/steer/follow-up POST actions from `app/api/agent/[id]/route.ts` into `lib/agent-actions/prompt-actions.ts`.
- Extracted explicit GET query actions from `app/api/agent/[id]/route.ts` into `lib/agent-actions/query-actions.ts`, including tools, thinking levels, fork messages, tree/system prompt, goal timeline, route decisions, runtime events, evidence, and stats.
- Extracted abort/compact/navigate-tree lifecycle POST actions from `app/api/agent/[id]/route.ts` into `lib/agent-actions/lifecycle-actions.ts`.
- Added `lib/agent-actions/types.ts` so action modules return plain action results and the route remains responsible for `NextResponse`.
- Added unit tests for action classification, initial goal progress truncation, goal prompt/protocol construction, progress update parsing, local CLI model payloads, thinking level updates, tool whitelist filtering, image parsing, route override parsing, attachment aside injection, steer/follow-up dispatch, query filter parsing, evidence/runtime event merging, hidden-context stripping for fork messages, session-backed query payloads, abort progress fail-open behavior, compaction forwarding, and tree navigation validation.
- Extracted local coding assistant adapter concerns from `lib/agent-registry.ts` into `lib/local-coding-assistant/adapter.ts`, including model identity, session-model payloads, CLI args, prompt/message construction, JSON stream text extraction, and runtime-profile constants.
- Updated model/tool actions and provider listing to depend on the local adapter directly instead of pulling local CLI model details through the registry.
- Extracted the generic event ring buffer from `lib/agent-registry.ts` into `lib/agent-event-buffer.ts`, covering append, replay-after-seq, latest seq, listener notification, and unsubscribe behavior.
- Extracted runtime-event mirroring from `lib/agent-registry.ts` into `lib/runtime/agent-event-mirror.ts`, so bridge/store failure handling and evidence-to-runtime-event persistence are isolated from registry lifecycle code.
- Extracted the approval request lifecycle from `lib/agent-registry.ts` into `lib/collab/approval-broker.ts`, centralizing request/resolved event emission, pending approval registration, timeout attribution, and optional response mapping.
- Extracted agent tool assembly from `lib/agent-registry.ts` into `lib/agent-tool-assembly.ts`, covering best-effort MCP tool loading, subagent/workflow/MCP custom-tool combination, session custom-tool normalization, and default browser tool activation.
- Extracted SDK session/resource-loader construction rules from `lib/agent-registry.ts` into `lib/agent-session-construction.ts`, covering resume-vs-new `SessionManager` selection, parent-session lineage, Shaula system prompt append, shell/write-boundary extension ordering, and `DefaultResourceLoader` creation.
- Extracted agent session lifecycle handling from `lib/agent-registry.ts` into `lib/agent-lifecycle.ts`, covering stop-reason detection, finish watchdogs, `agent_start`/`agent_end` state transitions, goal turn finalization, pause-for-user-input, and automatic goal continuation prompts.
- Extracted extension callback wiring from `lib/agent-registry.ts` into `lib/agent-extension-wiring.ts`, covering approval/clarification/goal/progress/browser/subagent/workflow callback assembly, MCP custom-tool loading, and custom-tool output for session construction.
- Extracted the ChatApp workbench controller from `app/ChatApp.tsx` into `app/hooks/useWorkbenchController.ts`, covering workbench persistence, initial view/open restoration, compact viewport behavior, sidebar toggle state, file-panel width clamping, and splitter drag state.
- Extracted the ChatApp composer history/controller from `app/ChatApp.tsx` into `app/hooks/useComposerHistoryController.ts`, covering input history persistence, ArrowUp/ArrowDown history browsing, `/goal` and `/workflow` command interception, and send/steer/follow-up history wrapping.
- Extracted the ChatApp session-switching controller from `app/ChatApp.tsx` into `app/hooks/useSessionSwitchingController.ts`, covering existing-session selection, cold context restore, loaded-runner reuse, Workbench closing on session selection, and Electron pet session switch/reconnect events.
- Extracted the ChatApp workflow history and inspector UI from `app/ChatApp.tsx` into `app/components/WorkflowHistoryPanel.tsx`, covering resumable workflow lists, checkpoint selection, debug trace/log/artifact/script inspection, and resume-summary formatting.
- Extracted ChatApp status overlays from `app/ChatApp.tsx` into `app/components/ChatStatusOverlays.tsx`, covering update-available, update-latest, and session-loading presentation.
- Extracted the ChatApp shell/layout frame from `app/ChatApp.tsx` into `app/components/ChatAppShell.tsx`, covering the app frame, sidebar/main/workbench slot composition, drag overlay, scroll-to-bottom affordance, and composer container without changing business handlers.
- Extracted workflow worker spawn configuration from `lib/workflows/script-runtime.ts` into `lib/workflows/script-worker-spawn.ts`, covering worker path resolution, memory/CPU limits, POSIX `ulimit` wrapping, and optional external sandbox argv wrapping while preserving the old `script-runtime` re-export.
- Extracted workflow manifest/capability gating from `lib/workflows/script-runtime.ts` into `lib/workflows/script-capabilities.ts`, covering default capability normalization, manifest limits, approval-required capabilities, runtime support checks, required-capability assertions, and child-agent tool-to-capability mapping.
- Extracted workflow worker RPC execution from `lib/workflows/script-runtime.ts` into `lib/workflows/script-worker-rpc.ts`, covering worker process launch, line-delimited request/response dispatch, abort handling, stderr failure reporting, and the init payload sent to the worker.
- Extracted workflow worktree runtime handling from `lib/workflows/script-runtime.ts` into `lib/workflows/script-worktree-manager.ts`, covering workflow-owned worktree tracking, diff artifacts, merge approval, merge success/failure artifacts, and worktree removal.
- Extracted workflow SDK assembly from `lib/workflows/script-runtime.ts` into `lib/workflows/script-sdk.ts`, covering workflow log/checkpoint/artifact APIs, ask-user, network request approval/policy checks, MCP tool scoping/approval, child-agent spawning, schema validation, parallel/stage/sleep helpers, and worktree SDK delegation.
- Extracted Electron dependency helpers from `electron/main.js` into `electron/dependencies.js`, covering cloudflared path detection, Homebrew detection, install command execution, status payloads, and install-result payloads while preserving the existing IPC names.
- Extracted Electron core IPC from `electron/main.js` into `electron/core-ipc.js`, covering app info, API base/local-secret bridge, dependency status/install handlers, directory selection, Finder/Explorer reveal, and external URL opening.
- Extracted Electron settings/keytar IPC from `electron/main.js` into `electron/settings-ipc.js`, covering settings window opening, provider key CRUD, settings load/save, provider-env map exposure, and reload-server registration while leaving server lifecycle restart in `main.js`.
- Extracted Electron pet IPC from `electron/main.js` into `electron/pet-ipc.js`, covering pet state forwarding, focus/reconnect routing, visibility/move/work-area/mouse-through controls, and native context menu actions.
- Extracted Electron native-browser PoC IPC from `electron/main.js` into `electron/webview-poc-ipc.js`, covering `webviewPoc:*` debugger attach, navigation, inspect, screenshot, click, and detach handlers.
- Extracted Electron tray/menu controller from `electron/main.js` into `electron/tray.js`, covering tray icon loading, context menu construction, pet visibility toggling, manual update checks, and quit handling while preserving a strong controller reference in `main.js`.
- Extracted Electron standalone server lifecycle from `electron/main.js` into `electron/server-lifecycle.js`, covering remote bind selection, free-port probing, keytar/env merge, wrapper child process startup, readiness detection, reload-server restart, and best-effort child shutdown.
- Extracted Electron window lifecycle from `electron/main.js` into `electron/windows.js`, covering main-window creation/focus, settings route navigation, pet window creation/blur forwarding, window diagnostics, dev-server health wait, startup update checks, and active-Space visibility handling.

Optional follow-up:

- No first-level P1-4 hub split remains. Further prop slimming inside the extracted UI shells is optional follow-up, not required for this boundary pass.

## 4. P2 Optimization Items

### P2-1. Electron And Windows Release Acceptance - Harness Implemented

Target:

- install Windows NSIS artifact;
- launch app;
- confirm window visible and not blank;
- wait for health ready;
- open settings;
- create a session;
- quit and verify child server exits.

Implemented:

- Added `npm run release:acceptance:win` as a local Windows release acceptance harness.
- Added `npm run release:acceptance:win:install` as the explicit NSIS installer acceptance entry; the default `release:acceptance:win` remains the unpacked smoke path to avoid silently modifying local install state.
- The harness can run against `dist/win-unpacked/Shaula Agent.exe` by default or install an NSIS artifact only when explicitly passed `--install`.
- Acceptance launch is isolated with a temp APPDATA/LOCALAPPDATA/USERPROFILE root, `ELECTRON_DISABLE_PET=1`, fixed `SHAULA_ACCEPTANCE_PORT`, fixed `SHAULA_LOCAL_SECRET`, and `SHAULA_WEB_ROOT` scoped to the repo.
- The harness waits for `/api/health` with a strict 2xx check, verifies provider API access with the local secret, creates a `local-coding-assistant` session without external model credentials, verifies the `/settings` route, quits the app, and checks Electron process exit, standalone server pid exit, and health endpoint shutdown after both graceful and forced shutdown paths.
- The harness now requires Electron window probes proving the main window and settings page are visible, loaded from the acceptance base URL, fully loaded, backed by expected React selectors, backed by client-side hydration markers, backed by actually loaded Next static resources, and free of renderer load/console errors before continuing.
- Electron prod startup now honors `SHAULA_ACCEPTANCE_PORT` for deterministic local health probing and `SHAULA_LOCAL_SECRET` for scripted local API acceptance.
- Electron acceptance mode can write `SHAULA_ACCEPTANCE_WINDOW_PROBE`, `SHAULA_ACCEPTANCE_SETTINGS_WINDOW_PROBE`, and `SHAULA_ACCEPTANCE_SERVER_PROBE` diagnostics without changing normal production startup behavior.
- Electron server reload now marks the old standalone child as an expected exit, waits for that child process to actually exit, and avoids treating a settings reload as an app-crashing server failure.
- `scripts/package-scripts.test.mjs` guards the acceptance script entry.
- The live NSIS install/uninstall path was executed locally with `npm run release:acceptance:win:install` after an unsigned Windows build. It installed the generated installer into an isolated temp target, launched the installed app, verified health, standalone server pid, main window, local-coding-assistant session creation, settings rendering, Electron shutdown, server shutdown, and uninstaller completion.
- The unpacked and NSIS acceptance runs are recorded in `docs/quality/2026-06-18-shaula-release-acceptance-win.md`; both passed, with only the non-fatal Node `[DEP0180]` deprecation warning.

Release note:

- No P2-1 release acceptance item remains. Real provider dogfood is completed under P1-3 as a manual/live gate.

### P2-2. Workbench State Visibility - Implemented

Target:

Make the UI answer these questions without reading the whole transcript:

- What is the active objective?
- What is the main artifact?
- What evidence is required?
- What has been verified?
- What is still missing?
- Is the agent running, waiting for user input, blocked, or safe to finalize?

Implemented:

- Added a compact Workbench goal-state strip to the Overview panel.
- The strip reuses `goal_timeline` and summarizes the active objective, main artifact, required evidence, verified evidence count, missing evidence count, and runtime/finalization status.
- Readiness and completion states are surfaced separately: running, waiting user, blocked, missing evidence, safe to finalize, and complete.
- Added Workbench e2e coverage for a ready-to-finalize goal showing objective, main artifact, required evidence, verified `2/2`, and missing `0`.

### P2-3. Benchmark And Skill Eval Hardening - Implemented

Target cases:

- coding diff success;
- premature completion rejection;
- failed required check;
- needs-user pause;
- blocked pause;
- browser observation;
- subagent write boundary;
- workflow worktree merge approval;
- local CLI shim behavior.

Implemented:

- Expanded `SHAULA_SKILL_EVAL_SUITE_V1` with the nine P2-3 target cases while keeping the older benchmark-derived smoke cases.
- Added deterministic case runners for coding diff success, premature completion rejection, failed required check, needs-user pause, blocked pause, host-observed browser evidence, subagent write-boundary enforcement, workflow worktree merge approval denial, and local CLI shim behavior.
- The failed-required-check runner and local dogfood fixture now use real verification evidence metadata and prove both sides: failed required `test_result` blocks completion, and a newer passing `test_result` can recover the verifier.
- The browser-observation runner now includes negative checks for agent-reported text-only browser claims and failed browser checks, not only a positive host-observed screenshot case.
- The workflow worktree merge runner now executes against a temp workflow store root and cleans it up so the benchmark cannot write to the user's live workflow store.
- Added `failed-required-check` to the local goal dogfood set so failed deterministic evidence is distinct from missing evidence.
- Added `npm run benchmark:shaula` and locked it in package-script guardrails plus CI.
- Kept provider dogfood as the live/manual layer; it still covers five provider-backed cases and remains separate from the deterministic local benchmark to avoid flaky model-dependent gates.

## 5. Explicit Non-Goals

Do not prioritize these until P0 is stable:

- rewriting the entire agent runtime;
- replacing the upstream SDK;
- broad visual redesign;
- a second evidence database;
- public release push;
- OS-level sandbox as a hard dependency on Windows;
- LLM hard router replacing advisory routing;
- large-scale file/state migration.

## 6. Recommended Execution Order

1. Create unified API access boundary and tests.
2. Persist evidence/runtime events.
3. Expand risk approval policy and fail-closed behavior for high-risk tools.
4. Decide `local-coding-assistant` parity or label it as text-only.
5. Promote browser verification into the verifier runner.
6. Add semantic completion verification.
7. Add PR/release CI and real provider dogfood gates.
8. Split central modules without behavior changes.
9. Add Electron/Windows installer acceptance.
10. Harden benchmark/skill-eval cases.

If only one thread can be started now, start with API access boundary.

Reason:

Shaula is a local high-privilege workbench. Before adding more agent ability,
the local API surface must have a clear default security model.
