---
name: codex-rules
description: apply coding standards, regression discipline, and implementation guardrails for all coding tasks. use when chatgpt is asked to write, edit, refactor, review, debug, or plan code in any language or framework. review the bundled rules one by one, apply only the rules relevant to the current task, surface conflicts explicitly, and favor additive changes, stable regressions, consistent styling, and project-level conventions over local shortcuts.
---

# Codex Rules

## Overview

Use this skill for every coding task. Review the rules in `references/codex-rules.md` one by one before changing code, then apply only the rules that materially affect the current task.

## Workflow

1. Identify the task type before editing anything: implementation, bug fix, refactor, styling, review, architecture, or regression follow-up.
2. Read `references/codex-rules.md` and evaluate each rule against the current task.
3. State the rules that matter for this task in the plan or reasoning summary.
4. Prefer additive edits over rewrites unless the existing structure cannot support the requested change.
5. If two rules appear to conflict, resolve the conflict explicitly and choose the option that preserves correctness, maintainability, and project conventions.
6. After making changes, verify that the result still complies with the relevant rules.

## Rule Application Standard

- Do not apply rules mechanically when they are irrelevant to the task.
- Do not ignore a relevant rule just because the immediate request is narrow.
- Treat regression and scope rules as release-blocking guidance, not optional advice.
- Treat design and styling rules as defaults unless the repository or the user explicitly requires a different convention.
- When a repository already has stronger local conventions, follow the repository unless doing so would violate a critical safety or correctness rule.

## Regression Handling

When a task touches shared logic, thresholds, scoring, rendering, normalization, validation, chunking, repair helpers, or any other behavior that can affect multiple inputs, follow the regression rules in `references/codex-rules.md` strictly.

Default to the broader rerun scope when the blast radius is unclear.

## UI And Styling Handling

For frontend work, treat the styling and layout rules in `references/codex-rules.md` as the default baseline. Reuse global styles, avoid overlapping overrides, avoid nested cards, and prevent overflow clipping issues.

If the task requires an exception, name the exception explicitly and keep the deviation as small as possible.

## Planning Capture

When the user is planning with the agent and mentions future work, deferred ideas, or follow-up tasks to handle later, always create or update `docs/plan-later.md`.

- Capture later-work items in that file as they arise during planning conversations.
- Keep entries concise, explicit, and action-oriented so they can be picked up later without guessing.
- Treat `docs/plan-later.md` as the running repository note for deferred plans, not as a replacement for the immediate task plan.

## Output Expectations

For coding tasks, the final response should usually make clear:

- which rules were relevant
- what constraints they imposed on the solution
- whether any rule conflicts or trade-offs remain
- what validation or rerun scope was required

Keep that summary concise unless the user asks for more detail.

## Resource

- `references/codex-rules.md`: authoritative coding, regression, styling, and change-management rules for this skill
