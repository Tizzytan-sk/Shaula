# Shaula Positioning

> Status: Draft
> Date: 2026-06-14
> Purpose: Define the independent direction for Shaula, a Shaula Agent-derived
> branch focused on getting real tasks finished even with weaker or lower-cost
> models.

## 1. Name

**Shaula**

Shaula is the proposed name for the pulled-back, independently directed branch
of Shaula Agent.

The name carries a sharp, decisive image: strike the critical point, stop the
drift, and finish the work. It should not feel like a generic AI chat product.
It should feel like a task workbench that finds the weak point in a problem and
drives the job to completion.

Suggested product surfaces:

| Surface | Name |
| --- | --- |
| Product name | Shaula |
| App name | Shaula Agent |
| Package name | `shaula-agent` |
| Local data directory | `~/.shaula/` |

## 2. Tagline

> **Strike the core. Finish the work.**

This is the core brand sentence.

It means:

- Strike the core: identify the real blocker, not just respond to the prompt.
- Finish the work: require evidence, verification, and closure.
- Stay sharp: avoid vague chatting, drifting plans, and premature completion.

## 3. Relationship To Shaula Agent

Shaula should not be framed as a hostile fork or a simple rename of Shaula Agent.
It should be framed as an experimental branch with a different product thesis.

Shaula Agent can continue as the original local-first agent workbench.

Shaula explores a narrower question:

> Can an agent workbench use task contracts, structured execution, verification,
> and repair loops to make weaker or lower-cost models finish real work more
> reliably?

This leaves room for continued collaboration with the original Shaula Agent
author while keeping Shaula's direction independent and testable.

## 4. Product Thesis

Most agent products assume the model is strong enough to be the main driver.
Shaula assumes the model may be unreliable.

The model should not be treated as the product's brain. It should be treated as
one replaceable worker inside a stronger execution system.

Shaula's value is not that it makes weak models intelligent. Its value is that
it surrounds weaker models with enough structure to reduce drift, catch errors,
force verification, and keep the task moving.

In short:

> Strong models benefit from Shaula. Weak models need Shaula.

## 5. Target Outcome

Shaula should optimize for task completion rate, not chat quality.

The first target should be bounded, verifiable software and knowledge-work tasks:

- small bug fixes;
- local refactors;
- test additions;
- documentation updates;
- browser acceptance checks;
- batch inspection and summarization;
- repeatable workflow runs;
- issue triage and evidence-backed reports.

Shaula should not claim that any weak model can complete any task. The stronger
claim is narrower and more defensible:

> Shaula improves the completion rate of lower-cost models on bounded,
> verifiable tasks by controlling task shape, context, tools, and verification.

## 6. Execution Protocol

Shaula should move from free-form chat toward a default task protocol.

Every non-trivial task should pass through:

1. Task contract
2. Scope and non-goals
3. Acceptance criteria
4. Context collection
5. Step decomposition
6. Tool execution
7. Evidence capture
8. Verification
9. Repair loop if needed
10. Completion decision

The core rule:

> No evidence, no completion.

Evidence can include:

- test output;
- diff summary;
- file path and line reference;
- screenshot;
- browser observation;
- command log;
- generated artifact;
- structured checklist result.

## 7. Weak-Model Compensation

Shaula should compensate for weak models through system design.

| Failure mode | Shaula response |
| --- | --- |
| Goal drift | Freeze a task contract and restate acceptance criteria before execution. |
| Bad context selection | Let the system gather and rank context before the model acts. |
| Overlarge task | Split into smaller steps with one action per step. |
| Tool misuse | Use tool allowlists, structured inputs, and retryable tool calls. |
| Premature completion | Require evidence and verification before marking done. |
| Repeated failure | Classify the failure, shrink the step, refresh context, or escalate model. |
| Weak JSON discipline | Use schemas, repair parsers, and smaller structured outputs. |
| Weak planning | Prefer deterministic workflow templates over open-ended planning. |

The weaker the model, the narrower the task step should become.

## 8. Product Principles

1. Completion over conversation.
   The product should optimize for finished work, not long back-and-forth chat.

2. Contracts before action.
   The agent should know what "done" means before touching files or tools.

3. Evidence before confidence.
   A confident answer without evidence is not enough.

4. Small steps beat clever prompts.
   Weak models perform better when each step has limited scope and clear inputs.

5. Repair is a first-class path.
   Failure should trigger structured recovery, not vague apologies or silent
   retries.

6. Model capability is a runtime variable.
   Execution strategy should adapt to model quality, context length, tool
   reliability, and structured-output discipline.

7. Local-first remains a boundary.
   User files, session history, workflow traces, and evidence should stay local
   unless the user explicitly chooses otherwise.

## 9. First-Phase Build Direction

Shaula should not begin with logo, website, pet behavior, or visual polish.

The first phase should change the execution spine:

| Priority | Work item | Result |
| --- | --- | --- |
| P0 | Task contract card | Every substantial request has goal, scope, non-goals, and acceptance criteria. |
| P0 | Evidence gate | Agent cannot mark work complete without concrete evidence. |
| P0 | Step runner | Large tasks are decomposed into small, inspectable steps. |
| P1 | Repair loop | Failed steps are classified and retried with narrower context. |
| P1 | Model profile | Lower-quality models get smaller steps, stricter schemas, and more checks. |
| P1 | Workflow defaults | `/workflow` and `/goal` become natural execution modes, not hidden power-user features. |
| P2 | Completion metrics | Track pass rate, retry count, evidence count, and user intervention count. |

## 10. Open Questions

- Should Shaula remain source-compatible with Shaula Agent for as long as possible?
- Should `~/.shaula/` data be migrated to `~/.shaula/` or reused during early experiments?
- Should Shaula expose weak-model mode explicitly, or infer model capability from provider/model profiles?
- Which three benchmark tasks should define the first completion-rate baseline?
- What minimum evidence should be required for code, browser, document, and analysis tasks?

## 11. One-Sentence Summary

Shaula is a Shaula Agent-derived task workbench built around one promise:

> **Strike the core. Finish the work.**

It uses contracts, context control, workflow structure, evidence gates, and
repair loops so even weaker models have a better chance of finishing bounded,
verifiable work.
