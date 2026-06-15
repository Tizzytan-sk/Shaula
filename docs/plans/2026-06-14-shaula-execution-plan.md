# Shaula Execution Plan

> Status: Executing; Phase 0-10 complete locally
> Date: 2026-06-14
> Scope: Turn the current Shaula Agent-derived codebase into Shaula's first
> execution-spine build while preserving the rubric/evaluation foundation.

## 1. Core Judgment

Shaula should not start as a visual rename or a broad refactor. The first build
must make the product thesis executable:

> Strike the core. Finish the work.

That means the implementation priority is:

1. define the task contract;
2. require evidence;
3. evaluate against rubrics;
4. turn failures into next actions;
5. make the control state visible to the user.

Branding, UI friendliness, skill evaluation, and performance work are all valid
optimization tracks, but they must be sequenced around that spine.

## 2. Current Baseline

Confirmed local baseline:

- Workspace: local Shaula checkout
- Branch: `shaula/execution-spine`
- Upstream base included: `upstream/main` at `a7baf46`
- Rubric/evaluation foundation preserved.
- Shaula baseline, Windows build fix, visible identity pass, execution contract
  v0, evaluation UI thin slice, Evidence Ledger v2, Host-run
  VerificationPlan, Skill Eval Harness v0, EvaluationAction Queue v0, and the
  optional read-only Verifier Path are committed locally.

Latest verified checks after Phase 10:

- `npm test` passes: 71 test files, 545 tests.
- `npm run lint` passes.
- `npm run build` passes on Windows via the cross-platform Node build wrapper.
- `npm run perf:size` tracks current build size: `.next/static` is 2.34 MB,
  `.next/server` is 3.41 MB, and `public` is 812.7 KB after moving unused
  Shaula source icon assets out of shipped public assets.
- Browser smoke check passes: local page title is `Shaula Agent`, Shaula shell
  renders, Shaula icon assets load, and no fresh console error is reported after
  reload.

Important existing implementation facts:

- Evidence store already exists in `lib/evidence/*`.
- Goal completion already has a stop-time evidence gate in `lib/goal/verifier.ts`.
- Rubric evaluation is already wired into the goal completion verifier.
- Independent evaluator input isolation already exists in `lib/evaluation/gate.ts`.
- Runtime timeline and goal timeline already show events/evidence, but they do
  not yet present the full future Agent Control Center.
- Several performance items from the old performance plan are already implemented:
  SSE 16ms batching, streaming Markdown fallback, and `PrismLight` language
  registration.

Completed implementation log:

- Phase 0: baseline locked and Windows build script fixed.
- Phase 1: visible Shaula identity, temporary lucide `Crosshair` mark, UI
  scale/readability pass, and compact viewport guard shipped.
- Brand/UI asset pass: real Shaula icon assets are added, high-frequency
  controls are larger, and main navigation labels are friendlier.
- Phase 2: execution contract model/store/build path added, goal creation now
  attaches contract ids, verifier receives contract summaries, and the goal
  timeline shows contract scope/evidence/non-goals.
- Phase 3: completion evaluations now persist on the goal, rejected completion
  attempts also push goal updates to the UI, the goal bar shows compact eval
  score/status, and the expanded timeline shows recommendation, next action,
  missing evidence, failed criteria, and hard fails.
- Phase 4: EvidenceRef now carries trust/source/criteria/artifact metadata,
  evidence writes normalize those fields, goal completion can evaluate ledger
  evidence against contract required evidence, and the goal/runtime timelines
  show evidence trust and source.
- Phase 5: VerificationPlan inference, controlled local command execution,
  command-result evidence, and failed required verification blocking are added.
- Phase 6: Skill Eval Harness v0 now builds skill.eval contracts, evaluates
  use-case results with the shared rubric evaluator, and records eval run,
  rubric score, and version-diff evidence into the shared Evidence Ledger.
- Phase 7: Rubric evaluation gaps now reconcile into an EvaluationAction queue;
  rejected completions open actions, later passing evaluations resolve them,
  and the goal timeline shows unresolved actions.
- Phase 8: the pure verifier gate remains the mandatory path, and an optional
  read-only verifier subagent request/task path now sanitizes inputs, strips
  write-capable tools, and requires structured JSON verdicts.
- Phase 9: an advisory task router now records prompt/goal route suggestions
  with reasons and optional reasoned overrides, exposes route decisions through
  the agent API, and shows the latest decision in the goal timeline.
- Phase 10: bundle/build size measurement is available through
  `npm run perf:size`, and unused Shaula source/extra-size icon files were moved
  from `public/brand` to `build/brand`, reducing shipped public assets from
  about 2.51 MB to about 812.7 KB while preserving the reusable source assets.

## 3. Source Inputs

Use these as source documents:

- `docs/plans/2026-06-14-shaula-positioning.md`
- Harness optimization plan provided from WeChat temp path:
  `harness-optimization-plan.md`
- Existing architecture/evidence plans:
  - `docs/plans/2026-06-05-architecture-health-roadmap.md`
  - `docs/plans/2026-06-06-architecture-health-technical-implementation.md`
  - `docs/plans/2026-06-06-architecture-health-regression-test-plan.md`
- Performance plan:
  - `docs/PERF.md`

Missing source:

- The referenced skill plan
  `source-latest-main/docs/plans/2026-06-13-rfc-8-skill-eval-harness.md`
  was not found in the current `source-latest-main` or the Shaula
  workspace. Treat skill-eval details as pending until the source file is
  supplied.

## 4. Execution Principles

1. Do not discard the rubric/evaluation foundation.
   It is part of Shaula's base layer, not an optional branch.

2. Preserve source compatibility where possible.
   Shaula can use different product naming, but early builds should not break
   existing sessions, settings, skills, or workflows without an explicit
   migration.

3. Do not create parallel truth.
   Skill eval, verifier, workflow, browser, and goal completion must reuse the
   same contract, evidence, rubric, and action concepts.

4. UI changes must clarify control state.
   Bigger and friendlier does not mean decorative. The user should more easily
   see what is running, what evidence exists, why completion was rejected, and
   what the next action is.

5. Performance work must be evidence-led.
   First fix build compatibility and add measurement. Then optimize the hot
   paths that still show up in profiling.

## 5. Phase 0: Lock The Baseline

Status: Complete.

Purpose: create a clean Shaula starting point before feature work.

### Work Items

1. Commit the current Shaula base:
   - `upstream/main` merge
   - rubric/evaluation foundation
   - Shaula positioning doc
   - Windows path test fix

2. Fix Windows build script compatibility:
   - Replace Unix-style npm script env assignment with a cross-platform approach.
   - Options:
     - use `cross-env`; or
     - add a small Node build wrapper script that sets `process.env`.
   - Prefer the least invasive option that keeps package scripts readable.

3. Re-run baseline verification:
   - `npm test`
   - `npm run lint`
   - `npm run build`

### Acceptance Criteria

- The branch is clean after commit.
- Windows can run `npm run build` without manual env assignment.
- Test, lint, and build all pass.

## 6. Phase 1: Shaula Identity And UI Readability

Status: Complete.

Purpose: make the local product visibly Shaula while keeping data compatibility.

### Work Items

1. Product naming pass:
   - legacy visible UI text -> `Shaula Agent`
   - web metadata title/description
   - Electron title, tray tooltip, tray menu labels
   - mobile pairing text
   - provider setup and empty states
   - README/package description where user-facing

2. Package and binary naming:
   - Package name target: `shaula-agent`
   - Binary target: `shaula-agent`
   - Keep legacy binary compatibility only if needed for early local testing.

3. Data directory policy:
   - Do not silently migrate legacy app state into `~/.shaula/`.
   - Early Shaula builds should keep state boundaries explicit.
   - Add a later migration plan before changing storage paths.

4. Icon direction:
   - Short-term UI icon: use existing icon library symbols such as `Crosshair`,
     `Target`, or `Sparkles` for the Shaula control surface.
   - App icon/tray icon should be handled as a separate asset pass.
   - Do not use emoji or ad hoc SVG drawings for production branding.

5. Friendlier UI scale:
   - Increase the practical reading size of high-frequency surfaces:
     sidebar rows, message body, goal/evidence/evaluation panels.
   - Increase small controls where they are dense today.
   - Keep the app workbench-like: clear, calm, and repeated-use friendly.

6. Control surface visibility:
   - Upgrade active goal/evaluation display from status-only to control-state:
     phase, score, missing evidence, failed criteria, and next action.

### Acceptance Criteria

- Main shell clearly says Shaula Agent.
- App title, tray title, and visible user-facing labels no longer say legacy product names
  except in compatibility/history docs.
- UI remains usable at desktop sizes without text overlap.
- Existing sessions/settings are not lost.
- Test, lint, and build pass.

## 7. Phase 2: Execution Contract v0

Status: Complete.

Purpose: establish one shared definition of what the task is and what done means.

### Why This Moves Earlier

The harness optimization plan put Execution Contract after evidence and action
queue work. For Shaula this is too late. Evidence and evaluation need a target.
The contract is the target.

### Work Items

1. Add execution contract model:
   - `lib/execution-contract/types.ts`
   - `lib/execution-contract/build.ts`
   - `lib/execution-contract/store.ts`

2. Minimum contract fields:
   - objective
   - scope
   - non-goals
   - acceptance criteria
   - required evidence
   - rubric profile
   - allowed capabilities
   - budget hints

3. Goal integration:
   - Build a contract when a substantial goal starts.
   - Attach contract id to active goal state.
   - Pass contract summary into verifier/evaluator input.

4. UI integration:
   - Show a compact contract card in the goal area.
   - Allow the user to see objective, non-goals, acceptance criteria, and
     required evidence.

### Acceptance Criteria

- Every long-running goal can have a structured contract.
- Verifier can evaluate from contract plus evidence without reading the full
  conversation.
- UI can show what Shaula promised to do and not do.

## 8. Phase 3: Evaluation UI Thin Slice

Status: Complete.

Purpose: make the existing rubric/evaluation layer visible and useful.

### Work Items

1. Surface evaluation result in goal UI:
   - total score / target score
   - recommendation
   - next action
   - missing evidence
   - failed criteria
   - hard fails

2. Persist latest completion evaluation on the goal:
   - rejected completion attempts keep the goal active but store the evaluation;
   - accepted completion stores the passing evaluation with the completed goal.

3. Show completion result in existing control surfaces:
   - compact goal bar eval badge;
   - expanded goal timeline evaluation summary.

4. Keep scope narrow:
   - Do not build the full Agent Control Center yet.
   - Do not create a new analytics dashboard.

### Acceptance Criteria

- If completion is rejected, the user can see why.
- If completion is accepted, the user can see the score and proof summary.
- The next recommended action is visible without opening raw logs.

## 9. Phase 4: Evidence Ledger v2

Status: Complete.

Purpose: upgrade the existing evidence store rather than create a duplicate one.

### Current Reality

`lib/evidence/*` already exists. The correct work is not "add Evidence Ledger v1"
from scratch. The correct work is to normalize and enrich it.

### Work Items

1. Extend `EvidenceRef`:
   - trust level
   - source type/id
   - support mapping to contract criteria or rubric criteria
   - compact summary field
   - stable artifact URI when available

2. Add or improve bridges:
   - progress artifacts
   - workflow checkpoints/artifacts
   - subagent results
   - browser observations/screenshots
   - approval decisions
   - test/build/lint command results

3. Evaluation integration:
   - Convert ledger evidence into evaluation evidence.
   - Use trust level to prevent self-reported evidence from satisfying strong
     completion requirements.

4. UI integration:
   - Group evidence by acceptance criterion, trust level, and source.

### Acceptance Criteria

- A goal can list all related evidence from one normalized API.
- Evidence can be mapped to acceptance criteria.
- Deterministic checks and host observations are visibly stronger than agent
  self-report.
- Existing evidence consumers remain backward compatible.

## 10. Phase 5: Host-run VerificationPlan

Status: Complete.

Purpose: make code completion depend on environment-backed checks.

### Work Items

1. Add verification plan types and inference:
   - infer commands from changed files, contract, rubric profile, and acceptance
     criteria;
   - start with tests/build/lint/browser observation.

2. Add controlled command runner:
   - command
   - cwd
   - timeout
   - required/optional
   - status and preview output

3. Store command results as evidence:
   - test result
   - build result
   - lint result
   - browser observation

4. Completion gate integration:
   - required failed command blocks completion;
   - missing required verification blocks completion for coding goals.

### Acceptance Criteria

- Coding goals cannot complete with only textual evidence.
- Failed required verification blocks completion.
- Passed commands create deterministic-check evidence.
- Chat output shows a summary, not full command logs.

## 11. Phase 6: Skill Eval Harness

Status: Complete.

Purpose: evaluate and improve skills using the same Shaula execution loop.

### Current Status

The referenced RFC file is missing from the available workspace. This section is
therefore a target integration shape, not the final RFC implementation.

### Design Decision

Skill eval should be implemented as a vertical workflow on top of Shaula's
contract/evidence/rubric/action loop. It should not become a separate evaluator
platform with separate data models.

### Proposed Workflow

1. Intake:
   - skill package or skill directory
   - use cases
   - rubric
   - baseline version

2. Contract:
   - what the skill should accomplish
   - allowed changes
   - non-goals
   - required evaluation evidence

3. Evaluation run:
   - execute use cases
   - collect outputs
   - score against rubric
   - record evidence

4. Improvement loop:
   - convert failed rubric criteria into actions
   - propose or apply skill edits
   - re-run selected use cases
   - compare versions

5. Output:
   - evaluation report
   - per-use-case score table
   - version diff
   - release candidate package

### Acceptance Criteria

- Skill eval uses the same Evidence Ledger.
- Skill eval uses the same RubricEvaluation shape or a compatible extension.
- Improvement actions are traceable back to failed use cases.
- The user can inspect why a skill version improved or regressed.

## 12. Phase 7: EvaluationAction Queue

Status: Complete.

Purpose: make rubric failures executable and trackable.

### Work Items

1. Add action model/store:
   - missing evidence
   - hard fail
   - failed criterion
   - min score failure
   - triggered pitfall
   - blocked or ask-user state

2. Map `RubricEvaluation` to actions.

3. Render unresolved actions in the goal timeline/control area.

4. Resolve actions when:
   - matching evidence appears;
   - criterion passes;
   - user waives the action;
   - goal is intentionally blocked.

5. Feed concise action summary into continuation prompts.

### Acceptance Criteria

- A failed evaluation produces structured actions.
- Actions are visible.
- Actions can resolve.
- The next model turn receives action guidance instead of raw rubric output.

## 13. Phase 8: Verifier Path

Status: Complete.

Purpose: separate producer and evaluator without overcomplicating the first
release.

### Decision

Do not make verifier subagent mandatory on day one. The current pure verifier
gate is valuable and cheaper. Strengthen it first. Add read-only verifier
subagent for higher-risk tasks after contract/evidence/action are stable.

### Work Items

1. Improve pure verifier gate:
   - contract-aware
   - trust-level-aware
   - required verification-aware

2. Add optional verifier subagent path:
   - read-only tools only
   - no write tools
   - input limited to contract, diff, evidence refs, rubric, and final output
   - structured output only

3. Promote to mandatory only after real runs prove value.

### Acceptance Criteria

- Completion does not rely on developer self-assessment.
- Verifier can reject missing evidence.
- Optional verifier subagent cannot modify files.

## 14. Phase 9: Advisory Task Router

Status: Complete.

Purpose: make mode selection more consistent without letting early routing bugs
control the system.

### Decision

Start with an advisory router, not a hard dispatcher.

### Work Items

1. Add route decision type:
   - direct
   - goal
   - workflow template
   - workflow script
   - subagent batch
   - browser task
   - ask user

2. Store route decision and reasons.

3. Let main agent override only with a reason.

4. Surface the chosen route in UI/debug timeline.

### Acceptance Criteria

- Similar requests produce similar route suggestions.
- Route decision is visible.
- User can understand why Shaula chose goal/workflow/subagent/browser/ask-user.

## 15. Phase 10: Performance And Package Optimization

Status: Complete.

Purpose: improve runtime experience and distribution quality after the execution
spine is stable enough to measure.

### Immediate Fixes

1. Cross-platform build script:
   - required before any release work.

2. Add simple bundle/build size measurement:
   - record `.next/static` size;
   - track largest chunks;
   - prevent silent regression later.

### Near-term Performance Work

1. Profile current state before changing:
   - long message streaming;
   - 100+ message conversation;
   - sidebar session list;
   - goal/evidence timeline open.

2. Remaining likely hotspots:
   - session polling in `useSessions`;
   - `ChatApp` state concentration;
   - message list rerenders;
   - long conversation virtualization;
   - Electron startup path.

3. Candidate improvements:
   - event-driven session refresh instead of polling;
   - memoize message list/message rows where not already done;
   - virtualize long message lists;
   - add FPS/token-to-paint instrumentation;
   - review Electron packaging and `asarUnpack` scope.

### Acceptance Criteria

- Build works on Windows.
- Bundle size is tracked.
- Performance changes are backed by before/after profiling.
- No large Electron architecture rewrite before data shows it is needed.

## 16. Explicit Non-goals For First Build

Do not do these in the first pass:

- Immediate migration from legacy app state into `~/.shaula/`.
- Public publish, npm release, GitHub push, or deployment without explicit user
  confirmation.
- Full UI redesign from scratch.
- Mandatory verifier subagent for every task.
- Electron architecture rewrite from HTTP/SSE to full IPC.
- Separate skill-eval platform with separate evidence/evaluation models.
- Large package slimming before build compatibility and measurement are in place.

## 17. Proposed Implementation Order

Recommended commit sequence:

1. `chore(shaula): lock execution-spine baseline`
2. `fix(build): make Next build script cross-platform`
3. `brand(shaula): update visible product identity`
4. `ui(shaula): improve workbench scale and control readability`
5. `feat(contract): add execution contract v0`
6. `feat(evaluation): surface completion evaluation in goal UI`
7. `feat(evidence): add trust and criteria mapping to ledger`
8. `feat(verification): add host-run verification plan`
9. `feat(skills): add skill evaluation workflow harness`
10. `feat(evaluation): add evaluation action queue`
11. `feat(verifier): add optional read-only verifier path`
12. `feat(router): add advisory task router`
13. `perf(build): add performance and bundle guardrails`

## 18. Review Questions

Before implementation starts, confirm these:

1. Should the first app icon use a temporary lucide-style `Crosshair/Target`
   mark, or should we create a proper Shaula app icon asset first?
2. Should the package expose both `shaula-agent` and legacy binaries
   during the transition?
3. Can the missing skill-eval RFC file be provided, or should the first skill
   harness be designed from the workflow shape in this document?
4. Should UI copy stay bilingual where technical, or move visible product copy
   mostly to English around the tagline?
5. Should the first Shaula build read legacy data paths, or write Shaula state
   only after a migration decision?

## 19. Definition Of Done For First Shaula Build

The first Shaula build is ready when:

- the app visibly presents as Shaula Agent;
- substantial goals have an execution contract;
- completion cannot pass without evidence;
- missing evidence and failed criteria are visible to the user;
- host-run verification can produce deterministic evidence;
- skill evaluation has a workflow path or a confirmed implementation plan;
- Windows build, tests, and lint pass;
- no existing local sessions/settings are accidentally lost.
